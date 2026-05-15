---
action: security
command: audit
schema_version: 1
description: Multi-pass security audit — SAST, secrets scanning, dependency CVEs, common vulnerability patterns.
---

# Audit: Security

A broad-spectrum security pass. Designed to be runnable on demand and
in CI. Findings should be triaged, not just counted — the report
distinguishes "real risk introduced" from "tool noise".

## Inputs

- Optional `--scope all|backend|frontend|deps` (default: `all`).
- Optional `--target <service-or-package>` to narrow SAST.

## Output

- `auto/audits/security/YYYY-MM-DD.md`
- `auto/audits/security/latest.json`

## Block 1: Pre-flight

- Detect which tools are available on `PATH`:
  - SAST: language-specific scanners (`bandit` for Python,
    `eslint-plugin-security` for TypeScript, `semgrep` for cross-language,
    `gosec`, `cargo-audit`, etc.).
  - Secret scanning: `detect-secrets`, `gitleaks`, `trufflehog`.
  - Dependency CVEs: `pip-audit`, `npm audit`, `cargo audit`, `osv-scanner`.
- Each missing tool → record as a coverage gap, don't fail the audit.

## Block 2: Discovery

- Lines of code per language
- Endpoint count
- Public functions / exported APIs
- Dependency count, runtime vs dev
- Existing baseline file (e.g. `.secrets.baseline`)

## Block 3: Run Detectors

### Pass A — SAST (Static Application Security Testing)

Run the available SAST tools across in-scope code. Map vendor severity
to the substrate scale (vendor critical → critical, etc.).

Common findings to expect:

- SQL string concatenation
- `eval` / `Function()` / `exec` of user input
- Path traversal: file open with unsanitized input
- Insecure random for security purposes
- Unsafe deserialization (any deserializer that executes code on the
  bytes — use safe loaders / strict-schema parsers instead)

### Pass B — Secret scanning

- Run the secret scanner against the working tree (and optionally git
  history). Pass results through the baseline so previously-acknowledged
  findings don't re-fire.
- Any new finding outside the baseline: severity critical.

### Pass C — Dependency CVEs

- Per stack, query the lockfile against the appropriate advisory DB.
- Vendor critical CVEs in production paths: severity critical.
- High in non-prod paths: severity high.
- Moderate and lower: severity medium / low.
- Persistent unresolved CVEs (older than 14 days): escalate severity by
  one level.

### Pass D — Authentication and authorization

Manual / pattern checks (require human read in many cases):

- Endpoints lacking an auth dependency / middleware: severity critical.
- Endpoints with auth but no authorization check (any authenticated
  user can act on any resource): severity critical.
- Tokens / session IDs logged: severity high.

### Pass E — Tenant / data isolation

If your data model is multi-tenant:

- Queries against tenant-scoped tables that lack a tenant filter:
  severity critical.
- Endpoints that accept a tenant ID from the request body / query
  rather than the authenticated context: severity critical.

### Pass F — Transport and storage

- HTTPS not enforced for production hosts: severity high.
- Plaintext password storage / weak hashing (MD5, SHA1): severity critical.
- Missing CSRF protection on state-changing endpoints: severity high.

## Block 4: Score + Gate

- Standard formula (weights 20/8/3/1).
- Hard gates regardless of score:
  - Any new secret in the diff → fail.
  - Any critical CVE in production → fail.
  - Any tenant-isolation gap on a tenant-scoped table → fail.

## Block 5: Diff vs Baseline

- New findings since last run
- Resolved findings
- Persistent findings → escalate

## Block 6: Reports

```markdown
---
date: YYYY-MM-DD
score: NN
gate: pass|conditional|fail
---

# Security audit

## Critical findings
## High findings
## Medium / Low findings
## Resolved since last run
## Tool coverage gaps
## Recommended actions
```

## Block 7: Followups

- Critical findings open a ticket immediately.
- Add new secret-scan exceptions to the baseline in a separate commit
  that documents *why*.
- Schedule the audit weekly (or per-merge if CI minutes permit).

## Rules

**Do:** triage findings, don't just count them; baseline acknowledged
findings; rerun after every dep bump.
**Don't:** ignore tool coverage gaps — record them; auto-acknowledge
findings without human review.
