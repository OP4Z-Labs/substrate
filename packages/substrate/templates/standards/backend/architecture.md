---
scope: backend
area: architecture
last_updated: 2026-05-14
rules:
  - BE-ARCH-001
  - BE-ARCH-002
update_triggers:
  - New service patterns established
  - Shared package additions
  - Middleware / dependency-injection changes
---

# Backend Architecture

> **Substrate default standard.** Opinionated baseline for backend
> services. Override per-team where your stack diverges; keep the
> layering discipline.

## Scope

This standard applies to:

- Every long-running backend service (HTTP API, message consumer,
  scheduled worker).
- The boundary between HTTP / network concerns and business logic.
- Cross-service composition patterns (events, RPC, libraries).

It does NOT apply to:

- CLI tools and one-shot scripts.
- Pure libraries (no I/O, no state).
- Frontend code (see `frontend/react.md`, `frontend/data-management.md`).

## Rules

### 1. Three layers: API → Service → Repository (BE-ARCH-001)

Every request flows through the same three layers:

```
HTTP handler  ─►  Service class  ─►  Repository / DB
   ↑                                     │
   └─────  HTTP response  ◄──────────────┘
```

- **API layer** — handler functions, route definitions, request /
  response shapes. **No business logic. No direct DB calls.** Its
  job is to translate HTTP into a function call, and back.
- **Service layer** — business logic. Tenant-aware, transaction-aware,
  side-effect-aware. Calls repositories. Owns invariants.
- **Repository / data layer** — query construction, ORM session
  management. **No business decisions.** Returns rows or domain
  objects.

The single most common architectural violation is "I'll just do this
one query in the handler." It compounds: now you have HTTP concerns
in the data layer, business logic in the routing layer, and no one
place to test the rules.

### 2. Async handlers in async services (BE-ARCH-002)

Pick an I/O posture per service and hold it:

- **Async-first.** Every handler is `async def`. Every DB call uses
  the async driver. No `time.sleep`, no blocking HTTP libs (use
  `httpx` async, `aiohttp`, etc.).
- **Sync-first.** Every handler is sync. Block freely; rely on the
  process model (workers, threads) for concurrency.

Mixing is allowed only at clearly-marked boundaries (background
workers, CLI commands). A sync handler in an async service is a
production-grade tail-latency footgun: it blocks the event loop and
slows every other request on the same worker.

### 3. One canonical service skeleton

Every service in this repo starts from the same skeleton:

```
service-name/
├── app/
│   ├── api/                   HTTP layer (routes, endpoint funcs)
│   │   └── v1/                versioned per backend/api-versioning.md
│   ├── core/                  config, deps, app factory
│   ├── db/                    session, base model, mixins
│   │   ├── models/            ORM mappings
│   │   └── migrations/        alembic / typeorm / prisma
│   ├── schemas/               request / response types
│   ├── services/              business logic
│   ├── integrations/          clients for other services / vendors
│   ├── main.py                entry point
│   └── health.py              /health and /ready handlers
├── tests/
│   ├── unit/
│   ├── integration/
│   └── conftest.py
├── pyproject.toml             (or package.json / go.mod / Cargo.toml)
├── Dockerfile
└── README.md
```

Adapt the names to your language, but keep the layering. A new
engineer should be able to walk into any service and know where
each kind of code lives.

### 4. Configuration: one typed surface

A service has exactly one config object (settings class / struct /
Pydantic model). It loads from env vars at startup, validates eagerly,
and crashes loudly if anything required is missing.

- **No `os.getenv()` scattered across the codebase.** Add the field
  to the config, read it once at startup, pass it through.
- **Validate at startup, not on first use.** A service that boots
  with bad config and only fails on the first user request is a
  service that ships outages.
- **Secrets are config, but typed as secrets.** Use `SecretStr` or
  equivalent so they don't accidentally appear in logs or repr
  output.

### 5. Health endpoints are mandatory

Every service exposes:

