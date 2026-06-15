# Infrastructure — Docker baseline (Org)

## Dockerfiles

- Pin base images to a specific tag (never `latest`).
- Multi-stage builds for production images.
- Run as non-root user.

## docker-compose

- All services declare healthchecks.
- Postgres + Redis on isolated networks.
- No host-mounted volumes for production data.

## Image hygiene

- `.dockerignore` covers `node_modules/`, build outputs, `.env`.

> Source: `@acme/substrate-shared@1.0.0` — fixture for the substrate
> enterprise smoke test.
