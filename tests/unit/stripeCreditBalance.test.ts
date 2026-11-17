import type Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthSession = vi.hoisted(() => vi.fn())
const findMember = vi.hoisted(() => vi.fn())
const findOrganization = vi.hoisted(() => vi.fn())
const retrieveCustomer = vi.hoisted(() => vi.fn())
const createPreview = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('~~/server/utils/auth', () => ({ getAuthSession }))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({
    query: {
      member: { findFirst: findMember },
      organization: { findFirst: findOrganization }
    }
  })
}))
// Only the methods of the stripe 23 client that the route should call.
vi.mock('~~/server/utils/stripe', () => ({
  createStripeClient: () => ({
    customers: { retrieve: retrieveCustomer },
    invoices: { createPreview }
  })
}))

// Nitro auto-imports these h3 helpers; stand in with the same shapes.
beforeAll(() => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getQuery', () => query.current)
  vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), input))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
// The first import pulls the drizzle schema; keep it out of the test timeout.
beforeAll(async () => {
  await import('~~/server/api/stripe/credit-balance.get')
}, 30_000)
afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type LineFixture = Pick<Stripe.InvoiceLineItem, 'id' | 'object' | 'amount' | 'description'>

function line(id: string, amount: number, description: string): LineFixture {
  return { id, object: 'line_item', amount, description }
}

const customer = {
  id: 'cus_acme',
  object: 'customer',
  balance: -5000, // a $50 credit
  currency: 'eur'
} satisfies Pick<Stripe.Customer, 'id' | 'object' | 'balance' | 'currency'>

const upcomingInvoice = {
  id: 'upcoming_in_1',
  object: 'invoice',
  lines: {
    object: 'list',
    data: [
      line('il_1', -1500, 'Unused time on Pro'),
      line('il_2', 2900, 'Remaining time on Business'),
      line('il_3', -500, 'Unused seat')
    ],
    has_more: false,
    url: '/v1/invoices/upcoming_in_1/lines'
  }
} satisfies Pick<Stripe.Invoice, 'id' | 'object'> & { lines: Pick<Stripe.ApiList<LineFixture>, 'object' | 'data' | 'has_more' | 'url'> }

async function callCreditBalance(organizationId = 'org-1') {
  query.current = { organizationId }
  const { default: handler } = await import('~~/server/api/stripe/credit-balance.get')
  return (handler as unknown as (event: unknown) => Promise<{ creditBalance: number, currency: string }>)({})
}

describe('the credit balance endpoint', () => {
  beforeEach(() => {
    getAuthSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    findMember.mockReset().mockResolvedValue({ userId: 'u1', organizationId: 'org-1', role: 'member' })
    findOrganization.mockReset().mockResolvedValue({ id: 'org-1', stripeCustomerId: 'cus_acme' })
    retrieveCustomer.mockReset().mockResolvedValue(customer)
    createPreview.mockReset().mockResolvedValue(upcomingInvoice)
  })

  it('previews the customer\'s upcoming invoice with the invoice preview API', async () => {
    await callCreditBalance()

    expect(createPreview).toHaveBeenCalledTimes(1)
    expect(createPreview).toHaveBeenCalledWith({ customer: 'cus_acme' })
  })

  it('adds the credits of the upcoming invoice to the customer balance', async () => {
    const result = await callCreditBalance()

    // $50 balance + $15 and $5 credit lines; the $29 charge is ignored.
    expect(result).toEqual({ creditBalance: 70, currency: 'eur' })
  })

  it('keeps the customer balance alone when the preview fails', async () => {
    createPreview.mockRejectedValue(new Error('No upcoming invoices for customer'))

    const result = await callCreditBalance()

    expect(result).toEqual({ creditBalance: 50, currency: 'eur' })
  })
})
