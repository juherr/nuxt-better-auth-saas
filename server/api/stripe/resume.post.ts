import { eq } from 'drizzle-orm'
import { organization as organizationTable } from '~~/server/db/schema'
import { requireAuthSession, requireOrganizationRole, resolveOwnedSubscription } from '~~/server/utils/billing'
import { useDB } from '~~/server/utils/db'
import { addPaymentLog, createStripeClient } from '~~/server/utils/stripe'
import { sendSubscriptionResumedEmail } from '~~/server/utils/stripeEmails'

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
    // Resume subscription (disable cancel_at_period_end)
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false
    })

    // Log the event
    await addPaymentLog('subscription_resumed', subscription)

    // Send resumed email
    await sendSubscriptionResumedEmail(referenceId, subscription)

    return {
      success: true,
      subscription
    }
  } catch (error: any) {
    console.error('Stripe resume error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to resume subscription'
    })
  }
})
