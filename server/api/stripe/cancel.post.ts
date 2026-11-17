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
  } catch (error: any) {
    console.error('Stripe cancel error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to cancel subscription'
    })
  }
})
