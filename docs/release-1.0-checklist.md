# Cadence v1.0 release checklist

> **DO NOT run `npm publish` from this document.** This is a
> reference. The maintainer (Beau) runs the publish manually when
> ready.

## Pre-release

- [ ] All tests passing on Node 20 / 22 / 24.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build` all green.
- [ ] CHANGELOG.md updated with the v1.0 entry.
- [ ] `packages/cadence/package.json` version bumped to `1.0.0`.
- [ ] `packages/cadence/src/util/version.ts` `CADENCE_VERSION` bumped
      to `1.0.0`.
- [ ] Root `package.json` (`cadence-monorepo`) version bumped to
      `1.0.0`.
- [ ] Adapter packages (`adapter-stub`, `adapter-linear`,
      `adapter-jira`, `adapter-github`) version bumped to `1.0.0` if
      shipping them alongside.
- [ ] `templates-history/1.0.0/` snapshot of current `templates/` is
      committed (so future minor versions have a v1.0 anchor for
      three-way merge).
- [ ] Docs site (`docs-site/`) builds clean.
- [ ] `cadence doctor` against a fresh `cadence init` returns all OK.

## Tag

```bash
git tag -a v1.0.0 -m "cadence v1.0 — General Availability"
git push origin v1.0.0
```

## Publish (when ready)

```bash
# 1. Build from a clean tree.
cd packages/cadence
npm run clean
npm run build

# 2. Dry-run the publish to verify the contents.
npm publish --dry-run

# Verify the file list. Expected: dist/, templates/, templates-history/,
# README.md, LICENSE.

# 3. Real publish.
npm publish --access public

# 4. Confirm.
npm view cadence@1.0.0
```

## Publish the adapters (optional at v1.0)

If publishing the adapters alongside, repeat the publish step for
each:

```bash
cd packages/adapter-stub && npm publish --access public
cd ../adapter-linear && npm publish --access public
cd ../adapter-jira && npm publish --access public
cd ../adapter-github && npm publish --access public
```

Each adapter has `"private": true` in its `package.json` by default
— flip to `false` before publish.

## GitHub release

1. Visit https://github.com/BeauGoldberg/cadence/releases/new
2. Tag: `v1.0.0`
3. Title: `cadence v1.0 — General Availability`
4. Body: paste the relevant CHANGELOG.md section.
5. Attach the npm tarball as an artefact (optional but useful for
   air-gapped consumers).

## Update the GitHub Action's default tag

The action's docs reference `@v1`. Make sure the `v1` tag exists and
points at the v1.0.0 commit:

```bash
git tag -a v1 -m "cadence@v1 (latest)"
git push origin v1 --force-with-lease
```

Force-pushing the `v1` tag is intentional — it's a major-version
pointer, like `actions/checkout@v4`. Consumers pinning `@v1` follow
the latest 1.x.

## Post-release

- [ ] Announce on relevant channels (Twitter, Reddit, HN — at your
      discretion).
- [ ] Open issues for any deferred v1.x work surfaced during the
      release.
- [ ] Schedule the v1.1 planning window.

## Rollback

If a critical bug ships in v1.0.0:

```bash
# Unpublish is restricted to 72h post-publish; after that, ship 1.0.1
# with the fix. Don't deprecate v1.0.0 unless it's actively dangerous.

# If within 72h:
npm unpublish cadence@1.0.0

# Otherwise:
npm dist-tag rm cadence latest
# Then ship 1.0.1 with the fix and re-add the tag.
```

## What gets shipped

The `files` array in `packages/cadence/package.json` declares the
tarball contents:

```json
{
  "files": [
    "dist",
    "templates",
    "templates-history",
    "README.md",
    "LICENSE"
  ]
}
```

Verify with `npm publish --dry-run` before the real publish.
