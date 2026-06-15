# Backend — API conventions (Org)

REST + JSON. Resources nested under `/api/v<N>/`.

## Response envelope

- List endpoints: `{ items, total, skip, limit }`.
- Error responses: `{ error, code, correlation_id }`.

## Versioning

- Major-version prefix is mandatory.
- Deprecated endpoints emit a `Deprecation` header.

> Source: `@acme/substrate-shared@1.0.0` — fixture for the substrate
> enterprise smoke test.
