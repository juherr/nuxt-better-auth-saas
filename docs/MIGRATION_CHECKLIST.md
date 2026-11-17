# NuxtHub v0.10 Migration Checklist

Use this checklist when syncing this branch with your own app or migrating from NuxtHub Admin to self-hosted Cloudflare Workers.

---

## Environment Variables

- [ ] Rename `NUXT_DATABASE_URL` → `DATABASE_URL` in your `.env` file
- [ ] Ensure `NUXT_NITRO_PRESET=cloudflare-module` is set
- [ ] Add all secrets to Cloudflare via `npx wrangler secret put <NAME>`

---

## Code Changes

### Database Path Rename

- [ ] Rename `server/database/` → `server/db/`
- [ ] Update all imports from `server/database/` to `server/db/`

**Files typically affected:**
- [ ] `server/utils/auth.ts`
- [ ] `server/api/**/*.ts` (all API routes)
- [ ] `server/services/**/*.ts`
- [ ] `shared/utils/types.ts`

### KV API Migration

- [ ] Replace `hubKV()` calls with `kv` from `hub:kv`

```diff
- const value = await hubKV().get(key)
+ import { kv } from 'hub:kv'
+ const value = await kv.get(key)
```

**Methods changed:**
| Old | New |
|-----|-----|
| `hubKV().get(key)` | `kv.get(key)` |
| `hubKV().set(key, value, { ttl })` | `kv.set(key, value, { ttl })` |
| `hubKV().del(key)` | `kv.del(key)` |

### Blob API Migration (if used)

- [ ] Replace `hubBlob()` calls with `blob` from `hub:blob`

```diff
- const file = await hubBlob().get(path)
+ import { blob } from 'hub:blob'
+ const file = await blob.get(path)
```

### Database API Migration (if used)

- [ ] Replace `hubDatabase()` calls with `db` from `hub:db`

```diff
- const result = await hubDatabase().query(sql)
+ import { db } from 'hub:db'
+ const result = await db.query(sql)
```

---

## Configuration Files

### nuxt.config.ts

- [ ] Update `hub` config to v0.10 syntax:

```diff
  hub: {
-   database: true,
+   db: 'postgresql',
    kv: true,
    blob: true,
-   workers: true,
-   bindings: {
-     hyperdrive: {
-       HYPERDRIVE: process.env.NUXT_CF_HYPERDRIVE_ID
-     }
-   }
  }
```

- [ ] Add Cloudflare config to nitro (optional but recommended):

```ts
nitro: {
  preset: process.env.NUXT_NITRO_PRESET,
  ...(process.env.NUXT_NITRO_PRESET === 'cloudflare-module' ? {
    cloudflare: {
      deployConfig: true,
      nodeCompat: true
    }
  } : {}),
}
```

### package.json Scripts

- [ ] Update paths from `server/database/` to `server/db/`:

```diff
- "auth:schema": "npx @better-auth/cli generate --config server/utils/auth.ts --output server/database/schema/auth.ts -y",
+ "auth:schema": "npx @better-auth/cli generate --config server/utils/auth.ts --output server/db/schema/auth.ts -y",

- "db:generate": "drizzle-kit generate --config ./server/database/drizzle.config.ts",
+ "db:generate": "drizzle-kit generate --config ./server/db/drizzle.config.ts",

- "db:migrate": "drizzle-kit migrate --config ./server/database/drizzle.config.ts",
+ "db:migrate": "drizzle-kit migrate --config ./server/db/drizzle.config.ts",
```

### drizzle.config.ts

- [ ] Update database URL reference:

```diff
  dbCredentials: {
-   url: process.env.NUXT_DATABASE_URL!
+   url: process.env.DATABASE_URL!
  }
```

- [ ] Update paths:

```diff
- schema: './server/database/schema/index.ts',
- out: './server/database/migrations',
+ schema: './server/db/schema/index.ts',
+ out: './server/db/migrations',
```

### runtimeConfig.ts

- [ ] Update database URL reference:

```diff
- databaseUrl: process.env.NUXT_DATABASE_URL,
+ databaseUrl: process.env.DATABASE_URL,
```

### .gitignore

- [ ] Update migrations path:

```diff
- server/database/migrations
+ server/db/migrations
```

- [ ] Add wrangler config:

```
wrangler.jsonc
```

### .env.example

- [ ] Rename database URL:

```diff
- NUXT_DATABASE_URL=postgres://postgres:@localhost:5432/yourdb
+ DATABASE_URL=postgres://postgres:@localhost:5432/yourdb
```

---

## New Files to Create

- [ ] Create `wrangler.jsonc` from `wrangler.example.jsonc`
- [ ] Fill in your Cloudflare resource IDs (KV, R2, Hyperdrive)

---

## Type Declarations

- [ ] Delete old `server/types/hub.d.ts` (if it has `hubKV` types)
- [ ] Create new `server/types/hub.d.ts` with v0.10 types:

