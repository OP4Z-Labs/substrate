---
scope: backend
area: security
last_updated: TODO
rules:
  - BE-SEC-001
  - BE-SEC-002
  - BE-SEC-003
update_triggers:
  - Auth changes
  - Security incident retros
  - New attack surface
---

# Backend Security Standards

> Cadence scaffold — fill in the TODOs.

The security bar every backend service holds. Pair with
`infrastructure/ci-cd.md` (deployment-side) and `operations/runbooks.md`
(response).

## 1. Authentication

TODO: Authentication mechanism (JWT, session cookies, OAuth, etc.).
Where tokens are issued, how they're verified.

## 2. Authorization

TODO: RBAC / ABAC / attribute-based. Where checks live (decorator,
middleware, in-service).

## 3. Tenant isolation (BE-SEC-001)

TODO: If multi-tenant, document the isolation invariant. Every query
that touches tenant-scoped data filters on the authenticated tenant.

## 4. Input validation

TODO: Pydantic / framework validation at the boundary. No raw request
data crossing into service code.

## 5. Secrets management

TODO: Where secrets live (env vars, secret manager). How they're loaded.
What never gets logged.

## 6. HTTPS / TLS

TODO: TLS enforced at the edge. Service-to-service TLS policy.

## 7. CSRF / CORS

TODO: CSRF strategy. CORS allowlist. State-changing endpoints
protected.

## 8. Password storage

TODO: bcrypt / argon2 / scrypt. Cost factor. Rotation policy if
applicable.

## 9. Session management

TODO: Session lifetime. Idle timeout. Revocation mechanism.

## 10. Rate limiting and abuse prevention

TODO: Where it lives (gateway, per-service). Default limits.

## 11. Dependency CVEs

TODO: Cadence: pip-audit / npm audit / similar. Update SLA per
severity.

## 12. Pen-test and audit cadence

TODO: How often external testing happens. Where reports live.

## Reference architecture

TODO: Link to your security architecture doc / threat model.
