import type { H3Event } from 'h3'
import type Stripe from 'stripe'
import type { OrgRole } from '~~/shared/utils/permissions'
import { and, eq } from 'drizzle-orm'
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
