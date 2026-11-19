<!-- SPDX-License-Identifier: MIT -->
<script lang="ts" setup>
// Tag of the built commit, else dev-<short sha> (scripts/appVersion.ts)
const version = useRuntimeConfig().public.appVersion
</script>

<template>
  <span
    v-if="version"
    class="text-xs font-mono text-neutral-500 dark:text-neutral-400"
  >{{ version }}</span>
</template>
