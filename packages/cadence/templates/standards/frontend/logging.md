---
scope: frontend
area: logging
last_updated: TODO
rules:
  - FE-LOG-001
update_triggers:
  - Logger changes
  - PII / privacy policy updates
---

# Frontend Logging Standards

> Cadence scaffold — fill in the TODOs.

How the frontend emits diagnostic information without leaking user
data or flooding the network.

## 1. Logger choice

TODO: Console + remote error tracker (Sentry, LogRocket, Bugsnag,
custom). Where it's configured.

## 2. Levels

- `debug`: dev-only; stripped from production.
- `info`: user-driven flows worth observing in aggregate.
- `warn`: recoverable problems (failed retry, fallback used).
- `error`: actionable failures (unhandled exception, broken state).

## 3. Production vs development

TODO: Console output in dev verbose; in production silent for
non-error levels. Remote tracker only receives `warn` and above.

## 4. Structured context

Every log includes:

- Component / hook name where applicable
- User ID if known (never PII; just the ID)
- Route / view
- Build version

## 5. Forbidden in log output (FE-LOG-001)

- Passwords, tokens, full session IDs
- Personally-identifiable data beyond an opaque user ID
- Form input values (especially in auth / payment flows)
- Full URLs with query strings that may contain secrets

## 6. Error boundaries integration

TODO: How error boundaries report to your tracker. What metadata they
attach.

## 7. Performance traces

TODO: When to emit performance marks. How they reach your APM tool.

## 8. Sampling

TODO: Sample rate for high-volume events. Always-on for errors.

## 9. Privacy and consent

TODO: GDPR / CCPA considerations. Whether logging is gated on consent.

## Common anti-patterns

- `console.log(user)` (logs the entire user object including PII)
- `console.error(error)` without context
- Network logs that include the request body for state-changing
  endpoints
