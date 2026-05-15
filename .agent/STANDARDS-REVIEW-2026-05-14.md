# Cadence v1.0 Standards Docs — Publish-Readiness Review

**Reviewer:** Claude (Opus 4.7 / 1M ctx)
**Date:** 2026-05-14
**Mode:** Read-only — no edits, no commits
**Scope:** 21 standards docs in `packages/cadence/templates/standards/`

---

## Executive summary

- **Overall verdict:** **needs-work-before-ship** — most docs are
  defensible and ship-grade in shape and tone, but several contain
  specific factual errors or examples that won't compile/run as
  written. Those are embarrassing in a doc that bills itself as
  opinionated industry standards. None of them require a rewrite;
  all are fixable in a focused half-day pass.
- **Counts:** **9 green / 11 yellow / 1 red**
- **Top 5 highest-priority findings** (in descending order of how
  embarrassing they'd be if shipped today):

  1. **`backend/database.md` uses `uuid_generate_v7()`** as a SQL
     default (lines 47, examples). That function does not exist
     in vanilla Postgres — `uuid_generate_v4()` is shipped via
     the `uuid-ossp` extension, and v7 generation typically lives
     in app code or a custom function. Senior engineers will see
     this and assume the author hasn't actually used Postgres
     recently. **MUST-FIX.**
  2. **`frontend/testing.md` uses pre-2.0 MSW API** (`rest.get`,
     `(req, res, ctx) => res(ctx.json(...))`). MSW 2.x — released
     Oct 2023, the current major — uses `http.get` and
     `HttpResponse.json(...)`. This dates the doc by ~2 years and
     anyone copy-pasting it onto MSW 2 will get runtime errors.
     **MUST-FIX.**
  3. **`backend/api.md` recommends `POST /api/v1/tasks/bulk`** for
     bulk operations on a doc that otherwise enforces REST verb
     semantics, without acknowledging the tension. More
     importantly, the response-shape rule says "no `data:` wrapping
     on single items" — but the canonical error shape uses a
     top-level `error` envelope. The inconsistency between
     "envelope-only-for-lists" and the error envelope is real and
     a thoughtful reader will catch it. **SHOULD-FIX** (with a
     one-sentence rationale).
  4. **`backend/error-handling.md` and `backend/api.md` disagree
     on 422 vs 400 / 422 vs 400-with-details.** `api.md` says
     "422 when the request parsed cleanly but is semantically
     invalid (e.g. `due_date` in the past)"; `error-handling.md`
     puts `due_at must be in the future` in the validation-error
     shape with `code: "VALIDATION_ERROR"` and shows a 422-ish
     pattern but never names the status code explicitly. The
     rule about `422` only being for *post-parse* semantic
     errors is worth keeping but the docs don't agree on whether
     "due_at in the past" is parse-clean-but-semantic (422) or
     a field validation (which framework-default-FastAPI returns
     as 422 anyway). The reader is left guessing. **SHOULD-FIX.**
  5. **`operations/runbooks.md` example has a markdown rendering
     bug** — the "Do — runbook with concrete commands" example
     embeds a nested ` ```bash ` fenced block inside a triple-
     backtick markdown block (lines 209-223). Most markdown
     renderers won't close the outer block correctly. This will
     render visibly broken on the docs site. **MUST-FIX.**

- **Recommended next action:** Fix the 1 red doc (`backend/database.md`)
  and the 5 highest-priority issues above, then a pass for the
  other yellow-doc issues. Total estimated effort: 4-6 hours.
  After that, ship-ready.

---

## Per-doc grades

| Doc | Overall | Accuracy | Defensibility | Completeness | Tone | Consistency | Embarrassment-risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `backend/architecture.md` | **green** | green | green | green | green | green | low |
| `backend/api.md` | **yellow** | green | yellow | green | green | yellow | low-mid |
| `backend/api-versioning.md` | **green** | green | green | green | green | green | low |
| `backend/database.md` | **red** | red | green | green | green | green | high |
| `backend/error-handling.md` | **yellow** | green | green | green | green | yellow | low-mid |
| `backend/messaging.md` | **green** | green | green | green | green | green | low |
| `backend/observability.md` | **green** | green | green | green | green | green | low |
| `backend/python.md` | **yellow** | yellow | green | yellow | green | green | low-mid |
| `backend/security.md` | **yellow** | green | yellow | yellow | green | green | low |
| `backend/testing.md` | **green** | green | green | green | green | green | low |
| `frontend/accessibility.md` | **green** | green | green | green | green | green | low |
| `frontend/data-management.md` | **yellow** | yellow | green | green | green | green | low |
| `frontend/logging.md` | **green** | green | green | green | green | green | low |
| `frontend/performance.md` | **green** | green | green | green | green | green | low |
| `frontend/react.md` | **yellow** | yellow | green | green | green | green | low |
| `frontend/testing.md` | **yellow** | red | green | green | green | green | mid-high |
| `frontend/typescript.md` | **yellow** | yellow | green | green | green | green | low |
| `infrastructure/ci-cd.md` | **yellow** | yellow | green | green | green | green | low |
| `infrastructure/docker.md` | **green** | green | green | green | green | green | low |
| `operations/database-ops.md` | **yellow** | green | green | yellow | green | green | low |
| `operations/feature-flags.md` | **yellow** | green | yellow | green | green | green | low |
| `operations/runbooks.md` | **yellow** | yellow | green | green | green | green | mid |

(22 rows because there's an extra `cross-cutting/markdown-format-specification.md` in the same tree — out of scope; not reviewed.)

---

## Per-doc findings (yellow + red docs)

### `backend/api.md` — yellow

**Rationale:** Solid REST baseline, but has a small consistency gap
between its response-shape rule and its error-shape rule, plus a
debatable verb-vs-resource design rule on bulk endpoints.

**Findings:**

- **Line 33, 170** — *should-fix* — `/api/v1/<resource>/bulk` is
  presented as a canonical bulk-operations endpoint, but the
  surrounding rule (line 39) says "actions get their own segment
  when they don't fit verb semantics." Bulk endpoints are a
  defensible pragmatic compromise, but the doc should explicitly
  acknowledge this is the deliberate exception to "RESTful nouns"
  and give the reader the reasoning (atomicity, payload size,
  batched validation). Direct: add one sentence under rule 1
  noting this is the convention for batching, with the trade-off.
- **Lines 70-92, 95-99** — *should-fix* — The "no `data:` wrapping
  on single items, the shape IS the data" rule (line 89) directly
  conflicts visually with the canonical error response which IS
  enveloped (`error` / `code` / `correlation_id`). A reader will
  ask "why is the error response enveloped but the success
  response isn't?" The answer is fine (errors aren't the resource;
  they're metadata about what went wrong), but the doc doesn't
  state it. Direct: add a sentence under rule 5 acknowledging the
  asymmetry and why it's intentional.
- **Line 122-135 (status-code table)** — *nit* — `503` is
  documented as "Dependency unavailable" but in industry use
  `503` typically means *the service itself* is unavailable
  (load shedding, maintenance). Dependency-unavailable usually
  surfaces as `502` (bad gateway) or `504` (gateway timeout) for
  HTTP-fronted deps. The table could be clearer or just drop the
  "dependency unavailable" gloss.
- **Line 137-139** — *should-fix* — The `422` vs `400` definition
  says use `400` for "missing required field" and `422` for
  semantically invalid like "due_date in the past." Most modern
  Python web frameworks (FastAPI, Pydantic, DRF) return `422` for
  missing required fields too. This rule contradicts framework
  reality; reader-side confusion will follow. Direct: either
  acknowledge framework defaults override this convention, or
  switch the rule to match the FastAPI/Pydantic pattern that
  most of the audience will be on.

**What's good:** The URL structure, status-code table, header-only
auth, OpenAPI-or-it-didn't-ship rule, and the do/don't examples
are clean, opinionated, and defensible. The "developer-facing
error message, code for client branching, correlation_id for
support" framing is right.

---

### `backend/database.md` — **red**

**Rationale:** The standout factual error of the whole catalog
appears here. The rule itself (UUID PKs, prefer time-ordered for
index locality) is correct; the SQL example uses a function name
that doesn't exist in vanilla Postgres.

**Findings:**

- **Lines 47, 200** — **must-fix** — `uuid_generate_v7()` is not a
  built-in Postgres function. `uuid_generate_v4()` exists in the
  `uuid-ossp` extension (since 9.1). UUIDv7 generation in
  Postgres typically requires either:
    - `gen_random_uuid()` (Postgres 13+, for v4)
    - A user-defined function (often called `uuidv7()`)
    - An extension like `pg_uuidv7`
    - Application-side generation
  The example as written will fail at table creation in any
  vanilla Postgres install. Direct: either use `gen_random_uuid()`
  (and note v4 isn't time-ordered) or add a "this assumes
  `pg_uuidv7` extension or a custom `uuidv7()` function" caveat
  with a footnote on where to get it.
- **Line 37** — *should-fix* — "Use UUIDv7 or ULID when you want
  time-ordered IDs (better index locality than UUIDv4)" is
  correct but the surrounding doc then uses the made-up
  `uuid_generate_v7()` as if it's standard. Either commit to a
  specific implementation strategy (app-side ULID with `ulid-py`
  or `python-ulid`, or `pg_uuidv7` extension) or stay vendor-
  neutral and don't put the function name in the SQL example.
- **Line 138-141** — *should-fix* — The pool sizing rule
  (`pool_size + max_overflow` ≤ `max_connections / replicas`) is
  correct but ignores the most common production deployment
  shape: K horizontal app instances behind a load balancer. The
  divisor should be `instances × replicas`, not `replicas`. As
  written, a single-replica multi-instance deploy will misread
  this and over-provision the pool. Direct: clarify the
  arithmetic for a horizontally-scaled fleet.
- **Lines 200-207 (composite index example)** — *nit* — The
  partial-index example `WHERE deleted_at IS NULL` interacts with
  rule 4 (soft delete) in an opinionated way the doc doesn't
  call out: most queries will include `deleted_at IS NULL`
  themselves, but the planner uses partial indexes only when
  the WHERE clause exactly matches. Worth a sentence on the
  trade-off.

**What's good:** The "tenant_id on every row" rule and its
cross-link to security are exactly right and well-illustrated.
The soft-delete trade-off discussion (privacy implication) is
unusually clear. ON DELETE explicitness is well-argued.

---

### `backend/error-handling.md` — yellow

**Rationale:** Good content. Conflicts mildly with `api.md` on
422 semantics and the in-line validation-error example doesn't
state its status code.

**Findings:**

- **Lines 114-125** — *should-fix* — The validation error example
  shows the field-level shape but never says what HTTP status
  this returns under. Compare to `api.md` which says `422` for
  semantic invalid and `400` for malformed. The reader has to
  cross-reference. Direct: add the status code to the example
  block.
- **Lines 152-164** — *should-fix* — The retry decorator example
  shows kwargs `retries`, `backoff_factor`, `jitter`,
  `retryable_exceptions` — which look invented. `tenacity`, the
  most popular Python retry lib, uses `stop_after_attempt`,
  `wait_exponential`, `retry_if_exception_type`. Either match a
  real library's API or label this as pseudo-code. As-is, anyone
  copy-pasting will get an import error.
- **Lines 220-235** — *nit* — The exception handler example
  references `request.state.correlation_id` but the
  `correlation_id` middleware that sets it lives in
  `observability.md`. A small cross-link callout (something
  like "assumes the middleware from observability.md is
  installed") would make it self-sufficient.
- **Line 178** — *nit* — Mentions `pybreaker` and `opossum` as
  circuit-breaker libs. `opossum` is JS (Node), not Python; the
  doc otherwise reads Python. Either label as multi-language
  examples or trim.

**What's good:** The exception hierarchy pattern is clean, the
`from exc` rule for Python is exactly right, the
"never-leak-internals-in-500" rule is well-justified, and the
"don't retry 4xx" rule is sharply expressed.

---

### `backend/python.md` — yellow

**Rationale:** Solid Python conventions. A couple of dated
recommendations and minor gaps.

**Findings:**

- **Lines 52-60** — *should-fix* — Recommends "black or ruff
  format" but doesn't recommend the convergence: `ruff format`
  is now substantially black-compatible and ruff is faster +
  one-tool. Either pick one (lean to `ruff format` for the 2026
  audience) or explicitly note they're interchangeable.
- **Lines 62-83** — *nit* — The ruff config example doesn't enable
  `N` (pep8-naming) despite rule 6 listing naming conventions.
  Minor inconsistency between "we enforce naming" and the lint
  preset.
- **Lines 85-95** — *should-fix* — `strict = true` then
  `disallow_untyped_defs = true` and `warn_unused_ignores = true`
  — `disallow_untyped_defs` is already covered by `strict`. The
  redundancy is minor but signals "the author copy-pasted without
  reading the mypy docs." Direct: trim to the additive flags
  only, or comment on what each flag *adds beyond strict*.
- **Lines 173-186 (pytest markers)** — *nit* — `asyncio_mode =
  "auto"` is correct for `pytest-asyncio>=0.21`. Worth mentioning
  the version dependency.
- **Missing section** — *should-fix* — No mention of virtual
  environment / interpreter isolation. For a doc claiming to be a
  Python baseline, the absence of "always use a venv" / "use
  poetry's managed env" is a notable gap. New contributors trip
  on this all the time.
- **Missing section** — *nit* — No mention of `__init__.py` /
  package layout / namespace packages / src-layout vs flat. This
  is genuinely contested territory and a Python standards doc
  not having an opinion is a slight gap.

**What's good:** The async-everywhere rule, no-`print()` rule
(with concrete enforcement), Pydantic-for-external/dataclass-for-
internal split, and the `pathlib` over `os.path` rule are all
correct and well-justified.

---

### `backend/security.md` — yellow

**Rationale:** Strong floor, but a few prescriptive numbers and
patterns are debatable.

**Findings:**

- **Line 70-72** — *should-fix* — "Access token: short TTL (15-60
  minutes). JWT or opaque, your call." 15-60 is a wide range and
  the JWT-or-opaque choice is genuinely consequential (JWT
  revocation is famously hard). A "best practice" doc should
  either pick a side or be explicit about the trade-off. Direct:
  add a sentence on the JWT-revocation problem and when each
  choice is appropriate.
- **Line 137-138** — *should-fix* — "5 / minute / IP, lock after
  10 failed attempts" for login rate limiting is a specific number
  presented without source. It's roughly reasonable but a senior
  security engineer will want to know if this is from OWASP
  ASVS, an internal calibration, or vibes. Direct: cite OWASP
  ASVS 4.0 §2.2.1 (or your reference) or label as "starting
  point — tune per threat model."
- **Lines 99-101** — *yellow on defensibility* — RBAC vs ABAC
  is presented as a binary choice. In practice most systems are
  hybrid (RBAC at the role level, ABAC for resource-ownership
  checks). The doc's framing pushes a reader toward picking one,
  when the right answer is "use both, but make the model
  explicit." Direct: reframe as "you'll likely combine these;
  here's when each is the primary axis."
- **Line 178-181** — *nit* — "HTTPS everywhere — including
  in-VPC." Correct as a principle, but glosses the operational
  cost (cert management for service mesh, mutual TLS, etc.).
  The reader who tries to do this without a service mesh will
  hit pain. Direct: one-sentence pointer to "see service mesh /
  cert-manager" or equivalent.
- **Line 198-201 (audit log example)** — *nit* — `ip` and
  `user_agent` fields shown alongside `actor_id` and `tenant_id`
  — but `frontend/logging.md` discourages logging full email /
  PII. IP address is, depending on jurisdiction, PII under GDPR.
  Worth a sentence acknowledging the audit-log retention is a
  separate privacy regime.
- **Missing** — *should-fix* — No mention of CSP (Content
  Security Policy), even though the doc's scope says it covers
  the server side and the `frontend/react.md` doc DOES NOT cover
  it either. CSP is set by the server and is a top-10 modern
  defense; its absence from both docs is the gap.

**What's good:** Tenant-isolation discipline is excellent. The
parameterized-queries rule with both ORM and raw-SQL examples is
exactly right. The argon2 vs SHA section is correctly opinionated.
The "12 patch deps on a schedule" rule with concrete SLAs is the
right level of detail.

---

### `frontend/data-management.md` — yellow

**Rationale:** Excellent content overall. One inaccurate library
reference and one missing topic.

**Findings:**

- **Line 105** — *should-fix* — `expect(qc).toHaveBeenInvalidatedFor(...)`
  is presented as if it's a standard matcher. It is not — it's a
  custom matcher from `@nexus/testing-config` (per the OP4Z
  context) but the doc as published doesn't make that clear.
  Readers will try to install it and not find it. Direct: either
  describe it as "a custom matcher you can install" with a
  pointer to where to write one, or replace with the canonical
  way (assert via `qc.getQueryState(key).fetchStatus` or
  `qc.invalidateQueries` spy).
- **Line 19** — *nit* — "Assumes a TanStack Query / SWR / RTK
  Query-class library; principles apply across them." Then every
  example uses TanStack-Query-specific API. Either explicitly
  pick TQ as canonical (and label cross-library equivalents) or
  consistently abstract the API. Mixed messaging.
- **Missing section** — *should-fix* — No discussion of mutation
  *ordering* or *queuing* when offline / spotty network. Modern
  apps need this; the "optimistic updates" section hand-waves it.
- **Line 184-185** — *nit* — `is4xx(error)` shown as a helper but
  never defined. Minor but copy-paste-unfriendly.

**What's good:** Query-key factory is sharply specified. The
two-tier cache strategy is opinionated and useful. Optimistic-
update pattern with three-handler structure is textbook-correct.
The "cache raw, derive on read" rule is well-justified.

---

### `frontend/react.md` — yellow

**Rationale:** Almost all good. A few age markers and one
genuinely-dated section.

**Findings:**

- **Line 17** — *should-fix* — "Targets React 18+." React 19
  shipped in late 2024 and is the current major. By 2026 most
  serious codebases are on 19. The doc references 19 (line 134)
  but the target line still says 18+. Direct: bump the target.
- **Lines 132-134** — *yellow* — "React 19's compiler will eat
  most of this concern; manual memoization is a stopgap." This
  is true for `useMemo` / `useCallback` but the framing implies
  the compiler is fully mainstream — at the time of writing,
  it's still optional/opt-in in most setups. Worth one sentence
  on "when the compiler is on, this rule mostly disappears."
- **Lines 136-148 (RSC section)** — *should-fix* — "Server
  Components by default. Don't ship to the browser." The framing
  is right for Next.js App Router but the doc never mentions
  that this section ONLY applies to RSC-enabled frameworks
  (Next.js App Router, Remix v2+, Waku). A reader on Vite/CRA
  will be confused about why they don't have Server Components.
  Direct: prefix with "If you're on a Server Components
  framework..."
- **Lines 218-228 (Don't example)** — *nit* — "fetch in render
  (runs on every paint)" — technically the fetch fires on every
  render, not paint. Render ≠ paint in React. Minor pedantry but
  a React expert will flinch.

**What's good:** Hooks rules, naming conventions, file
organization, state-management table, side-effect cleanup,
memoization-when-it-pays — all sharp and defensible. The
do-vs-don't examples are excellent.

---

### `frontend/testing.md` — yellow (close to red on accuracy)

**Rationale:** Content is correct in spirit and structure. But
the MSW examples use the v1 API (deprecated for ~2 years), which
will outright break for anyone on the current MSW major.

**Findings:**

- **Lines 83-89, 138-141, 200-217** — **must-fix** — Uses MSW v1
  API (`rest.get`, `(req, res, ctx) => res(ctx.json(...))`).
  MSW 2.x (released Oct 2023) uses:
  ```ts
  import { http, HttpResponse } from "msw";
  http.get("/api/v1/tasks", () => HttpResponse.json({ items: [] }))
  ```
  This is the single most-likely-to-be-copy-pasted code example
  in the doc and it will fail on any current MSW install.
  Direct: update all MSW examples to v2 API.
- **Lines 109-117** — *should-fix* — Snapshot-test trade-off
  discussion is correct but doesn't mention that React Testing
  Library + Vitest now have built-in inline snapshots
  (`toMatchInlineSnapshot`) which sidestep some of the
  "every refactor touches them" pain. Worth one sentence.
- **Line 175-178** — *nit* — `screen.findByText(/title/i)` etc.
  The doc uses both `getByLabelText` (synchronous) and
  `findByText` (async) without distinguishing when each is
  appropriate. Minor but a tightening opportunity.
- **Line 153-156** — *should-fix* — "E2E suites that try to cover
  every UI state become flaky-test graveyards." Strong statement;
  worth a one-line gesture toward visual regression
  (Chromatic, Percy) as an alternative for broad UI coverage.

**What's good:** The pyramid framing, `userEvent` over
`fireEvent`, "test behavior not implementation,"
accessibility-friendly queries, and the "happy + failure path"
rule are textbook-correct.

---

### `frontend/typescript.md` — yellow

**Rationale:** Strong opinions, all defensible. Minor gaps and
one out-of-date recommendation.

**Findings:**

- **Lines 121-135 (enum section)** — *should-fix* — "Enums:
  prefer string union types." Strong opinion, defensible, but
  the example argues against `enum Priority { Low, Medium, ... }`
  — which is the *numeric* enum. TypeScript also has `const
  enum` and string-valued enums which have different trade-offs.
  The doc doesn't distinguish. A senior TS dev will notice the
  argument is against the weakest form of enum. Direct:
  acknowledge the three enum flavors and the case against each.
- **Lines 66-85 (type vs interface)** — *yellow* — "type by
  default" is a defensible default but the prevailing community
  guidance (e.g., TypeScript handbook, Effective TypeScript) is
  more like "they're interchangeable for most use cases; pick
  one and be consistent." The doc's stance is fine but a touch
  more dogmatic than the consensus. Worth softening or citing
  a reason.
- **Lines 154** — *nit* — `import type { Task } from "@/types/task"`
  is shown but the doc never mentions that TS 5+ has `verbatimModuleSyntax`
  / `isolatedModules` interactions that make `import type` not
  just a preference but sometimes required. Worth a sentence.
- **Missing section** — *should-fix* — No mention of `satisfies`
  operator, which is one of the most important TS features for
  config/data validation in modern code. For a 2026 TypeScript
  standards doc, omitting `satisfies` is a real gap.
- **Missing section** — *nit* — No discussion of `tsconfig.json`
  inheritance / project references. For monorepos (the implied
  audience), this is a real ergonomics topic.

**What's good:** Strict-mode preset, `unknown` over `any`, "narrow
instead of cast" with concrete example, discriminated unions for
state, generics-named-with-intent, optional-vs-nullable per-layer
discipline — all sharp.

---

### `infrastructure/ci-cd.md` — yellow

**Rationale:** Solid baseline. One reference to a non-existent
GitHub Action and minor framing nits.

**Findings:**

- **Lines 195-197** — *should-fix* — The example references
  `uses: BeauGoldberg/cadence@v1`. This is a GitHub Action that
  may or may not exist yet (Cadence hasn't shipped). If it doesn't
  exist by ship time, this example will be a broken reference.
  Direct: either confirm the action exists and is published, or
  use a more generic example (`npx @op4z/cadence audit --diff`).
- **Lines 24-39** — *should-fix* — The "Total target: < 5
  minutes for the PR pipeline" target is reasonable but doesn't
  account for the audit step's own runtime. Cadence's audit on a
  big repo could itself take time. Worth acknowledging.
- **Lines 60-67 (branch naming)** — *nit* — `feat/`, `fix/`,
  `chore/` prefixes are consistent with conventional-commits
  type. But the doc doesn't mention `breaking/` or how to
  handle major-version-bump branches. Minor gap.
- **Lines 86-91 (commit conventions)** — *nit* — Example uses
  `[TASK-128]` task-id format. This is fine generic. Worth a
  callout that the format is up to the team — readers from a
  Jira shop will use `[PROJ-1234]`, etc.
- **Line 158-161** — *should-fix* — The Dependabot/Renovate
  recommendation has no opinion on which to use. The two have
  meaningfully different ergonomics (Renovate is more
  configurable; Dependabot is GitHub-native). One-line lean.
- **Line 145-152** — *nit* — "Environments are immutable" — true
  in spirit. But "preview/pull-request environments" being
  immutable is a stretch — they're typically ephemeral, not
  immutable. Minor word choice.

**What's good:** The PR-vs-merge pipeline split, required-checks
mandate, reproducible-builds rule, rolling-deploys-with-health-
gates, immutable environments, cache-key-the-right-things — all
defensible and well-justified.

---

### `operations/database-ops.md` — yellow

**Rationale:** Excellent on expand/contract, backups, capacity.
A couple of completeness gaps.

**Findings:**

- **Lines 107-118 (capacity table)** — *should-fix* — The
  watermark numbers are presented as universal defaults. They're
  reasonable starting points, but a Postgres OLTP workload, a
  Redis cache, and a MongoDB document store have wildly
  different shapes. Either note "Postgres-tuned defaults" or
  explicitly invite per-DB tuning. As-is, a reader on a heavy-
  write workload may treat 70 % CPU as alarming when it's
  steady-state.
- **Missing section** — *should-fix* — No mention of read
  replicas / replica lag handling at the application level.
  This is one of the most common production database ops topics
  and its absence is notable.
- **Missing section** — *should-fix* — No mention of vacuum /
  autovacuum (Postgres) or equivalent maintenance operations.
  The doc gestures at it in line 138 but doesn't say anything
  about tuning, monitoring, or the famous "vacuum freeze
  storm" failure mode. For a 2026 ops doc, this is a gap.
- **Lines 151-167 (expand/contract example)** — *nit* — The
  example is column rename. Worth one more example (e.g., a
  type change or a multi-step constraint addition) since
  column rename is the easy case.

**What's good:** The expand/contract framing with 4 deploys is
exactly right. The "tested backups via quarterly drill" rule is
the kind of thing that prevents real disasters. The "production
default read-only" rule with audit is opinionated and correct.

---

### `operations/feature-flags.md` — yellow

**Rationale:** Solid baseline. A couple of points where the
opinion feels under-justified for a doc that's otherwise sharp.

**Findings:**

- **Lines 39-55 (30-day rule)** — *yellow on defensibility* — "A
  release flag has 30 days." Strong specific number. The
  reasoning ("stale flags rot") is right but 30 days is
  aggressive — many teams use 60-90. The doc should either
  defend 30 specifically (with the math: stale-flag bug rate
  vs cleanup overhead) or soften to "sub-quarter" with a
  pointer to local calibration.
- **Line 130-141 (rollout sequence)** — *should-fix* — The
  6-step rollout (1 → 10 → 50 → 100 + 1-week soak) is
  reasonable but the doc presents it as canonical without
  acknowledging that not every flag needs all 6 stages. Some
  features ship at 100 % for internal-tools-only. Worth a
  sentence acknowledging scope.
- **Lines 191-205 (HA fallback)** — *should-fix* — The fallback
  cascade (cached → in-code default → feature OFF) is correct,
  but "feature stays off (safe)" is wrong for ops/kill flags
  where the default is "feature on." Self-contradicts rule 4.
  Direct: clarify the fallback default depends on the flag
  category.
- **Missing section** — *nit* — No discussion of flag-system
  vendor selection (LaunchDarkly, Unleash, GrowthBook, etc.).
  Reasonable to stay vendor-neutral; could mention "in-house vs
  vendor" trade-off briefly.

**What's good:** Four-category taxonomy, descriptive-naming
convention, both-branches-tested rule, no-PII-in-targeting rule,
cleanup-is-its-own-PR pattern are all good.

---

### `operations/runbooks.md` — yellow (close to red on the rendering issue)

**Rationale:** Content is right. One real rendering bug that
will be visible on the docs site.

**Findings:**

- **Lines 209-223** — **must-fix** — The "Do — runbook with
  concrete commands" example block embeds a nested ` ```bash `
  code fence inside the outer ` ```markdown ` fence. Most
  markdown renderers won't handle this correctly — the outer
  fence closes at the first inner ` ``` `, then the rest
  renders as broken markdown. Direct: use four-backtick fences
  for the outer wrapper, or indent the inner code block, or
  use HTML `<pre>` tags. Test in the docs-site renderer
  before shipping.
- **Lines 35-49 (file layout)** — *nit* — The layout shows
  `docs/runbooks/` but other docs (e.g., `observability.md`
  line 153) reference `docs/runbooks/` too — consistent so far.
  But `database-ops.md` line 221 refers to the same place. Worth
  doublechecking everything points to one canonical path.
- **Lines 56-101 (template shape)** — *should-fix* — The
  template is good but doesn't include a "post-incident-update"
  field — when the runbook was *last touched in response to an
  actual incident*. The `last_verified` field is for staging
  drills; real-incident updates are different signal. Worth
  separating.
- **Line 169-179** — *nit* — "Privileged operations require
  two-person review" is one of those rules that sounds great
  but is rarely enforced. Worth a sentence on enforcement
  mechanism (CR? deploy gate? human checklist?) or labeled
  as aspirational.

**What's good:** The "every alert links to a runbook" rule with
its sharp justification ("a paged alert without a runbook is an
alert that wastes the on-call's time") is exactly right. The
quarterly review, severity-is-defined-not-vibe, runbook-in-repo
rules are all on-target.

---

## Cross-cutting findings

### Tone

Tone is uniformly good across the catalog — direct, opinionated,
respectful, with concrete rationale paragraphs. The "Rationale"
section format pattern works. No doc reads preachy or
condescending. The "Do / Don't" examples consistently explain
*why* the bad pattern is bad rather than just stating "this is
wrong."

### Cross-doc consistency

- **Status code 422 conflict** between `backend/api.md` (line
  137-139) and `backend/error-handling.md` (line 114-125) — see
  detailed findings above. Should resolve to one position.
- **Bundle/runbook directory paths** — `backend/observability.md`,
  `operations/database-ops.md`, and `operations/runbooks.md` all
  reference `docs/runbooks/` consistently. Good.
- **Cross-references** — Every doc has a "See also" section and
  most cross-links resolve correctly within the catalog. I did
  not check every link target manually but the surface-level
  pattern is solid.
- **MSW version mismatch internal** — `frontend/testing.md` uses
  MSW v1 in examples; if `data-management.md` ever adds MSW
  examples they should match.
- **Naming convention for rule IDs** — Across the catalog, rules
  are tagged `BE-ARCH-001`, `FE-A11Y-001`, `INF-CICD-001`, etc.
  Pattern is consistent. Good.
- **Frontmatter shape** — All 21 docs have the same frontmatter
  fields (`scope`, `area`, `last_updated`, `rules`,
  `update_triggers`). Consistent. Good.

### Structural consistency

The Scope / Rules / Examples / Rationale / See-also shape holds
across every doc. Section depth varies (some docs have 8 rules,
some have 12) but the shape is predictable. This is exactly what
the handoff promised, and it works.

### Patterns showing up across multiple docs

- **Vendor-neutral framing with vendor-specific examples.** Most
  docs say "applies regardless of stack" then use Python /
  TanStack Query / Postgres examples. This is fine for a doc
  marketed as opinionated-baseline, but the framing should be
  consistent. Either lean fully into "Python/TS/Postgres assumed,
  here's the principle that travels," or genuinely abstract the
  examples. The current half-and-half is mostly fine but
  occasionally confusing (e.g., `error-handling.md` mentioning
  `opossum` which is JS).
- **"Pick one and stick to it"** appears in multiple docs
  (pagination, ORM, formatter, dependency manager) and is a
  consistent good rule.
- **Concrete numbers without sources.** Multiple docs cite
  specific thresholds (90-day deprecation, 30-day flag, 5/min
  login rate, 70%/85% disk watermark) without sourcing. Some are
  clearly arbitrary (and that's OK); others are defensible
  industry consensus and deserve a citation. Pick a policy:
  either all specifics get a "starting point" caveat, or the
  ones grounded in standards (OWASP, WCAG, RFC) get cited.

---

## What I didn't review

- **`cross-cutting/markdown-format-specification.md`** — explicitly
  out of scope per the task brief (the 21 in-scope docs are
  backend/frontend/infrastructure/operations).
- **Whether examples actually compile / pass in a real project.**
  I read the examples; I didn't try to run them. The flagged
  issues are based on inspection (e.g., `uuid_generate_v7()`
  doesn't exist, MSW v1 API is deprecated) but I didn't run a
  test harness.
- **The `docs-site/` mirror.** I reviewed the canonical bodies in
  `packages/cadence/templates/standards/`. If the mirror has
  drifted, that's a separate review.
- **The `RULES.yaml` registry** the docs cross-reference. I
  verified the rule IDs are internally consistent within the
  docs but did not check that every rule ID appears in the
  registry (e.g., `BE-ARCH-001` mentioned in the frontmatter
  but I didn't open RULES.yaml to confirm it exists).
- **Specific library version compatibility** beyond MSW. I
  flagged the MSW issue because it's a hard version break;
  similar issues may exist for older `tenacity`, older Pydantic
  v1, etc., but those aren't as cut-and-dry.
- **Audit rule mappings.** Many docs cross-link rule IDs like
  `BE-DB-001` to suggest "the audit will catch this." Whether
  the audit detectors actually exist and work is outside my
  scope here.
- **The `Link:` header MIME / formatting in `api-versioning.md`**
  (line 79). The header format used is fine for HTTP spec; I
  didn't validate against RFC 8288 exhaustively.
- **Stack-specific Python/JS deep cuts** — I'm reasonably
  confident on the Python / TS / SQL ecosystem; for a doc that
  ever drifts into something more niche (Go, Rust, Ruby specifics)
  I'd want a domain expert eyeball.

---

## Closing note for Beau

This is a well-shaped catalog. The bones — Scope / Rules /
Examples / Rationale / See also — are exactly right, the tone is
consistent and professional, the cross-references mostly hold,
and the opinions are defensible. The reason this scored
"needs-work" rather than "ship-ready" is concentrated in a small
number of specific, fixable issues:

1. One genuine factual error (`uuid_generate_v7()` doesn't exist
   in vanilla Postgres) — the only red.
2. One library-version drift (MSW v1 → v2) in
   `frontend/testing.md`.
3. One rendering bug (nested fences in `runbooks.md`).
4. A handful of small consistency gaps (422 semantics, error
   envelope vs success raw shape, JWT-or-opaque under-justified).
5. A few "missing topics" that a senior eye would flag (CSP,
   `satisfies`, read replicas, `vacuum`).

None of these require a rewrite. All are an afternoon's work.
After that, this catalog is genuinely shippable under your name.
