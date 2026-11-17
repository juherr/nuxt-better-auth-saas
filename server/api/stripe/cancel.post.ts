import { requireOwnedSubscription } from '~~/server/utils/billing'

export default defineEventHandler(async (event) => {
  const { stripe, subscriptionId } = await requireOwnedSubscription(event)

  try {
    // Cancel at period end
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    })

    return {
      success: true,
      subscription
    }
  } catch (error) {
    console.error('[stripe/cancel]', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to cancel subscription'
    })
  }
})
