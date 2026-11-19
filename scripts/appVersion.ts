// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process'

/**
 * Version shown in the app, resolved once at build time by nuxt.config.ts.
 *
 * Kept out of `server/utils` and `shared/utils`, which Nuxt auto-imports, so
 * that `node:child_process` never reaches a server or client bundle.
 */

export interface GitVersionInfo {
  /** Tag pointing exactly at HEAD, e.g. `v1.2.0`. */
  tag?: string
  /** Abbreviated SHA of HEAD. */
  sha?: string
}

/**
 * An explicit override (`NUXT_PUBLIC_APP_VERSION`) wins; otherwise a tagged
 * commit shows its tag, an untagged one `dev-<short sha>`, and a build
 * without git information `dev`.
 */
export const resolveAppVersion = ({ override, tag, sha }: GitVersionInfo & { override?: string }): string => {
  if (override)
    return override
  if (tag)
    return tag
  return sha ? `dev-${sha}` : 'dev'
}

const git = (cwd: string, ...args: string[]): string | undefined => {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined
  } catch {
    // No git binary, not a repository, or no tag on HEAD.
    return undefined
  }
}

/**
 * Reads the tag and SHA of the checked-out commit. A shallow CI checkout
 * fetches no tags: a release build has to fetch them (`fetch-tags: true`)
 * or set `NUXT_PUBLIC_APP_VERSION`.
 */
export const readGitVersionInfo = (cwd: string): GitVersionInfo => {
  const sha = git(cwd, 'rev-parse', '--short', 'HEAD')
  if (!sha)
    return {}
  const tag = git(cwd, 'describe', '--tags', '--exact-match', 'HEAD')
  return tag ? { tag, sha } : { sha }
}
