# Backend — Security baseline (Org)

## Secrets

- No secrets in code or commit messages. Use environment variables.
- All `.env` files gitignored.

## Authentication

- Every endpoint requires authentication except explicit public routes.
- JWT tokens encrypted with Fernet at rest.
- Sessions expire after 24h of inactivity.

## Multi-tenant isolation

- Every query filters `tenant_id`.
- API responses never leak data across tenant boundaries.

> Source: `@acme/substrate-shared@1.0.0` — fixture for the substrate
> enterprise smoke test.
