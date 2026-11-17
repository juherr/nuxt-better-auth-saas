import type { H3Event } from 'h3'
import type Stripe from 'stripe'
import type { OrgRole } from '~~/shared/utils/permissions'
import { and, eq, inArray } from 'drizzle-orm'
import { member as memberTable, subscription as subscriptionTable } from '~~/server/db/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

type Database = Awaited<ReturnType<typeof useDB>>

export interface BillingOrganization {
  id: string
  stripeCustomerId?: string | null
}

type AuthSession = NonNullable<Awaited<ReturnType<typeof getAuthSession>>>

const sessionsByEvent = new WeakMap<H3Event, AuthSession>()

/**
 * Requires a signed-in user and answers 401 otherwise. Routes call it
 * before reading their input, so an anonymous caller never gets a 400.
 * The session is kept for the rest of the request, so a later
 * `requireOrganizationRole` on the same event does not look it up again.
 */
export async function requireAuthSession(event: H3Event): Promise<AuthSession> {
  const known = sessionsByEvent.get(event)
  if (known) {
    return known
  }

  const session = await getAuthSession(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  sessionsByEvent.set(event, session)
  return session
}

/**
 * Requires a signed-in user who is a member of the organization and, when
 * `roles` is given, whose stored role is exactly one of them. Without
 * `roles`, any membership passes, whatever its role value.
 * Anonymous callers get 401. A non-member and a member with another role
 * get the same 403, so the answer does not reveal membership.
 */
export async function requireOrganizationRole(
  event: H3Event,
  organizationId: string,
  roles?: readonly OrgRole[]
) {
  const session = await requireAuthSession(event)

  const db = await useDB()
  const member = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, session.user.id)
    )
  })

  if (!member || (roles && !roles.includes(member.role as OrgRole))) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  return { session, member }
}

const subscriptionNotFound = () =>
  createError({ statusCode: 404, statusMessage: 'Subscription not found' })

const customerIdOf = (customer: Stripe.Subscription['customer'] | null | undefined) =>
  typeof customer === 'string' ? customer : customer?.id

/**
 * Resolves a client-supplied Stripe subscription id to a subscription that
 * belongs to `org`: the organization must hold a local record of it, and
 * Stripe must bill it to the organization's customer. Every failed check
 * answers the same 404. This only reads; callers update afterwards.
 */
export async function resolveOwnedSubscription(
  db: Database,
  stripe: Stripe,
  org: BillingOrganization,
  subscriptionId: string
): Promise<Stripe.Subscription> {
  if (!org.stripeCustomerId) {
    throw subscriptionNotFound()
  }

  // No unique index on stripeSubscriptionId: any matching record will do.
  const record = await db.query.subscription.findFirst({
    where: and(
      eq(subscriptionTable.referenceId, org.id),
      eq(subscriptionTable.stripeSubscriptionId, subscriptionId)
    )
  })
  if (!record || record.referenceId !== org.id || record.stripeSubscriptionId !== subscriptionId) {
    throw subscriptionNotFound()
  }

  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error: any) {
    if (error?.code === 'resource_missing') {
      throw subscriptionNotFound()
    }
    throw error
  }

  if (customerIdOf(subscription.customer) !== org.stripeCustomerId) {
    throw subscriptionNotFound()
  }

  return subscription
}

const ACTIVE_STATUSES = ['active', 'trialing'] as const

const isActiveStatus = (status: string | null | undefined) =>
  (ACTIVE_STATUSES as readonly string[]).includes(status ?? '')

export type SubscriptionChoice<T>
  = | { outcome: 'none' }
    | { outcome: 'one', subscription: T }
    | { outcome: 'many' }

/**
 * Decides between candidate subscriptions, counting one id once. It never
 * picks among several distinct subscriptions: the caller must refuse.
 */
export function chooseSingleSubscription<T extends { id: string }>(candidates: readonly T[]): SubscriptionChoice<T> {
  const distinct = new Map(candidates.map(candidate => [candidate.id, candidate]))
  if (distinct.size === 0) {
    return { outcome: 'none' }
  }
  if (distinct.size > 1) {
    return { outcome: 'many' }
  }
  return { outcome: 'one', subscription: distinct.values().next().value! }
}

async function retrieveIfExists(stripe: Stripe, subscriptionId: string) {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error: any) {
    if (error?.code === 'resource_missing') {
      return undefined
    }
    throw error
  }
}

/**
 * Local records of the organization that are active or trialing, confirmed
 * by Stripe: the subscription exists, is billed to the organization's
 * customer and is still active or trialing there.
 */
async function verifiedLocalSubscriptions(stripe: Stripe, db: Database, org: BillingOrganization, customerId: string) {
  const rows = await db.query.subscription.findMany({
    where: and(
      eq(subscriptionTable.referenceId, org.id),
      inArray(subscriptionTable.status, [...ACTIVE_STATUSES])
    )
  })
  // No unique index on stripeSubscriptionId: several rows may share one id.
  const ids = new Set(rows
    .filter(row => row.referenceId === org.id && isActiveStatus(row.status))
    .map(row => row.stripeSubscriptionId)
    .filter((id): id is string => !!id))

  const verified: Stripe.Subscription[] = []
  for (const id of ids) {
    const subscription = await retrieveIfExists(stripe, id)
    if (subscription && customerIdOf(subscription.customer) === customerId && isActiveStatus(subscription.status)) {
      verified.push(subscription)
    }
  }
  return verified
}

/** Every active or trialing subscription of the customer, across all list pages. */
async function listedActiveSubscriptions(stripe: Stripe, customerId: string) {
  const listed: Stripe.Subscription[] = []
  for (const status of ACTIVE_STATUSES) {
    // `for await` walks every page (ApiListPromise is an async iterator).
    for await (const subscription of stripe.subscriptions.list({ customer: customerId, status })) {
      listed.push(subscription)
    }
  }
  return listed
}

/**
 * Finds the organization's single active or trialing Stripe subscription.
 * Local records of the organization come first, each confirmed by Stripe;
 * without any, the customer's active and trialing subscriptions are listed.
 * Answers 400 when there is none and 409 when there are several: it never
 * picks one arbitrarily.
 */
export async function selectActiveSubscription(
  stripe: Stripe,
  db: Database,
  org: BillingOrganization
): Promise<Stripe.Subscription> {
  const noActiveSubscription = () =>
    createError({ statusCode: 400, statusMessage: 'No active subscription found' })

  if (!org.stripeCustomerId) {
    throw noActiveSubscription()
  }

  let candidates = await verifiedLocalSubscriptions(stripe, db, org, org.stripeCustomerId)
  if (candidates.length === 0) {
    candidates = await listedActiveSubscriptions(stripe, org.stripeCustomerId)
  }

  const choice = chooseSingleSubscription(candidates)
  if (choice.outcome === 'none') {
    throw noActiveSubscription()
  }
  if (choice.outcome === 'many') {
    throw createError({ statusCode: 409, statusMessage: 'Multiple active subscriptions' })
  }
  return choice.subscription
}
