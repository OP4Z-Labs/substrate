---
scope: backend
area: database
last_updated: TODO
rules:
  - BE-DB-001
  - BE-DB-002
update_triggers:
  - Schema convention changes
  - New ORM patterns
  - Migration policy changes
---

# Backend Database Standards

> Cadence scaffold — fill in the TODOs.

Schema, migration, and query conventions for every persistent store in
this repo.

## 1. Engines

TODO: Which databases you use (PostgreSQL, MySQL, SQLite, etc.) and
what each is for.

## 2. ORM and query layer

TODO: ORM choice (or none), session lifecycle, connection pooling
defaults.

## 3. Schema conventions

TODO: Naming (singular vs plural table names, snake_case columns),
primary keys (UUID vs auto-increment), timestamp columns.

```
table_name           snake_case, plural
column_name          snake_case
PRIMARY KEY (id)     UUID or integer per project decision
created_at           timestamp, default now()
updated_at           timestamp, auto-update
```

## 4. Migrations

TODO: Migration tool (Alembic, Flyway, raw SQL), how migrations are
authored, how they're tested, how rollbacks work.

## 5. Indices

TODO: Index policy — when to add, when to compose, when to drop. Note
that foreign keys need indices on the referencing side.

## 6. Tenant scoping (BE-DB-001)

TODO: If your data model is multi-tenant, document the column name
(`tenant_id`?), how every query filters it, and the test that catches
unfiltered queries.

## 7. Soft deletes

TODO: Whether you use them, the column name, how queries filter them.

## 8. Transactions

TODO: When to use, how to compose, isolation levels per use case.

## 9. Connection management

TODO: Pool size, max overflow, timeout policy.

## 10. Backups and disaster recovery

TODO: Reference `operations/database-ops.md`.
