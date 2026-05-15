---
scope: operations
area: runbooks
last_updated: 2026-05-14
rules:
  - OPS-RUN-001
update_triggers:
  - New alert added
  - Incident postmortem completed
  - Service ownership changed
---

# Runbooks

> **Cadence default standard.** What every runbook contains, where they
> live, and how they stay current.

## Scope

Every alert, every paged operation, every recurring manual procedure.

## Rules

### 1. Every alert links to a runbook (OPS-RUN-001)

An alert that pages someone at 3am must include a runbook URL. The
runbook tells them what to do.

A paged alert without a runbook is an alert that wastes the on-call's
time. If you can't write the runbook, you don't understand the alert
well enough to set it.

### 2. Runbooks live in the code repo, not in a wiki

```
docs/runbooks/
├── README.md                    index
├── alerts/
│   ├── high-error-rate.md
│   ├── db-connection-saturation.md
│   └── ...
├── procedures/
│   ├── rollback-deploy.md
│   ├── restore-from-backup.md
│   └── ...
└── incidents/
    ├── severity-1.md            what "sev1" means and who paged
    └── postmortem-template.md
```

Wikis rot. Code repos get reviewed. A runbook PR is reviewed; a wiki
edit is not.

### 3. Standard runbook shape

```markdown
# <Alert / Procedure Name>

**Owner:** team-name
**Severity (if alert):** sev1 / sev2 / sev3
**Last verified:** 2026-04-15
**Last incident update:** 2026-03-20 (INC-2026-031)

## What this means

One paragraph. Plain English. "Postgres pool saturation on the
task-service means more than 90% of pool slots are in use; new
requests are queueing."

## First steps

1. Check the dashboard at <URL>.
2. Identify which service is the source.
3. ...

## Common causes

- A long-running query is holding connections.
- A downstream is slow, causing requests to pile up.
- A leak — connections held without release.

## Safe remediations

1. Restart the service: ... (only when X is true).
2. Failover to a replica: ... (only when Y is true).
3. Scale connection pool: ... (always safe).

## What NOT to do

- Don't truncate the connections table.
- Don't change pool size in production without ...

## Escalation

If the above doesn't work in 15 minutes, page <person/team>.

## Related

- Dashboard: <URL>
- Service architecture: <link>
- Past incident: <link>
```

Every runbook follows this shape. New runbook? Copy the template;
fill the sections; commit.

`Last verified` is for routine staging drills (see rule 4).
`Last incident update` is for the last real incident that touched
this runbook. They're different signal — a runbook can be 90 days
since drill but updated yesterday because someone just used it.

### 4. Runbooks are tested

A runbook says "restart the service via `./scripts/restart.sh
task-service`." The procedure should:

- Be exercised in staging at least quarterly.
- Be exercised in a chaos / game day exercise at least annually.
- Have its accuracy verified after every incident that touched it.

A runbook that hasn't been run in 18 months is folklore. Test it or
mark it `last_verified: stale`.

### 5. Runbooks are linked from the alert config

```yaml
# alerts/db-connection-saturation.yaml
alert: db-pool-saturation
severity: high
expr: db_pool_in_use / db_pool_max > 0.9
for: 5m
annotations:
  summary: "DB pool saturation on {{ $labels.service }}"
  runbook: "https://github.com/org/repo/blob/main/docs/runbooks/alerts/db-pool-saturation.md"
```

When the page fires, the runbook is one click away. Don't make the
on-call grep their inbox.

### 6. Severity is defined, not vibe

```
sev1 — Customers can't use the product. Page on-call now.
sev2 — Significant degradation; page during business hours.
sev3 — Annoying; ticket; fix this sprint.
```

Each runbook declares the severity at the top. The severity drives
the page frequency, the response SLA, and who gets pulled in.

### 7. Update after every incident

After an incident:

1. Write a postmortem (use `postmortem-template.md`).
2. Identify which runbooks (alerts AND procedures) should have
   helped.
3. Update them with the missing piece.

A postmortem that doesn't update a runbook is incomplete. The
purpose of writing it down is to make the next incident shorter.

### 8. Procedures owned by a single team

```
docs/runbooks/procedures/
├── rollback-deploy.md           OWNER: platform
├── restore-from-backup.md       OWNER: platform
├── rotate-api-keys.md           OWNER: security
└── ban-abusive-user.md          OWNER: trust-and-safety
```

The owning team is responsible for keeping the procedure current
and rehearsed. Cross-team handoffs are documented at the runbook
boundary.

### 9. Privileged operations require two-person review (where applicable)

Procedures that touch user data, billing, or auth should require:

- Two people on the call.
- Action logged after the fact.
- Postmortem if the procedure was triggered outside its normal use.

The runbook spells out which procedures need this. Enforcement is
either tooling-level (deploy gate requiring two approvers, dual-key
secret retrieval) or process-level (paired-screenshare checklist).
Pick one and write the enforcement mechanism into the runbook —
"two-person review" as a vibe in the policy doc doesn't survive a
3am page.

### 10. Quarterly review

Each team reviews its runbooks every quarter:

- Does the procedure still work? (run it in staging)
- Did the alert fire correctly? (was the threshold right?)
- Did anything change in the system that breaks the runbook?
- Update `last_verified` and commit.

## Examples

### Do — runbook with concrete commands

````markdown
# Restart task-service

**Owner:** platform
**Severity:** sev2 (during business hours)
**Last verified:** 2026-04-15

## When to use

Use when task-service:
- Has a high error rate that recent deploys didn't cause.
- Has memory > 80 % of the limit.
- Has stuck connections to the database.

## Steps

```bash
# 1. Identify the affected cluster.
kubectl get deploy task-service -n production

# 2. Rolling restart.
kubectl rollout restart deployment/task-service -n production

# 3. Watch the rollout.
kubectl rollout status deployment/task-service -n production

# 4. Confirm.
curl https://api.example.com/health   # expect 200
```

If `rollout status` doesn't return within 5 minutes, escalate.
````

### Don't — vague runbook

```markdown
# DB issues

Talk to the database team. Try restarting things.
```

Useless at 3am.

## Rationale

Every incident is partly a documentation incident — "the answer
existed somewhere but the on-call couldn't find it." Runbooks
linked from alerts, owned by teams, exercised quarterly, are the
boring discipline that turns 4-hour outages into 20-minute incidents.

## See also

- `database-ops.md` — restore drill is a procedure.
- `feature-flags.md` — kill-switch flags belong in runbooks.
- `infrastructure/ci-cd.md` — rollback procedure.
- `backend/observability.md` — alert → runbook linking.
