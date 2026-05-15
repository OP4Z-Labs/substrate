---
scope: backend
area: error-handling
last_updated: 2026-05-14
rules:
  - BE-ERR-001
  - BE-ERR-002
update_triggers:
  - Custom exception class added
  - Error-to-HTTP mapping changed
  - Retry policy modified
---

# Error Handling

> **Substrate default standard.** How services raise, propagate, log, and
> respond to errors. Independent of language; equivalent patterns work
> in Python, TypeScript, Go.

## Scope

This standard applies to:

- Exceptions / errors raised inside backend services.
- The boundary where errors become HTTP responses.
- Retry, fallback, and circuit-breaker patterns.

It does NOT cover:

- Frontend error boundaries (see `frontend/react.md`).
- Operational alerting (see `operations/runbooks.md`).

## Rules

### 1. A custom exception hierarchy, rooted at the service

```python
class ServiceError(Exception):
    """Base for all service-defined errors."""
    code: str = "INTERNAL_ERROR"
    status_code: int = 500


class NotFoundError(ServiceError):
    code = "NOT_FOUND"
    status_code = 404


class ValidationError(ServiceError):
    code = "VALIDATION_ERROR"
    status_code = 422


class TenantIsolationError(ServiceError):
    code = "TENANT_ISOLATION"
    status_code = 403
```

Service code raises these. The HTTP layer maps them to responses
once, in middleware — not in every handler.

### 2. No bare `except:` / `catch {}` (BE-ERR-001)

```python
# WRONG
try:
    result = compute()
except:
    pass

# WRONG (in TS / JS)
try { result = compute(); } catch {}
```

Bare catches swallow `KeyboardInterrupt`, `SystemExit`, programming
errors. They also hide bugs that look like "intermittent" failures
in production.

Always:

- Catch the specific type(s) you can handle.
- Or catch broadly AND log AND re-raise.

```python
try:
    result = compute()
except (ConnectionError, TimeoutError) as exc:
    logger.warning("compute failed, retrying", error=str(exc))
    raise RetryableError("compute failed") from exc
```

### 3. Errors don't leak in HTTP responses (BE-ERR-002)

A `500 Internal Server Error` response body contains:

```json
{
  "error": "Internal server error",
  "code": "INTERNAL_ERROR",
  "correlation_id": "01HX..."
}
```

NEVER include:
- Stack traces
- Database error messages (which often leak schema info)
- File paths
- Internal class / function names

The full error detail goes to logs, linked to the response via the
correlation ID.

### 4. Validation errors return field-level detail

Returned with HTTP `422 Unprocessable Entity`:

```json
{
  "error": "Validation error",
  "code": "VALIDATION_ERROR",
  "correlation_id": "01HX...",
  "details": [
    { "field": "title", "message": "must not be empty" },
    { "field": "due_at", "message": "must be in the future" }
  ]
}
```

Clients can render these next to the form field they came from.
Generic "validation failed" is not enough.

> Note: `422` (not `400`) for any payload validation failure —
> matches FastAPI / Pydantic default behavior. `400` is reserved for
> requests the server couldn't even parse (malformed JSON, missing
> body). See `api.md` for the full status-code table.

### 5. Errors are logged with structure, not just messages

```python
logger.error(
    "Task creation failed",
    tenant_id=str(tenant_id),
    user_id=str(user_id),
    error_type=type(exc).__name__,
    error_message=str(exc),
    correlation_id=correlation_id,
)
```

Free-text error logs are unsearchable. The structured fields above
mean you can find "all task-creation failures for tenant X" in one
query.

### 6. Retries are bounded and backed off

Retry only:
- Idempotent operations.
- Transient errors (`ConnectionError`, `TimeoutError`, HTTP 5xx).

Use exponential backoff with jitter. With `tenacity`:

```python
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

@retry(
    retry=retry_if_exception_type((ConnectionError, TimeoutError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential_jitter(initial=1, max=10),
    reraise=True,
)
async def call_downstream(url: str) -> dict:
    ...
```

NEVER retry:
- `400`, `401`, `403`, `404`, `422` — these are not transient.
- Operations with side effects unless they're idempotent.

### 7. Circuit breakers for downstream dependencies

When a downstream service is failing repeatedly, stop hammering it.
Use a circuit breaker (`pybreaker` or `purgatory` for Python;
`opossum` for Node) so the failure doesn't cascade.

States: closed (normal) → open (failing, fast-fail) → half-open
(probing).

A circuit breaker without an alert is a hidden outage — wire an
alert to the "open" transition.

### 8. `from` clause preserves the chain (Python)

```python
try:
    ...
except DatabaseError as exc:
    raise ServiceError("Could not save") from exc
```

Without `from`, the original cause is lost from the traceback.

### 9. Don't catch and re-raise without adding value

```python
# Useless
try:
    do_work()
except Exception as exc:
    raise exc
```

If you can't handle or enrich, let it propagate.

## Examples

### Do — typed errors, mapped at the boundary

```python
# app/services/tasks.py
async def get_task(db, task_id: UUID, tenant_id: UUID) -> Task:
    task = await db.get(Task, task_id)
    if task is None:
        raise NotFoundError(f"Task {task_id} not found")
    if task.tenant_id != tenant_id:
        raise TenantIsolationError("Cross-tenant access denied")
    return task

# app/api/middleware/errors.py
# Assumes the correlation-id middleware from observability.md is
# installed earlier in the stack — it's what sets
# request.state.correlation_id.
@app.exception_handler(ServiceError)
async def service_error_handler(request, exc: ServiceError):
    logger.warning(
        "service error",
        error_type=type(exc).__name__,
        code=exc.code,
        correlation_id=request.state.correlation_id,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": str(exc),
            "code": exc.code,
            "correlation_id": request.state.correlation_id,
        },
    )
```

### Don't — handler does the HTTP mapping itself

```python
@router.get("/tasks/{id}")
async def get_task(id: UUID, db, user):
    try:
        task = await db.get(Task, id)
    except Exception as exc:
        # Swallows real bugs; never bubbles up.
        return JSONResponse(status_code=500, content={"error": str(exc)})
    if task is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return task
```

This pattern, repeated in every handler, means every handler invents
its own error shape, its own logging, and its own bugs.

### Do — retry the right operations

```python
@retry_on(ConnectionError, TimeoutError, retries=3)
async def fetch_user(client, user_id: UUID) -> User:
    response = await client.get(f"/users/{user_id}")
    response.raise_for_status()
    return User.model_validate(response.json())
```

### Don't — retry everything

```python
@retry_on(Exception, retries=10)
async def fetch_user(client, user_id):
    ...
```

This retries `400`s, `401`s, validation errors. You'll hammer the
downstream and never see real bugs.

## Rationale

Errors are how a service tells you "the assumption broke." Treat
them as first-class data: typed, structured, logged with context,
mapped predictably to HTTP responses. The discipline above is the
difference between an on-call shift where every error you see is a
real problem, and one where you spend hours triaging noise.

## See also

- `api.md` — canonical error response shape.
- `observability.md` — correlation IDs, structured logging.
- `testing.md` — testing error paths.
- `frontend/react.md` — error boundaries.
