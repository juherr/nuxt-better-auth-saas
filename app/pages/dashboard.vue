<script setup lang="ts">
const { organization, session, fetchSession } = useAuth()
const router = useRouter()

definePageMeta({
  layout: false
})

onMounted(async () => {
  // Ensure session is fresh
  await fetchSession()

  // 1. Check if we already have an active org in session
  const activeId = session.value?.activeOrganizationId
  if (activeId) {
    // Fetch list to find the slug for the active ID
    const { data: orgs } = await organization.list()
    const activeOrg = orgs?.find(o => o.id === activeId)

    if (activeOrg) {
      return router.push(`/${activeOrg.slug}/dashboard`)
    }
  }

  // 2. Fallback: If no active org or not found in list, default to first
  const { data: orgs } = await organization.list()

  const first = orgs?.[0]
  if (first) {
    // Set first org as active
    await organization.setActive({ organizationId: first.id })
    await fetchSession()
    router.push(`/${first.slug}/dashboard`)
  } else {
    // 3. No orgs, go to onboarding
    router.push('/onboarding')
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <UIcon
      name="i-lucide-loader-2"
      class="w-8 h-8 animate-spin text-primary"
    />
  </div>
</template>
