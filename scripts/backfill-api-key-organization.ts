// Links legacy API keys to their organization in api_key_organization.
//
// Run with `pnpm db:backfill-api-keys` (plain Node with type stripping, so
// relative imports carry their `.ts` extension and Nuxt aliases are not
// available). Idempotent: keys that are already linked are left as they are.
// Never reads nor prints the key material.
//
// Keys left without an organization cannot be listed nor revoked by anyone.
// By default the script prints the ids of those that remain enabled; with
// --disable-unlinked it disables them after linking.
import type { ApiKeyBackfillOutcome } from '../server/utils/apiKeyBackfill.ts'
import process from 'node:process'
import pg from 'pg'
import {
  decideApiKeyBackfill,
  describeUnlinkedApiKeys,
  parseApiKeyBackfillArgs
} from '../server/utils/apiKeyBackfill.ts'
import { parseLegacyOrganizationId } from '../server/utils/apiKeyMetadata.ts'

interface LegacyApiKeyRow {
  id: string
  reference_id: string
  metadata: string | null
  linked: boolean
}

interface ApiKeyIdRow {
  id: string
}

// Keys with no organization link that the API key plugin still accepts:
// it refuses only `enabled === false`, so a NULL counts as enabled.
const ENABLED_UNLINKED_KEY = `enabled IS NOT FALSE
  AND NOT EXISTS (SELECT 1 FROM api_key_organization l WHERE l.api_key_id = api_key.id)`

interface OrganizationMembershipRow {
  role: string | null
}

async function main(): Promise<number> {
  const args = parseApiKeyBackfillArgs(process.argv.slice(2))
  if ('error' in args) {
    console.error(`${args.error}. Usage: pnpm db:backfill-api-keys [--disable-unlinked]`)
    return 1
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set: point it at the Postgres database to backfill.')
    return 1
  }

  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const counts: Record<ApiKeyBackfillOutcome, number> = {
      'link': 0,
      'already-linked': 0,
      'skipped-invalid': 0,
      'skipped-unknown-org': 0,
      'skipped-not-manager': 0
    }

    const { rows: keys } = await client.query<LegacyApiKeyRow>(
      `SELECT k.id, k.reference_id, k.metadata, (l.api_key_id IS NOT NULL) AS linked
       FROM api_key k
       LEFT JOIN api_key_organization l ON l.api_key_id = k.id`
    )

    for (const key of keys) {
      const organizationId = key.linked ? null : parseLegacyOrganizationId(key.metadata)
      let organizationExists = false
      let ownerRole: string | null = null
      if (organizationId !== null) {
        const { rows } = await client.query<OrganizationMembershipRow>(
          `SELECT m.role
           FROM organization o
           LEFT JOIN member m ON m.organization_id = o.id AND m.user_id = $2
           WHERE o.id = $1`,
          [organizationId, key.reference_id]
        )
        organizationExists = rows.length > 0
        ownerRole = rows[0]?.role ?? null
      }

      let outcome = decideApiKeyBackfill({ alreadyLinked: key.linked, organizationId, organizationExists, ownerRole })
      if (outcome === 'link') {
        const inserted = await client.query(
          `INSERT INTO api_key_organization (api_key_id, organization_id)
           VALUES ($1, $2)
           ON CONFLICT (api_key_id) DO NOTHING`,
          [key.id, organizationId]
        )
        if (inserted.rowCount === 0)
          outcome = 'already-linked'
      }
      counts[outcome]++
    }

    console.log(
      `API key backfill: scanned=${keys.length} linked=${counts.link}`
      + ` already-linked=${counts['already-linked']}`
      + ` skipped-invalid=${counts['skipped-invalid']}`
      + ` skipped-unknown-org=${counts['skipped-unknown-org']}`
      + ` skipped-not-manager=${counts['skipped-not-manager']}`
    )

    if (args.disableUnlinked) {
      const disabled = await client.query(`UPDATE api_key SET enabled = false WHERE ${ENABLED_UNLINKED_KEY}`)
      console.log(describeUnlinkedApiKeys({ disableUnlinked: true, disabledCount: disabled.rowCount ?? 0 }))
    }
    else {
      const { rows } = await client.query<ApiKeyIdRow>(
        `SELECT id FROM api_key WHERE ${ENABLED_UNLINKED_KEY} ORDER BY id`
      )
      console.log(describeUnlinkedApiKeys({ disableUnlinked: false, enabledUnlinkedIds: rows.map(row => row.id) }))
    }
    return 0
  }
  finally {
    await client.end()
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error('API key backfill failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
)
