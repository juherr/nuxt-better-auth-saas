import { requireOwnedSubscription } from '~~/server/utils/billing'
import { addPaymentLog } from '~~/server/utils/stripe'
import { sendSubscriptionResumedEmail } from '~~/server/utils/stripeEmails'

export default defineEventHandler(async (event) => {
  const { stripe, subscriptionId, referenceId } = await requireOwnedSubscription(event)

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
  } catch (error) {
    console.error('[stripe/resume]', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to resume subscription'
    })
  }
})
