---
action: api-contract
command: audit
schema_version: 1
description: API contract audit — endpoint diffs across versions, breaking changes, schema drift, undocumented endpoints.
---

# Audit: API Contract

Targets external-facing API surface. Compares the current state of the
API against a baseline (the previous published version or a recorded
snapshot) and surfaces breaking changes before they ship.

## Inputs

- Optional `--baseline <ref>` — git ref to compare against (default
  `main`).
- Optional `--service <name>` to scope.

## Output

- `auto/audits/api-contract/YYYY-MM-DD.md`
- `auto/audits/api-contract/latest.json`

## Block 1: Pre-flight

- Locate the API definition surface. Options in order of preference:
  1. A generated OpenAPI / gRPC / GraphQL schema file
  2. A code-introspection pass (FastAPI's `app.openapi()`, Spring's
     swagger, etc.)
  3. Static grep over the endpoint decorators (last resort)
- Load the previous sidecar.

## Block 2: Discovery

- Endpoint count
- Per-endpoint: method, path, request schema, response schema, auth
  requirement
- Deprecated endpoints (those marked or scheduled for removal)
- Public vs internal split (if your API has a documented surface)

## Block 3: Run Detectors

### Pass A — Removed endpoints

- A public endpoint exists in baseline but not in the current state:
  severity high.
- A deprecated endpoint reached its removal date without a removal:
  severity medium (operational reminder).

### Pass B — Schema-breaking changes

For each endpoint that exists in both:

- Required field added to request: severity high (existing clients break).
- Field removed from response: severity high.
- Field type narrowed (e.g. `string` → `enum`): severity high.
- Field type widened: severity low.
- New optional field on request: severity low.
- New field on response: severity low (but document — clients may rely
  on the response shape).

### Pass C — Behavior-breaking changes

- Status code semantics changed (`201` → `200`): severity high.
- Auth requirement changed (required → optional, or vice versa):
  severity critical.
- Pagination shape changed: severity high.
- Rate limit headers changed: severity medium.

### Pass D — Documentation drift

- Endpoints exist in code but not in published docs: severity medium.
- Endpoints documented but no longer in code: severity medium.
- Request / response examples in docs are out of date: severity low
  (when machine-checkable).

### Pass E — Versioning hygiene

- Breaking changes added without a version bump: severity critical.
- New version published without a deprecation timeline for the previous
  version: severity medium.
- Multiple versions with no clear migration path: severity medium.

## Block 4: Score + Gate

- Hard gates:
  - Any breaking change without a major-version bump → fail.
  - Removed public endpoint without prior deprecation → fail.
- Otherwise standard formula.

## Block 5: Diff vs Baseline

- New endpoints added (additive — fine)
- Removed endpoints (gate)
- Schema changes (per-endpoint table)
- Behavior changes

## Block 6: Reports

```markdown
---
date: YYYY-MM-DD
baseline: <ref>
endpoints_added: N
endpoints_removed: N
endpoints_changed: N
breaking: N
---

# API contract audit

## Breaking changes
## New endpoints
## Removed endpoints
## Schema changes (per endpoint)
## Documentation drift
## Recommended actions
```

## Block 7: Followups

- For breaking changes, draft the deprecation notice and migration
  guide before merging.
- Pin a snapshot of the API after every release so the next audit has
  a stable baseline.

## Rules

**Do:** treat external API as a contract; pin baselines per release;
document additive changes too — they affect client behavior.
**Don't:** ship breaking changes without a version bump; rely on
"nobody is using this endpoint" — they are.
