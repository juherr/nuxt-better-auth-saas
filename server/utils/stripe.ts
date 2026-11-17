import type { Subscription } from '@better-auth/stripe'
import { stripe } from '@better-auth/stripe'
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable, organization as organizationTable } from '~~/server/db/schema'
import { PAID_TIERS } from '~~/shared/utils/plans'
import { logAuditEvent } from './auditLogger'
import { useDB } from './db'
import { runtimeConfig } from './runtimeConfig'
import {
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
  sendSubscriptionConfirmedEmail,
  sendSubscriptionExpiredEmail,
  sendTrialExpiredEmail,
  sendTrialStartedEmail
} from './stripeEmails'
import { removeExcessMembersOnExpiration } from './subscription-handlers'

/**
 * STRIPE ORGANIZATION BILLING IMPLEMENTATION
 *
 * 1. Customer Creation:
 *    - Customers are created for ORGANIZATIONS, not Users.
 *    - `ensureStripeCustomer(organizationId)` is called explicitly (e.g. before checkout).
 *    - It fetches the Organization and its Owner (for email).
 *    - It creates a Stripe Customer with metadata `organizationId`.
 *    - The Stripe Customer ID is stored in `organization.stripeCustomerId`.
 *
 * 2. Webhook Handling:
 *    - Webhooks are handled by Better Auth's `stripe` plugin.
 *    - The `addPaymentLog` function processes events.
 *    - It retrieves the Organization using `getOrgByStripeCustomerId`.
 *    - Logs are associated with the Organization (via details) and marked as 'system' user actions.
 *
 * 3. Metadata:
 *    - `ownerUserId` is stored in metadata to track the initiator.
 *    - `organizationId` is the primary reference.
 */

/**
 * Billing is optional: it is enabled only when a Stripe secret key is set.
 */
export const isStripeConfigured = () => Boolean(runtimeConfig.stripeSecretKey)

export const createStripeClient = () => {
  if (!isStripeConfigured()) {
    // The Stripe SDK throws an opaque error without a key; answer 503 instead.
    throw createError({
      statusCode: 503,
      statusMessage: 'Billing is not configured'
    })
  }
  // The SDK's pinned version (node_modules/stripe/esm/apiVersion.js), which it also sends when omitted.
  return new Stripe(runtimeConfig.stripeSecretKey!, { apiVersion: Stripe.API_VERSION })
}

export const ensureStripeCustomer = async (organizationId: string) => {
  const client = createStripeClient()
  const db = await useDB()

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org) {
    throw new Error('Organization not found')
  }

  // Check if customer already exists
  if (org.stripeCustomerId) {
    return { id: org.stripeCustomerId }
  }

  // Fetch Owner for email
  const member = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.role, 'owner')
    ),
    with: { user: true }
  })

  const email = member?.user.email

  // Create new customer if not exists
  const customerParams: Stripe.CustomerCreateParams = {
    name: org.name,
    metadata: {
      organizationId: org.id,
      ownerUserId: member?.user.id || ''
    }
  }

  if (email) {
    customerParams.email = email
  }

  const customer = await client.customers.create(customerParams)

  // Update organization with stripe customer id
  await db.update(organizationTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organizationTable.id, organizationId))

  return customer
}

const getOrgByStripeCustomerId = async (stripeCustomerId: string) => {
  const db = await useDB()
  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.stripeCustomerId, stripeCustomerId)
  })
  return org
}

/**
 * Sync Stripe customer name with organization name (shows on invoices).
 * Called after subscription events to ensure the customer name stays as the org name
 * (not the cardholder name from payment method).
 * @param organizationId - The organization ID
 * @param newName - Optional: pass the new name directly to avoid DB race conditions
 */
export const syncStripeCustomerName = async (organizationId: string, newName?: string) => {
  const db = await useDB()
  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org?.stripeCustomerId)
    return

  const nameToSync = newName || org.name
  const client = createStripeClient()
  await client.customers.update(org.stripeCustomerId, {
    name: nameToSync
  })
  console.log(`[Stripe] Synced customer ${org.stripeCustomerId} name to "${nameToSync}"`)
}

export const addPaymentLog = async (action: string, subscription: any) => {
  // Handle both Better Auth subscription object and raw Stripe subscription object
  const customerId = subscription.stripeCustomerId ||
    (typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id)

  if (!customerId)
    return

  const org = await getOrgByStripeCustomerId(customerId)
  if (!org)
    return

  await logAuditEvent({
    userId: undefined, // Webhook event, no specific user
    category: 'payment',
    action: `${action}:${subscription.plan?.id || subscription.plan?.name || 'unknown'}`,
    targetType: 'stripeCustomerId',
    targetId: customerId,
    status: 'success',
    details: `Organization: ${org.name} (${org.id})`
  })
}

