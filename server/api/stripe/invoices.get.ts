import { eq } from 'drizzle-orm'
import { subscription as subscriptionTable } from '~~/server/db/schema'
import { findOrganization, requireAuthSession, requireOrganizationRole } from '~~/server/utils/billing'
import { useDB } from '~~/server/utils/db'
import { createStripeClient } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  await requireAuthSession(event)

  const query = getQuery(event)
  const organizationId = query.organizationId as string
  const limit = Math.min(Number(query.limit) || 10, 100)
  const startingAfter = query.startingAfter as string | undefined

  if (!organizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing organizationId'
    })
  }

  const db = await useDB()

  await requireOrganizationRole(event, organizationId)

  const org = await findOrganization(db, organizationId)

  if (!org || !org.stripeCustomerId) {
    return {
      invoices: [],
      hasMore: false
    }
  }

  // Get the subscription for this organization to filter invoices
  const orgSubscription = await db.query.subscription.findFirst({
    where: eq(subscriptionTable.referenceId, organizationId)
  })

  const stripe = createStripeClient()

  try {
    // Fetch invoices filtered by this organization's subscription
    // This ensures users with multiple orgs only see invoices for this specific org
    const invoices = await stripe.invoices.list({
      customer: org.stripeCustomerId,
      limit,
      starting_after: startingAfter || undefined,
      ...(orgSubscription?.stripeSubscriptionId && { subscription: orgSubscription.stripeSubscriptionId })
    })

    return {
      invoices: invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amount: inv.amount_paid,
        currency: inv.currency,
        created: inv.created,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        invoicePdf: inv.invoice_pdf,
        description: inv.description || inv.lines.data[0]?.description || 'Subscription'
      })),
      hasMore: invoices.has_more
    }
  } catch (e: any) {
    console.error('Failed to fetch invoices:', e)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch invoices'
    })
  }
})
