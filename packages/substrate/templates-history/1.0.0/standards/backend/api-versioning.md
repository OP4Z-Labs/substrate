---
scope: backend
area: api-versioning
last_updated: 2026-05-14
rules:
  - BE-APIV-001
  - BE-APIV-002
update_triggers:
  - Major API version planned
  - Deprecation cycle started
  - Breaking change shipped
---

# API Versioning

> **Substrate default standard.** Opinionated baseline for HTTP APIs.
> Override the per-team specifics; keep the discipline.

## Scope

This standard applies to:

- Every public HTTP API surface (REST, GraphQL, RPC) consumed by clients
  that the team does not control.
- Internal service-to-service APIs where the producer and consumer can
  not synchronize their release.

It does NOT apply to:

- In-process function call boundaries.
- Database schemas (see `database.md` and `operations/database-ops.md`
  for expand/contract migrations).
- Background job payloads internal to one service (those are coupled to
  the deploy unit and don't need a public version contract).

## Rules

### 1. URL versioning is the default — `/api/vN/...`

Every endpoint sits under a numbered version prefix. `/api/v1/tasks`
not `/tasks`. The number changes only when the contract changes in a
breaking way.

**Why URL versioning over header versioning?** It's debuggable
(visible in logs, browser dev tools, curl), it routes cleanly at
the edge, and it surfaces version skew immediately. Header
versioning is technically purer but a maintenance burden in
practice — clients forget the header, gateways strip it,
debugging suffers.

Cross-link: rule `BE-APIV-001`.

### 2. SemVer the version number — major-only in the URL

The URL carries the **major** version. Minor and patch changes ship
in-place under the same `/v1/`:

| Change                                            | Where               |
| ------------------------------------------------- | ------------------- |
| New optional field on a response                  | `/v1` in place      |
| New endpoint                                      | `/v1` in place      |
| Required field added to a request                 | `/v2`               |
| Field removed or renamed                          | `/v2`               |
| Response shape restructured                       | `/v2`               |
| Behavior change clients cannot tolerate silently  | `/v2`               |

Adding to a response is non-breaking _only if_ clients are tolerant
to unknown fields. Document this expectation explicitly in your
client SDK / SDK-less consumer docs.

### 3. Deprecation requires headers + a sunset date

When an endpoint or version is going away, every response from it
includes:

```
Deprecation: true
Sunset: Sat, 31 Dec 2026 23:59:59 GMT
Link: <https://docs.example.com/migrate/v1-to-v2>; rel="successor-version"
```

Sunset MUST be at least 90 days after the deprecation announcement
for external APIs (clients you don't control). Internal-only APIs
can be tighter — pick a number, write it down, follow it.

Cross-link: rule `BE-APIV-002`.

### 4. Removal requires a full deprecation cycle

The path to removing an endpoint:

1. **Announce.** Add `Deprecation` + `Sunset` headers in code. Update
   docs. Notify known clients.
2. **Bake.** Let the sunset window elapse. Track usage; chase
   stragglers.
3. **Cut.** Either remove the endpoint (returns 404) or replace
   handler body with 410 Gone + a body pointing at the successor.

Skipping step 2 — turning off an endpoint within hours of
announcing — is a hard incident. Don't do it.

### 5. Breaking changes within a major are not allowed

Within `/v1`, the contract is immutable. If a "small" breaking
change is unavoidable (e.g. fixing a security bug that requires a
schema change), the change either:

- Lives behind a new versioned URL (`/v1/.../safe`), or
- Triggers a full `/v2` migration, or
- Ships in `/v1` AND issues a security advisory acknowledging the
  break, with a migration window.

There is no "everyone-knows-this-will-break-just-do-it" exception.

### 6. Version multiple at the same time when supporting clients

When you ship `/v2`, `/v1` keeps working until it's sunset. The
trap: maintaining two versions is real cost. Budget for it.

Two strategies for keeping the cost down:

- **Adapter layer.** `/v1` handlers internally call `/v2`'s service
  functions, translating request and response on the way. Service
  code stays unduplicated.
- **Hard fork.** Both versions live in code as independent handler
  trees. Easier to ship the `/v2` change but doubles the surface
  going forward.

Adapter is the default. Hard-fork only when the contract change is
too deep for translation.

### 7. Document version diffs in a changelog

Every API has a `CHANGELOG.md` or equivalent. The entry for `/v2`
explicitly states:

- What changed
- Why
- Migration steps (with sample curl / SDK calls)
- Sunset date for `/v1`
- A link to the deprecation policy

API consumers should never have to diff endpoint docs to figure
out what they need to change.

## Examples

### Do — non-breaking addition

```diff
 # /api/v1/tasks (GET response)
 {
   "id": "uuid",
   "title": "string",
+  "estimated_hours": 4.0
 }
```

Tolerant clients ignore the new field. Strict clients (unlikely,
but possible) fail; doc the tolerance expectation.

### Don't — silently rename a field

```diff
 # /api/v1/tasks (GET response)
-  "estimatedHours": 4.0
+  "estimated_hours": 4.0
```

This is breaking. Ship `/v2` or aliases both keys during a
deprecation window.

### Do — full deprecation cycle

```
2026-04-01  /v1/tasks/{id}/complete renamed to /v1/tasks/{id}/close
            POST /complete returns 200 + Deprecation: true + Sunset: 2026-07-01
            CHANGELOG updated
            All client SDKs ship v3.4 calling /close
2026-07-01  /complete returns 410 Gone, body links to /close
2026-10-01  /complete handler removed entirely
```

### Don't — quietly remove an endpoint

A 404 with no warning, no header, no migration doc is the
worst-of-all-worlds. Client teams get paged at 3am. Avoid.

## Rationale

The job of versioning is to let the producer evolve the API without
breaking consumers, and let consumers upgrade on their own schedule.
URL-based major versioning is the boring choice that gets the job
done. Deprecation cycles with headers and sunset dates give
consumers the data they need to plan without you having to email
them.

If two consumers want different things at the same time and can't
synchronize, that's exactly what version coexistence is for. The
cost of supporting two versions is real but predictable; the cost
of unscheduled breaking changes is unpredictable, paged, and
expensive.

## See also

- `backend/api.md` — request/response shapes, status codes, errors.
- `operations/database-ops.md` — schema migration discipline that
  lets `/v2` ship without rolling back the DB.
