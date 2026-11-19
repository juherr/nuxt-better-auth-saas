// SPDX-License-Identifier: MIT
// Only a relative import, with its `.ts` extension, on purpose:
// scripts/backfill-api-key-organization.ts runs this module under plain
// Node (type stripping), outside Nuxt and its aliases.
import { isApiKeyManagerRole } from './apiKeyMetadata.ts'

export type ApiKeyBackfillOutcome
  = | 'link'
    | 'already-linked'
    | 'skipped-invalid'
    | 'skipped-unknown-org'
    | 'skipped-not-manager'

/**
 * Decides what the backfill does with one legacy API key. Legacy metadata
 * was set by the client and never checked, so a key is linked only when
 * its owner currently manages (exact role `owner` or `admin`) the
 * organization the metadata names.
 */
export function decideApiKeyBackfill(input: {
  alreadyLinked: boolean
  organizationId: string | null
  organizationExists: boolean
  ownerRole: string | null
}): ApiKeyBackfillOutcome {
  if (input.alreadyLinked)
    return 'already-linked'
  if (input.organizationId === null)
    return 'skipped-invalid'
  if (!input.organizationExists)
    return 'skipped-unknown-org'
  if (!isApiKeyManagerRole(input.ownerRole))
    return 'skipped-not-manager'
  return 'link'
}

/**
 * Flag of the backfill that disables, after linking, every API key left
 * without an organization. Such a key cannot be listed nor revoked by
 * anyone, so it should not stay usable.
 */
export const DISABLE_UNLINKED_FLAG = '--disable-unlinked'

/**
 * Reads the backfill's command-line arguments. Anything but the exact
 * flag is refused, so that a mistyped flag does not silently run the
 * report-only mode.
 */
export function parseApiKeyBackfillArgs(args: readonly string[]): { disableUnlinked: boolean } | { error: string } {
  let disableUnlinked = false
  for (const arg of args) {
    if (arg !== DISABLE_UNLINKED_FLAG)
      return { error: `Unknown argument: ${arg}` }
    disableUnlinked = true
  }
  return { disableUnlinked }
}

/**
 * Summary of the API keys the backfill left without an organization:
 * how many it disabled, or which ones (ids only, never key material)
 * remain enabled.
 */
export function describeUnlinkedApiKeys(
  result: { disableUnlinked: true, disabledCount: number }
    | { disableUnlinked: false, enabledUnlinkedIds: readonly string[] }
): string {
  if (result.disableUnlinked)
    return `disabled-unlinked=${result.disabledCount}`
  const ids = result.enabledUnlinkedIds
  if (ids.length === 0)
    return 'enabled-unlinked=0'
  return `enabled-unlinked=${ids.length} ids=${ids.join(',')} (rerun with ${DISABLE_UNLINKED_FLAG} to disable them)`
}
