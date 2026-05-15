---
scope: frontend
area: typescript
last_updated: 2026-05-14
rules:
  - FE-TS-001
update_triggers:
  - tsconfig changed
  - New strictness flag adopted
  - Type-narrowing pattern adopted
---

# TypeScript

> **Cadence default standard.** TypeScript across both frontend and
> shared packages. Backend Python lives in `backend/python.md`.

## Scope

Every `.ts` and `.tsx` file in the repo. Generated files (codegen
output, build artefacts) are exempted in `.eslintignore`.

## Rules

### 1. Strict mode is on, everywhere

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

`strict: true` enables most of these, but list the strict-family
flags explicitly so a future `strict` default change doesn't silently
loosen things.

### 2. No `any` without an inline justification (FE-TS-001)

```ts
// WRONG — no explanation
function parse(raw: any) { ... }

// RIGHT — narrow type or unknown + a guard
function parse(raw: unknown) {
  if (!isTaskShape(raw)) throw new Error("invalid task");
  return raw;
}

// RIGHT — `any` with a justification when truly needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legacyShim(payload: any) {  // HACK: third-party returns untyped
  ...
}
```

`unknown` is the type to reach for. It forces a narrowing step that
makes the assumption visible.

### 3. Type vs Interface: type by default

```ts
type Task = {
  id: string;
  title: string;
};
```

Use `interface` when:
- You need declaration merging (rare).
- You're consuming a library that uses `interface` and you want to
  extend it.

Otherwise, `type` — it composes more naturally with unions,
intersections, and mapped types.

### 4. Discriminated unions for state machines

```ts
type RequestState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

function render(s: RequestState<Task[]>) {
  if (s.status === "loading") return <Spinner />;
  if (s.status === "error") return <Err error={s.error} />;
  if (s.status === "success") return <List items={s.data} />;
  return null;
}
```

The compiler narrows `s.data` and `s.error` based on the
discriminator. No optional chaining everywhere.

### 5. Avoid `as` casts — narrow instead

```ts
// WRONG — `as` lies to the compiler
const task = response.data as Task;

// RIGHT — validate first
const task = TaskSchema.parse(response.data);  // zod / valibot / etc
```

`as` is acceptable when:
- You've just done a narrowing check the type system can't see.
- You're working around a structural-typing gap with an upstream lib.

In both cases, comment the cast.

### 6. Enums: prefer string union types

```ts
// PREFERRED
type Priority = "low" | "medium" | "high" | "critical";

// AVOID
enum Priority { Low, Medium, High, Critical }
```

`enum` ships runtime overhead and has surprising semantics
(reverse mapping). String unions are zero-cost and
narrow-friendly.

### 7. Imports: stable order, type-only when applicable

```ts
// External
import { useState } from "react";

// Internal shared packages
import { Button } from "@/components/ui/button";
import type { Task } from "@/types/task";

// Local relative
import { TaskForm } from "./TaskForm";
import type { TaskRowProps } from "./TaskRow";
```

`import type` for type-only imports — it lets the bundler strip
them. ESLint can auto-fix this.

### 8. Module boundaries: explicit exports

A barrel file (`index.ts`) re-exports the package's public surface
exactly:

```ts
// packages/forms/src/index.ts
export { Form } from "./Form";
export { useFormState } from "./useFormState";
export type { FormConfig, FormState } from "./types";
```

Don't `export *` — it lets accidental internals leak out.

### 9. Generics: name with intent, not letters

```ts
// AVOID
function transform<T, U>(items: T[], fn: (item: T) => U): U[]

// PREFERRED
function transform<TInput, TOutput>(
  items: TInput[],
  fn: (item: TInput) => TOutput,
): TOutput[]
```

`T`-only is fine for single-generic helpers, but two-generic functions
benefit from intent in the name.

### 10. Optional vs nullable: pick one and stick to it

```ts
// Database row → null for "absent"
interface Task {
  due_at: Date | null;
}

// API request body → optional for "absent"
interface TaskCreate {
  due_at?: Date;
}
```

This is a domain decision per layer. Pick the convention, write it
down, don't mix.

### 11. JSDoc on public APIs

Every exported function / type / class gets a one-line description
at minimum:

```ts
/**
 * Fetches a task by ID. Returns null when the task is not found
 * or the caller's tenant doesn't own it.
 */
export async function getTask(id: string): Promise<Task | null> { ... }
```

The IDE surfaces this on hover.

## Examples

### Do — narrowed unknown

```ts
function parseTask(raw: unknown): Task {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { id?: unknown }).id !== "string"
  ) {
    throw new Error("not a task");
  }
  return raw as Task;
}
```

(Or use a runtime validator like zod for the same shape.)

### Don't — sprinkle `any`

```ts
function parseTask(raw: any): Task {
  return raw;  // compiler is silent; bugs are loud later
}
```

### Do — discriminated union

```ts
type FetchResult = { ok: true; data: Task } | { ok: false; error: string };

function handle(r: FetchResult) {
  if (r.ok) return render(r.data);   // narrowed to data
  return showError(r.error);          // narrowed to error
}
```

### Don't — optional everything

```ts
interface FetchResult {
  ok?: boolean;
  data?: Task;
  error?: string;
}
```

Now every access needs `?.` and the compiler has no idea which fields
are populated together.

## Rationale

TypeScript pays back exactly as much as you put into it. Strict mode,
narrow `unknown` over loose `any`, discriminated unions for state —
each is a small habit that the compiler turns into hours of saved
debugging.

## See also

- `react.md` — types in component props.
- `data-management.md` — typed query keys + responses.
- `testing.md` — typed test fixtures.
- `backend/python.md` — equivalent strictness on the BE.
