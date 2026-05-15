---
scope: backend
area: observability
last_updated: TODO
rules:
  - BE-OBS-001
  - BE-OBS-002
update_triggers:
  - Logger format changes
  - Metric naming changes
  - Tracing tool changes
---

# Backend Observability Standards

> Cadence scaffold — fill in the TODOs.

Logs, metrics, traces, and alerts. The principle: every production
incident should be debuggable from telemetry alone.

## 1. Logging

TODO: Logger choice, output format (JSON in prod), level policy
(`info` on the request path, `debug` for verbose, `warn` for recoverable,
`error` for actionable).

### Required structured fields

- `correlation_id` — propagated from the request
- `request_id` (if distinct)
- `user_id` / `tenant_id` (when relevant)
- `service` — which service emitted the log
- `version` — service version
- `level`, `timestamp`, `message`

### Forbidden in log output

- Passwords, tokens, full session IDs
- Personally-identifiable information beyond what's strictly needed

## 2. Metrics

TODO: Metrics library / format (Prometheus, StatsD, OpenTelemetry).
Naming convention (snake_case, hierarchical).

### Required metrics per service

- Request rate, error rate, latency (RED method)
- Saturation: queue depth, connection-pool usage
- Business metrics: per-domain counters

## 3. Tracing

TODO: Tracing tool (Jaeger, Zipkin, vendor APM). Span naming,
propagation across services.

## 4. Health checks

TODO: `/health` returns 200 when the service can serve. `/ready` returns
200 when the service is ready to receive traffic (deps available).

## 5. Alerts

TODO: Alert rules tied to SLOs. Where they're defined. On-call rotation.

## 6. Dashboards

TODO: Standard dashboard per service. What goes on it.

## 7. Correlation across services (BE-OBS-001)

TODO: How `correlation_id` is generated, propagated, and persisted
across service boundaries.

## 8. Retention and cost

TODO: Log retention policy, sampling for high-volume logs, cost
budget per service.
