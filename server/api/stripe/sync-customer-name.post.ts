// SPDX-License-Identifier: MIT
import { findOrganization, requireAuthSession, requireOrganizationRole } from '~~/server/utils/billing'
import { useDB } from '~~/server/utils/db'
import { syncStripeCustomerName } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  await requireAuthSession(event)

  const body = (await readBody(event)) ?? {}
  const { organizationId, name } = body

  if (!organizationId) {
    throw createError({ statusCode: 400, message: 'organizationId is required' })
  }

  // Check ownership before loading the organization, so a caller who is
  // not its owner gets the same 403 whether or not it exists.
  await requireOrganizationRole(event, organizationId, ['owner'])

  const db = await useDB()
  const org = await findOrganization(db, organizationId)

  if (!org) {
    throw createError({ statusCode: 404, message: 'Organization not found' })
  }

  // Sync customer name if org has a Stripe customer
  if (org.stripeCustomerId) {
    await syncStripeCustomerName(organizationId, name)
  }

  return { success: true }
})
