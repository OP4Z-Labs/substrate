---
scope: frontend
area: performance
last_updated: 2026-05-14
rules:
  - FE-PERF-001
  - FE-PERF-002
update_triggers:
  - Bundle size budget changed
  - Core Web Vitals thresholds changed
  - New rendering strategy adopted
---

# Frontend Performance

> **Substrate default standard.** Core Web Vitals + bundle discipline.

## Scope

Every user-facing frontend that ships in this repo.

## Rules

### 1. Core Web Vitals: target the "good" bucket

| Metric                   | Good      | Needs improvement |
| ------------------------ | --------- | ----------------- |
| LCP (Largest Contentful Paint) | < 2.5 s | 2.5 – 4 s     |
| INP (Interaction to Next Paint) | < 200 ms | 200 – 500 ms |
| CLS (Cumulative Layout Shift) | < 0.1   | 0.1 – 0.25    |

Track these in production via the `web-vitals` package or an
RUM service. Don't fly blind.

### 2. Bundle size budgets

Per-route gzipped JS:

| Route type           | Budget   |
| -------------------- | -------- |
| Marketing / landing  | < 100 KB |
| App entry (auth)     | < 200 KB |
| Authenticated route  | < 300 KB |

Measure with `next build`, `vite build`, or `webpack-bundle-analyzer`.
Each route's number lives in `docs/performance/bundle-budget.md`.

A PR that pushes a route past budget either:
- Reduces something elsewhere, OR
- Updates the budget with a justification, OR
- Gets blocked.

### 3. Code-split by route at minimum

The first JS bundle a user downloads only contains the code for the
landing page. Each subsequent route loads its own chunk on demand.

Most frameworks do this automatically; the failure mode is
accidentally importing a giant lib at the root level (e.g.
`import { chart } from "recharts"` in `_app.tsx`).

### 4. Lists have stable keys (FE-PERF-001)

```tsx
// WRONG
items.map((item, i) => <Row key={i} item={item} />)

// RIGHT
items.map(item => <Row key={item.id} item={item} />)
```

Index keys cause React to keep the wrong DOM elements when the list
reorders. Symptoms: state in the wrong row, animations playing on
the wrong item, focus drift.

Index keys are fine only for: static lists, lists with no state per
item, lists that never reorder.

### 5. Virtualize long lists

When a list could realistically render > 100 items:

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";
```

Or `react-window`, or framework-native (Next.js `dynamic`, etc.).
Rendering 10,000 DOM nodes turns scroll into a slideshow.

### 6. Images: width, height, lazy, modern format (FE-PERF-002)

```tsx
<img
  src="/photo.webp"
  width={1200}
  height={800}
  loading="lazy"
  alt="Sunset over the city"
/>
```

- `width` and `height` (or aspect-ratio CSS) → no CLS.
- `loading="lazy"` for images below the fold.
- WebP / AVIF → 30-70 % smaller than JPEG.
- Use the framework's `<Image>` component when available
  (Next.js, Astro, Remix) — it handles responsive variants.

### 7. Lazy-load heavy components

```tsx
const Chart = dynamic(() => import("./Chart"), { ssr: false });
```

Editors, charts, video players, complex forms — anything > 50 KB
gzipped that's not on the critical path.

### 8. Preload the next route

```tsx
<Link href="/tasks" prefetch>...</Link>
```

Most frameworks prefetch links in the viewport. Confirm yours does;
if not, manually preload the routes users are likely to visit next.

### 9. Defer non-critical CSS / JS

- CSS: use `<link rel="stylesheet" media="print" onload="this.media='all'">`
  for non-blocking load. Or extract critical CSS inline.
- Third-party scripts (analytics, chat widgets): `defer` or
  `<Script strategy="afterInteractive">` (Next.js).

The first-paint cost of "one tiny analytics snippet" is real.

### 10. Memoization where it pays

```tsx
const sortedTasks = useMemo(() => tasks.sort(byPriority), [tasks]);
```

Use `useMemo` / `useCallback` when:
- The value is a prop to a `memo`-ed child.
- The computation is non-trivial (large sort, complex object build).

Skip it for cheap operations. The `useMemo` call itself has cost; if
the computation is trivial, the wrapping is more expensive than the
work.

### 11. Avoid layout thrashing

Reading then writing then reading DOM in a loop causes a "thrash":

```ts
// WRONG — forces synchronous layout per iteration
for (const el of elements) {
  el.style.height = el.offsetHeight + 10 + "px";
}

// RIGHT — batch reads, then batch writes
const heights = elements.map(el => el.offsetHeight);
elements.forEach((el, i) => { el.style.height = heights[i] + 10 + "px"; });
```

### 12. Track regression budgets in CI

Lighthouse CI / a custom bundle-size action / web-vitals smoke tests.
A perf regression caught at merge time costs minutes; caught a week
later costs hours.

## Examples

### Do — properly sized image with lazy load

```tsx
import Image from "next/image";

<Image src="/dashboard-hero.webp" width={1600} height={900} alt="..." priority />
<Image src="/feature-1.webp" width={800} height={600} alt="..." loading="lazy" />
```

`priority` for above-the-fold; `loading="lazy"` for below.

### Don't — unsized image causing layout shift

```tsx
<img src="/hero.jpg" alt="hero" />
```

Browser doesn't know how tall it'll be → CLS spike when it loads.

### Do — virtualized long list

```tsx
const rowVirtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 50,
});
```

### Don't — render 10k rows

```tsx
<div>
  {items.map(item => <Row key={item.id} item={item} />)}
</div>
```

Performance cliff hits around 1000-2000 nodes depending on row
complexity.

## Rationale

Frontend performance is a feature with real business impact (every
100ms of LCP costs ~ 1 % of conversions, per public studies). The
discipline above — measure, budget, lazy load, virtualize — is
boring but proven.

## See also

- `react.md` — memoization patterns.
- `accessibility.md` — fast pages help assistive tech too.
- `data-management.md` — query caching avoids re-fetches.
- `typescript.md` — type-only imports reduce bundle.