/**
 * Seats an organization is billed for: its members plus its pending
 * invitations. Callers apply their own floor.
 */
export const countBillableSeats = (organization: {
  members: unknown[]
  invitations: { status: string }[]
}) => {
  const members = organization.members.length
  const pendingInvitations = organization.invitations.filter(i => i.status === 'pending').length
  return { total: members + pendingInvitations, members, pendingInvitations }
}

export const syncSubscriptionQuantity = async (organizationId: string) => {
  const db = await useDB()
  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId),
    with: {
      members: true,
      invitations: true
    }
  })

  if (!org?.stripeCustomerId)
    return

  const client = createStripeClient()

  // Find active subscription
  const subscriptions = await client.subscriptions.list({
    customer: org.stripeCustomerId,
    status: 'active',
    limit: 1
  })

  if (subscriptions.data.length === 0)
    return

  const subscription = subscriptions.data[0]
  const currentQuantity = subscription.items.data[0].quantity

  // Calculate new quantity
  const newQuantity = countBillableSeats(org).total

  if (currentQuantity !== newQuantity && newQuantity > 0) {
    await client.subscriptions.update(subscription.id, {
      items: [{
        id: subscription.items.data[0].id,
        quantity: newQuantity
      }]
    })

    await logAuditEvent({
      userId: undefined,
      category: 'payment',
      action: 'update_quantity',
      targetType: 'subscription',
      targetId: subscription.id,
      status: 'success',
      details: `Updated quantity from ${currentQuantity} to ${newQuantity}`
    })
  }
}

/**
 * Seats billed at checkout: members plus pending invitations, at least one.
 */
export const resolveCheckoutSeats = async (organizationId: string) => {
  const db = await useDB()
  const organization = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId),
    with: {
      members: true,
      invitations: true
    }
  })
  if (!organization)
    return 1
  const { total: count, members: memberCount, pendingInvitations: inviteCount } = countBillableSeats(organization)
  console.log('[Stripe] Calculated Quantity:', count, 'Members:', memberCount, 'Invites:', inviteCount, 'Org:', organizationId)
  return count > 0 ? count : 1
}

interface UpgradeSession {
  user: { id: string }
  session: Record<string, any>
}

/**
 * The reference an upgrade acts for, resolved as @better-auth/stripe's
 * referenceMiddleware does: `referenceId` from the body, then the query,
 * then the session's active organization (dist/index.mjs,
 * referenceMiddleware), else the user.
 */
export const resolveUpgradeReferenceId = (
  ctx: { body?: any, query?: any },
  session: UpgradeSession
): string => ctx.body?.referenceId
  || ctx.query?.referenceId
  || session.session.activeOrganizationId
  || session.user.id

/**
 * Settles who an upgrade bills and for how many seats, on the server.
 *
 * The reference is `resolveUpgradeReferenceId`'s. Anything but
 * the user's own id is billed as an organization: the body then carries
 * `customerType: 'organization'`, so the plugin's organization branch runs
 * `authorizeReference` on that reference. Client seats are never kept:
 * members plus pending invitations for an organization, one for a user
 * (the base quantity; the plugin bills `ctx.body.seats || 1`). The merge
 * of a before hook skips undefined values (defu), so a key cannot be
 * dropped, only replaced.
 */
export const checkoutSeatsOverride = async (
  ctx: { body?: any, query?: any },
  session: UpgradeSession
) => {
  const body = ctx.body ?? {}
  const referenceId = resolveUpgradeReferenceId(ctx, session)
  if (referenceId === session.user.id)
    return { context: { body: { ...body, customerType: 'user', seats: 1 } } }
  const seats = await resolveCheckoutSeats(referenceId)
  return { context: { body: { ...body, customerType: 'organization', referenceId, seats } } }
}

/**
 * Better Auth `hooks.before` middleware applying `checkoutSeatsOverride`
 * to `/subscription/upgrade`. A before hook returning `{ context: { body } }`
 * is merged over the request (better-auth dist/api/dispatch.mjs,
 * runBeforeHooks). The session is not on the context yet at this point;
 * without one the hook steps aside and the plugin answers 401.
 * auth.ts's before hook runs the same steps on that path, with the
 * foreign-subscription check in between, since one before hook carries
 * every check; the dispatch tests run the override through this one.
 */
export const checkoutSeatsHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/subscription/upgrade')
    return undefined
  const session = await getSessionFromCtx(ctx)
  if (!session)
    return undefined
  return checkoutSeatsOverride(ctx, session)
})

