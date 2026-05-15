# Contributing to Cadence

Thanks for considering a contribution. This document covers the
build, test, and PR workflow.

## Build & test

```bash
git clone https://github.com/BeauGoldberg/cadence
cd cadence
npm install
npm run build
npm test
```

You need Node 20+. See [docs/compatibility.md](docs/compatibility.md)
for the full matrix.

### Per-package commands

```bash
# Lint / typecheck / build across the workspace
npm run lint
npm run typecheck
npm run build

# Tests
npm test                          # all
npm run test:unit --workspaces    # unit only
npm run test:integration --workspaces  # integration only

# Documentation site
npm run docs:dev                  # local preview at http://localhost:4321
npm run docs:build                # production build
```

### Running cadence locally

After `npm run build`, the CLI is at
`packages/cadence/dist/cli.js`. Link it for global testing:

```bash
cd packages/cadence
npm link
cadence --version
```

Or invoke directly:

```bash
node packages/cadence/dist/cli.js audit --help
```

## Project layout

```
packages/
├── cadence/              the CLI (publishable)
├── adapter-stub/         reference TaskAdapter
├── adapter-linear/       Linear adapter
├── adapter-jira/         Jira adapter
└── adapter-github/       GitHub Issues adapter
docs/                     long-form docs
docs-site/                Astro docs site
templates-history/        snapshots for upgrade (npm artefact)
.agent/                   autonomous-run handoffs (gitignored content)
```

## PR workflow

1. **Open an issue first** for non-trivial changes — saves you
   re-doing the work in PR review.
2. **Branch from `main`.** Short-lived, descriptive name:
   ```
   feat/audit-script-detector-windows
   fix/upgrade-three-way-conflict
   docs/standards-frontend-clarification
   ```
3. **Commit conventions.** Conventional commits with optional scope:
   ```
   feat(audit): support multi-line ripgrep patterns
   fix(upgrade): handle missing template-history gracefully
   docs(standards): expand backend/security.md
   ```
4. **Gates.** All four must pass locally before opening the PR:
   - `npm run build`
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
5. **Tests with code.** New features need tests; bug fixes need a
   regression test.
6. **CHANGELOG.** Add a one-line entry under `## Unreleased`
   describing the user-visible change.
7. **PR description.** Summary + test plan. Use the PR template.

## Sign-off

We don't require DCO sign-offs, but if you do `git commit -s`, the
project will accept and preserve the Signed-off-by trailer.

## Code style

- TypeScript: strict mode, no `any` without justification (see
  `templates/standards/frontend/typescript.md`).
- 100-column lines (prettier configured).
- ESLint: errors fail CI.

## Adding new audit detectors

The detector contract is documented in [docs/audit-runtime.md](docs/audit-runtime.md).
Adding a new detector type is additive:

1. Add a literal to `Detector["type"]` in `src/audit/types.ts`.
2. Add a runner under `src/audit/detectors/`.
3. Wire it into `runner.ts`'s `runSingleRule()`.
4. Add unit tests in `tests/audit-runtime.test.ts`.
5. Document the contract in `docs/audit-runtime.md`.

## Adding rules to the bundled RULES.yaml

Cadence ships a default `RULES.yaml`. To propose a new rule:

1. Open an issue describing the rule and your use case.
2. Land the rule definition in
   `packages/cadence/templates/standards/cross-cutting/RULES.yaml`.
3. Land or update the owning standards doc in
   `packages/cadence/templates/standards/<scope>/<area>.md`.
4. Add detector coverage where appropriate.
5. Test against your own repo before merging.

See [docs/contributing-rules.md](docs/contributing-rules.md) for the
full contribution guide.

## Reporting issues

Use the GitHub issue templates:

- **Bug** — something is broken. Include reproduction.
- **Feature request** — describe the use case, not the
  implementation.
- **Rule contribution** — for the curated public RULES registry.

## Code of conduct

Be kind. Be welcoming. Help maintain a productive collaboration
environment. Maintainers reserve the right to remove participants
whose behavior degrades the project.

## License

By contributing, you agree your contribution is licensed under the
MIT license (for code) or CC-BY-4.0 (for content) as documented in
[LICENSES.md](LICENSES.md).
