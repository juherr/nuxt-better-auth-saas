# Contributing

## Commit messages

Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<optional scope>): <description>

<optional body>

<optional footers>
```

- Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `style`,
  `revert`.
- A breaking change adds `!` after the type or scope (`feat(auth)!: …`) and a
  `BREAKING CHANGE: <what to do>` footer.
- Lines stay under 100 characters.

[commitlint](https://commitlint.js.org) (`commitlint.config.mjs`) checks every message in the
husky `commit-msg` hook. On a pull request, the `Conventional Commits` workflow checks the title,
which becomes the commit subject of a squash merge, and the commits, which a rebase or merge
keeps. Check a message by hand with `printf '%s' 'feat: …' | pnpm exec commitlint`.

## Changelog

[`CHANGELOG.md`](CHANGELOG.md) follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
A pull request with a change visible to people who use or fork the starter adds an entry under
`## [Unreleased]`, in the matching section: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`
or `Security`.

- Write for humans: describe the effect, not the implementation, and group related changes into
  one entry.
- Start a breaking entry with `**Breaking:**` and say what to do (rename a variable, run
  `pnpm db:generate`, …).
- End the entry with the pull request link.
- Test-only changes, refactors and internal CI tweaks need no entry.

On release, the `[Unreleased]` entries move under a new `## [x.y.z] - YYYY-MM-DD` heading, and
the link references at the bottom of the file are updated.

## Licensing

New files need licensing information: see the [License](README.md#license) section of the README.
