import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { PLAN_TIERS, registeredPlanNames } from '~~/shared/utils/plans'
import PricingPage from '~/pages/pricing/index.vue'

// The pricing page CTA starts a Stripe checkout through better-auth. The plan
// it sends must be one the Stripe plugin registers (derived from PLAN_TIERS,
// see server/utils/stripe.ts), and the prices it shows must be PLAN_TIERS'.

const { upgrade, toastAdd, authState } = vi.hoisted(() => ({
  upgrade: vi.fn(),
  toastAdd: vi.fn(),
  authState: { organization: { subscriptions: [] as unknown[], userOwnsMultipleOrgs: false } }
}))

mockNuxtImport('useI18n', () => () => ({
  t: (key: string, params?: { price?: number }) =>
    params?.price !== undefined ? `${key}:${params.price}` : key
}))
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('useAuth', () => () => ({
  loggedIn: ref(true),
  session: ref({ activeOrganizationId: null }),
  subscription: { upgrade },
  payment: 'stripe',
  useActiveOrganization: () => ref({ data: { id: 'org-1', ...authState.organization } })
}))

async function mountPage() {
  // The layout's navigation needs the real i18n; only the page body is under test.
  return mountSuspended(PricingPage, {
    global: { stubs: { NuxtLayout: { template: '<div><slot /></div>' } } }
  })
}

async function selectYearly(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  await wrapper.find('button[role="radio"][id$=":yearly"]').trigger('click')
  await nextTick()
}

async function clickProCta(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  const cta = wrapper.findAll('button').find(b => b.text() === 'pricing.cta.pro')
  expect(cta).toBeDefined()
  await cta!.trigger('click')
  await vi.waitFor(() => expect(upgrade).toHaveBeenCalled())
  return upgrade.mock.calls.at(-1)![0].plan as string
}

describe('pricing page', () => {
  beforeEach(() => {
    upgrade.mockReset()
    upgrade.mockResolvedValue({ data: { url: 'https://checkout' }, error: null })
    toastAdd.mockReset()
    authState.organization = { subscriptions: [], userOwnsMultipleOrgs: false }
  })

  it('sends a registered plan name for the monthly checkout', async () => {
    const wrapper = await mountPage()
    const plan = await clickProCta(wrapper)

    expect(registeredPlanNames()).toContain(plan)
    expect(plan).toBe(PLAN_TIERS.pro.monthly.id)
  })

  it('sends a registered plan name for the yearly checkout', async () => {
    const wrapper = await mountPage()
    await selectYearly(wrapper)
    const plan = await clickProCta(wrapper)

    expect(registeredPlanNames()).toContain(plan)
    expect(plan).toBe(PLAN_TIERS.pro.yearly.id)
  })

  it('sends the trial-less plan once the organization used its trial', async () => {
    authState.organization = { subscriptions: [], userOwnsMultipleOrgs: true }
    const wrapper = await mountPage()
    const plan = await clickProCta(wrapper)

    expect(registeredPlanNames()).toContain(plan)
    expect(plan).not.toBe(PLAN_TIERS.pro.monthly.id)
  })

  it('shows the Pro prices of PLAN_TIERS for both intervals', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain(`pricing.pro.price:${PLAN_TIERS.pro.monthly.price}`)

    await selectYearly(wrapper)
    expect(wrapper.text()).toContain(`pricing.pro.price:${PLAN_TIERS.pro.yearly.price}`)
  })

  it('tells the user when the checkout cannot start', async () => {
    upgrade.mockResolvedValue({ data: null, error: { status: 400, message: 'Plan not found' } })
    const wrapper = await mountPage()
    await clickProCta(wrapper)

    await vi.waitFor(() => expect(toastAdd).toHaveBeenCalled())
    expect(toastAdd.mock.calls[0]![0]).toMatchObject({ title: 'pricing.checkoutError', color: 'error' })
  })
})
