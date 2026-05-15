---
scope: frontend
area: react
last_updated: 2026-05-14
rules:
  - FE-REACT-001
  - FE-REACT-002
update_triggers:
  - React version upgrade
  - New component conventions adopted
  - State-management approach changed
---

# React

> **Substrate default standard.** Component conventions for any React
> codebase (Next.js, Remix, Vite, plain CRA). Targets React 19+.

## Scope

Every React component, hook, and provider in the frontend code. Native
mobile and React Server Components have additional conventions noted
inline.

## Rules

### 1. Hooks at top level, never conditionally (FE-REACT-001)

```tsx
// WRONG — calls hooks conditionally
function Bad({ shouldFetch }) {
  if (shouldFetch) {
    const { data } = useQuery(...);  // breaks rules of hooks
  }
  return <div />;
}

// RIGHT — always call, branch on data
function Good({ shouldFetch }) {
  const { data } = useQuery(key, { enabled: shouldFetch });
  return shouldFetch && data ? <div>{data}</div> : null;
}
```

Enforced by `eslint-plugin-react-hooks` (`react-hooks/rules-of-hooks`).

### 2. Components: PascalCase; hooks: camelCase with `use` prefix (FE-REACT-002)

```tsx
function TaskList() { ... }              // component
function useTaskList() { ... }           // hook
```

Components export their name; hooks use the name as their function
name AND filename. `useTaskList.ts`, not `taskList.ts`.

### 3. One component per file (within reason)

```
components/
├── TaskList/
│   ├── TaskList.tsx          main export
│   ├── TaskRow.tsx           helper, not exported elsewhere
│   ├── TaskList.test.tsx
│   └── index.ts              re-export the public surface
```

Exception: tiny presentational helpers (a `<Badge>` literally returning
one `<span>`) can co-locate.

### 4. Props are typed; defaults via destructuring, not `defaultProps`

```tsx
interface TaskRowProps {
  task: Task;
  onComplete?: (id: string) => void;
  compact?: boolean;
}

export function TaskRow({ task, onComplete, compact = false }: TaskRowProps) {
  return <div className={compact ? "compact" : "comfy"}>...</div>;
}
```

`defaultProps` is dead in modern React; don't use it for function
components.

### 5. State management: right tool per problem

| Problem                                  | Tool                              |
| ---------------------------------------- | --------------------------------- |
| Component-local UI state                 | `useState`                        |
| State shared across a tree               | `useContext` + provider           |
| Server state (cached, async)             | TanStack Query / SWR              |
| Global, complex (rare)                   | Redux / Zustand / Jotai           |
| Form state                               | React Hook Form / Formik          |
| URL state                                | router-native                     |

The default is local state. Reach for context when more than 2
levels deep want the same data; reach for a server-state library when
you're caching async data.

Putting everything in Redux because "scale" is a 2018 instinct.
Most apps never need it.

### 6. Side effects live in `useEffect`; cleanups are mandatory

```tsx
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal }).then(...);
  return () => controller.abort();
}, [url]);
```

If the effect attaches a listener, opens a connection, or kicks off
async work, the cleanup either tears it down or aborts it.

Dependencies are accurate. The exhaustive-deps lint rule is on. When
you intentionally omit a dependency, add an eslint-disable with a
comment explaining why.

### 7. Memoization: `useMemo` / `useCallback` are cost-tolerant

Don't sprinkle `useCallback` everywhere "for performance." The
useCallback call itself has a cost.

Use memoization when:
- The value is passed to a `memo`-ed child as a prop.
- The computation is non-trivial (sorting, mapping a large list).
- A deps array drives a `useEffect` and you want to avoid spurious
  re-runs.

React 19's compiler will eat most of this concern when it's on.
At the time of writing it's still opt-in in most setups (`babel-plugin-react-compiler`
or the Vite/Next plugin), so manual memoization remains a stopgap.
Once the compiler is enabled across your repo, you can lean on it
and audit existing `useMemo` / `useCallback` for removal.

### 8. Server Components vs Client Components

This rule applies only on RSC-enabled frameworks (Next.js App Router,
Remix v2+, Waku, TanStack Start with RSC). If you're on Vite, CRA,
or Remix Pages router, you don't have Server Components — skip this
rule.

When you ARE on an RSC framework:

- **Server Components by default.** Don't ship to the browser; can
  fetch data directly.
- **Client Components only when needed.** `"use client"` opts in to
  interactivity. State, effects, browser APIs all require it.

Keep Client Components small. Wrap them inside Server Components
that handle data fetching.

### 9. Error boundaries at route + module roots

Every top-level route has an error boundary. Page-level data fetches
live below it. Crashes in one section don't blank the whole app.

```tsx
<ErrorBoundary fallback={<RouteErrorPage />}>
  <TaskListPage />
</ErrorBoundary>
```

Log the error via the structured logger (see `frontend/logging.md`).

### 10. Accessibility is non-negotiable

`<button>` for buttons. `<a>` for links. `<label>` for inputs. Real
semantic HTML is the cheapest accessibility win.

The full a11y bar lives in `frontend/accessibility.md`. Read it.

### 11. Keys on lists are stable IDs, not array index

```tsx
// WRONG
items.map((item, i) => <Row key={i} item={item} />)

// RIGHT
items.map(item => <Row key={item.id} item={item} />)
```

Index keys are fine for static lists that never reorder. Anything
sortable / filterable / addable / removable needs a real key.

Cross-link: rule `FE-PERF-001`.

## Examples

### Do — typed component with named function

```tsx
"use client";

import { useState } from "react";

interface TaskFormProps {
  initialTitle?: string;
  onSave: (task: Task) => void;
  onCancel?: () => void;
}

export function TaskForm({ initialTitle = "", onSave, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(initialTitle);

  async function handleSubmit() {
    const task = await createTask({ title });
    onSave(task);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <button type="submit">Save</button>
      {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
    </form>
  );
}
```

### Don't — anonymous default export, untyped, side-effects in render

```tsx
export default function ({ task, save }) {
  fetch("/api/log", { method: "POST", body: JSON.stringify({ view: task.id }) });
  return <div onClick={() => save(task)}>...</div>;
}
```

Five problems: no name (bad stack traces), no types, fetch in
render (runs on every render), `<div>` for an interactive element
(a11y), inline JSON without validation.

## Rationale

React's flexibility is also its liability — there are five ways to
do anything and four of them have subtle wrong cases. The conventions
above are what successful React codebases converge on after living
with the wrong cases for a few years.

## See also

- `accessibility.md` — semantic HTML, ARIA, focus.
- `data-management.md` — TanStack Query patterns.
- `performance.md` — list keys, bundle size.
- `typescript.md` — types that catch React mistakes.
- `testing.md` — testing components.
