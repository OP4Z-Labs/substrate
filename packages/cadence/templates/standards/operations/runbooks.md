---
scope: operations
area: runbooks
last_updated: TODO
rules:
  - OPS-RUN-001
update_triggers:
  - New service runbook
  - Incident retro reveals gap
---

# Runbook Standards

> Cadence scaffold — fill in the TODOs.

How operational runbooks are written, organized, and kept current.

## 1. Location

TODO: Where runbooks live (`docs/operations/runbooks/`). Index doc
that lists them all.

## 2. One runbook per scenario

Each runbook covers one well-defined situation. Not "everything you
need to know about service X" — but "service X is down".

## 3. Required sections

```markdown
# Runbook: <scenario>

## When this fires
What alert / symptom triggered this runbook.

## Impact
Who is affected, how badly, for how long.

## Diagnose
Commands / queries / dashboards to determine the cause.

## Mitigate
Immediate steps to restore service (may not fix root cause).

## Resolve
Root-cause fix.

## Post-incident
Retro template; communication template.

## Related
Links to other runbooks, dashboards, decisions.
```

## 4. Authorship

TODO: Who writes the first version. When it's reviewed. SLA from "we
needed this and didn't have it" to "runbook written".

## 5. Currency

- Reviewed every 6 months.
- Updated immediately after any incident that exposed staleness.
- Linked from alerts so the on-call sees them.

## 6. Tooling

TODO: Whether runbooks are markdown in the repo, in an external tool,
or both.

## 7. Drill cadence

TODO: How often runbooks are exercised. Tabletop vs live drill.

## 8. Forbidden patterns

- Runbooks that say "page the engineer who knows this"
- Steps without commands you can run
- "Check the dashboard" without naming the dashboard
- Runbooks that have never been exercised
