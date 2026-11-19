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
- **One run at a time.** All runs that pass the fork gate share the `demo` concurrency group, and no running one is
  cancelled. GitHub keeps only one pending run per group, so a newer run replaces a pending one. A run that fails the
  gate (CI failed or cancelled, not a `push`, or a fork's `main`) skips all its jobs and gets a group of its own
  (`demo-skipped-<run id>`), so it cannot displace a pending run. The gate is written twice, in the concurrency group
  and in the `reset` job's `if:`, and both copies must stay identical. If the nightly reset is queued while a deploy
  run is pending, that deploy is dropped: its commit goes live with the next push or `gh workflow run demo.yml`.
- **`reset` job.** It runs `pnpm db:generate`, then `pnpm demo:reset` against `DEMO_DATABASE_URL`, with
  `DEMO_RESET_CONFIRM` set to that URL's hostname. The reset wipes the database, applies the migrations and seeds the
  demo accounts.
- **`deploy` job.** It renders `deploy/demo/wrangler.template.jsonc` into `wrangler.jsonc`, builds with
  `NUXT_NITRO_PRESET=cloudflare-module` and runs `wrangler deploy`. A smoke test then checks `/api/health`, signs in
  as `demo@example.com` and checks that demo mode is on (see [Demo mode](#demo-mode)). Each of these requests is tried
  up to three times, a few seconds apart, when the worker answers 503 or `error code: 1102` (CPU limit, see
  [Measured CPU time](#measured-cpu-time)); any other unexpected answer fails the job at once.
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

## Demo mode

`deploy/demo/wrangler.template.jsonc` sets `NUXT_PUBLIC_DEMO_MODE=true`. With the flag on, the app answers 403
`DEMO_MODE_RESTRICTED` to:

- sign-up, and any user creation;
- password, email, account and session changes on the two public accounts (`demo@example.com` and
  `demo-admin@example.com`);
- admin actions that target those two accounts;
- file uploads.

When a check needs the caller's session (account changes, leaving or removing members of the demo organizations, their
logos) and the request carries a session cookie the check cannot resolve, the app refuses it rather than guessing whose
session it is. A stale or forged cookie therefore gets this 403 instead of the usual 401.

The sign-in page shows the credentials of both accounts.

The demo accounts come only from `pnpm demo:reset`. Never point `create-admin.ts` at the demo database: the next reset
wipes whatever it created anyway.

After each deploy, the smoke test signs in as `demo@example.com` and posts a password change with that session. The job
fails unless the answer is 403 `DEMO_MODE_RESTRICTED`, which proves the flag reached the worker.
The smoke test proves the flag and the routes, not the CPU budget: its requests usually pass even though they go
over 10 ms of CPU.

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
- Keep `sslmode=verify-full` in the URL stored as `DEMO_DATABASE_URL` (step 5), used by the reset from the runner. With
  `require`, `pg` prints a warning on every connection. Hyperdrive gets the same URL without any query string (step 2).

### 2. Hyperdrive

```bash
url=$(neonctl connection-string --project-id <project id> --role-name <owner role> --ssl verify-full)
pnpm exec wrangler hyperdrive create nuxt-saas-demo \
  --connection-string="${url%%\?*}" --caching-disabled
```

`${url%%\?*}` drops everything from the `?` on. Strip the whole query string, not only `sslmode`: Neon URLs also carry
`channel_binding=require`. Hyperdrive encrypts every connection with `require` by default. Verifying the
server certificate (`verify-full`) would need the root CA uploaded with `wrangler cert upload certificate-authority`,
then `--ca-certificate-id <id> --sslmode verify-full`; this demo does not set it up
([Hyperdrive TLS/SSL](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/)).

`--caching-disabled` ("Disables the caching of SQL responses") is taken from `wrangler hyperdrive create --help`
(wrangler 4.163.0). Caching stays off so that the demo never serves rows from before a reset. Note the returned id.

### 3. KV namespace

```bash
pnpm exec wrangler kv namespace create nuxt-saas-demo
```

Note the returned id. KV holds the sessions.

Wrangler then suggests a config block with the binding `nuxt_saas_demo`. Do not copy it: the template's binding must
stay `KV`, which is the name the app reads. Only the id goes into `DEMO_KV_ID` (step 5).

### 4. Worker secret

```bash
pnpm exec wrangler secret put NUXT_BETTER_AUTH_SECRET --name nuxt-saas-demo
```

This is done once, by hand, **after the first `wrangler deploy`**, which creates the `nuxt-saas-demo` worker. The
workflow does not set it. `secret put` publishes a new version of the worker with the secret: no redeploy is needed.

The first deploy is usually the workflow's first run (steps 5 and then [Running it by hand](#running-it-by-hand)). Its
smoke test fails at the demo sign-in, since the secret is not there yet: set the secret, then rerun the workflow.

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

On `workers.dev`, that URL is `https://nuxt-saas-demo.<subdomain>.workers.dev`, where `<subdomain>` is the account's
workers.dev subdomain. Read it in the Cloudflare dashboard (Workers & Pages), or from the API:

```bash
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain"
```

Each job gets only its own secrets: `reset` gets `DEMO_DATABASE_URL`, `deploy` gets the two Cloudflare ones.

## Running it by hand

```bash
gh workflow run demo.yml
```

This resets and then deploys the ref chosen for the run (`main` by default). `workflow_dispatch` accepts any branch.
`workflow_run` and the "Run workflow" button only work once `demo.yml` is on the default branch, so the first run
happens after the merge to `main`
([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).

In a public repository, GitHub disables scheduled workflows after 60 days without repository activity
([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
Re-enable the workflow from the Actions tab (or `gh workflow enable demo.yml`) when that happens.

## Free plan limits

| Limit | Free plan | Source |
|---|---|---|
| CPU time per HTTP request | 10 ms | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Requests | 100,000/day | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker size | 64 MiB uncompressed (no compressed limit) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| KV writes | 1,000/day (to different keys) | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) |
| KV writes to the same key | 1 per second | [KV limits](https://developers.cloudflare.com/kv/platform/limits/) |
| Hyperdrive queries | 100,000/day | [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) |

- **Worker size.** The first real deploy reported `Total Upload: 10394.27 KiB / gzip: 2261.22 KiB` and
  `Worker Startup Time: 112 ms` (wrangler 4.163.0), well under 64 MiB. Wrangler also warns that the config's `main` is
  overridden: this is expected, since `wrangler deploy` uses the redirected configuration written by the build (see
  [Build rules](#build-rules)).
- **CPU time, over the limit.** See [Measured CPU time](#measured-cpu-time).
- **KV writes.** Every sign-in writes a session to KV, and rewrites the `active-sessions-<userId>` key of that user. All
  visitors share the demo account, so two demo sign-ins within the same second can hit the per-key limit.

### Measured CPU time

Measured on 2026-11-19 against the deployed demo, on the free plan. CPU time in ms, read from `wrangler tail`. The
median and max leave out the first, cold call of each path.

| Path | Status | First call | Median | Max |
|---|---|---|---|---|
| `GET /api/health` | 200 | 33 | 20 | 36 |
| `GET /` | 200 | 536 | 258 | 593 |
| `GET /signin` | 200 | 418 | 102 | 466 |
| demo sign-in | 200 + cookie | 240 | 177 | 240 |
| `GET /dashboard` | 200 | 188 | 111 | 229 |
| `GET /acme-demo/members` | 200 | 139 | 304 | 546 |
| change-password (demo) | 403 `DEMO_MODE_RESTRICTED` | 19 | 22 | 76 |
| admin sign-in | 200 + cookie | 197 | 137 | 197 |
| `GET /admin` | 302 | 76 | 48 | 213 |
| `GET /admin/dashboard` | 200 | 35 | 57 | 156 |

- Over the whole session, the GraphQL Analytics API gave a CPU time of 137 ms at P50 and 594 ms at P99.
- Every path is above the 10 ms limit, yet isolated, spaced-out requests all passed.
- Chained requests fail. After about 15 server-rendered requests in a row, the worker answers HTTP 503 with the body
  `error code: 1102`, and the tail shows `Error: Worker exceeded CPU time limit.`. 21 of the 139 events of the session
  were `exceededCpu`, each cut at `cpuTime` 10. One demo sign-in was cut too.

The demo is fine for light testing by one visitor at a time, not reliable under bursts. If that becomes a problem, two
options:

- the Workers Paid plan, whose CPU limit per request is far above these numbers
  ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/));
- the `node-server` target on another host ([SELF_HOSTING_NODE.md](./SELF_HOSTING_NODE.md)), with the same code.

To measure again:

- `pnpm exec wrangler tail nuxt-saas-demo --format json` prints one JSON event per request, with its `cpuTime` (ms),
  its `outcome` (`ok`, `exceededCpu`) and its exceptions. Send a header such as `X-Probe: <name>` with each request to
  match events to requests.
- The GraphQL Analytics API dataset `workersInvocationsAdaptive`, filtered on the script name, gives CPU time quantiles
  over a time range.
