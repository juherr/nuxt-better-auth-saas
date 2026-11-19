// SPDX-License-Identifier: MIT
export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, organization, useActiveOrganization, fetchSession, session } = useAuth()

  if (!loggedIn.value)
    return

  const routeSlug = to.params.slug as string
  if (!routeSlug || routeSlug === 't')
    return

  // Don't run on non-dashboard routes if they happen to have a slug param but aren't organization related
  // Assuming all routes with :slug are organization routes based on app structure

  // Check if we need to switch organization
  const activeOrgId = (session.value as any)?.activeOrganizationId

  // Use cached org list to avoid fetching on every navigation
  // getCachedData returns undefined to ensure fresh data on each full page load
  const { data: orgs } = await useAsyncData('user-organizations', async () => {
    const { data } = await organization.list()
    return data
  }, {
    getCachedData: () => undefined
  })

  if (!orgs.value || orgs.value.length === 0)
    return

  const targetOrg = orgs.value.find((o: any) => o.slug === routeSlug)

  if (targetOrg) {
    if (targetOrg.id !== activeOrgId) {
      // Organization mismatch, set active organization
      const { error } = await organization.setActive({ organizationId: targetOrg.id })
      if (error) {
        // The session stays on its organization: leave the requested one, never mark it active.
        // Redirect to the active org, else any other one: the first may be the requested org.
        console.error('[middleware/organization] setActive failed', error)
        const fallbackOrg = orgs.value.find((o: any) => o.id === activeOrgId)
          ?? orgs.value.find((o: any) => o.id !== targetOrg.id)
        if (fallbackOrg)
          return navigateTo(useLocalePath()(`/${fallbackOrg.slug}/dashboard`))
        return
      }
      await fetchSession()

      // Update activeOrg ref immediately to update UI
      const activeOrg = useActiveOrganization()
      if (activeOrg.value) {
        activeOrg.value.data = targetOrg
      }
    }
  } else {
    // Invalid slug, redirect to first available org or handle error
    // We can redirect to the first org's dashboard if the user has access to any orgs
    const firstOrg = orgs.value?.[0]
    if (firstOrg) {
      // Prevent infinite redirect if we are already redirected
      const localePath = useLocalePath()
      const targetPath = localePath(`/${firstOrg.slug}/dashboard`)
      if (to.path !== targetPath) {
        return navigateTo(targetPath)
      }
    }
  }
})
