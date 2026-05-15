---
scope: frontend
area: logging
last_updated: 2026-05-14
rules:
  - FE-LOG-001
update_triggers:
  - Logging service changed
  - PII policy updated
  - Sample rate adjusted
---

# Frontend Logging

> **Substrate default standard.** Client-side logging discipline. Backend
> logging is `backend/observability.md`.

## Scope

Anything that emits a log line, an error report, or a telemetry event
from the user's browser / device.

## Rules

### 1. A single logger module, not console.log scattered

```ts
// lib/logger.ts
export const logger = {
  info(event: string, data?: Record<string, unknown>) { ... },
  warn(event: string, data?: Record<string, unknown>) { ... },
  error(event: string, error: Error, data?: Record<string, unknown>) { ... },
};
```

Every component imports `logger`. `console.log` is for the REPL.

### 2. No PII, secrets, or sensitive form input in logs (FE-LOG-001)

NEVER log:
- Passwords, even hashed.
- Tokens, JWT contents, session IDs.
- Full credit card numbers (last 4 only, if at all).
- Full email addresses when avoidable (`user_id` instead).
- Form input from auth, payment, or other sensitive flows.

```ts
// WRONG
logger.info("login.submitted", { email: form.email, password: form.password });

// RIGHT
logger.info("login.submitted", { email_provided: !!form.email });
```

This is enforced by code review + a (best-effort) lint rule that
flags `password`, `token`, `secret` in logger arg objects.

### 3. Error tracking goes through one service

Sentry, Datadog RUM, Rollbar — pick one. Hook it up at the error
boundary AND at unhandled-rejection handlers:

```ts
window.addEventListener("unhandledrejection", (e) => {
  logger.error("unhandled.rejection", e.reason);
});
window.addEventListener("error", (e) => {
  logger.error("uncaught.error", e.error);
});
```

The error boundary catches React render errors; the listeners catch
async / global errors.

### 4. Sample noisy events

Login success: log all. Mouse movement / scroll telemetry: sample at
< 1 %. The sample rate is configurable per event class.

```ts
if (Math.random() < SCROLL_LOG_SAMPLE_RATE) {
  logger.info("scroll.viewport", { depth });
}
```

### 5. Correlate frontend with backend via request ID

When the frontend makes an API call, the backend sets
`X-Correlation-ID` in the response (see `backend/observability.md`).
The frontend captures it and attaches to subsequent error reports:

```ts
const correlationId = response.headers.get("X-Correlation-ID");
logger.error("api.failed", err, { correlation_id: correlationId });
```

### 6. Structured events, not freetext

```ts
// PREFERRED
logger.info("task.created", { task_id, priority, source: "modal" });

// AVOID
logger.info(`Created task ${task_id}`);
```

Structured events are queryable. Freetext is not.

### 7. Error boundaries log + render a fallback

```tsx
class ErrorBoundary extends Component {
  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("react.error_boundary", error, { component_stack: info.componentStack });
  }
  ...
}
```

The error boundary owns the bridge between React render failures and
the logger.

### 8. Production vs development

```ts
const logger = {
  info: (event, data) => {
    if (import.meta.env.PROD) sendToService(event, data);
    else console.info(event, data);
  },
};
```

Local dev sees logs in the console; production ships to the service.
NEVER ship production logs to the console — they cost CPU and leak
to anyone with dev tools.

### 9. User identifiable info uses an ID, not the name/email

Send `user_id` (UUID) to the logger. The backend resolves to the
human-friendly name only when displaying. Logs stay GDPR-friendly
(delete the user → ID becomes orphaned; no PII to chase).

### 10. The logger never throws

A logger that throws cascades the original error into a different
error. Catch internally:

```ts
try {
  await sendToService(event, data);
} catch {
  // swallow — logging failure must not gate the user's flow
}
```

## Examples

### Do — structured error report with correlation

```tsx
async function saveTask(data: TaskCreate) {
  try {
    const task = await api.createTask(data);
    logger.info("task.created", { task_id: task.id, priority: task.priority });
    return task;
  } catch (err) {
    logger.error("task.create.failed", err as Error, {
      correlation_id: (err as ApiError).correlationId,
      priority: data.priority,
    });
    throw err;
  }
}
```

### Don't — console.log + leaked data

```tsx
async function saveTask(data) {
  console.log("Saving", data);  // includes the full form, possibly with PII
  const task = await api.createTask(data);
  console.log("Saved", task);
  return task;
}
```

## Rationale

Frontend logs are the only visibility you have into "what's
happening in the user's browser?" Treat them as a privacy boundary
(don't ship PII), a debugging tool (correlate with backend), and a
product-feedback signal (event counts shape roadmap).

## See also

- `backend/observability.md` — correlation IDs, what the backend logs.
- `react.md` — error boundaries.
- `accessibility.md` — assistive-tech telemetry caveats.
- `security.md` (backend) — secret-redaction discipline.
