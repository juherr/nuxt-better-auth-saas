# nuxt-saas-starter

## Toolchain
- Node 26 (`.nvmrc`), pnpm 12 via `packageManager`; run pnpm through that version, not a global shim.
- pnpm 12 rejects versions published < 24 h ago (`minimumReleaseAge` default, kept on purpose):
  a freshly resolved lockfile can fail `pnpm install --frozen-lockfile` in CI until the next day.
- Build scripts of dependencies are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`).

## Run
- `cp .env.example .env` → `pnpm db:generate` (writes the gitignored `server/db/migrations`) →
  `pnpm dev` (applies migrations on start; `npx nuxt db migrate` applies them alone).
- Target is picked by `NUXT_NITRO_PRESET`: `node-server` (default; `pnpm build && pnpm serve`, see
  `docs/SELF_HOSTING_NODE.md`) or `cloudflare-module` (`pnpm preview:cf`, `pnpm deploy`, `wrangler.example.jsonc`).
- KV (sessions) driver is baked in at **build** time: Redis when `REDIS_URL` is set, the `KV` binding on
  Cloudflare, else `fs-lite` under `.data/kv`; `NUXT_REDIS_URL` is read by nothing. The upload rate limiter reads `REDIS_URL` at run time.
- Without Stripe keys, billing routes answer 503 "Billing is not configured" instead of failing.

## Layout
- `app/` Nuxt UI front (pages, components, composables; i18n: `app/i18n/global.json` + per-component
  SFC `<i18n src="./i18n.json">`).
- `server/api/**` routes (admin, organization, stripe, file, health) · `server/utils/` auth (better-auth
  factory in `auth.ts`), billing, Stripe, drivers · `server/db/schema/` Drizzle schema (pg).
- `shared/utils/` code shared by app and server (e.g. `permissions.ts` access control).
- `emails/*.tsx` React Email templates rendered by `server/utils/email.ts`.

## Checks
- `pnpm lint --max-warnings=0` — also the husky pre-commit hook; never `--no-verify`.
- `pnpm test:unit` (node project) · `pnpm test:ci` (unit + nuxt components, what CI runs) ·
  the `e2e` Vitest project needs a running app and stays out of CI.
- `pnpm typecheck` is non-blocking in CI with ~119 known errors (#11): compare `grep -c 'error TS'`
  against main, do not require zero.
- Unit tests stub `hub:kv` through `tests/unit/stubs/hub-kv.ts` (alias in `vitest.config.ts`).
- `postgres` and `ioredis` are loaded by NuxtHub, never imported: only a booted app exercises them —
  mirror the `smoke` job of `.github/workflows/ci.yml` (Postgres 16 + Redis 7, `REDIS_URL`).

## Database and auth
- `server/db/migrations` is gitignored: never commit migrations; document schema changes as an
  upgrade note in the README.
- `pnpm auth:schema` regenerates `server/db/schema/auth.ts`; custom columns survive only when declared
  in better-auth `additionalFields` (`lastActiveOrganizationId`, `referralCode`, `stripeCustomerId`).
- better-auth verification and rate limit live in the database: `hub:kv` has no atomic consume or
  increment, so the KV `getAndDelete`/`increment` throw on purpose.

## Conventions
- Stripe: `apiVersion: Stripe.API_VERSION`; read period ends through
  `server/utils/stripeSubscriptionPeriod.ts`; checkout reference, customer type and seats are decided server-side.
- `createError`: keep `statusCode`/`statusMessage` — h3 1.x derives `message` from `statusMessage`,
  not `statusText` (migration tracked in #50).
- ESLint: `antfu/reasonable-newline` (#47) and antfu's pnpm rules (#48) are off on purpose.
- Confirm a Nuxt module bump with `nuxt prepare`/`build`: modules can require versions `npm view` does not show.
