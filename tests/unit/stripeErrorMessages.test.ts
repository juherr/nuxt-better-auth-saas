// SPDX-License-Identifier: MIT
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_TIERS } from '~~/shared/utils/plans'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'

const findLocalSubscription = vi.hoisted(() => vi.fn())
const selectActiveSubscription = vi.hoisted(() => vi.fn())
const updateSubscription = vi.hoisted(() => vi.fn())
const createSchedule = vi.hoisted(() => vi.fn())
const createInvoicePreview = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/billing', () => ({
  requireAuthSession: async () => ({ user: { id: 'u1' } }),
  requireOrganizationRole: async () => ({ userId: 'u1', organizationId: 'org-a', role: 'owner' }),
  findOrganization: async () => ({ id: 'org-a', stripeCustomerId: 'cus_a' }),
  selectActiveSubscription,
  requireOwnedSubscription: async () => ({
    stripe: { subscriptions: { update: updateSubscription } },
    subscriptionId: 'sub_a',
    referenceId: 'org-a'
  })
}))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({ query: { subscription: { findFirst: findLocalSubscription } } })
}))
vi.mock('~~/server/utils/stripe', () => ({
  createStripeClient: () => ({
    subscriptions: { update: updateSubscription },
    subscriptionSchedules: { create: createSchedule },
    invoices: { createPreview: createInvoicePreview }
  }),
  addPaymentLog: vi.fn()
}))
vi.mock('~~/server/utils/stripeEmails', () => ({
  sendSubscriptionResumedEmail: vi.fn(),
  sendSubscriptionUpdatedEmail: vi.fn()
}))

beforeAll(stubNitroGlobals)

/** Text Stripe put in its error; it must never reach the client. */
const SENTINEL = 'sentinel: No such customer cus_secret_42 (req_abc)'

const stripeError = (fields: Record<string, unknown> = {}) =>
  Object.assign(new Error(SENTINEL), {
    type: 'StripeInvalidRequestError',
    statusCode: 400,
    raw: { message: SENTINEL },
    ...fields
  })
const cardError = () => stripeError({ type: 'StripeCardError', code: 'card_declined', statusCode: 402 })

/** Everything the h3 error would serialise into the response body. */
const exposed = (error: Error) => JSON.stringify({ ...error, message: error.message })

const DECLINED = 'Your card was declined. Please update your payment method.'
const proMonthly = PLAN_TIERS.pro.monthly
const businessMonthly = PLAN_TIERS.business.monthly

const activeSubscription = (priceId: string) => ({
  id: 'sub_a',
  status: 'active',
  currency: 'usd',
  items: { data: [{ id: 'si_a', quantity: 1, price: { id: priceId, recurring: { interval: 'month' } } }] }
})

interface Case {
  load: () => Promise<{ default: unknown }>
  body: Record<string, unknown>
  label: string
  /** Prepares the Stripe call that fails, and makes it reject with `error`. */
  fail: (error: Error) => void
  generic: string
}

const reject = (fn: ReturnType<typeof vi.fn>) => (error: Error) => fn.mockRejectedValue(error)

const failures: Record<string, Case> = {
  'cancel': {
    load: () => import('~~/server/api/stripe/cancel.post'),
    body: {},
    label: '[stripe/cancel]',
    fail: reject(updateSubscription),
    generic: 'Failed to cancel subscription'
  },
  'resume': {
    load: () => import('~~/server/api/stripe/resume.post'),
    body: {},
    label: '[stripe/resume]',
    fail: reject(updateSubscription),
    generic: 'Failed to resume subscription'
  },
  'change-plan (scheduled downgrade)': {
    load: () => import('~~/server/api/stripe/change-plan.post'),
    body: { organizationId: 'org-a', newInterval: 'month', newTierKey: 'pro' },
    label: '[stripe/change-plan]',
    fail: (error) => {
      selectActiveSubscription.mockResolvedValue(activeSubscription(businessMonthly.priceId))
      findLocalSubscription.mockResolvedValue({ plan: businessMonthly.id })
      createSchedule.mockRejectedValue(error)
    },
    generic: 'Failed to schedule plan change'
  },
  'change-plan (upgrade)': {
    load: () => import('~~/server/api/stripe/change-plan.post'),
    body: { organizationId: 'org-a', newInterval: 'month', newTierKey: 'business' },
    label: '[stripe/change-plan]',
    fail: (error) => {
      selectActiveSubscription.mockResolvedValue(activeSubscription(proMonthly.priceId))
      findLocalSubscription.mockResolvedValue({ plan: proMonthly.id })
      updateSubscription.mockRejectedValue(error)
    },
    generic: 'Failed to change plan'
  },
  'update-seats': {
    load: () => import('~~/server/api/stripe/update-seats.post'),
    body: { organizationId: 'org-a', seats: 3 },
    label: '[stripe/update-seats]',
    fail: (error) => {
      selectActiveSubscription.mockResolvedValue(activeSubscription(proMonthly.priceId))
      updateSubscription.mockRejectedValue(error)
    },
    generic: 'Failed to update subscription'
  },
  'preview-seat-change': {
    load: () => import('~~/server/api/stripe/preview-seat-change.post'),
    body: { organizationId: 'org-a', seats: 3 },
    label: '[stripe/preview-seat-change]',
    fail: (error) => {
      selectActiveSubscription.mockResolvedValue(activeSubscription(proMonthly.priceId))
      createInvoicePreview.mockRejectedValue(error)
    },
    generic: 'Failed to calculate preview'
  },
  'preview-tier-change': {
    load: () => import('~~/server/api/stripe/preview-tier-change.post'),
    body: { organizationId: 'org-a', newTierKey: 'business', newInterval: 'month' },
    label: '[stripe/preview-tier-change]',
    fail: (error) => {
      selectActiveSubscription.mockResolvedValue(activeSubscription(proMonthly.priceId))
      createInvoicePreview.mockRejectedValue(error)
    },
    generic: 'Failed to preview plan change'
  }
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  for (const fn of [findLocalSubscription, selectActiveSubscription, updateSubscription, createSchedule, createInvoicePreview]) {
    fn.mockReset()
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe.each(Object.entries(failures))('%s', (_name, route) => {
  it('answers 500 with its generic message when Stripe fails, and logs the details server-side', async () => {
    const error = stripeError()
    route.fail(error)

    const thrown = await callRoute(route.load, route.body).catch((e: Error) => e) as Error

    expect(thrown).toMatchObject({ statusCode: 500, statusMessage: route.generic })
    expect(exposed(thrown)).not.toContain('sentinel')
    expect(consoleError).toHaveBeenCalledWith(route.label, error)
  })
})

describe.each([
  ['change-plan (upgrade)', failures['change-plan (upgrade)']!],
  ['update-seats', failures['update-seats']!]
])('%s', (_name, route) => {
  it('answers 402 with the generic decline text when the card is declined', async () => {
    const error = cardError()
    route.fail(error)

    const thrown = await callRoute(route.load, route.body).catch((e: Error) => e) as Error

    expect(thrown).toMatchObject({ statusCode: 402, statusMessage: DECLINED })
    expect(exposed(thrown)).not.toContain('sentinel')
    expect(consoleError).toHaveBeenCalledWith(route.label, error)
  })
})