export const setupStripe = () => stripe({
  stripeClient: createStripeClient(),
  stripeWebhookSecret: runtimeConfig.stripeWebhookSecret,
  // Organization subscriptions bill `organization.stripeCustomerId`; 1.7
  // rejects `customerType: 'organization'` without this option.
  // https://better-auth.com/docs/plugins/stripe
  organization: {
    enabled: true
  },
  onEvent: async (event) => {
    // Handle payment_intent.payment_failed - send email when card is declined
    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      const customerId = typeof paymentIntent.customer === 'string'
        ? paymentIntent.customer
        : paymentIntent.customer?.id

      if (customerId) {
        console.log('[Stripe] Payment failed for customer:', customerId, 'Amount:', paymentIntent.amount, 'PI:', paymentIntent.id)
        // sendPaymentFailedEmail has built-in deduplication using KV storage
        await sendPaymentFailedEmail(customerId, paymentIntent.amount, paymentIntent.id)
      }
    }
  },
  createCustomerOnSignUp: false, // Disable for Org-based billing
  subscription: {
    enabled: true,
    getSubscriptionReference: async (subscription: any) => {
      // Try to get organizationId from metadata first
      if (subscription.metadata?.organizationId) {
        return subscription.metadata.organizationId
      }

      // Fallback to stripeCustomerId lookup
      let customerId = subscription.stripeCustomerId
      if (!customerId) {
        if (typeof subscription.customer === 'string') {
          customerId = subscription.customer
        } else if (subscription.customer && typeof subscription.customer === 'object' && 'id' in subscription.customer) {
          customerId = subscription.customer.id
        }
      }

      if (customerId) {
        const org = await getOrgByStripeCustomerId(customerId)
        if (org) {
          return org.id
        }
      }

      return null
    },
    authorizeReference: async ({ user, referenceId }, ctx) => {
      const db = await useDB()
      const member = await db.query.member.findFirst({
        where: and(
          eq(memberTable.organizationId, referenceId),
          eq(memberTable.userId, user.id)
        )
      })

      // Allow all members to view subscription data (for badges, etc.)
      if (member) {
        // For read-only operations (GET requests), allow all members
        if (ctx?.method === 'GET') {
          return true
        }

        // For write operations (POST, PUT, DELETE), only allow owners
        if (member.role === 'owner') {
          // Ensure Stripe Customer exists for the Organization before allowing action
          await ensureStripeCustomer(referenceId)
          return true
        }
      }

      return false
    },
    getCheckoutSessionParams: async ({ session }, ctx) => {
      const body = ctx?.body as any
      const activeOrganizationId = (session as any)?.activeOrganizationId

      const targetOrgId = body?.referenceId || activeOrganizationId

      // The plugin sets `customer` (organization.stripeCustomerId with
      // customerType 'organization') and `line_items` (seats from the body,
      // see checkoutSeatsOverride) itself and drops ours since 1.7.
      const params: any = {
        allow_promotion_codes: true,
        tax_id_collection: {
          enabled: true
        },
        billing_address_collection: 'required',
        // 1.7 defaults to { address: 'auto' } for organization customers;
        // Stripe asks for name 'auto' to collect tax IDs from an existing
        // customer (https://docs.stripe.com/tax/checkout/tax-ids).
        customer_update: {
          name: 'auto',
          address: 'auto'
        },
        metadata: {
          // Ensure metadata is preserved/set
          ...(body?.metadata || {}),
          organizationId: targetOrgId // Explicitly add org ID to metadata
        }
      }

      return { params }
    },
    plans: async () => {
      // Generate plans dynamically from PLAN_TIERS
      const plans: any[] = []

      for (const tier of PAID_TIERS) {
        // Monthly plan with trial
        plans.push({
          name: tier.monthly.id,
          priceId: tier.monthly.priceId,
          freeTrial: {
            days: tier.trialDays,
            onTrialStart: async (subscription: Subscription) => {
              console.log(`[Stripe] ${tier.key} monthly onTrialStart fired:`, { referenceId: subscription.referenceId })
              await addPaymentLog('trial_start', subscription)
              if (subscription.referenceId) {
                await sendTrialStartedEmail(subscription.referenceId, subscription)
              }
            },
            onTrialEnd: async ({ subscription }: { subscription: Subscription }) => {
              console.log(`[Stripe] ${tier.key} monthly onTrialEnd fired:`, { referenceId: subscription.referenceId, status: subscription.status })
              await addPaymentLog('trial_end', subscription)
              if (subscription.referenceId && subscription.status === 'active') {
                console.log('[Stripe] Sending subscription confirmed email for trial end')
                await sendSubscriptionConfirmedEmail(subscription.referenceId, subscription)
              }
            },
            onTrialExpired: async (subscription: Subscription) => {
              await addPaymentLog('trial_expired', subscription)
              if (subscription.referenceId) {
                await removeExcessMembersOnExpiration(subscription.referenceId)
                await sendTrialExpiredEmail(subscription.referenceId, subscription)
              }
            }
          }
        })

        // Yearly plan with trial
        plans.push({
          name: tier.yearly.id,
          priceId: tier.yearly.priceId,
          freeTrial: {
            days: tier.trialDays,
            onTrialStart: async (subscription: Subscription) => {
              console.log(`[Stripe] ${tier.key} yearly onTrialStart fired:`, { referenceId: subscription.referenceId })
              await addPaymentLog('trial_start', subscription)
              if (subscription.referenceId) {
                await sendTrialStartedEmail(subscription.referenceId, subscription)
              }
            },
            onTrialEnd: async ({ subscription }: { subscription: Subscription }) => {
              console.log(`[Stripe] ${tier.key} yearly onTrialEnd fired:`, { referenceId: subscription.referenceId, status: subscription.status })
              await addPaymentLog('trial_end', subscription)
              if (subscription.referenceId && subscription.status === 'active') {
                console.log('[Stripe] Sending subscription confirmed email for trial end')
                await sendSubscriptionConfirmedEmail(subscription.referenceId, subscription)
              }
            },
            onTrialExpired: async (subscription: Subscription) => {
              await addPaymentLog('trial_expired', subscription)
              if (subscription.referenceId) {
                await removeExcessMembersOnExpiration(subscription.referenceId)
                await sendTrialExpiredEmail(subscription.referenceId, subscription)
              }
            }
          }
        })

        // No-trial versions (for users who own multiple orgs)
        plans.push({
          name: `${tier.monthly.id}-no-trial`,
          priceId: tier.monthly.priceId
        })
        plans.push({
          name: `${tier.yearly.id}-no-trial`,
          priceId: tier.yearly.priceId
        })
      }

      return plans
    },
    onSubscriptionComplete: async ({ subscription }) => {
      await addPaymentLog('subscription_created', subscription)
      // Sync customer name back to org name (in case payment method changed it)
      if (subscription.referenceId) {
        await syncStripeCustomerName(subscription.referenceId)
        // Only send confirmation email if subscription has NO trial
        // If there's a trial, emails are handled by onTrialStart (trial started) and onTrialEnd (confirmed/expired)
        const hasTrial = subscription.trialStart || subscription.trialEnd || subscription.status === 'trialing'
        if (!hasTrial) {
          await sendSubscriptionConfirmedEmail(subscription.referenceId, subscription)
        }
      }
    },
    onSubscriptionUpdate: async ({ subscription }) => {
      console.log('[Stripe] onSubscriptionUpdate fired:', {
        referenceId: subscription.referenceId,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
      })
      await addPaymentLog('subscription_updated', subscription)
      // Sync customer name back to org name (in case payment method changed it)
      if (subscription.referenceId) {
        await syncStripeCustomerName(subscription.referenceId)

        // Check if this is a cancellation (cancel_at_period_end was just set to true)
        // This happens when user clicks "Downgrade to Free"
        if (subscription.cancelAtPeriodEnd) {
          console.log('[Stripe] Subscription scheduled for cancellation, sending cancellation email')
          await sendSubscriptionCanceledEmail(subscription.referenceId, subscription)
        }

        // Note: Confirmation emails are sent from onTrialEnd (trial → active)
        // and onSubscriptionComplete (direct subscribe without trial)
        // We don't send emails here to avoid duplicates on plan/seat changes
      }
    },
    onSubscriptionCancel: async ({ subscription }) => {
      await addPaymentLog('subscription_canceled', subscription)
      if (subscription.referenceId) {
        // Note: Cancellation email is sent from onSubscriptionUpdate when cancelAtPeriodEnd is set
        // This hook fires for immediate cancellations, not scheduled ones
        // Remove excess members when subscription is canceled
        await removeExcessMembersOnExpiration(subscription.referenceId)
      }
    },
    onSubscriptionDeleted: async ({ subscription }) => {
      await addPaymentLog('subscription_deleted', subscription)
      // Remove excess members when subscription is deleted/expired
      if (subscription.referenceId) {
        const result = await removeExcessMembersOnExpiration(subscription.referenceId)
        const membersRemoved = result?.removedCount || 0
        // Send subscription expired email
        await sendSubscriptionExpiredEmail(subscription.referenceId, subscription, membersRemoved)
      }
    }
  }
})
