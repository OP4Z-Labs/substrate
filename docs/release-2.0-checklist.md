# Substrate v2.0 release checklist

> **DO NOT run `npm publish` from this document.** This is a
> reference. The maintainer (Beau) runs the publish manually when
> the org-side prerequisites (op4z org recovery + npm token) are
> resolved.

## Pre-release

- [ ] All tests passing on Node 20 / 22 / 24 (CI matrix).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build` all green.
- [ ] `cd docs-site && npm run build` green.
- [ ] CHANGELOG.md updated with the v2.0 entry. (Done in B4
      sub-phase 4.)
- [ ] `docs/migration-from-1.x.md` exists. (Done in B4 sub-phase 4.)
- [ ] `docs/release-2.0-checklist.md` exists. (This file.)
- [ ] `packages/substrate/package.json` version bumped to `2.0.0`.
      (Done in B4 sub-phase 5.)
- [ ] `packages/substrate/src/util/version.ts` `SUBSTRATE_VERSION`
      bumped to `2.0.0`. (Done in B4 sub-phase 5.)
- [ ] Root `package.json` (`substrate-monorepo`) version bumped to
      `2.0.0`. (Done in B4 sub-phase 5.)
- [ ] Adapter packages (`adapter-stub`, `adapter-linear`,
      `adapter-jira`, `adapter-github`) — version bump optional.
      Recommend keeping them at 0.8.0 unless their public surface
      changes alongside; they're internal-facing and were never
      published.
- [ ] `templates-history/2.0.0/` snapshot of current `templates/` is
      committed (so future minor versions have a v2.0 anchor for
      three-way merge). Pattern:
      `cp -r packages/substrate/templates packages/substrate/templates-history/2.0.0`
      then `git add` + commit.
- [ ] `substrate doctor` against a fresh `substrate init` returns
      all OK (run in a tempdir; no surprises).
- [ ] `substrate validate` against every template manifest passes.
- [ ] `substrate run <template-id> --dry-run` plans cleanly for
      each reference workflow (`tackle-task`, `audit-service`,
      `audit-package`, `weekly-proposal-walk`).

## Tag (when ready)

```bash
git tag -a v2.0.0 -m "substrate v2.0 — Workflow Runtime + Proposal Pipeline"
git push origin v2.0.0
```

Force-update the `v2` major-version pointer once published:

```bash
git tag -a v2 -m "@op4z/substrate@v2 (latest)"
git push origin v2 --force-with-lease
```

The `v2` tag is the consumer pinning surface (mirrors the
`actions/checkout@v4` convention).

## Publish (when ready)

```bash
# 1. Build from a clean tree.
cd packages/substrate
npm run clean
npm run build

# 2. Verify the tarball contents.
npm pack
tar -tzf op4z-substrate-2.0.0.tgz

# Expected file list:
#   - dist/cli.js + dist/**/*.js (.d.ts files)
#   - templates/ (workflows, hooks, doc-checks, standards,
#                 audits, knowledge-sources, rules-registry,
#                 bridges, init)
#   - templates-history/{1.0.0,2.0.0}/ snapshots
#   - schemas/{workflow,hook,doc-check,config}.schema.json
#   - README.md
#   - LICENSE

# 3. Dry-run the publish.
npm publish --dry-run

# 4. Real publish.
npm publish --access public

# 5. Confirm.
npm view @op4z/substrate@2.0.0
```

## What gets shipped

The `files` array in `packages/substrate/package.json` declares the
tarball contents:

```json
{
  "files": [
    "dist",
    "templates",
    "templates-history",
    "schemas",
    "README.md",
    "LICENSE"
  ]
}
```

Critically excluded (verify via `tar -tzf`):

- No source `.ts` files
- No `tests/`
- No `docs/`
- No `.agent/` HANDOFFs
- No `vitest.config.ts` / `tsconfig*.json`
- No `node_modules/`

## GitHub release

1. Visit https://github.com/op4z/substrate/releases/new
2. Tag: `v2.0.0`
3. Title: `substrate v2.0 — Workflow Runtime + Proposal Pipeline`
4. Body: paste the `[2.0.0]` section from `CHANGELOG.md`.
5. Attach the npm tarball as a build artefact (optional but useful
   for air-gapped consumers).

## Post-release

- [ ] Announce on relevant channels (Twitter, Reddit, HN — at your
      discretion).
- [ ] Update the docs site's "Status" section once published
      (`docs-site/src/pages/index.astro`).
- [ ] Open issues for any deferred v2.x work surfaced during the
      release. Candidates currently parked:
      - AI-drafted standards-doc + ADR applicators (deterministic
        drafts ship in v2.0; the AI polish wrapper is open-ended)
      - `substrate scheduler --auto-run` (today's CLI is
        non-invasive; cron-driven invocation is the consumer's job)
      - Visual / web UI for proposal review (CLI walk only in v2.0)
- [ ] Schedule the v2.1 planning window.

## Rollback

If a critical bug ships in v2.0.0:

```bash
# Unpublish is restricted to 72h post-publish; after that, ship
# 2.0.1 with the fix. Don't deprecate v2.0.0 unless it's actively
# dangerous to consumers.

# If within 72h:
npm unpublish @op4z/substrate@2.0.0

# Otherwise:
npm dist-tag rm @op4z/substrate latest
# Then ship 2.0.1 with the fix and re-add the tag.
```

## GitHub Action's default tag

The action's docs reference `@v2` once v2.0 publishes. Until then,
the action's `action.yml` and consumer docs continue to recommend
`@v1`. After publish:

```bash
git tag -a v2 -m "@op4z/substrate@v2 (latest)"
git push origin v2 --force-with-lease
```

## Out-of-scope from the publish

- **The op4z GitHub org access** is being recovered by the
  maintainer; do not push to the remote until that lands.
- **Publishing adapter packages** is optional at v2.0. They remain
  on the v0.8 surface and aren't required for `@op4z/substrate`'s
  v2.0 functionality.
- **`docs-site` deployment** is independent of the npm publish. The
  site builds locally via `npm run docs:build`; CI / Pages
  deployment is a follow-up.
