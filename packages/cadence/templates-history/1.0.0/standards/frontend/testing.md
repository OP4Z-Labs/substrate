---
scope: frontend
area: testing
last_updated: 2026-05-14
rules:
  - FE-TEST-001
update_triggers:
  - Test runner changed
  - Coverage threshold changed
  - Forbidden pattern surfaced in audits
---

# Frontend Testing

> **Cadence default standard.** Vitest / Jest + Testing Library +
> Playwright is the assumed stack. Principles apply across runners.

## Scope

Every frontend test: unit, component, integration, end-to-end.

## Rules

### 1. The pyramid (same shape, different sizes)

- **Unit tests** — pure functions, hooks via `renderHook`, small
  components. Fast. Run on save.
- **Component / integration** — `render` + interact + assert. Mocked
  network. ~ 50-80 % of the suite.
- **E2E** — Playwright / Cypress. Real backend (or stable mock).
  Slow. Run in CI; not on save.

### 2. Use `userEvent` over `fireEvent` (FE-TEST-001)

```tsx
import userEvent from "@testing-library/user-event";

const user = userEvent.setup();
await user.click(button);
await user.type(input, "hello");
```

`userEvent` simulates real user behavior (focus, hover, keyboard
sequence). `fireEvent` dispatches a single synthetic event and
misses bugs in between (e.g., focus management, multi-event
sequences for `change`).

### 3. Test behavior, not implementation

```tsx
// PREFERRED — what the user sees
expect(screen.getByText("Saved")).toBeInTheDocument();

// AVOID — internal state
expect(component.state.isSaved).toBe(true);
```

If the test breaks when you refactor without changing behavior,
the test is too tightly coupled to implementation.

### 4. Async assertions: always `await waitFor` / `findBy`

```tsx
// WRONG
expect(screen.getByText("Saved")).toBeInTheDocument();   // racy

// RIGHT
expect(await screen.findByText("Saved")).toBeInTheDocument();

// or
await waitFor(() => {
  expect(screen.getByText("Saved")).toBeInTheDocument();
});
```

Promise-shaped state needs explicit waits. Flaky tests are usually
missing await.

### 5. Mock at the boundary, not the core

```tsx
// PREFERRED — mock at the network layer (MSW)
const server = setupServer(
  rest.get("/api/v1/tasks", (req, res, ctx) => res(ctx.json({ items: [], total: 0 }))),
);

// AVOID — mock the hook
vi.mock("@/data/tasks", () => ({ useTasks: () => ({ data: [] }) }));
```

MSW intercepts at the network level — the component code under test
runs unchanged. Mocking the hook bypasses the very code path you
want to verify.

### 6. Coverage thresholds

| Code              | Min line coverage |
| ----------------- | ----------------- |
| UI components     | 80 %              |
| Hooks             | 85 %              |
| Utilities         | 90 %              |
| API client        | 85 %              |

Coverage is a floor. A 100 %-covered function with no behavior
assertions is worse than 60 % with sharp assertions.

### 7. Snapshot tests are a tool, not a default

Snapshot tests are great for:
- Markdown / docs rendering output.
- Stable visual regression on a small set of "golden" components.

Snapshot tests are terrible for:
- Anything that re-renders frequently (every refactor touches them).
- Components with timestamps / IDs / random data.

Most component logic is better tested with explicit assertions.

### 8. Selectors: prefer accessibility-friendly queries

| Best                                       | Worst                            |
| ------------------------------------------ | -------------------------------- |
| `getByRole("button", { name: "Save" })`    | `container.querySelector(".btn")` |
| `getByLabelText("Email")`                  | `getByClassName("input-email")`   |
| `getByText("Welcome")`                     | `getByTestId("welcome-text")`     |

`getByRole` exercises the same semantic surface a screen reader
uses. If your component is hard to query that way, it's probably
also hard to use with assistive tech.

`getByTestId` is the escape hatch when other queries don't work.
Don't lead with it.

### 9. Test the happy path AND the failure path

```tsx
test("shows error message when save fails", async () => {
  server.use(rest.post("/api/v1/tasks", (req, res, ctx) =>
    res(ctx.status(500), ctx.json({ error: "Internal", code: "INTERNAL_ERROR" }))
  ));
  render(<TaskForm onSave={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
});
```

The failure-path test catches more real bugs than the happy-path
one. Don't skip it.

### 10. E2E covers user-critical flows only

Sign up → log in → core workflow → log out. 5-10 flows total per
app. Not "test every button"; test the paths that block
revenue / mission.

E2E suites that try to cover every UI state become flaky-test
graveyards.

### 11. Fast feedback loop

`npm run test:unit` should finish in < 10 seconds for a typical
package. If it doesn't, the tests are doing too much (rendering
full pages, hitting MSW, etc.). Move those into integration.

`test --watch` should be the developer's default loop while
iterating.

## Examples

### Do — accessibility-friendly assertion

```tsx
test("submits the form with the entered title", async () => {
  const onSave = vi.fn();
  render(<TaskForm onSave={onSave} />);

  await userEvent.type(screen.getByLabelText(/title/i), "Buy milk");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() => {
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Buy milk" }));
  });
});
```

### Don't — implementation-coupled assertion

```tsx
test("submits", async () => {
  const wrapper = mount(<TaskForm onSave={vi.fn()} />);
  wrapper.find("input.title-input").simulate("change", { target: { value: "x" } });
  wrapper.find("button.submit").simulate("click");
  expect(wrapper.state("isSubmitting")).toBe(true);
});
```

Three things every refactor will break.

### Do — MSW for the network mock

```ts
import { setupServer } from "msw/node";
import { rest } from "msw";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("loads tasks", async () => {
  server.use(rest.get("/api/v1/tasks", (req, res, ctx) =>
    res(ctx.json({ items: [{ id: "1", title: "Buy milk" }], total: 1 })),
  ));
  render(<TaskList />, { wrapper: TestProviders });
  expect(await screen.findByText("Buy milk")).toBeInTheDocument();
});
```

### Don't — `vi.mock` the data hook

```tsx
vi.mock("@/data/tasks", () => ({ useTasks: () => ({ data: [{ id: "1", title: "Buy milk" }] }) }));
```

You're testing the mock, not the integration.

## Rationale

Frontend tests have a deserved reputation for flakiness and high
maintenance cost. The discipline above (test behavior, use
accessibility queries, mock at the boundary, await async) keeps
tests close to user reality and stable across refactors.

## See also

- `react.md` — components under test.
- `accessibility.md` — same selectors as assistive tech.
- `data-management.md` — mutation invalidation tests.
- `backend/testing.md` — equivalent rules on the BE.
