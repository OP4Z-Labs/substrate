---
scope: frontend
area: react
last_updated: TODO
rules:
  - FE-REACT-001
  - FE-REACT-002
update_triggers:
  - React major bumps
  - Component patterns evolve
---

# React Standards

> Cadence scaffold — fill in the TODOs.

Component and hook conventions. Drop this file if you don't use React.

## 1. Component file shape

```tsx
"use client"; // when applicable (Next.js app router, etc.)

import { useState, useCallback } from "react";

interface Props {
  // ...
}

export function ComponentName({ prop }: Props) {
  // hooks
  // event handlers
  // render
}
```

## 2. Naming

- Components: `PascalCase`
- Hooks: `useCamelCase` (the `use` prefix is enforced)
- Props interfaces: `PascalCase` with a descriptive suffix
  (`ComponentNameProps`)

## 3. State

TODO: When to use `useState`, when `useReducer`, when state should be
lifted, when it should be server state.

## 4. Effects (FE-REACT-001)

- Always declare a dependency array.
- Never call hooks conditionally or after early-return.
- Side effects belong in `useEffect`, not the render body.
- Cleanup functions for subscriptions / timers.

## 5. Memoization

TODO: When to use `useMemo` / `useCallback` / `React.memo`. The bar
isn't "always memoize" — it's "memoize when profiling shows a need".

## 6. Refs

TODO: When refs are appropriate (imperative DOM access, third-party
integrations). When they're a smell (synchronizing state).

## 7. Composition over inheritance

TODO: Slot / children patterns. Render props vs hooks for reusable
behavior.

## 8. Error boundaries

TODO: Where they live in the tree. What they render. How they report
to your error tracker.

## 9. Lists and keys

- Use stable, unique keys.
- Index keys only when items never re-order.

## 10. Server components / SSR

TODO: If using a framework with server components, document the
boundary policy and which patterns live on which side.

## 11. Common anti-patterns

- Inline component definitions inside another component's render
- Deep prop drilling (use context or composition)
- Effect chains that update state that triggers another effect
