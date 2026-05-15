---
scope: frontend
area: performance
last_updated: TODO
rules:
  - FE-PERF-001
  - FE-PERF-002
update_triggers:
  - Bundle budget changes
  - Core Web Vitals threshold updates
---

# Frontend Performance Standards

> Cadence scaffold — fill in the TODOs.

Budgets and patterns for keeping the frontend fast.

## 1. Core Web Vitals targets

TODO: LCP, FID, CLS, INP thresholds. Tested how, against which
environments.

| Metric | Target | Critical |
| ------ | ------ | -------- |
| LCP    | < 2.5s | < 4.0s   |
| INP    | < 200ms | < 500ms |
| CLS    | < 0.1  | < 0.25   |

## 2. Bundle budgets

TODO: Per-route budgets. Tool that enforces (size-limit, bundlesize,
webpack-bundle-analyzer). Where the budget config lives.

## 3. Code splitting

- Route-level code split by default.
- Heavy components (rich editor, charts, data tables) lazy-loaded.
- Eager loading reserved for above-the-fold.

## 4. Image policy

TODO: Format (AVIF / WebP fallback). Sizing (`srcset`, `sizes`).
Loading attribute. Where the rules are enforced.

## 5. Asset optimization

TODO: Fonts (subset, preload), icons (sprite vs inline SVG vs component
library), CSS (delivery strategy).

## 6. Network discipline

- API requests deduped / cached client-side.
- Predictable prefetching on hover for navigation links.
- No render-blocking third-party scripts in critical paths.

## 7. Render performance (FE-PERF-001)

- Lists above ~200 items virtualized.
- Memoize when profiling shows a need, not preemptively.
- Avoid effect chains that re-trigger renders.

## 8. Server-side rendering

TODO: SSR vs SSG vs ISR per route. Hydration cost considerations.

## 9. Measurement

TODO: RUM (Real User Monitoring) tool. Synthetic monitoring. Where
results are reviewed.

## 10. CI gates

TODO: Bundle size budget as a PR gate. Lighthouse CI as a periodic
budget. Both, or one?

## Common anti-patterns

- Importing `lodash` (not `lodash/specificFn`)
- Eager imports of route-level components
- Unkeyed lists that re-order on every render
- Unbounded `useEffect` chains
