---
scope: frontend
area: data-management
last_updated: 2026-05-14
rules:
  - FE-DATA-001
  - FE-DATA-002
update_triggers:
  - Server-state library changed
  - Cache policy adjusted
  - Real-time channel added
---

# Frontend Data Management

> **Cadence default standard.** How the frontend talks to the backend
> and what it does with the data. Examples use TanStack Query (the
> most common 2026 choice); the principles — key factories, mutation
> invalidation, two-tier strategy, optimistic updates — port to SWR
> and RTK Query directly with surface-level rename.

## Scope

Every async data flow in the frontend: REST calls, GraphQL queries,
WebSocket subscriptions, server-sent events. Pure local UI state
(see `react.md`) is out of scope.

## Rules

### 1. Use a server-state library — never raw fetch in components

```tsx
// WRONG
const [data, setData] = useState();
useEffect(() => { fetch("/api/tasks").then(r => r.json()).then(setData); }, []);

// RIGHT
const { data } = useTasks();   // wraps TanStack Query / SWR
```

The server-state library gives you cache, deduplication, retries,
revalidation, and loading / error states for free. Reimplementing
these per-component is a slow road to bug city.

### 2. Query keys via a factory (FE-DATA-001)

```ts
// data/keys/tasks.ts
export const taskKeys = {
  all: ["tasks"] as const,
  list: (filters?: TaskFilters) => ["tasks", "list", filters] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
  comments: (taskId: string) => ["tasks", "comments", taskId] as const,
};
```

```tsx
// Use the factory
const { data } = useQuery({ queryKey: taskKeys.list({ status: "active" }), queryFn: fetchTasks });
```

```tsx
// WRONG — hand-rolled key
useQuery({ queryKey: ["tasks", "list", "active"], queryFn: ... });
```

When you invalidate, you invalidate via the factory too:

```ts
queryClient.invalidateQueries({ queryKey: taskKeys.list() });
```

Hand-rolled keys drift. Factories don't.

### 3. Two-tier strategy: stable data preloaded, volatile data on-demand

| Tier         | Examples                          | Stale time   |
| ------------ | --------------------------------- | ------------ |
| Stable (T1)  | Lookups, configs, preferences     | 1-2 hours    |
| Volatile (T2) | Tasks, projects, sprints, posts | 2-15 minutes |

Tier 1 loads once at app start; tier 2 loads when a route mounts.
The split avoids loading "user prefs" 100 times per session.

### 4. Mutations invalidate the right cache slice (FE-DATA-002)

Every mutation hook documents what it invalidates:

```ts
function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: (newTask) => {
      // Invalidate list views
      qc.invalidateQueries({ queryKey: taskKeys.list() });
      // Seed the detail view so the next click is instant
      qc.setQueryData(taskKeys.detail(newTask.id), newTask);
    },
  });
}
```

The matching test asserts the invalidation. With a `vi.spyOn` on
`queryClient.invalidateQueries`:

```ts
const invalidate = vi.spyOn(qc, "invalidateQueries");
await createTask(data);
expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.list() });
```

(Teams that test invalidation often often write a thin custom
matcher — e.g. `toHaveBeenInvalidatedFor(qc, key)` — over this same
spy. Keep it in your local testing-config package; don't expect it
to exist in `@tanstack/react-query`.)

Forgetting an invalidation is the most common "the UI says stale
data" bug.

### 5. Optimistic updates for fast-feel interactions

```ts
function useToggleComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: toggleComplete,
    onMutate: async (taskId) => {
      await qc.cancelQueries({ queryKey: taskKeys.detail(taskId) });
      const previous = qc.getQueryData(taskKeys.detail(taskId));
      qc.setQueryData(taskKeys.detail(taskId), (old: Task) =>
        old ? { ...old, status: old.status === "completed" ? "open" : "completed" } : old,
      );
      return { previous };
    },
    onError: (_err, taskId, ctx) => {
      qc.setQueryData(taskKeys.detail(taskId), ctx?.previous);
    },
    onSettled: (_, __, taskId) => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}
```

Three handlers: `onMutate` (apply optimistic state, snapshot), `onError`
(restore on failure), `onSettled` (always reconcile with server).

### 6. Pagination: infinite query or skip/limit, pick one per resource

