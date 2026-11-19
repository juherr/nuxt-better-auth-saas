// The public demo creates no account: better-auth refuses every sign-up
// there, so the sign-up page sends its visitors to the sign-in page, which
// lists the demo accounts. The query (redirect, invitation) is kept.
export default defineNuxtRouteMiddleware((to) => {
  if (!useRuntimeConfig().public.demoMode)
    return
  return navigateTo(useLocalePath()({ path: '/signin', query: to.query }))
})