- `GET /health` — process is alive. Cheap, no dependencies.
- `GET /ready` — service can serve requests. Checks deps it cannot
  start without (DB connection, primary message broker).

Health drives the orchestrator (k8s probes, ECS health checks,
load balancers). Reusing `/ready` as `/health` couples liveness to
dependency health and causes restart storms when a downstream is
flapping.

### 6. Inter-service communication: events for facts, HTTP for queries

When service A needs to tell service B that something happened, ship
an **event** (see `messaging.md`). When service A needs an answer
from service B right now, make an **HTTP call**.

Anti-pattern: events that block the producer waiting for a consumer
ACK. That's an HTTP call with extra steps.

Anti-pattern: HTTP calls that fan out across 5+ services to assemble
one response. That's a join the data layer should be doing.

### 7. Background work is its own deploy unit

Long-running tasks (more than ~5 s of work, or scheduled jobs) run in
a separate process from the HTTP handlers. This:

- Isolates their resource use (memory, CPU) from request latency.
- Lets you scale them independently.
- Survives HTTP-worker restarts.

Use Celery (Python), BullMQ (Node), Sidekiq (Ruby), or whatever your
stack offers. The HTTP handler enqueues; the worker processes.

### 8. Cross-cutting concerns live in middleware

Authentication, request ID propagation, structured logging,
rate limiting, CORS — all middleware. Each service composes a
known stack at startup. Adding a new cross-cutting concern means
adding middleware, not sprinkling code through handlers.

## Examples

### Do — clean three-layer separation

```python
# app/api/v1/tasks.py
@router.post("/tasks")
async def create_task(
    body: TaskCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskRead:
    service = TaskService(db)
    task = await service.create(body, user.id, user.tenant_id)
    return TaskRead.from_orm(task)

# app/services/tasks.py
class TaskService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = TaskRepository(db)

    async def create(self, data: TaskCreate, user_id: UUID, tenant_id: UUID) -> Task:
        # Business invariant: due date must be in the future.
        if data.due_at and data.due_at < now():
            raise ValidationError("due_at must be in the future")
        return await self.repo.insert({**data.model_dump(), "owner_id": user_id, "tenant_id": tenant_id})

# app/db/repositories/tasks.py
class TaskRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def insert(self, fields: dict) -> Task:
        task = Task(**fields)
        self.db.add(task)
        await self.db.commit()
        return task
```

### Don't — handler talks directly to the DB

```python
# WRONG
@router.post("/tasks")
async def create_task(body: TaskCreate, db: AsyncSession = Depends(get_db)):
    task = Task(**body.dict())
    db.add(task)
    await db.commit()
    return task
```

Three problems: business rules can't be tested in isolation, tenant
scoping is invisible, and the handler now knows about ORM session
lifecycle.

### Do — async-first consistency

```python
async def fetch_external_data(client: httpx.AsyncClient, url: str) -> dict:
    response = await client.get(url, timeout=5.0)
    response.raise_for_status()
    return response.json()
```

### Don't — sync call inside an async handler

```python
async def fetch_external_data(url: str) -> dict:
    # Blocks the event loop. Other requests stall.
    return requests.get(url, timeout=5.0).json()
```

## Rationale

The discipline above is the difference between a codebase where a
new engineer can ship safely on day one and a codebase where every
change requires rebuilding the mental model from scratch. The
three-layer split, single config surface, and consistent skeleton
mean every service in the repo looks like every other service from
20 feet away — the differences are in the business logic, not in
the structure.

When teams diverge from this pattern, it's usually for a real
reason (a specific service has unusual constraints). Document the
divergence at the top of that service's README so the deviation is
intentional, not accidental.

## See also

- `backend/api.md` — endpoint conventions, error shapes.
- `backend/database.md` — schema design, query patterns, migrations.
- `backend/messaging.md` — events, consumers, idempotency.
- `backend/observability.md` — logs, metrics, tracing.
- `backend/security.md` — auth, isolation, secrets.
- `backend/testing.md` — pyramid, fixtures, coverage bar.
