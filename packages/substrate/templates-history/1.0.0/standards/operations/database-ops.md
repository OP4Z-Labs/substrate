---
scope: operations
area: database-ops
last_updated: 2026-05-14
rules:
  - OPS-DBOPS-001
update_triggers:
  - Schema change planned
  - Backup strategy modified
  - Restore tested
  - Performance incident resolved
---

# Database Operations

> **Substrate default standard.** Operational discipline for the
> databases your services depend on. Independent of vendor —
> applies to Postgres, MySQL, SQL Server, MongoDB, etc.

## Scope

This standard covers:

- Schema migration safety on live databases.
- Backup and restore procedures.
- Performance investigation (slow queries, lock contention).
- Capacity planning and routine maintenance.

It does NOT cover:

- The schema design itself — that's `backend/database.md`.
- Application-layer query patterns — also `backend/database.md`.

## Rules

### 1. Production migrations follow expand/contract

A schema change on a live database is shipped in **multiple deploys**:

1. **Expand.** Add the new column / table / index. Old code keeps
   working untouched. New column is nullable (or has a default) so
   inserts don't fail.
2. **Backfill.** A script populates the new column for existing rows.
   Runs in batches; ack progress in logs. Doesn't lock the table.
3. **Cut over.** Application code starts reading + writing the new
   column. Tests confirm.
4. **Contract.** Once all instances are running the new code and the
   old column / table is unused, drop it. Confirm with `pg_stat_*` or
   equivalent that no one reads it.

A single migration that does all four steps at once is a recipe for
mid-deploy outage. The discipline above takes longer but stays
reversible at every checkpoint.

Cross-link: rule `OPS-DBOPS-001`.

### 2. Migrations are reversible (or explicitly not)

Every migration ships with a working down/rollback step, OR with a
`docs/migrations/<id>-no-rollback.md` documenting why rollback is
impossible (data destruction, schema squash).

"It works on my laptop" is not a rollback. Test in staging against a
realistic dataset.

### 3. Production access is audited and read-only-by-default

Direct production database access is the most dangerous knife in the
drawer. Two rules:

- **Default read-only.** Day-to-day debugging uses a read-only
  account. Writes require deliberate escalation (separate creds, paged
  approval, or write-only via a wrapper that logs the operation).
- **Audit every session.** Connection logs persist for at least 90
  days. Slow queries and ad-hoc writes show up in a queryable place.

### 4. Backups are tested by restoring

A backup that has never been restored is a hope, not a backup. At
minimum:

- **Automated daily full backups** with 30-day retention.
- **PITR (point-in-time recovery)** or WAL archiving for fine-grained
  recovery.
- **Quarterly restore drill** to a staging environment. Document the
  result. Track restore time.

If the quarterly drill hasn't happened, the backup status is "unknown."
Treat it as red.

### 5. Slow queries get a budget and a remediation path

A query slower than the team-defined budget (e.g. 500ms p95 for
user-blocking paths, 5s for batch) shows up in a slow-query log. The
on-call handles in this order:

1. **Triage** — is this query blocking users or a background job?
2. **Snapshot** — `EXPLAIN ANALYZE` (or vendor equivalent), capture
   the plan and the data shape.
3. **Decide** — add an index, rewrite the query, or push the work
   to a background job. Document the choice.

"It's been slow for months and nobody fixed it" is technical debt
the team has agreed to keep. Make that explicit, don't let it drift.

### 6. Capacity has watermarks and triggers

Track for each database:

| Metric                | Watch | Page  |
| --------------------- | ----- | ----- |
| Disk used             | 70 %  | 85 %  |
| Connections used      | 70 %  | 90 %  |
| Replication lag       | 5 s   | 30 s  |
| CPU sustained 5min    | 60 %  | 80 %  |
| Lock wait p95         | 100ms | 500ms |

Adjust to fit your workload. The point is: define what "concerning"
and "alarming" mean BEFORE the incident.

### 7. No long-running transactions in user-facing paths

A transaction that holds locks for seconds blocks every other
session that needs the same locks. Symptoms: cascading slowness,
connection pool exhaustion, deadlock storms.

Rules of thumb:

- User-facing request: transaction commits or rolls back in < 1 s.
- Background job: < 30 s, or break into chunks.
- Schema migration: < 5 s of locked time per statement (use
  `lock_timeout` to bail out rather than block).

### 8. Monitoring covers the database, not just the app

App-level metrics ("did the request return 200") miss database-shaped
problems. Add:

- Connection pool utilization (per service).
- Slow-query rate and worst-case duration.
- Replication health.
- Vacuum / autovacuum progress (Postgres) or equivalent.
- Disk I/O saturation.

Wire each to an alert with a runbook.

## Examples

### Do — expand/contract for a column rename

```sql
-- Deploy 1 (expand): add the new column, dual-write
ALTER TABLE users ADD COLUMN email_address text;
-- Application: write to both email and email_address;
-- read from email.

-- Backfill
UPDATE users SET email_address = email
  WHERE email_address IS NULL;
-- Run in batches; verify count.

-- Deploy 2 (cut over): read from email_address
-- Application: read from email_address;
-- still write to both.

-- Deploy 3 (contract): drop email
ALTER TABLE users DROP COLUMN email;
```

Each deploy is independently reversible.

### Don't — a single migration that does everything

```sql
-- DANGEROUS: locks the table, rewrites every row,
-- and breaks every instance still on the old code.
ALTER TABLE users RENAME COLUMN email TO email_address;
```

### Do — backup drill report

```
2026-Q1 Restore Drill — Production Replica
- Source backup: 2026-03-15T03:00Z (daily full)
- Target: staging-restore-test
- Restore start: 2026-03-18T14:00Z
- Restore complete: 2026-03-18T14:42Z
- Total: 42 minutes (target was < 60 minutes)
- Spot checks:
  - users.id MAX matches: ✓
  - orders count within 0.01%: ✓
  - PITR window verified to 2026-03-15T03:30Z: ✓
- Action items: none
```

### Don't — set-and-forget backups

```
Backup schedule: every night.
Last restore: unknown.
```

That's not a backup, that's a tape gathering dust.

## Rationale

Database operations are where small mistakes turn into long
incidents. Expand/contract migrations, tested backups, and explicit
slow-query budgets are the difference between "we noticed something
slow, fixed it" and "we lost data for half a day."

The standard is opinionated on the strategy (expand/contract,
quarterly restore drill) but vendor-neutral on the implementation —
the discipline works whether you're on Postgres, MySQL, MongoDB, or
something else.

## See also

- `backend/database.md` — schema design, indexes, query patterns.
- `backend/api-versioning.md` — coordinating API changes with schema.
- `operations/runbooks.md` — where the restore drill procedure lives.
