---
scope: operations
area: feature-flags
last_updated: TODO
rules:
  - OPS-FLAG-001
update_triggers:
  - Flag platform changes
  - Cleanup policy updates
---

# Feature Flag Standards

> Cadence scaffold — fill in the TODOs.

How feature flags are created, used, and retired.

## 1. Flag platform

TODO: LaunchDarkly, Flagsmith, Unleash, custom. Where flags are
defined.

## 2. Categories of flags

- **Release flags** — gate unfinished features; short-lived.
- **Experiment flags** — A/B tests; medium-lived.
- **Ops flags** — kill switches; long-lived.
- **Permission flags** — per-tenant or per-user toggles; long-lived.

Naming conventions reflect category.

## 3. Default values

- Release flags default off in production until ready.
- Ops flags default to the safe state.
- Experiment flags default to the control variant.

## 4. Code patterns

TODO: How flags are referenced in code. SDK calls vs config lookup vs
environment variable.

```ts
if (await flags.isEnabled("new-checkout-flow", { userId })) {
  return <NewCheckout />;
}
return <LegacyCheckout />;
```

## 5. Cleanup (OPS-FLAG-001)

- Release flags removed within 30 days of full rollout.
- Experiment flags removed within 14 days of the experiment ending.
- Ops flags reviewed quarterly.

Stale flags are audited by `cadence audit --type functionality-gaps`.

## 6. Auditing

- All flag changes logged.
- Production flag changes reviewed by a second engineer (for high-risk
  flags).

## 7. Testing

- Both flag states tested in CI.
- Snapshot of flag state at incident time captured in observability.

## 8. Communication

- Major flag changes (large rollouts) announced in the change log.
- Flag-driven user-visible changes documented in release notes.

## 9. Forbidden patterns

- Flags referenced in code but missing from the platform
- Flags in the platform never referenced from code
- Nesting flags more than 2 levels deep
- "Magic" flag values (use named constants for the flag keys)
