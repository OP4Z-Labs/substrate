---
scope: infrastructure
area: docker
last_updated: TODO
rules:
  - INF-DOCKER-001
update_triggers:
  - Base image updates
  - Build optimization changes
---

# Docker Standards

> Cadence scaffold — fill in the TODOs.

How services are containerized.

## 1. Base images

TODO: Pin specific tags, not `latest`. Document the chosen base per
runtime.

| Component | Base image       | Notes                       |
| --------- | ---------------- | --------------------------- |
| Python    | python:3.12-slim | minimal footprint           |
| Node      | node:20-alpine   |                             |
| Database  | postgres:15      | per service decision        |

Update via Dependabot (or equivalent) — never silently float.

## 2. Multi-stage builds

TODO: Standard multi-stage shape (builder + runtime). Slim final image.

```dockerfile
# Stage 1: builder
FROM base AS builder
WORKDIR /app
COPY . .
RUN <build steps>

# Stage 2: runtime
FROM base AS runtime
WORKDIR /app
COPY --from=builder /app/dist /app/dist
USER nonroot
CMD ["./entrypoint.sh"]
```

## 3. Layer ordering

- Manifest files copied first (cache deps).
- Source code last (changes invalidate fewer layers).

## 4. Security

- Run as non-root user.
- No secrets in build args.
- No `--privileged` runs except in documented exceptional cases.

## 5. Health checks

TODO: HEALTHCHECK directive or orchestrator-level liveness/readiness
probes.

## 6. Logging

- Logs to stdout / stderr only.
- Never log files inside the container.

## 7. Build context

- `.dockerignore` excluding `.git`, `node_modules`, `__pycache__`, etc.
- Build context kept minimal (under 100MB is a reasonable target).

## 8. Image size

TODO: Target size per service. Where bloat is reviewed.

## 9. Registry

TODO: Which registry, tagging convention (sha + semver + `latest`),
retention.

## 10. docker-compose for local development

TODO: One canonical `docker-compose.yml` for the repo. Volume mounts.
Port allocation.
