# Case study: OP4Z — cadence dogfood

> **Project:** OP4Z — multi-service productivity platform.
> **Team size:** 1 (solo founder + AI assistance).
> **Codebase:** ~9 backend microservices (Python/FastAPI), 1 frontend
> (Next.js 15), 28+ shared packages across Python and TypeScript.
> **Cadence usage:** Most of the framework was extracted FROM the
> OP4Z automation tooling, so cadence v1.0 covers ~60% of what OP4Z
> needs natively.

## What problem cadence solves

OP4Z is a solo project that ships at the pace of a small team. The
single biggest accelerator is automation — every audit, scaffolding
step, and standards check that runs without human attention is time
freed for actual product work.

Pre-cadence, this automation lived in OP4Z's `auto/` directory as a
mix of shell scripts (`./exc audit`, `./exc create`), Claude slash
commands (`/run`), and hand-rolled instructions. The automation
worked, but it wasn't reusable — extracting it to a new project meant
copying the whole thing and editing for differences.

Cadence is the extraction. The reusable framework lives in cadence;
OP4Z-specific content lives in OP4Z's `auto/` overrides. New projects
(blaze, chorus, the blog site) cadence-init in 30 seconds and get the
same automation backbone OP4Z developed over months.

## Which cadence features OP4Z depends on most

### `cadence init` + `cadence add`

OP4Z's 7-subdir `auto/` layout, the 15-audit catalog, and the
21 standards docs all originated here. `cadence init --bridge claude`
+ `cadence add standard backend/architecture` scaffolds OP4Z's
preferred shape in seconds.

### `cadence audit` (v1.0 detector runtime)

OP4Z's `RULES.yaml` carries 96 rules covering backend/frontend/
security/messaging/observability. The v1.0 detector runtime replaces
~3,000 lines of one-off Python audit scripts that OP4Z had accumulated.

Concrete win: the "no `assert x or True`" rule (BE-TEST-001) found
2,055 weak assertions across the OP4Z test suite during the v0.5
dogfood pass. Without the detector runtime, those were invisible.

### `cadence knowledge refresh`

The `KNOWLEDGE.md` auto-discovery (services, ports, env vars) saves
roughly 30 minutes per onboarding session for any AI assistant
working on OP4Z. The compose file has 59 services; cadence parses
them all into a redacted, structured doc.

### `cadence task` (with the Linear adapter)

OP4Z uses its own task system at the API level, but the cadence task
verbs (`find`, `search`, `create`, `update`, `complete`) match the
shape exactly. A future move from OP4Z's task service to Linear is a
plugin swap, not a rewrite.

### The Claude bridge

Every cadence-managed surface (`/run audit`, `/run scaffold`,
`/run docs --decision`) is one slash command in Claude Code. The
bridge file regenerates from the config; no manual sync of "what
commands are available."

## What bit us during dogfood

### v0.5 — `knowledge refresh` lost services on `command: >` block scalars

The hand-rolled `yaml-mini.ts` parser couldn't handle multi-line
block scalars. Result: parsing OP4Z's compose returned 1 service
instead of 59. Fixed in v0.5 by swapping to the `yaml` library.

### v0.8 — bridge file directory conventions for Cursor

Cursor's `.cursor/commands/` is the assumed location, but Cursor's
public spec wasn't fully nailed down at the time. Cadence ships the
file at the most likely location; users on Cursor's "newer" spec
move the file one line of `mv`.

### v0.8 → v1.0 — RULES.yaml shape stabilization

The v0.x RULES.yaml had `detector.type: shell` for arbitrary shell
commands. v1.0 deprecates this in favor of `script` (sandboxed JS).
OP4Z's RULES.yaml had ~30 `shell` detectors; the migration is
straightforward but real.

## What we'd want next

- **`cadence review`.** OP4Z has 5 review variants (`pre`, `standards`,
  `security`, `deep`, `doc-gap`) implemented as `/run` slash commands.
  v1.0 lists these as deferred to v1.x.
- **`cadence standards init`.** Loading all relevant standards docs
  into agent context at the start of a session. v1.0 lists these as
  deferred.
- **More adapter ecosystem.** Linear, Jira, GitHub Issues ship at
  v1.0; OP4Z would benefit from a Notion adapter for its
  documentation surface.

## Quantified impact (qualitative because the project is solo)

| Activity                            | Pre-cadence | Post-cadence |
| ----------------------------------- | ----------- | ------------ |
| New auxiliary project setup         | ~2 days     | ~30 minutes  |
| Audit a new service vs standards    | ~1 hour     | ~5 minutes   |
| Cross-service consistency check     | ad hoc      | `audit --all` |
| Standards-doc onboarding for an AI  | re-explain  | `standards --init` |

The qualitative impact: cadence makes "ship every day" actually
sustainable for a solo founder. Without it, the maintenance load
of 9 services + 28 packages would compound until the project
couldn't move.

## Recommendation

If you're a small team or solo project with > 3 services, cadence's
audit + scaffolding + standards layer pays for itself within the
first month. The 30-second `cadence init` plus the bundled 15 audits
+ 21 standards gives you a working automation backbone that would
take weeks to build from scratch.

If you're a larger team, the value is in the consistency — every
service looks like every other service from 20 feet away; new hires
ramp on the system, not on N different conventions.
