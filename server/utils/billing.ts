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

/**
 * Requires a signed-in user holding one of `roles` in the organization.
 * Anonymous callers get 401. A non-member and a member with another role
 * get the same 403, so the answer does not reveal membership.
 */
export async function requireOrganizationRole(
  event: H3Event,
  organizationId: string,
  roles: readonly OrgRole[]
) {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const db = await useDB()
  const member = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, session.user.id)
    )
  })

  if (!member || !roles.includes(member.role as OrgRole)) {
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
