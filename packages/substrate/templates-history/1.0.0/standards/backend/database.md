---
scope: backend
area: database
last_updated: 2026-05-14
rules:
  - BE-DB-001
  - BE-DB-002
update_triggers:
  - Schema design conventions changed
  - Migration tooling switched
  - New ORM patterns adopted
---

# Database

> **Substrate default standard.** Schema design, query patterns, and
> migration discipline for the application database. Operations
> concerns (backups, restore drills, expand/contract) live in
> `operations/database-ops.md`.

## Scope

Applies to the primary relational store(s) — Postgres, MySQL,
SQL Server — every backend service writes to. Document stores and
caches have their own conventions (see vendor docs).

## Rules

### 1. Primary keys are UUIDs (or ULIDs), not auto-increment ints

- Globally unique without coordination → safe to merge data across
  environments / shards.
- Don't leak business volume (an integer ID of 47 tells the client
  you have 47 users).
- Stable when you split a table or migrate to a new schema.

Use `UUIDv7` or `ULID` when you want time-ordered IDs (better
index locality than `UUIDv4`).

### 2. Every tenant-scoped table has a tenant_id column with an index

In a multi-tenant system, `tenant_id` is on every row of every
tenant-scoped table. Every query filters by it. No exceptions.

```sql
CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL,
  title       text NOT NULL,
  ...
);
CREATE INDEX tasks_tenant_id ON tasks (tenant_id);
```

This is rule `BE-DB-001` / `BE-SEC-001` (cross-listed). The single
most common multi-tenant security bug is "I forgot the tenant filter
on this one query."

### 3. Timestamps are timezone-aware UTC

```sql
created_at timestamp WITH TIME ZONE NOT NULL DEFAULT now()
updated_at timestamp WITH TIME ZONE NOT NULL DEFAULT now()
```

Never `timestamp WITHOUT TIME ZONE`. The implicit-local-time bugs
cost more than they save in storage.

### 4. Soft delete by default, hard delete on request

Add `deleted_at timestamp WITH TIME ZONE` (nullable). Queries filter
`WHERE deleted_at IS NULL`. Hard delete reserved for:

- GDPR / data-subject erasure requests.
- Compliance retention boundaries.
- Genuinely transient data (rate-limit counters, etc.).

A soft delete that the user thinks is a hard delete is a privacy
violation. Document the retention contract for each table.

### 5. Indexes follow query patterns, not "just in case"

Add an index when:

- A query in production runs against a non-PK column more than
  ~100 times/day, OR
- The query is on a user-blocking path and currently does a full
  scan.

Don't add an index because it "might be useful later." Indexes cost
write throughput and storage; verify the query plan first.

For composite indexes, the leading column must match the most
selective filter. `(tenant_id, status)` is great for "tasks of one
tenant with one status"; useless for "tasks across tenants with one
status."

### 6. Foreign keys with explicit ON DELETE

Every FK declares ON DELETE behavior explicitly:

```sql
CREATE TABLE task_comments (
  id        uuid PRIMARY KEY,
  task_id   uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ...
);
```

Options:
- `CASCADE` — child rows go with the parent. Use when the child has
  no meaning without the parent.
- `SET NULL` — child stays, FK becomes null. Use when the child
  outlives the parent (e.g., audit records).
- `RESTRICT` — parent can't be deleted while children exist. Use
  when accidental deletion is the bigger risk.

`NO ACTION` (the default in most DBs) is a footgun — it works most
of the time and then surprises you.

### 7. Migrations are versioned, ordered, and committed

- Migration tool: alembic / typeorm-migrations / prisma migrate /
  flyway / liquibase. Pick one per service and stick to it.
- Migration files are committed to the repo and code-reviewed.
- Each migration has both `up` and `down` (or a documented reason
  it's irreversible — see rule `BE-DB-002`).
- Migrations run as part of deploy, not ad-hoc.

### 8. Connection pooling, with limits

A service has a single connection pool, sized for its workload:

```python
engine = create_async_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)
```

`pool_size + max_overflow` should never exceed
`max_connections / number_of_replicas` for your DB instance.
Otherwise the first overload moment becomes a connection storm.

### 9. Avoid the ORM for migrations and bulk operations

ORMs are great for transactional row-shaped reads and writes. They
are not great for "update 10 million rows" or "calculate a histogram."
For those:

- Bulk inserts: raw SQL with `COPY` (Postgres) or batched
  `INSERT ... VALUES (...)` clauses.
- Bulk updates: raw SQL with `WHERE` predicates.
- Migrations: raw SQL (or migration-tool DSL). ORM-driven schema is
  too lossy.

### 10. Long queries get a timeout

Every query has a deadline. In Postgres:

```sql
SET statement_timeout = '5s';
```

Or at the connection / session level via the driver. A query without
a deadline blocks until the connection times out or the DBA kills
it — both are bad outcomes.

## Examples

### Do — tenant-scoped query

```python
async def list_tasks(db: AsyncSession, tenant_id: UUID) -> list[Task]:
    stmt = (
        select(Task)
        .where(Task.tenant_id == tenant_id, Task.deleted_at.is_(None))
        .order_by(Task.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())
```

### Don't — silent tenant leak

```python
async def list_tasks(db: AsyncSession) -> list[Task]:
    # Returns every tenant's tasks. Audit-worthy bug.
    result = await db.execute(select(Task))
    return list(result.scalars().all())
```

### Do — composite index for the actual query

```sql
-- Query: "give me this tenant's non-completed tasks, newest first"
SELECT * FROM tasks
  WHERE tenant_id = $1 AND status <> 'completed'
  ORDER BY created_at DESC;

CREATE INDEX tasks_tenant_status_created
  ON tasks (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
```

### Don't — index without the matching query

```sql
-- Adding "in case"
CREATE INDEX tasks_title ON tasks (title);
-- But the actual queries are all by tenant_id + status. This
-- index slows writes and helps nothing.
```

## Rationale

A schema is forever — once data lands in it, changing the shape is
an operational event (see `database-ops.md`). The conventions above
front-load the cost: UUIDs, soft deletes, FK actions, explicit
timeouts. The payoff is that the schema doesn't fight you when the
business changes.

## See also

- `operations/database-ops.md` — backups, restore drills, schema migration discipline.
- `security.md` — tenant isolation, encryption at rest.
- `architecture.md` — repository layer pattern.
- `observability.md` — slow-query logging.
