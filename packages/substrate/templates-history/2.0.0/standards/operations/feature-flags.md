---
scope: operations
area: feature-flags
last_updated: 2026-05-14
rules:
  - OPS-FLAG-001
update_triggers:
  - New flag taxonomy adopted
  - Flag service changed
  - Cleanup policy modified
---

# Feature Flags

> **Substrate default standard.** Flags are how you decouple deploy
> from release. Used well, they're a superpower. Used poorly, they're
> the source of every "why does this only break in production" bug.

## Scope

All feature flags — release flags, experiment flags, ops
kill-switches, permission flags.

## Rules

### 1. Four flag categories, named explicitly

| Category    | Purpose                                | Lifespan      |
| ----------- | -------------------------------------- | ------------- |
| Release     | Hide new code until ready to ship      | < 30 days     |
| Experiment  | A/B test, gradual rollout              | < 90 days     |
| Ops / kill  | Disable a feature in an incident       | indefinite    |
| Permission  | Gate by user / role / tier             | indefinite    |

Tag every flag with its category. A flag without a category is just
an `if` statement that won't get cleaned up.

### 2. No long-lived release flags (OPS-FLAG-001)

A release flag has 30 days. After that:

- The feature is shipped → remove the flag.
- The feature was scrapped → remove the flag AND the dead code.

Why 30 specifically? Stale-flag bug rate climbs sharply once neither
branch is exercised in production for more than a release cycle — at
weekly deploy cadence, 4-6 weeks is when "we'll clean it up" stops
being credible. Teams on slower cadences (monthly+ deploys) can
push to 60-90 days, but write the limit down and enforce it.

Stale release flags rot:

- Code branches both behind them become unmaintained.
- Tests stop covering both branches.
- Eventually someone trips the wrong combination and ships an
  incident.

The audit catches "flags older than X days" and surfaces them
weekly. Don't let it grow.

### 3. Flag names are descriptive

```
# WRONG
new_feature
v2

# RIGHT
release.tasks.bulk_update
release.tasks.bulk_update_v2_optimistic
experiment.tasks.priority_default_high
ops.payments.disable_3ds_challenge
permission.workspace.advanced_analytics
```

Structure: `<category>.<scope>.<name>`. The category up front means
you can grep, audit, and clean up by category.

### 4. Default value is the safe behavior

```ts
// WRONG — default ON, requires explicit OFF to disable
if (flags.get("ops.export.bulk_export_enabled", true)) {
  await runBulkExport();
}

// RIGHT — default OFF, opt-in
if (flags.get("ops.export.bulk_export_enabled", false)) {
  await runBulkExport();
}
```

For ops/kill flags, the default is "feature on" (so the flag is the
KILL switch). For release flags, the default is "feature off" (so
unreleased code stays hidden).

### 5. Flag checks happen at the call site, not deep in the call stack

```ts
// GOOD — flag check at the entry point
async function createTask(data: TaskCreate) {
  if (flags.isEnabled("release.tasks.with_recurrence")) {
    return createTaskWithRecurrence(data);
  }
  return createTaskOriginal(data);
}

// BAD — flag check deep inside
async function createTaskInternal(data, db) {
  ...
  if (flags.isEnabled("release.tasks.with_recurrence")) {
    // 200 lines later
  }
  ...
}
```

Deep flag checks make the code path hard to follow and the cleanup
PR enormous.

### 6. Both branches are tested

```ts
test.each([true, false])("createTask handles flag=%s", async (flagOn) => {
  flags.override("release.tasks.with_recurrence", flagOn);
  ...
});
```

Or two separate tests covering both branches. A flag with only the
"on" branch tested is a flag that breaks on rollback.

### 7. Flag rollouts are gradual + monitored

A rollout sequence for a user-facing feature with real blast radius:

1. Internal users (employees) — 100 %.
2. Beta cohort — explicit opt-in.
3. 1 % of all users — monitor metrics.
4. 10 % — monitor metrics.
5. 50 % — monitor metrics.
6. 100 % — flag stays for 1 week (so rollback is possible), then
   removed.

