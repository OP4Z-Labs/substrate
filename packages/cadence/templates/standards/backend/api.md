---
scope: backend
area: api
last_updated: TODO
rules:
  - BE-API-001
  - BE-API-002
update_triggers:
  - New endpoint conventions
  - Versioning policy changes
  - Response-shape changes
---

# Backend API Standards

> Cadence scaffold — fill in the TODOs.

REST (or gRPC, or GraphQL) conventions every public endpoint in this
repo follows.

## 1. URL structure

TODO: Document your URL conventions. Common pattern:

```
/api/v1/<resource>                 # list / create
/api/v1/<resource>/{id}            # get / update / delete
/api/v1/<resource>/{id}/<action>   # action endpoints
/api/v1/<resource>/bulk            # bulk operations
```

## 2. HTTP methods

TODO: Confirm semantic mapping (`GET` safe, `POST` creates, `PUT`
idempotent update, `PATCH` partial, `DELETE` removes).

## 3. Query parameters

TODO: Pagination, filtering, sorting, relationship inclusion.

```
?skip=0&limit=50
?status=active&status=pending
?sort_by=created_at&order=desc
?include=author,reviewer
```

## 4. Response shapes

TODO: Document the canonical list and single-item shapes.

```json
{ "items": [...], "total": 100, "skip": 0, "limit": 50 }
```

## 5. Error responses (BE-API-001)

TODO: Document the canonical error shape and the codes it carries.

```json
{
  "error": "human-readable message",
  "code": "ERROR_CODE",
  "correlation_id": "..."
}
```

## 6. Status codes

TODO: When you use 200 vs 201 vs 204; when 4xx vs 5xx; what 422 means.

## 7. Versioning

TODO: Reference `api-versioning.md` if you have one. URL versioning vs
header versioning. Deprecation policy.

## 8. Authentication

TODO: Reference `security.md`. Per-endpoint auth requirement; how it's
declared.

## 9. Rate limiting

TODO: Default limit, override mechanism, error response when exceeded.

## 10. Documentation

TODO: OpenAPI / Swagger / similar. Where it's hosted, how it's
generated, when it's updated.