```ts
// Infinite (good UX, more complex state)
useInfiniteQuery({
  queryKey: taskKeys.list(),
  queryFn: ({ pageParam = 0 }) => fetchTasks({ skip: pageParam, limit: 50 }),
  getNextPageParam: (last, pages) => last.length < 50 ? undefined : pages.length * 50,
});

// Skip/limit (simpler, page-numbered UI)
useQuery({
  queryKey: [...taskKeys.list(), { page }],
  queryFn: () => fetchTasks({ skip: page * 50, limit: 50 }),
});
```

### 7. Error handling: per-query AND global

```tsx
const { data, error, isError } = useTasks();

if (isError) return <ErrorBox error={error} retry={() => refetch()} />;
```

Plus a global handler for unrecoverable errors (auth expired, network
down):

```ts
function is4xx(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number" &&
    (error as { status: number }).status >= 400 &&
    (error as { status: number }).status < 500
  );
}

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (failureCount, error) => failureCount < 3 && !is4xx(error) },
  },
  queryCache: new QueryCache({
    onError: (error) => { if (isAuthExpired(error)) redirectToLogin(); },
  }),
});
```

### 8. Type the response and the error

```ts
async function fetchTask(id: string): Promise<Task> {
  const res = await api.get(`/tasks/${id}`);
  return TaskSchema.parse(res.data);  // runtime validation
}

const { data, error } = useQuery<Task, ApiError>({ ... });
```

When the API contract drifts, you want a runtime error at the
boundary, not a `undefined.title` deep in a component.

### 9. Don't store derived data in the cache

```ts
// WRONG — caches the derived
const tasksByStatus = useQuery({
  queryKey: ["tasks", "by-status"],
  queryFn: () => fetchTasks().then(groupByStatus),
});

// RIGHT — cache the raw, derive at the call site
const { data: tasks } = useTasks();
const tasksByStatus = useMemo(() => groupByStatus(tasks ?? []), [tasks]);
```

Caching derivations means every mutation has to invalidate two
keys; one for the raw, one for the derivation. Compute on read.

### 10. Real-time updates: subscribe, then invalidate

```tsx
useEffect(() => {
  const sub = socket.on("task.updated", (taskId) => {
    qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
  });
  return () => sub.unsubscribe();
}, [qc]);
```

Don't try to PATCH the cache directly from the socket payload —
your invalidation handler is already the source of truth.

### 11. Offline / spotty network: queue mutations, don't drop them

Optimistic updates assume the network is "usually there." On
unreliable connections (mobile, in-flight, transit) you also need to
**queue** mutations so they retry in order when the network returns.

- TanStack Query: enable `persistQueryClient` plus
  `onlineManager` + `mutationCache.getAll().filter(...).map(m => m.execute())`
  on reconnect. Mutations carry their own
  `retry` + `retryDelay` settings.
- The queue MUST preserve order — a "create task" followed by a
  "complete task" must apply in that sequence on the server, even
  if both were issued offline.
- Surface a queue indicator in the UI (badge: "3 pending changes")
  so users know writes are not yet durable. Failures after retry
  exhaustion need an "undo / fix" flow.

Don't try to merge concurrent writes client-side — let the server
be the conflict authority and reconcile via the standard
invalidate-after-mutate flow.

### 12. Stale-while-revalidate is the default

Show cached data immediately; fetch fresh data in the background;
update when fresh data arrives. This is how TanStack Query and SWR
behave by default. Don't fight it.

Disable only for: legal / compliance reasons (must show fresh), or
when the cached data could cause harm (e.g. account balance).

## Examples

### Do — typed query with factory keys

```ts
// data/api/tasks.ts
export async function fetchTasks(filters: TaskFilters): Promise<TaskListResponse> {
  const res = await api.get("/api/v1/tasks", { params: filters });
  return TaskListResponseSchema.parse(res.data);
}

// data/hooks/tasks.ts
export function useTasks(filters: TaskFilters = {}) {
  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => fetchTasks(filters),
    staleTime: 60_000,
  });
}
```

### Don't — raw fetch + useState + useEffect

```tsx
function TaskList() {
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    fetch("/api/v1/tasks").then(r => r.json()).then(setTasks);
  }, []);
  return <ul>{tasks.map(t => <li>{t.title}</li>)}</ul>;
}
```

No cache, no dedup, no error handling, no loading state, no
revalidation. Reinventing the wheel.

## Rationale

Data management is the single biggest source of frontend complexity.
A server-state library + query-key factories + clear mutation
invalidation turns it into a set of well-known patterns. Each rule
above is the bandage for a real production bug.

## See also

- `react.md` — components consuming queries.
- `typescript.md` — typed schemas.
- `testing.md` — testing mutations + invalidations.
- `backend/api.md` — the API contract on the other end.
