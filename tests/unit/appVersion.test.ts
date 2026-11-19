import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readGitVersionInfo, resolveAppVersion } from '~~/scripts/appVersion'

describe('resolveAppVersion', () => {
  it('prefers the explicit override', () => {
    expect(resolveAppVersion({ override: 'v9.9.9', tag: 'v1.0.0', sha: 'abc1234' })).toBe('v9.9.9')
  })

  it('ignores an empty override', () => {
    expect(resolveAppVersion({ override: '', tag: 'v1.0.0', sha: 'abc1234' })).toBe('v1.0.0')
  })

  it('shows the tag of a release build', () => {
    expect(resolveAppVersion({ tag: 'v1.0.0', sha: 'abc1234' })).toBe('v1.0.0')
  })

  it('shows dev and the short sha of an untagged build', () => {
    expect(resolveAppVersion({ sha: 'abc1234' })).toBe('dev-abc1234')
  })

  it('falls back to dev without git information', () => {
    expect(resolveAppVersion({})).toBe('dev')
  })
})

describe('readGitVersionInfo', () => {
  const dirs: string[] = []
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-version-'))
    dirs.push(dir)
    return dir
  }
  // The developer's global and system git config (tag signing, core.abbrev)
  // must reach neither the fixture's git commands nor the function under
  // test: both inherit this environment. Neither may an inherited repository
  // location (set by git when the tests run from a hook): git would then use
  // that repository instead of the temp dir, and commit and tag into it.
  beforeEach(() => {
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'])
      vi.stubEnv(name, undefined)
  })
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  const repoWithOneCommit = () => {
    const dir = tempDir()
    git(dir, 'init', '-q')
    writeFileSync(join(dir, 'file.txt'), 'content')
    git(dir, 'add', 'file.txt')
    git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-q', '-m', 'init')
    return dir
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true })
  })

  it('returns nothing outside a git repository', () => {
    expect(readGitVersionInfo(tempDir())).toEqual({})
  })

  it('returns the short sha and no tag on an untagged commit', () => {
    const dir = repoWithOneCommit()

    expect(readGitVersionInfo(dir)).toEqual({ sha: git(dir, 'rev-parse', '--short', 'HEAD') })
  })

  it('returns the tag on a tagged commit', () => {
    const dir = repoWithOneCommit()
    git(dir, 'tag', 'v1.2.3')

    expect(readGitVersionInfo(dir)).toEqual({ tag: 'v1.2.3', sha: git(dir, 'rev-parse', '--short', 'HEAD') })
  })
})
