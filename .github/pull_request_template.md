## Summary

<!-- What changes, and why. -->

## Checklist

- [ ] The title follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  (it becomes the commit subject of a squash merge).
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`, or the change is not visible to users of the
  starter (tests, refactor, internal CI).
- [ ] `pnpm lint --max-warnings=0`, `pnpm typecheck` and `pnpm test:ci` pass.
