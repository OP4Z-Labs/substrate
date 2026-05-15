---
scope: backend
area: api
last_updated: 2026-05-14
rules:
  - BE-API-001
  - BE-API-002
update_triggers:
  - New endpoint conventions
  - Versioning policy changes
  - Response-shape changes
---

# Backend API

> **Cadence default standard.** REST conventions for any public HTTP
> API in this repo. See `api-versioning.md` for the version cycle.

## Scope

This standard applies to every public HTTP endpoint — internal
service-to-service APIs and client-facing APIs both. It is REST-flavored
but the discipline (consistent shapes, predictable errors, pagination
contract) applies to GraphQL and gRPC just as well.

## Rules

### 1. URL structure

```
/api/v1/<resource>             list / create
/api/v1/<resource>/{id}        get / update / delete
/api/v1/<resource>/{id}/<verb> action endpoints (POST)
/api/v1/<resource>/bulk        bulk operations
```

- Plural nouns: `/api/v1/tasks`, not `/api/v1/task`.
- Lowercase, kebab-case for multi-word: `/api/v1/task-templates`.
- IDs in the path, not the query string.
- Actions get their own segment when they don't fit verb semantics
  (`/api/v1/tasks/{id}/complete` over a magic field on PATCH).
- `/<resource>/bulk` is the deliberate exception to "RESTful nouns"
  — it batches creates / updates / deletes for atomicity, payload
  efficiency, and validation in one round-trip. Document the exact
  shape (which verbs it accepts, partial-success semantics) per
  endpoint.

### 2. HTTP methods carry semantics

| Method   | Use                                          | Idempotent | Safe |
| -------- | -------------------------------------------- | ---------- | ---- |
| `GET`    | Read                                         | ✓          | ✓    |
| `POST`   | Create, or action that isn't safely repeated | ✗          | ✗    |
| `PUT`    | Replace (full-update)                        | ✓          | ✗    |
| `PATCH`  | Partial update                               | ✓          | ✗    |
| `DELETE` | Remove                                       | ✓          | ✗    |

Don't tunnel writes through `GET` to dodge CSRF. Fix CSRF properly.

### 3. Query parameters: pagination, filtering, sorting, include

```
?skip=0&limit=50                  pagination (or ?cursor=...)
?status=active&status=pending     multi-value filter (OR)
?exclude_status=archived          exclusion filter
?sort_by=created_at&order=desc    sorting
?include=author,reviewer          relationship inclusion
```

Pick one pagination style per service and stick to it. Mixing
skip/limit and cursors confuses every client.

Cross-link: rule `BE-API-002`.

### 4. Response shapes: envelopes for lists, raw for single

**List endpoint:**

```json
{
  "items": [...],
  "total": 100,
  "skip": 0,
  "limit": 50
}
```

**Single item:**

```json
{ "id": "uuid", "title": "...", ... }
```

No `data: { ... }` wrapping on single items. The shape IS the data.

### 5. Canonical error response (BE-API-001)

```json
{
  "error": "human-readable message for developers",
  "code": "ERROR_CODE",
  "correlation_id": "uuid"
}
```

Validation errors add a `details` array:

```json
{
  "error": "Validation error",
  "code": "VALIDATION_ERROR",
  "correlation_id": "uuid",
  "details": [
    { "field": "title", "message": "must not be empty" }
  ]
}
```

The `error` field is for developer eyes (logs, debugging). Build
user-facing copy in the client based on `code`, not by parsing the
message. The `correlation_id` lets support correlate a user-reported
issue with server logs.

Note the deliberate asymmetry with rule 4: success responses are the
resource itself (no `data:` envelope), but error responses ARE
enveloped. That's because an error isn't the resource — it's
metadata describing what went wrong, and the metadata fields (`code`,
`correlation_id`) need somewhere to live. The wrapping keeps the
success path clean and the error path discoverable.

### 6. Status codes

| Code  | Meaning                                                                        |
| ----- | ------------------------------------------------------------------------------ |
| `200` | OK with body                                                                   |
| `201` | Created — include the new resource in the body                                 |
| `202` | Accepted (async work queued)                                                   |
| `204` | OK with no body                                                                |
| `400` | Bad request — malformed input                                                  |
| `401` | Unauthenticated — no/bad credentials                                           |
| `403` | Authenticated but not allowed                                                  |
| `404` | Not found                                                                      |
| `409` | Conflict (e.g., duplicate)                                                     |
| `422` | Unprocessable — payload validation failure (missing/invalid field, wrong type, semantic violation) |
| `429` | Rate limited                                                                   |
| `500` | Unexpected server error                                                        |
| `502` | Upstream / dependency returned an invalid response                             |
| `503` | This service is unavailable (load shedding, maintenance, draining)             |
| `504` | Upstream / dependency timed out                                                |

`422` vs `400`: use `400` only when the request is **malformed** —
unparseable JSON, missing body when one is required, content-type
mismatch. Use `422` for any **payload validation failure**: missing
required field, wrong type, or semantic violation like `due_date` in
the past.

> Note: this matches FastAPI / Pydantic default behavior — they
> return `422` for missing or wrong-typed fields out of the box.
> Trying to map "missing required field" to `400` works against
> framework defaults and produces no benefit. See `error-handling.md`
> for the validation-error response shape.

### 7. Authentication via headers, never URL params

```
Authorization: Bearer <token>
```

Never put tokens in query strings — they end up in access logs.

Anonymous endpoints (login, signup, public docs) explicitly declare
themselves. Everything else requires auth by default.

### 8. Documentation: OpenAPI or it didn't ship

Every API surface generates an OpenAPI / Swagger spec. The spec is
checked into the repo (or generated from the code in CI). Breaking
changes to the spec require an API version bump (see
`api-versioning.md`).

## Examples

### Do — RESTful resource endpoints

```
GET    /api/v1/tasks                list
POST   /api/v1/tasks                create
GET    /api/v1/tasks/{id}           read
PATCH  /api/v1/tasks/{id}           partial update
DELETE /api/v1/tasks/{id}           delete
POST   /api/v1/tasks/{id}/complete  action
POST   /api/v1/tasks/bulk           bulk operations
```

### Don't — verbs in URLs, GET for writes

```
GET  /api/getTasks
POST /api/createNewTask
GET  /api/deleteTask?id=42        # CSRF-able and unauditable
```

### Do — uniform error shape

```http
HTTP/1.1 404 Not Found
{
  "error": "Task not found",
  "code": "TASK_NOT_FOUND",
  "correlation_id": "01HX2Z..."
}
```

### Don't — error string only

```http
HTTP/1.1 404 Not Found
"Task not found"
```

Clients can't reliably branch on string content.

## Rationale

A consistent API is one fewer thing every client implementer has to
puzzle out. The conventions above are conservative on purpose —
they're what most successful APIs have converged on. Deviate when
your domain demands it, but write down the deviation so the next
endpoint follows the same convention.

## See also

- `api-versioning.md` — version cycle, deprecation discipline.
- `error-handling.md` — exception → HTTP mapping.
- `security.md` — authentication, rate limiting, CSRF.
- `observability.md` — correlation IDs, request logging.
