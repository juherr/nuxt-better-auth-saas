import { eq } from 'drizzle-orm'
import { organization as organizationTable } from '~~/server/db/schema'
import { requireAuthSession, requireOrganizationRole, resolveOwnedSubscription } from '~~/server/utils/billing'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  await requireAuthSession(event)

  const body = (await readBody(event)) ?? {}
  const { subscriptionId, referenceId } = body

  if (!subscriptionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Subscription ID is required'
    })
  }

  if (!referenceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Reference ID (Organization ID) is required'
    })
  }

  // subscriptionId and referenceId are client input: check the caller owns
  // the organization, then that the subscription is billed to it.
  await requireOrganizationRole(event, referenceId, ['owner'])

  const db = await useDB()
  const organization = await db.query.organization.findFirst({
    where: eq(organizationTable.id, referenceId)
  })
  if (!organization) {
    throw createError({ statusCode: 404, statusMessage: 'Subscription not found' })
  }

  const stripe = createStripeClient()
  await resolveOwnedSubscription(db, stripe, organization, subscriptionId)

  try {
    // Cancel at period end
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    })

    // We need to manually trigger the log function from server/utils/stripe if we want consistency,
    // but `addPaymentLog` is not exported.
    // However, the webhook will eventually fire and log it too.
    // But for immediate UI feedback and audit log, we can try to log if we export it.
    // Since `addPaymentLog` is not exported in `server/utils/stripe.ts`, we'll skip it or export it.
    // I will export it in a subsequent edit if needed, but for now let's just return success.

    return {
      success: true,
      subscription
    }
  } catch (error: any) {
    console.error('Stripe cancel error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to cancel subscription'
    })
  }
})