```ts
import type { Storage } from 'unstorage'

declare module 'hub:kv' {
  interface KVStorage extends Storage {
    keys: Storage['getKeys']
    get: Storage['getItem']
    set: Storage['setItem']
    has: Storage['hasItem']
    del: Storage['removeItem']
    clear: Storage['clear']
  }
  export const kv: KVStorage
}

declare module 'hub:blob' {
  import type { BlobStorage, BlobEnsureOptions } from '@nuxthub/core/blob'
  export const blob: BlobStorage
  export const ensureBlob: (blob: Blob, options: BlobEnsureOptions) => void
}
```

---

## Package Updates

- [ ] Update `@nuxthub/core` to v0.10+:

```bash
pnpm remove @nuxthub/core
pnpm add @nuxthub/core
```

---

## Database Migrations

- [ ] Mark all existing migrations as applied:

```bash
# List migrations
ls server/db/migrations/

# Mark each as applied
npx nuxt db mark-as-migrated 0000_migration_name
npx nuxt db mark-as-migrated 0001_migration_name
# ... repeat for all
```

---

## API Keys Scoped to Their Organization

API keys now belong to exactly one organization through the `api_key_organization` table
(`server/db/schema/apiKeyOrganization.ts`). Keys were previously matched by searching their
`metadata` text for the organization id, which is not a reliable tenant boundary. Existing keys
need a one-off backfill.

- [ ] Generate the migration that creates `api_key_organization` (`server/db/migrations` is
  gitignored, so each deployment generates its own):

```bash
pnpm db:generate
```

- [ ] Apply it through NuxtHub, never with `pnpm db:migrate` (see
  [Self-Hosting on Node.js](./SELF_HOSTING_NODE.md#1-database-migrations)):

```bash
DATABASE_URL=postgres://user:password@host:5432/database npx nuxt db migrate
```

- [ ] Backfill the existing keys:

```bash
DATABASE_URL=postgres://user:password@host:5432/database pnpm db:backfill-api-keys
```

The script reads each key's `metadata` (a JSON object, or a JSON string of a JSON object as
older clients stored it), never the key itself, and prints one line of counts:

| Count | Meaning |
|-------|---------|
| `scanned` | API keys read. |
| `linked` | Keys linked to their organization by this run. |
| `already-linked` | Keys that already had an organization; left unchanged. |
| `skipped-invalid` | Metadata missing, not JSON, or without a non-empty string `organizationId`. |
| `skipped-unknown-org` | The organization named in the metadata does not exist. |
| `skipped-not-manager` | The key's owner is not currently `owner` or `admin` of that organization. |

The script is idempotent: run it again at any time, linked keys stay as they are. A second run
reports the same skipped counts, since skipped keys are not changed.

- [ ] Tell the affected users. Organization API key listings only show linked keys, matched
  exactly on the organization id; there is no fallback on metadata. Skipped keys, including those
  whose owner is no longer `owner` or `admin` of the organization, no longer appear and must be
  recreated by an owner or admin.

New keys are linked when they are created. Only an `owner` or `admin` of the organization named
in the request's `metadata.organizationId` may create one; the id must match exactly, an id with
surrounding whitespace is refused. Creating the key and linking it are
not one transaction: if the link cannot be written, the request fails without returning the key,
and the stored key stays unlisted with no one holding its plaintext (it fails closed). The API key plugin's own
`/api-key/get`, `/api-key/list`, `/api-key/update` and `/api-key/delete` endpoints are disabled:
keys are listed and revoked through `/api/organization/api-keys`, which check the caller's role
in the key's organization.

Deleting an organization through better-auth deletes its API keys first (the organization
plugin's `beforeDeleteOrganization` hook), so no key outlives its organization. If that deletion
fails, the organization is not deleted. An organization row removed directly in the database
skips the hook: its links go with it, and its keys stay enabled with no organization.

---

## Deployment

- [ ] Build the application:

```bash
pnpm build
```

- [ ] Deploy to Cloudflare:

```bash
npx wrangler deploy
```

---

## Verification

- [ ] Local dev works: `pnpm dev`
- [ ] Build succeeds: `pnpm build`
- [ ] Deploy succeeds: `npx wrangler deploy`
- [ ] App loads in production
- [ ] Authentication works
- [ ] Database queries work
- [ ] File uploads work (if using blob storage)
- [ ] Caching works (sessions, rate limiting)

---

## Quick Reference: Find & Replace

| Find | Replace |
|------|---------|
| `server/database` | `server/db` |
| `NUXT_DATABASE_URL` | `DATABASE_URL` |
| `hubKV()` | `kv` (with import) |
| `hubBlob()` | `blob` (with import) |
| `hubDatabase()` | `db` (with import) |
| `hub.database: true` | `hub.db: 'postgresql'` |
