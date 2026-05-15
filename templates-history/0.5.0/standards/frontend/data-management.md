---
scope: frontend
area: data-management
last_updated: TODO
rules:
  - FE-DATA-001
  - FE-DATA-002
update_triggers:
  - Server-state library changes
  - Caching strategy updates
---

# Frontend Data Management Standards

> Cadence scaffold — fill in the TODOs.

How the frontend fetches, caches, mutates, and invalidates server data.

## 1. Server state vs client state

- **Server state**: anything from an API. Owned by a cache layer.
- **Client state**: form values, UI toggles, ephemeral interactions.

These are distinct concerns; don't conflate them in one store.

## 2. Server-state library

TODO: TanStack Query, SWR, Apollo, Relay, RTK Query. Configuration
(default stale time, retry policy, refetch on focus).

## 3. Query key conventions (FE-DATA-001)

TODO: Use a key factory per entity. Never hand-roll keys at call sites.

```ts
// queryKeys.ts
export const taskKeys = {
  all: ["tasks"] as const,
  list: (filters?: TaskFilters) => [...taskKeys.all, "list", filters] as const,
  detail: (id: string) => [...taskKeys.all, "detail", id] as const,
};

// at the call site
useQuery({ queryKey: taskKeys.detail(taskId), queryFn: ... });
```

## 4. Stale-time tiers

TODO: Document your tiers and the data they apply to.

| Tier     | Data type                        | Stale time   |
| -------- | -------------------------------- | ------------ |
| Stable   | Lookups, configs, preferences    | 1-2 hours    |
| Volatile | Tasks, projects, current state   | 2-15 minutes |
| Real-time| WebSocket-driven                 | 0            |

## 5. Mutations and invalidation

- Mutations invalidate the relevant entities on success.
- Use `invalidateEntity(taskKeys.all)` (or equivalent) — not raw key
  arrays at call sites.
- Optimistic updates explicit, with rollback on error.

## 6. Loading and error states

- Every query consumer renders a loading and an error state.
- Skeletons over spinners for content-heavy UI.
- Errors actionable (retry button, link to relevant settings).

## 7. Prefetching

TODO: Prefetch on hover for navigation. Prefetch on viewport for
below-the-fold data. Cost-aware (don't prefetch on slow networks).

## 8. Pagination

TODO: Cursor vs offset. Infinite scroll vs explicit pagination. Cache
policy for paginated results.

## 9. WebSocket / SSE integration

TODO: How real-time updates merge into the query cache.

## 10. Forbidden patterns

- Raw `fetch(` / `axios(` inside components (route through the data layer)
- Hand-rolled query keys at call sites
- Mutations that don't invalidate
- Global mutable state for server data