Not every flag earns the full ladder. Internal-tooling-only features,
non-customer-facing changes, or low-blast-radius experiments can
ship at 100 % to the relevant cohort directly. Scale the rollout to
the failure mode you're hedging against.

If error rate or latency regresses, the rollout pauses. The flag
service supports this directly; don't roll your own.

### 8. Cleanup is a real task, not an afterthought

The cleanup of a released flag is its own PR:

```
chore(flags): remove release.tasks.with_recurrence (shipped 2026-04-12)

- Remove flag check in app/services/tasks.py
- Remove the original code path
- Update task creation tests to cover only the new flow
- Remove flag from feature-flag service config
```

The flag goes in code. The flag goes in the service config. The
flag is in tests. All three are removed in one PR.

### 9. Permission flags ARE long-lived — but reviewed quarterly

```
permission.workspace.advanced_analytics
permission.api.admin_only
```

These exist forever (or until the gated feature exists). Quarterly
review: are the gating rules still correct? Is the flag still
needed?

### 10. Ops flags MUST have a documented trigger

```
ops.payments.disable_3ds_challenge
  Triggered when:
    - 3DS challenge rate > 50 % for 5 minutes
    - Stripe 3DS endpoint returning 5xx
  Reset by:
    - Manual after Stripe status page shows green
    - Automatic after 24h
```

This information lives in the runbook (`operations/runbooks.md`),
linked from the flag's metadata.

### 11. Flag system is highly available

The flag service falls back gracefully:

- If unreachable: use the cached value.
- If no cache: use the in-code default.
- If neither: fall back to the **category-appropriate safe default**:
  - Release / experiment flags → feature OFF (rollout halts; users
    see the existing behavior).
  - Ops / kill-switch flags → feature ON (the kill switch is the
    inverted form; "no signal" means "run normally").
  - Permission flags → most-restrictive permission (deny by
    default, matching rule 4 of `backend/security.md`).

NEVER let a flag-service outage take down the application — but
"safe" depends on which flag is failing open. Write the safe default
in the flag's metadata so the fallback isn't a guess at incident
time.

### 12. No personal data in flag targeting payloads

Targeting "users in tier=enterprise" is fine. Targeting "user with
email=ceo@bigcorp.com" is a privacy issue:

- The flag service likely persists targeting rules.
- A breach of the flag service leaks the targeting data.

Target by user ID, tier, region. Don't target by name / email /
free text.

## Examples

### Do — categorized flag, both branches tested, cleanup tracked

```ts
// app/services/tasks.ts
async function createTask(data: TaskCreate, user: User) {
  if (flags.isEnabled("release.tasks.with_recurrence", { userId: user.id })) {
    return createTaskWithRecurrence(data, user);
  }
  return createTaskOriginal(data, user);
}

// tests/services/tasks.test.ts
test.each([true, false])("createTask with recurrence flag = %s", async (flagOn) => {
  flags.override("release.tasks.with_recurrence", flagOn);
  const task = await createTask(data, user);
  if (flagOn) expect(task.recurrence).toBeDefined();
  else expect(task.recurrence).toBeUndefined();
});

// TODO TASK-128: remove flag after 2026-06-12 rollout completion.
```

### Don't — uncategorized, deep, untested

```ts
// app/lib/utils.ts (200 lines into a utility module)
function maybeAddRecurrence(task) {
  if (flag("new_thing")) {
    task.recurrence = ...;
  }
  return task;
}
```

Hard to find, hard to clean up, hard to test, will live forever.

## Rationale

Feature flags trade short-term simplicity for long-term complexity.
The trade is worth it for safe rollouts and incident-time
kill-switches — but only if you actually clean up flags after the
rollout. The discipline above is what keeps that promise.

## See also

- `runbooks.md` — ops-flag procedures.
- `infrastructure/ci-cd.md` — gradual rollouts.
- `backend/testing.md` — testing both flag branches.
- `frontend/data-management.md` — flag-driven UI.
