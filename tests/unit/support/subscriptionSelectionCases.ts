import type { StripeSubscriptionsState } from './stripeSubscriptionsFake'
import { fakeSubscription } from './stripeSubscriptionsFake'

/**
 * Selection rules every billing route that acts on "the" active
 * subscription must follow. Each route test runs this whole table through
 * a small adapter of its own (see `SelectionRouteAdapter`).
 *
 * The organization is `org-a`, billed to the Stripe customer `cus_a`.
 */

export interface LocalSubscriptionRow {
  id: string
  referenceId: string
  status: string
  stripeSubscriptionId: string | null
}

export type SelectionOutcome
  = | { selected: string }
    | { statusCode: number, statusMessage: string }

export interface SelectionCase {
  name: string
  localRows: LocalSubscriptionRow[]
  stripe: StripeSubscriptionsState
  expected: SelectionOutcome
}

/** Stripe namespaces a route calls once it holds the selected subscription. */
export interface DownstreamStripe {
  subscriptions?: Record<string, unknown>
  [namespace: string]: Record<string, unknown> | undefined
}

export interface SelectionRouteAdapter {
  load: () => Promise<{ default: unknown }>
  body: Record<string, unknown>
  /** Fresh stubs for the calls the route makes after selecting. */
  downstream: () => DownstreamStripe
  /** The subscription id that reached the route's downstream Stripe call, if any. */
  selectedId: (downstream: DownstreamStripe) => string | undefined
}

const row = (stripeSubscriptionId: string, status = 'active'): LocalSubscriptionRow =>
  ({ id: `local-${stripeSubscriptionId}`, referenceId: 'org-a', status, stripeSubscriptionId })

const noActive = { statusCode: 400, statusMessage: 'No active subscription found' }
const several = { statusCode: 409, statusMessage: 'Multiple active subscriptions' }

export const selectionCases: SelectionCase[] = [
  {
    name: 'an active subscription listed after a canceled one',
    localRows: [],
    stripe: { pages: [[fakeSubscription('sub_old', 'canceled'), fakeSubscription('sub_new', 'active')]] },
    expected: { selected: 'sub_new' }
  },
  {
    name: 'a local active record next to a canceled one',
    localRows: [row('sub_old', 'canceled'), row('sub_new')],
    stripe: { pages: [[fakeSubscription('sub_old', 'canceled'), fakeSubscription('sub_new', 'active')]] },
    expected: { selected: 'sub_new' }
  },
  {
    name: 'a trialing subscription',
    localRows: [],
    stripe: { pages: [[fakeSubscription('sub_trial', 'trialing')]] },
    expected: { selected: 'sub_trial' }
  },
  {
    name: 'an active subscription on the second list page',
    localRows: [],
    stripe: { pages: [[fakeSubscription('sub_old', 'canceled')], [fakeSubscription('sub_page2', 'active')]] },
    expected: { selected: 'sub_page2' }
  },
  {
    name: 'a local record billed to another customer',
    localRows: [row('sub_foreign')],
    stripe: {
      pages: [[fakeSubscription('sub_own', 'active')]],
      elsewhere: [fakeSubscription('sub_foreign', 'active', 'cus_b')]
    },
    expected: { selected: 'sub_own' }
  },
  {
    name: 'no active or trialing subscription',
    localRows: [],
    stripe: { pages: [[fakeSubscription('sub_old', 'canceled')]] },
    expected: noActive
  },
  {
    name: 'several active subscriptions in Stripe',
    localRows: [],
    stripe: { pages: [[fakeSubscription('sub_1', 'active'), fakeSubscription('sub_2', 'active')]] },
    expected: several
  },
  {
    name: 'two confirmed local records',
    localRows: [row('sub_1'), row('sub_2', 'trialing')],
    stripe: { pages: [[fakeSubscription('sub_1', 'active'), fakeSubscription('sub_2', 'trialing')]] },
    expected: several
  }
]
