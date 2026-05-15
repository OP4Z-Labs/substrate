---
scope: backend
area: security
last_updated: 2026-05-14
rules:
  - BE-SEC-001
  - BE-SEC-002
update_triggers:
  - Authentication mechanism changed
  - New authorization rule introduced
  - Secret-storage strategy changed
  - Penetration test findings landed
---

# Security

> **Cadence default standard.** The non-negotiable security posture
> for backend services. This is the floor, not the ceiling — your
> threat model may demand more.

## Scope

Every backend service handling user data, auth, or business
operations. Frontend-side security concerns (CSRF, CORS, CSP) live
in `frontend/react.md` and elsewhere; this doc covers the server.

## Rules

### 1. Tenant isolation: filter on every query (BE-SEC-001 / BE-DB-001)

Every query against a tenant-scoped table includes `WHERE tenant_id =
:current_tenant`. No exceptions. Cross-tenant data access is the
single most expensive bug you can ship.

Enforcement:

- **Middleware** sets the current tenant from auth context.
- **Repository layer** requires `tenant_id` as a parameter on every
  query method.
- **Tests** include explicit cross-tenant negative cases.

```python
# Don't write this in a service
result = await db.execute(select(Task).where(Task.id == task_id))

# Write this
result = await db.execute(
    select(Task).where(Task.id == task_id, Task.tenant_id == current_tenant_id)
)
```

### 2. No secrets in committed code (BE-SEC-002)

API tokens, database passwords, signing keys — loaded from:

- Environment variables.
- A dedicated secret store (AWS Secrets Manager, Vault, GCP Secret
  Manager).

A `.env` file is fine for local dev IF it's in `.gitignore` and
checked. Ship a `.env.example` with placeholders.

CI / CD secrets are managed by the CI platform's secret store.

Run a secret scanner in pre-commit (`gitleaks`, `detect-secrets`) so
"I'll just commit it for testing" stays a thought, not a leak.

### 3. Authentication: short-lived access tokens, rotating refresh tokens

- Access token: short TTL (15-60 minutes). JWT or opaque — see
  trade-off below.
- Refresh token: longer TTL, single-use rotation, server-side
  revocation list.
- Logout invalidates the refresh token.
- Password reset / 2FA bypass / device approval each trigger refresh
  rotation.

**JWT vs opaque** is a real trade-off, not just preference:

- **JWTs** are self-contained — every service can validate them
  without a round-trip. The catch: revocation is hard. A compromised
  JWT is valid until expiry unless you keep a denylist (which
  reintroduces the central lookup JWTs were meant to avoid). Lean
  JWT when downstream services need to validate without contacting
  auth, and you accept the revocation gap.
- **Opaque tokens** require a session lookup per validation — a
  Redis hit, typically. Slower but revocation is instant. Lean
  opaque for high-trust scenarios (financial, healthcare) or when
  the auth service can absorb the read load.

Don't ship "1-year access tokens." Convenience for the developer is
risk for the user.

### 4. Authorization: deny by default

Every endpoint declares its auth requirement explicitly:

```python
@router.get("/admin/users", dependencies=[Depends(require_admin)])
async def list_all_users(...):
    ...
```

The default for an undeclared endpoint is "authentication required."
Public endpoints (`/health`, `/login`, `/docs`) opt out explicitly.

Authorization is policy. Most production systems combine two layers:

- **RBAC** (role-based) at the coarse level — admin vs user vs
  guest. Easy to reason about, easy to audit.
- **ABAC** (attribute-based) for resource-ownership and
  relationship checks — "you can edit a task IF you own it OR
  you're an admin of the owning tenant."

The question is rarely "RBAC or ABAC" — it's "which is the primary
axis for this check." Routes and admin features go RBAC; per-row
access goes ABAC. Make the model explicit so future authors don't
guess.

Whichever model: a single function makes the call. Don't sprinkle
`if user.role == 'admin'` across handlers.

### 5. Passwords: bcrypt / argon2, never SHA / MD5

```python
from passlib.hash import argon2

# Store
hashed = argon2.hash(plaintext_password)

# Verify
argon2.verify(plaintext_password, hashed)
```

- argon2 (Argon2id) is the current default.
- bcrypt is still fine.
- SHA-256, MD5, "SHA + salt" — these are wrong. They're too fast.

Never log a password, not even in debug. Never email a password.

### 6. CSRF protection on state-changing endpoints

For browser-driven cookie auth, every POST / PUT / PATCH / DELETE
requires a CSRF token. Server validates origin / referer + token.

For pure-API token auth (Authorization header), CSRF is N/A — but
make sure the auth IS via header, not cookies.

### 7. Rate limiting at the edge AND per user

Two layers:

- **Edge**: protects against simple flood (per IP, per endpoint).
  Set in the gateway / reverse proxy.
- **Per-user**: protects against single-account abuse. Set in
  middleware or a dedicated service.

