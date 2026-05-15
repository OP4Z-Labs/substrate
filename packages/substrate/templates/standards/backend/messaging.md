---
scope: backend
area: messaging
last_updated: 2026-05-14
rules:
  - BE-MSG-001
  - BE-MSG-002
update_triggers:
  - New event added
  - Consumer added
  - Dead-letter handling changed
  - Broker swapped
---

# Messaging & Event-Driven Communication

> **Substrate default standard.** Applies to any async message bus —
> Redis Streams, Kafka, RabbitMQ, NATS, AWS SQS, Google Pub/Sub.

## Scope

This standard covers:

- **Events** — past-tense facts (`OrderPlaced`, `UserCreated`) that
  other services react to.
- **Commands** — requests for action sent to a known recipient.
- **Background jobs** — work the producer wants done later, often by
  itself.

It does NOT cover:

- Synchronous HTTP calls between services (see `architecture.md`).
- Internal in-process queues for backpressure (those don't cross
  service boundaries).

## Rules

### 1. Events are past-tense facts

Event names describe what already happened. `OrderPlaced`, not
`PlaceOrder`. `UserDeleted`, not `DeleteUser`. The grammar isn't
cosmetic — it's the boundary that prevents consumers from accidentally
treating an event as a command they can refuse.

### 2. Schemas are versioned and explicit

Every event carries a schema version:

```json
{
  "schema": "OrderPlaced/v1",
  "occurredAt": "2026-05-14T12:34:56Z",
  "data": { ... }
}
```

Schema evolution rules:

- **Additive changes** stay on `v1`. New optional fields are allowed.
- **Breaking changes** produce `v2`. Producer emits BOTH versions for a
  deprecation window, consumers migrate, then `v1` retires.
- **Never** mutate `v1` in place to introduce a required field.

Use protobuf, Avro, JSON Schema, or just typed code — but pick one
and document it.

### 3. Consumers are idempotent

A consumer must handle the same event twice without producing
duplicate side effects. Brokers offer at-least-once delivery; treating
that as "usually once" is the bug that ruins your weekend.

Two common idempotency strategies:

**Idempotency key on the consumer side.** Track processed event IDs in
a database table. On every event, check the table first.

```python
async def handle_order_placed(event: OrderPlaced) -> None:
    if await db.exists("processed_events", event.id):
        return  # already handled
    async with db.transaction():
        await create_order(event.data)
        await db.insert("processed_events", {"id": event.id})
```

**Natural idempotency.** The operation itself is safely repeatable
(`UPSERT`, "set status to X if not already X"). Preferred when
possible — no extra table.

Cross-link: rule `BE-MSG-001`.

### 4. Failed messages go to a dead-letter queue

A message that exhausts its retry budget MUST land somewhere humans
can inspect. Silently dropping is not an option.

Configure:

- **Max retries** per consumer (typical: 3–5 with exponential backoff)
- **DLQ destination** named after the source (`orders-events.dlq`)
- **DLQ monitoring** — alert on non-zero queue depth
- **DLQ replay path** — a documented "reprocess these messages once
  the fix ships" runbook

Cross-link: rule `BE-MSG-002`.

### 5. Producers don't wait for consumers

The producer's job is "publish and continue." If the broker is
unreachable, options are:

1. **Outbox pattern** — write the event to a local DB table in the
   same transaction as the business change; a background process
   ships it to the broker. Resilient to broker outages.
2. **Fail fast** — if the broker is unavailable, fail the operation
   that produced the event. Only use this when the event is
   sufficiently critical that "the work didn't happen" is the right
   answer.

Default to outbox. The "fail the request because Redis is down" path
is a tail-risk amplifier — pick it consciously.

### 6. Consumer groups, not point-to-point

Multiple services subscribing to the same event each declare their
own consumer group (or equivalent). The broker delivers a copy to
each group; each group sees each event once.

This isolates consumer rollouts: deploying a fix to one consumer
doesn't risk redelivering events to a different consumer that
already processed them.

### 7. Avoid event chains > 3 hops

`OrderPlaced` → `InventoryReserved` → `PaymentRequested` →
`PaymentCaptured` → `OrderFulfilled` is the kind of chain that
becomes impossible to reason about during an incident. Each hop is a
chance for the chain to break.

When you hit 3+ hops, sketch the flow as an orchestration (a single
process that coordinates the steps) and decide whether you should
own it explicitly rather than emergent-via-events.

### 8. Events don't carry sensitive payloads

PII, secrets, full user objects — don't ship them in event bodies.
Ship IDs and let consumers fetch what they need from the producer's
authoritative store. Easier to redact, audit, and rotate access.

## Examples

### Do — additive schema change

```diff
 OrderPlaced/v1
 {
   "id": "uuid",
   "total_cents": 1234,
+  "promo_code": null
 }
```

Existing consumers ignore `promo_code`. Stays on `v1`.

### Don't — breaking change without a version bump

```diff
 OrderPlaced/v1
 {
   "id": "uuid",
-  "total_cents": 1234
+  "total": { "amount": 1234, "currency": "USD" }
 }
```

This breaks every consumer. Ship `OrderPlaced/v2`, run both for a
deprecation window, retire `v1`.

### Do — idempotent consumer

```python
@subscribe("orders.OrderPlaced/v1")
async def reserve_inventory(event: OrderPlaced) -> None:
    # Natural idempotency: UPSERT on (order_id, sku) means re-runs
    # are safe.
    for line in event.data.lines:
        await db.execute(
            "INSERT INTO inventory_reservations (order_id, sku, qty) "
            "VALUES (:order_id, :sku, :qty) ON CONFLICT DO NOTHING",
            order_id=event.data.id, sku=line.sku, qty=line.qty,
        )
```

### Don't — fire-and-forget without idempotency tracking

```python
@subscribe("orders.OrderPlaced/v1")
async def charge_customer(event):
    # If this event redelivers, the customer gets charged twice.
    await stripe.charges.create(amount=event.data.total_cents, ...)
```

Add an idempotency key or check-before-charge.

## Rationale

Event-driven systems trade direct dependency for delivery uncertainty.
The discipline above — idempotent consumers, dead-letter queues,
versioned schemas — is the cost of getting decoupled services.

Skipping idempotency works fine in the happy path; the failure mode
is a midnight incident where a broker glitch causes a redelivery
storm and your support team is fielding "why was I charged 7 times"
tickets. Pay the cost up front.

## See also

- `architecture.md` — when to use events vs HTTP calls.
- `observability.md` — how to trace a request across event hops.
- `operations/runbooks.md` — DLQ replay procedure should live there.
