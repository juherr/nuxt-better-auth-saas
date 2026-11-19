# Public demo on Cloudflare Workers

The public demo runs on the Cloudflare Workers **free plan**, with a Neon free database behind Hyperdrive and sessions in
KV. `.github/workflows/demo.yml` deploys it from `main` and resets its database to the demo seed every night.

## What the workflow does

| Trigger | Jobs |
|---|---|
| `workflow_run`: CI completed on `main` | `reset`, then `deploy`, only when CI succeeded on a `push` from this repository |
| `schedule`: `0 3 * * *` (03:00 UTC) | `reset` only |
| `workflow_dispatch` | `reset`, then `deploy` |

- **Fork gate.** `workflow_run` fires for any CI run whose head branch is named `main`, including a pull request from a
  fork's own `main`. The `reset` job therefore also requires `event == 'push'` and the head repository to be this one;
  otherwise the fork's code would run with the demo secrets.
- **One run at a time.** All runs share the `demo` concurrency group, and no running one is cancelled. GitHub keeps
  only one pending run per group, so a newer run replaces a pending one. If the nightly reset is queued while a deploy
  run is pending, that deploy is dropped: its commit goes live with the next push or `gh workflow run demo.yml`.
- **`reset` job.** It runs `pnpm db:generate`, then `pnpm demo:reset` against `DEMO_DATABASE_URL`, with
  `DEMO_RESET_CONFIRM` set to that URL's hostname. The reset wipes the database, applies the migrations and seeds the
  demo accounts.
- **`deploy` job.** It renders `deploy/demo/wrangler.template.jsonc` into `wrangler.jsonc`, builds with
  `NUXT_NITRO_PRESET=cloudflare-module` and runs `wrangler deploy`. A smoke test then waits for `/api/health` and signs
  in as `demo@example.com`.
- **Reset before deploy.** Between the two jobs the previous code runs on the new schema for a few minutes. This is
  accepted for a demo.

### Build rules

- **No `DATABASE_URL` or `REDIS_URL` at build time.**
  - A `DATABASE_URL` present at build makes NuxtHub apply the migrations during the build, and freezes the URL into
    `.output`. `server/db/migrations` is gitignored and `db:generate` names the migration differently on every checkout,
    so applying it to a database that was not wiped fails with "relation already exists". Migrations are therefore only
    applied by the reset, after a full wipe.
  - `REDIS_URL` switches the KV driver to ioredis, which does not run on Workers.
- **Render `wrangler.jsonc` before the build.** The `cloudflare-module` preset merges the root `wrangler.jsonc` into
  `.output/server/wrangler.json`, and `wrangler deploy` uses that file ("Using redirected Wrangler configuration").
  Checked with wrangler 4.163.0 and `wrangler deploy --dry-run`: rendered after the build, the worker was named
  `houseofbetterauth` and had only the `ASSETS` binding, without KV, Hyperdrive or the vars.
- The template is rendered with an explicit variable list,
  `envsubst '${DEMO_KV_ID} ${DEMO_HYPERDRIVE_ID} ${DEMO_BASE_URL}'`. Without it, `envsubst` would also blank
  `"$schema"`.

## One-time setup

### 1. Neon database

Create the project with the `neon` CLI (`neonctl`):

```bash
neonctl projects create --name nuxt-saas-demo
neonctl connection-string --project-id <project id> --role-name <owner role> --ssl verify-full
```

- Use the **direct** endpoint, not the `-pooler` one (`--pooled` is off by default). The reset was run against the
  direct endpoint, and `DEMO_RESET_CONFIRM` is the hostname of that URL.
- Use the **owner role** of the database: the reset drops and recreates the `public` and `drizzle` schemas.
- Keep `sslmode=verify-full` in the URL. With `require`, `pg` prints a warning on every connection.

### 2. Hyperdrive

```bash
pnpm exec wrangler hyperdrive create nuxt-saas-demo \
  --connection-string='<Neon direct URL>' --caching-disabled
```

`--caching-disabled` ("Disables the caching of SQL responses") is taken from `wrangler hyperdrive create --help`
(wrangler 4.163.0). Caching stays off so that the demo never serves rows from before a reset. Note the returned id.

### 3. KV namespace

```bash
pnpm exec wrangler kv namespace create nuxt-saas-demo
```

Note the returned id. KV holds the sessions.

### 4. Worker secret

```bash
pnpm exec wrangler secret put NUXT_BETTER_AUTH_SECRET --name nuxt-saas-demo
```

This is done once, by hand. The workflow does not set it. Without it, sign-in fails, and so does the workflow's smoke
test: set it, then rerun the workflow.

### 5. GitHub secrets and variables

| Name | Kind | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | API token with edit permission on Workers Scripts, Workers KV Storage and Hyperdrive |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Cloudflare account id |
| `DEMO_DATABASE_URL` | secret | Neon direct URL, owner role, `sslmode=verify-full` (step 1) |
| `DEMO_KV_ID` | variable | KV namespace id (step 3) |
| `DEMO_HYPERDRIVE_ID` | variable | Hyperdrive config id (step 2) |
| `DEMO_BASE_URL` | variable | Public URL of the demo, e.g. `https://nuxt-saas-demo.<subdomain>.workers.dev`, no trailing slash |

`DEMO_BASE_URL` sets `NUXT_PUBLIC_BASE_URL` and `NUXT_PUBLIC_I18N_BASE_URL`. better-auth uses it as its base URL and
trusted origin, so it must be the exact URL users reach.

Each job gets only its own secrets: `reset` gets `DEMO_DATABASE_URL`, `deploy` gets the two Cloudflare ones.

## Running it by hand

```bash
gh workflow run demo.yml
```

This resets and then deploys the ref chosen for the run (`main` by default). `workflow_dispatch` accepts any branch.

GitHub disables scheduled workflows after 60 days without activity in the repository. Re-enable the workflow from the
Actions tab (or `gh workflow enable demo.yml`) when that happens.

## Free plan limits

| Limit | Free plan | Source |
|---|---|---|
| CPU time per HTTP request | 10 ms | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Requests | 100,000/day | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker size | 64 MiB uncompressed (no compressed limit) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| KV writes | 1,000/day (to different keys) | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) |
| KV writes to the same key | 1 per second | [KV limits](https://developers.cloudflare.com/kv/platform/limits/) |
| Hyperdrive queries | 100,000/day | [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) |

- **Worker size.** `wrangler deploy --dry-run` reported `Total Upload: 10359.03 KiB / gzip: 2253.64 KiB` (wrangler
  4.163.0), well under 64 MiB.
- **CPU time, not yet measured.** better-auth hashes passwords with its default scrypt, and every request on Workers
  creates a new `betterAuth` instance and `pg.Pool`. Sign-in and server-side rendering may exceed 10 ms of CPU, in which
  case Cloudflare answers with error 1102.
- **KV writes.** Every sign-in writes a session to KV, and rewrites the `active-sessions-<userId>` key of that user. All
  visitors share the demo account, so two demo sign-ins within the same second can hit the per-key limit.
