---
scope: frontend
area: typescript
last_updated: TODO
rules:
  - FE-TS-001
  - FE-TS-002
update_triggers:
  - TS major bumps
  - tsconfig changes
---

# TypeScript Standards

> Cadence scaffold — fill in the TODOs.

TypeScript conventions across frontend apps and shared packages.

## 1. Versions

TODO: Minimum TS version. Major-bump policy.

## 2. tsconfig posture

TODO: Strict settings. Where the base config lives. Per-package
overrides allowed?

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

## 3. `any` posture

TODO: `any` banned vs `any` allowed-but-flagged. `unknown` preferred
when you genuinely don't know the type.

## 4. Type vs interface

TODO: When to use each. Common rule: `interface` for object shapes
that may be extended; `type` for unions, intersections, mapped types.

## 5. Generics

TODO: Naming (`T`, `TItem`, `TKey` vs descriptive). When to constrain.

## 6. Module organization

- Public exports flow through `index.ts` barrels.
- Internal modules don't re-export.
- No circular imports.

## 7. Branded / nominal types

TODO: For ID types where structural typing isn't enough.

```ts
type UserId = string & { readonly __brand: unique symbol };
```

## 8. Discriminated unions

TODO: Pattern for variant types (state machines, action types).

## 9. Utility types

TODO: Which built-in utility types you encourage; which custom ones
you've added to a shared package.

## 10. ESLint integration

TODO: `@typescript-eslint` plugin config. Rules enabled / disabled.

## 11. Common anti-patterns

- `as` casts that silence the type checker without runtime validation
- `// @ts-ignore` without a comment explaining why
- `Function` and `Object` types (use specific shapes)
- Implicit `any` in callback parameters