Login endpoints get aggressive rate limiting. Starting point: 5 /
minute / IP, lock the account after 10 failed attempts in 15
minutes. These numbers are anchored to OWASP ASVS 4.0 §2.2.1
("anti-automation") — calibrate against your threat model and
abuse-team data, but treat anything looser than this as a finding.

### 8. Input validation is mandatory and explicit

Every external input goes through a validator (Pydantic, Joi, Zod,
class-validator). Type signatures are not validation.

```python
class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    priority: Literal["low", "medium", "high", "critical"]
    due_at: datetime | None = None
```

Bonus: validators give you OpenAPI for free.

### 9. SQL: parameterized queries, always

Never:

```python
query = f"SELECT * FROM users WHERE email = '{email}'"
```

Always:

```python
query = select(User).where(User.email == email)
# Or raw:
result = await db.execute("SELECT * FROM users WHERE email = :email", {"email": email})
```

The ORM does this for you when you use it correctly. The risk is
when developers drop to raw SQL for performance and forget the
parameter binding.

### 10. HTTPS everywhere — including in-VPC

Service-to-service communication runs over TLS. The "we're in the
same VPC" argument is wrong: defense in depth + same-VPC compromise
scenarios + audit visibility all want TLS on internal calls too.

Local dev can run plaintext for ergonomics; production must not.

The operational cost — cert issuance, rotation, mTLS — is real.
A service mesh (Istio, Linkerd, Consul Connect) or
`cert-manager` + Kubernetes makes this tractable; trying to manage
internal certs by hand at scale is where teams give up and drop
back to plaintext. Pick the mesh / cert-management story BEFORE
mandating internal TLS.

### 11. Audit log for sensitive operations

Every "sensitive" action (auth events, permission changes, admin
overrides, data exports) writes an immutable audit log entry:

```json
{
  "ts": "2026-05-14T...",
  "actor_id": "...",
  "tenant_id": "...",
  "action": "role.granted",
  "subject_id": "...",
  "details": { "role": "admin" },
  "ip": "1.2.3.4",
  "user_agent": "..."
}
```

Audit logs go to a separate storage (different DB / dataset) so
they survive an app-DB compromise.

Note that `ip` and `user_agent` are PII under GDPR / similar
regimes. The audit-log retention contract is therefore a separate
privacy regime from app-data retention — write it down (typical
shape: longer retention for compliance, redacted or pseudonymized
after the immediate investigation window).

### 12. Patch dependencies on a schedule

`pip-audit`, `npm audit`, `cargo audit` — one of these runs in CI
weekly. Critical / high findings get a 7-day SLA; medium / low get a
30-day SLA. No CVE goes unaddressed for a quarter.

### 13. Content Security Policy on every HTML response

CSP is set by the server (`Content-Security-Policy` response
header) and is one of the highest-leverage modern defenses against
XSS, clickjacking, and data exfiltration. A reasonable starting
policy:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self' data:;
  connect-src 'self' https://api.example.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

Tighten from there. `'unsafe-inline'` on `script-src` defeats the
point — use nonces or hashes for the few inline scripts you genuinely
need. Ship CSP in `Content-Security-Policy-Report-Only` mode first
to catch violations without breaking the app, then promote to
enforcing once the report stream is clean.

Pair with sensible defaults on `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
and `Permissions-Policy` for the features you don't use.

## Examples

### Do — explicit tenant scope

```python
async def get_user_tasks(
    self,
    user_id: UUID,
    tenant_id: UUID,
) -> list[Task]:
    stmt = (
        select(Task)
        .where(
            Task.owner_id == user_id,
            Task.tenant_id == tenant_id,
            Task.deleted_at.is_(None),
        )
    )
    result = await self.db.execute(stmt)
    return list(result.scalars().all())
```

### Don't — global query "filtered" client-side

```python
async def get_user_tasks(self, user_id, tenant_id):
    result = await self.db.execute(select(Task).where(Task.owner_id == user_id))
    tasks = result.scalars().all()
    return [t for t in tasks if t.tenant_id == tenant_id]
    # By the time we filter in Python, the rows are already across the wire.
    # An attacker who manipulates user_id sees cross-tenant data over the wire.
```

### Do — argon2 password hashing

```python
from passlib.context import CryptContext

pwd = CryptContext(schemes=["argon2"], deprecated="auto")
hashed = pwd.hash(password)
ok = pwd.verify(password, hashed)
```

### Don't — homemade hash

```python
import hashlib
hashed = hashlib.sha256((password + SALT).encode()).hexdigest()
```

## Rationale

Security bugs are the most expensive class of bug — they cost
incident response, customer trust, regulatory fines, and engineering
time. The conventions above are the minimum cost to avoid the most
common classes (tenant leak, credential theft, injection, brute
force).

This standard is the floor. Industries with regulatory baselines
(healthcare, finance, government) layer more on top.

## See also

- `database.md` — tenant_id discipline, encryption at rest.
- `api.md` — auth via headers, error shape.
- `error-handling.md` — never leak internals in 500 responses.
- `observability.md` — redacting sensitive fields in logs.
- `operations/database-ops.md` — production access audit trail.
