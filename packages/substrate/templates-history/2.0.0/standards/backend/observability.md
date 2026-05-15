---
scope: backend
area: observability
last_updated: 2026-05-14
rules:
  - BE-OBS-001
  - BE-OBS-002
update_triggers:
  - New metric added
  - Tracing backend changed
  - Log schema modified
---

# Observability

> **Substrate default standard.** Logs, metrics, and traces — the three
> pillars. The point isn't dashboards; the point is being able to
> answer "what is happening right now?" within 60 seconds.

## Scope

Every long-running backend process. Frontend telemetry has its own
conventions (see `frontend/logging.md`).

## Rules

### 1. Logs are structured JSON in production (BE-OBS-001)

```json
{
  "ts": "2026-05-14T12:34:56.789Z",
  "level": "INFO",
  "service": "task-service",
  "event": "task.created",
  "correlation_id": "01HX...",
  "tenant_id": "...",
  "user_id": "...",
  "task_id": "...",
  "duration_ms": 42
}
```

- One JSON object per line (NDJSON).
- Timestamp in ISO 8601 with millisecond precision.
- Stable field set per service — adding fields is non-breaking;
  renaming is.
- No printf-style logs in production. They're un-queryable.

In local dev, render to colorized human output — but the field set
stays the same.

### 2. Every request emits a correlation ID (BE-OBS-002)

Middleware:

```python
@app.middleware("http")
async def correlation_id(request: Request, call_next):
    cid = request.headers.get("X-Correlation-ID") or str(uuid4())
    request.state.correlation_id = cid
    with logger.contextualize(correlation_id=cid):
        response = await call_next(request)
    response.headers["X-Correlation-ID"] = cid
    return response
```

Propagate the header to downstream HTTP calls so the trace spans the
fleet. Include it in error responses so support can correlate user
reports with logs.

### 3. Metrics: RED + USE

For each service, track:

- **R**ate — requests per second.
- **E**rrors — error rate (or count).
- **D**uration — latency distribution (p50 / p95 / p99).

For each resource (DB pool, cache, message queue):

- **U**tilization — % in use.
- **S**aturation — queue depth, backlog.
- **E**rrors — connection failures, timeouts.

Wire each to a graph. Don't graph internal counters that don't
answer "what's wrong" or "how busy."

### 4. Metric naming: `<scope>_<measure>_<unit>`

```
http_requests_total                  counter
http_request_duration_seconds        histogram
db_pool_connections_in_use           gauge
event_queue_depth                    gauge
event_processing_duration_seconds    histogram
```

Avoid:
- Pure verbs (`requests` — too generic).
- Unit-less metrics (`db_latency` — is it ms? seconds?).
- Vendor-specific names that don't survive a backend swap.

### 5. Tracing for distributed work

When a request crosses service boundaries, propagate a trace ID
(W3C Trace Context or OpenTelemetry). The tracing backend (Jaeger,
Tempo, Honeycomb, etc.) reconstructs the cross-service tree.

Instrument:
- Inbound HTTP middleware.
- Outbound HTTP clients.
- Database queries (slow only — full instrumentation is expensive).
- Message broker publish + consume.

Don't instrument every function call. Trace what crosses a
process boundary.

### 6. Logs, metrics, traces — pick the right tool

| Question                                       | Tool    |
| ---------------------------------------------- | ------- |
| "What did this one user see?"                  | Logs    |
| "How many users hit this error in the last 5m?" | Metrics |
| "Why did this one request take 4 seconds?"     | Traces  |

Using logs for high-cardinality "what's the rate" queries is
expensive. Using metrics for "what did this one user see" loses
information. Pick the right tool for the question.

### 7. Health and readiness are distinct (also in `architecture.md`)

- `/health` → process is up. Cheap, no deps.
- `/ready` → service can serve. Checks deps.

The orchestrator polls both. Conflating them causes restart storms
when a downstream flaps.

### 8. Sensitive data does NOT go in logs

No passwords, no tokens, no full credit cards, no full email
addresses (when avoidable). Use:

- IDs instead of objects (`user_id` not `user`).
- Hashes or last-4 for sensitive fields.
- Redaction at the logger layer when the structure can't be changed.

This isn't paranoia — it's GDPR / SOC 2 / PCI compliance and an
incident-response courtesy.

### 9. Alerts have runbooks

Every alert that pages someone links to a runbook in
`docs/runbooks/`. The runbook answers:

- What does this alert mean?
- What should I check first?
- What are the common causes?
- What are the safe remediations?
- Who owns it?

An alert without a runbook is a 3am puzzle for the on-call.

## Examples

### Do — structured event log

```python
logger.info(
    "task.created",
    tenant_id=str(tenant_id),
    user_id=str(user.id),
    task_id=str(task.id),
    type=data.type,
    priority=data.priority,
    duration_ms=int((time.monotonic() - start) * 1000),
)
```

Searchable. Aggregatable. Linkable to a request via correlation ID.

### Don't — concatenated message

```python
logger.info(f"Created task {task.id} for user {user.id} in {ms}ms")
```

Searchable by literal substring only. Each query is a new regex.

### Do — RED dashboard for a service

```
Row 1: Request rate by endpoint (line)
Row 2: Error rate by endpoint (line)
Row 3: Latency p50/p95/p99 by endpoint (line)
Row 4: DB pool utilization (gauge)
Row 5: Background queue depth (gauge)
```

### Don't — vanity dashboards

```
Row 1: Total requests since service started
Row 2: Disk space (yes, the host's disk)
Row 3: Number of users ever registered
```

None of those answer "what is happening right now?"

## Rationale

Observability is what lets a small team operate a system bigger
than the team. The investment up front (structured logs,
correlation IDs, RED metrics) compounds: every incident gets
faster to triage, every postmortem has data, every feature ships
with feedback.

## See also

- `error-handling.md` — what to log when things fail.
- `api.md` — correlation ID in responses.
- `operations/runbooks.md` — what links each alert to.
- `security.md` — redaction discipline.
