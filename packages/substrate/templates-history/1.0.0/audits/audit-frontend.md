---
action: frontend
command: audit
schema_version: 1
description: Frontend area audit — component patterns, hook usage, accessibility, performance, data layer discipline.
---

# Audit: Frontend Area

A targeted audit of one frontend area — usually a route group, feature
slice, or product domain. Designed to be run repeatedly as a product
matures so regressions are caught early.

## Inputs

- **`--target <area>`** — required; the directory or tag name for the
  slice (e.g. `app/dashboard`, `features/auth`).
- Optional `--app <name>` if your monorepo hosts multiple frontends.
- Optional `--rules <ID,ID>` — restrict to a subset of `FE-*` rules.

## Output

- `auto/audits/frontend/<target>-YYYY-MM-DD.md`
- `auto/audits/frontend/<target>-latest.json`

## Block 1: Pre-flight

- Verify the area path exists and contains the conventional frontend
  shape (components, hooks, optional data hooks, tests).
- Load `RULES.yaml` (or equivalent). All rules in scope `FE-*` apply
  unless `--rules` narrows.
- Locate previous sidecar for diff-vs-baseline.

## Block 2: Discovery

- File count (component / hook / test / story / other)
- Lines of code per kind
- Component count by class (page / layout / feature / primitive)
- Hook count (custom hooks defined here)
- Test ratio (tests-to-components)

## Block 3: Run Detectors

### Pass A — Component patterns

- Components defined as anonymous default exports without a name:
  severity low.
- Components exceeding ~200 lines: severity medium (decomposition signal).
- Inline event handlers that re-allocate on every render in hot paths:
  severity low.
- Side effects inside render bodies (DOM mutation, fetch outside hooks):
  severity high.

### Pass B — Hook discipline

- `useEffect` without a dependency array when state is referenced:
  severity high.
- `useState` for derived data that could be a computed expression:
  severity low.
- Custom hooks that don't follow the `use` prefix: severity medium.
- Hooks called conditionally or after early-return: severity critical.

### Pass C — Data layer

- Raw `fetch(` / `axios(` calls inside components: severity high
  (route them through your data client / query layer).
- Query keys constructed inline rather than via a factory: severity
  medium.
- Mutations without invalidation calls: severity high.
- Loading and error states absent: severity medium.

### Pass D — Accessibility

- `<button>` without a label / `<img>` without `alt`: severity high.
- Focusable elements without keyboard handlers: severity medium.
- Color contrast tokens used outside the design system: severity low
  (manual review).
- Touch targets smaller than 44×44 px on primary actions: severity
  medium.

### Pass E — Performance

- Bundle-blocking imports of large libraries from leaf components:
  severity medium.
- Lists rendered without keys, or with index keys when items can re-order:
  severity high.
- Eager imports of route components that should be lazy: severity medium.

## Block 4: Coverage

Run the frontend test suite scoped to the area:

- Overall %
- Component coverage (rendered + interaction tests)
- Untested user-facing flows

Threshold suggestion: **UI ≥ 80%** for files in scope.

## Block 5: Diff vs Baseline

- New high/critical findings since last run
- Resolved findings
- Coverage delta
- Bundle size delta if a budgeting tool is wired in

## Block 6: Score + Gate

Standard formula (weights 20/8/3/1; ≥90 pass, ≥75 conditional).
Any critical introduced → fail.

## Block 7: Reports

```markdown
---
target: <area>
date: YYYY-MM-DD
score: NN
---

# Frontend audit: <area>

## Summary
## Findings by severity
## Coverage
## Bundle and runtime (optional)
## Recommended actions
```

## Block 8: Followups

- File tasks for high-severity findings.
- Pair findings with the design-system or accessibility champions when
  relevant — not all findings are individual-IC work.

## Rules

**Do:** narrow to a single area; pair severity calls with reproduction
steps; cross-reference accessibility findings with the `frontend/accessibility`
standards doc.
**Don't:** roll the whole frontend into one audit (use `audit --type all`);
weight every finding the same — accessibility regressions block ship,
style inconsistencies don't.
