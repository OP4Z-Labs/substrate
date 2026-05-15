---
scope: frontend
area: testing
last_updated: TODO
rules:
  - FE-TEST-001
  - FE-TEST-002
update_triggers:
  - Test framework changes
  - Coverage threshold updates
---

# Frontend Testing Standards

> Cadence scaffold — fill in the TODOs.

Conventions for component, hook, and integration tests on the frontend.

## 1. Frameworks

TODO: Vitest / Jest, Testing Library, Playwright. Per-layer mapping.

## 2. Test pyramid

TODO: How you split between component tests, integration tests, and
end-to-end tests.

## 3. Test organization

```
src/
├── components/
│   ├── ComponentName.tsx
│   └── ComponentName.test.tsx
└── hooks/
    ├── useThing.ts
    └── useThing.test.ts
```

## 4. Required test additions (FE-TEST-001)

TODO: Whenever a new component / hook / utility ships under `<your
frontend root>`, a corresponding `*.test.tsx` or `*.test.ts` file
ships with it. Pre-merge gate enforces.

## 5. Render helpers

TODO: Use a shared `renderWithProviders` (or equivalent) that wires the
required contexts (router, query client, theme, i18n).

## 6. User interactions

```tsx
import { userEvent } from "@testing-library/user-event";

const user = userEvent.setup();
await user.click(screen.getByRole("button", { name: /save/i }));
```

`userEvent` over `fireEvent`. Always `await` user interactions and
async assertions (`waitFor`, `findBy*`).

## 7. Async behavior

- Always `await` `waitFor`.
- Use `findBy*` queries for elements that appear asynchronously.
- Never use `setTimeout` in test code — use fake timers or `waitFor`.

## 8. Mocking

- Mock external boundaries (APIs via MSW, localStorage, navigator).
- Don't mock your own modules — refactor for testability instead.

## 9. Snapshot tests

TODO: When you use them. How they're updated. Whether they replace
behavioral assertions (no — they don't).

## 10. Coverage

- UI components: 80% minimum
- Hooks: 85%
- Utilities: 85%

## 11. Forbidden patterns

- `fireEvent.click` when `userEvent.click` works
- `screen.getBy*` for elements that may render asynchronously (use
  `findBy*`)
- Unhandled promise warnings
- Testing implementation details (state shape) instead of behavior
