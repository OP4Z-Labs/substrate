# Frontend — TypeScript style (Org)

TypeScript 5.x. Strict mode on. ESLint + Prettier.

## Hard rules

- No `any` without an inline justification comment.
- All public exports typed (no inference at module boundaries).
- React components are `function` declarations, not arrow consts.

## Imports

- Order: React/external → `@<scope>/*` packages → `@/*` absolute → relative.
- Side-effect-only imports last.

> Source: `@acme/substrate-shared@1.0.0` — fixture for the substrate
> enterprise smoke test.
