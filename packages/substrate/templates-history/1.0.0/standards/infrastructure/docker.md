---
scope: infrastructure
area: docker
last_updated: 2026-05-14
rules:
  - INF-DOCKER-001
  - INF-DOCKER-002
update_triggers:
  - Base image changed
  - New build stage added
  - Production runtime user changed
---

# Docker

> **Substrate default standard.** Image discipline for containers
> shipped to production. Builds are reproducible, layers are
> ordered for cache, and the runtime user is not root.

## Scope

Every Dockerfile / container build in the repo. Includes dev
containers used in CI; excludes ad-hoc one-off images.

## Rules

### 1. Pin base image versions (INF-DOCKER-002)

```dockerfile
# WRONG — moving target
FROM node:latest

# RIGHT — pinned major.minor + variant
FROM node:20.18-alpine

# BETTER — pinned to a digest for full reproducibility
FROM node:20.18-alpine@sha256:abc123...
```

`latest` is the most common bug bait. Pin to at minimum
`<major>.<minor>-<variant>`. Update on a schedule via Dependabot
/ Renovate.

### 2. Run as non-root (INF-DOCKER-001)

```dockerfile
FROM node:20.18-alpine
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY --chown=app:app . .
USER app
CMD ["node", "dist/index.js"]
```

A container running as root that gets compromised has the same
capabilities as root on the host (depending on capabilities config).
Non-root is the cheap defense.

Some base images (`node:*-slim`, `python:*-slim`) ship without a
non-root user — add one in the Dockerfile.

### 3. Multi-stage builds: build separately from runtime

```dockerfile
# Stage 1: builder — installs deps, compiles, etc.
FROM node:20.18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: runtime — only the artefacts
FROM node:20.18-alpine
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
USER app
CMD ["node", "dist/index.js"]
```

Build deps (gcc, dev headers) don't ship to production. Runtime
image is smaller, smaller attack surface, faster pulls.

### 4. Order layers from least-changing to most-changing

```dockerfile
# Good: package files first (rarely change), source last (often)
COPY package.json package-lock.json ./
RUN npm ci

COPY src/ src/
RUN npm run build
```

Each layer is cached if its inputs are unchanged. Order matters
because once a layer rebuilds, all subsequent layers rebuild too.

### 5. `.dockerignore` excludes the kitchen sink

```
.git/
node_modules/
dist/
*.log
.env
.env.*
*.md
tests/
```

Without it, COPY scoops the whole repo into the build context —
slow uploads, leaked secrets, bloated images.

### 6. One process per container

A container runs one logical process. If you need a web server +
a sidecar metrics agent, that's two containers in the same pod
(k8s) or task (ECS), not one container running `supervisord`.

Exception: an init process that supervises a single child for
signal handling (`tini`, `dumb-init`). That's still "one logical
process."

### 7. Health check declared in the image

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/ready || exit 1
```

The orchestrator's health check overrides this in production, but
having one in the image makes local-dev `docker ps` show
container health.

### 8. Use SIGTERM for shutdown

The container runtime sends SIGTERM, waits for `stop-period`
(default 10 s), then SIGKILLs. The app must catch SIGTERM and
shutdown cleanly:

- Stop accepting new requests.
- Finish in-flight requests.
- Close DB connections.
- Exit 0.

Apps that ignore SIGTERM get hard-killed mid-request → user-visible
errors on every deploy.

### 9. Don't bake secrets into the image

```dockerfile
# WRONG
ENV STRIPE_KEY=sk_live_...

# RIGHT — leave it for the runtime
ENV STRIPE_KEY=""
```

Secrets come from the orchestrator's secret store at runtime
(see `infrastructure/ci-cd.md`, rule `BE-SEC-002`). An image
that bakes in a secret is one `docker pull` away from a leak.

### 10. Tag images with the git SHA, not `latest`

```bash
docker build -t my-service:${GIT_SHA} .
docker push my-service:${GIT_SHA}
```

Plus a moving `:main` tag if you want a "latest from main" pointer.
NEVER deploy `:latest` to production — you can't roll back to a
specific version.

### 11. Build for the right platform

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t my-service:${GIT_SHA} .
```

If your production runs on ARM (Graviton, Apple Silicon CI), the
image needs ARM support. Otherwise you get cryptic "exec format
error" on first run.

### 12. Scan for vulnerabilities

`trivy`, `grype`, `docker scout` — pick one. Run on every build.
Critical CVEs block deploys; high CVEs get a 7-day SLA.

Old / unmaintained base images are the most common source of
vulnerabilities. The `INF-DOCKER-002` pin discipline is also a
vulnerability-management discipline.

## Examples

### Do — typed multi-stage Dockerfile

```dockerfile
FROM node:20.18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20.18-alpine
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ready || exit 1
CMD ["node", "dist/server.js"]
```

### Don't — runs-as-root, single stage, latest tag

```dockerfile
FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD ["npm", "start"]
```

Six problems: `latest`, single-stage (devDeps in production),
runs as root, `npm install` not `npm ci`, no health check,
`npm start` doesn't forward SIGTERM cleanly.

## Rationale

Container security and reproducibility are properties of the build,
not the deploy. Pin base images, drop root, multi-stage, and scan —
each is small individually; together they keep the ops surface clean.

## See also

- `infrastructure/ci-cd.md` — when images are built and pushed.
- `backend/architecture.md` — health endpoints inside the image.
- `backend/security.md` — secrets discipline.
- `operations/runbooks.md` — operating container clusters.
