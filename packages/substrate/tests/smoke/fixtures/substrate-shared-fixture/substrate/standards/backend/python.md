# Backend — Python style (Org)

Python 3.12 baseline. Use `black` for formatting and `ruff` for linting.

## Hard rules

- `async` handlers in async services. Sync handlers block the event loop.
- Service layer owns DB access; HTTP handlers delegate.
- No bare `except` clauses.
- Use type hints on all public functions.

> Source: `@acme/substrate-shared@1.0.0` — fixture for the substrate
> enterprise smoke test.
