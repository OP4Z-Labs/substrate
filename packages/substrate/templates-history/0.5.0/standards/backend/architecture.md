---
scope: backend
area: architecture
last_updated: TODO
rules:
  - BE-ARCH-001
  - BE-ARCH-002
  - BE-ARCH-003
update_triggers:
  - New service patterns established
  - Shared package additions
  - Middleware / dependency-injection changes
---

# Backend Architecture Standards

> Cadence scaffold — fill in the TODOs with your team's chosen patterns.
> Each section is a placeholder; delete the ones that don't apply.

This document describes the structural and behavioral patterns that
every backend service in this repo should follow. Rules referenced below
live in `cross-cutting/RULES.yaml`.

## 1. Directory Structure

TODO: Document your canonical service layout. Reference one or two
"gold standard" services that exemplify the pattern. Example shape:

```
service-name/
├── app/
│   ├── api/             # HTTP handlers / endpoint definitions
│   ├── core/            # config, dependencies
│   ├── db/              # session, models, migrations
│   ├── schemas/         # request / response shapes
│   ├── services/        # business logic
│   ├── integrations/    # cross-service clients
│   └── main.py          # entry point
└── tests/
```

## 2. Required Files

TODO: List the files every service must have (logging setup, config
surface, health endpoint, etc.) and link to reference implementations.

## 3. Layering Rules (BE-ARCH-001, BE-ARCH-002)

- Endpoints call services.
- Services call the database, message broker, and external integrations.
- No direct database calls from the API layer.
- No HTTP concerns inside service classes.

## 4. Async / concurrency posture

TODO: Describe whether your services are async-first, sync-first, or
mixed; what the bar is for blocking operations on the request path; how
long-running work is queued.

## 5. Error handling

TODO: Reference `error-handling.md` and describe the exception
hierarchy used here.

## 6. Dependency injection

TODO: Document how services compose dependencies (constructor
injection, framework DI container, factory functions).

## 7. Inter-service communication

TODO: Decide between synchronous HTTP, message broker, RPC, or a mix.
Document the cases each is appropriate for.

## 8. Configuration

TODO: Single typed config surface. Where it lives, how it's validated,
how secrets are loaded.

## 9. Observability

TODO: Reference `observability.md`. Note any service-level minimums
(structured logs on every request, correlation IDs, key metrics).

## 10. Testing

TODO: Reference `testing.md`. Note any architectural test requirements
(integration coverage on critical paths, contract tests across
services).

## Cross-references

- `database.md` — schema, migrations, query patterns
- `api.md` — REST conventions, versioning, response shapes
- `messaging.md` — events, queues, consumer groups
- `security.md` — auth, isolation, secrets handling
- `testing.md` — pyramid, fixtures, coverage bar
