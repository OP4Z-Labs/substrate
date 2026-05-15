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

### 3. Type vs Interface: pick one, be consistent

For most app-level shapes `type` and `interface` are interchangeable.
The TypeScript handbook explicitly calls this a style choice. The
guidance below is a default, not a hard rule:

```ts
type Task = {
  id: string;
  title: string;
};
```

`type` is a reasonable default because it composes more naturally
with unions, intersections, and mapped types — and a codebase that
leans on those (most do) ends up converting `interface` to `type` at
the first union.

Use `interface` when:
- You need declaration merging (rare, mostly module augmentation).
- You're consuming a library that uses `interface` and you want to
  extend it.
- You've inherited a codebase that already standardized on `interface`
  — consistency beats churning every file.

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

TypeScript ships three enum flavors, each with a different
trade-off:

```ts
// 1. Numeric enum — values are 0, 1, 2, 3. Reverse-mapping leaks
//    onto the runtime object; serialization is fragile.
enum Priority { Low, Medium, High, Critical }

// 2. String enum — values are explicit strings. Better than numeric
//    on the wire, but still emits a runtime object and isn't a
//    structural type (so widening / narrowing is awkward).
enum Priority { Low = "low", Medium = "medium", High = "high", Critical = "critical" }

// 3. `const enum` — fully inlined at compile time. Zero runtime.
//    But breaks under `isolatedModules` and most build tools
//    (esbuild, swc) need an explicit flag to handle it.

// PREFERRED: string union type
type Priority = "low" | "medium" | "high" | "critical";
```

String unions are zero-cost, narrow-friendly, work with every
build tool, and serialize 1:1 as JSON. They beat all three enum
flavors for most app code. Reach for `enum` only when interop with
a library or generated code demands it.

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
them. ESLint can auto-fix this. Under `verbatimModuleSyntax` or
`isolatedModules` (recommended in any modern setup), `import type`
is sometimes required, not just a preference — the compiler can't
always tell which imports survive emit.

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

### 12. Use `satisfies` for config / literal shapes you want to constrain without widening

`satisfies` (TS 4.9+) is the right tool when you want to verify a
value matches a type but keep the precise literal types intact:

```ts
// WITHOUT satisfies — `routes` widens to Record<string, string>
const routes: Record<string, string> = {
  home: "/",
  tasks: "/tasks",
  profile: "/profile",
};
// routes.home is now `string`, not `"/"`

// WITH satisfies — checked against the constraint, but keys and
// values keep their literal types
const routes = {
  home: "/",
  tasks: "/tasks",
  profile: "/profile",
} satisfies Record<string, string>;
// routes.home is `"/"`; typeof routes is the precise shape
```

Lean on `satisfies` for:
- Configuration objects (theme tokens, route maps, feature flags).
- Discriminated-union literal tables (e.g. mapping `kind` →
  handler functions).
- Anywhere you'd otherwise lose information to a type annotation.

### 13. `tsconfig.json` inheritance for monorepos

In a monorepo, ship one root `tsconfig.base.json` with the strict
settings, then have each package extend it:

```json
// tsconfig.base.json (root)
{ "compilerOptions": { "strict": true, ... } }

// packages/forms/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist" } }
```

For typed cross-package references, use project references
(`references: [{ "path": "../shared" }]`) — they give you per-
package incremental builds and enforce that one package can't reach
into another's source without an explicit dependency.

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
