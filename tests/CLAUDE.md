# tests/

- Vitest projects (`vitest.config.ts`): `unit` = `tests/unit/**` (node; `~~` → root, `hub:kv` →
  `unit/stubs/hub-kv.ts`), `nuxt` = `tests/components/**` (happy-dom), `e2e` = `tests/e2e/**`.
  `pnpm test:unit` · `pnpm test:ci` (unit + nuxt) · `pnpm test` (all, e2e included).
- Route tests: `beforeAll(stubNitroGlobals)` then `callRoute(() => import('~~/server/api/...'), body, query,
  params, headers)` from `unit/support/nitroGlobals.ts`; stub `useRuntimeConfig` yourself when needed.
- Mocks: `vi.hoisted(() => vi.fn())` + `vi.mock('~~/server/utils/<name>', ...)`; `useDB` returns
  `{ query: { <table>: { findFirst } } }`. Reuse fakes in `unit/support/` (`sql.ts` renderSql,
  `stripeSubscriptionsFake.ts`) and `resetKvStub` / `kvSetCalls` from the `hub:kv` stub.
- Component tests: `mountSuspended` + `mockNuxtImport` from `@nuxt/test-utils/runtime`; SFCs with an
  `<i18n>` block need `mockNuxtImport('useI18n', () => () => ({ t: key => key }))`.
- e2e: `setup({ host: process.env.NUXT_TEST_APP_URL })` + `createPage`; sign-in tests need an existing
  user in `NUXT_TEST_EMAIL` / `NUXT_TEST_PASSWORD`.
