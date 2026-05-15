---
scope: backend
area: error-handling
last_updated: TODO
rules:
  - BE-ERR-001
  - BE-ERR-002
update_triggers:
  - New exception classes
  - Error response shape changes
---

# Backend Error Handling Standards

> Cadence scaffold — fill in the TODOs.

How errors are raised, caught, transformed, and surfaced across the
backend.

## 1. Exception hierarchy

TODO: Document your base exception and the standard subclasses
(`NotFoundError`, `ValidationError`, `PermissionDeniedError`,
`ConflictError`, etc.).

```python
class AppError(Exception):
    code: str
    status_code: int

class NotFoundError(AppError):
    code = "NOT_FOUND"
    status_code = 404
```

## 2. When to raise

TODO: Raise specific exceptions, not HTTP exceptions. Let the framework
adapter translate.

## 3. When to catch

TODO: Catch at the boundary (middleware, exception handler), not in
service code. Service code that catches should only do so to add
context, then re-raise.

## 4. Logging

TODO: Errors logged with correlation ID, stack trace, structured
context. Don't log secrets in error context.

## 5. Client-facing messages

TODO: User-safe messages (no stack traces, no internal IDs leaked). The
client gets the `code` field; the message is for humans.

## 6. Validation errors (BE-ERR-001)

TODO: Pydantic / framework validation error shape. Whether you flatten
field paths or nest them.

## 7. External service failures

TODO: Retries, circuit breakers, timeouts. Whether downstream failure
becomes 502 / 503 / 504 vs a domain-specific error code.

## 8. Background task failures

TODO: How async / queued task failures surface. Dead-letter handling.
User notification policy.

## 9. Forbidden patterns

- `except Exception: pass` (or `catch (e) {}` in TS) — never.
- Returning a success response with an error embedded — never.
- Raising plain `Exception` / `Error` in code paths a client can hit
  — replace with a typed exception.
