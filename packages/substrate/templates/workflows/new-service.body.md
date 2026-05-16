# New package or service scaffold

Reference workflow for scaffolding a new package or service in the repo
and then running an audit on it so it starts its life with a green
report. The manifest (`new-service.yaml`) declares the prompt + step
shape; this body is the prose program the orchestrator hands to the AI
session.

The workflow is intentionally generic. Substrate ships the workflow
*shape* — gather inputs, run a deterministic scaffold, audit the
result — and lets the user wire the actual scaffold command. That keeps
the reference manifest applicable to any stack (FastAPI, Express,
Next.js, Go services, a TypeScript library, etc.) instead of locking
the user into one codegen pipeline.

---

## Inputs

- **name** (required) — the new module name in kebab-case (e.g.
  `notification-service`, `billing-client`, `metrics-collector`).
- **stack** (required) — the stack identifier. Pull the allowed list
  from `substrate.config.json` `stacks` (commonly `python`,
  `typescript`, `fastapi`, `express`).

The orchestrator resolves both values via prompt steps with
`must-confirm: true` so the user can't accidentally scaffold under the
wrong name or into the wrong tree.

## Output

- A new directory under the matching root from `substrate.config.json`
  `paths.*` (e.g. `apps/backend/<name>/` for backend services,
  `packages/typescript/<name>/` for TS packages).
- `substrate/audits/package/<name>-YYYY-MM-DD.md` from the chained audit.

## Block 1 — Resolve repo conventions

Before scaffolding, read `substrate.config.json` and note:

- `paths.backend` — where backend services live.
- `paths.frontend` — where frontend apps live.
- `paths.packagesTs` — where TypeScript packages live.
- `paths.packagesPython` — where Python packages live.
- `stacks` — the allowed stack identifiers for this repo.

Cross-reference the user's `${stack}` answer with `stacks` to confirm
it's a recognized value. If not, ask the user to either pick from the
list or extend `substrate.config.json` `stacks` first — don't silently
scaffold into a fifth tree.

## Block 2 — Pre-flight

- Confirm a directory at `<root>/<name>/` does not already exist. If it
  does, abort with `exit_code: 2` so the user can rename or remove the
  existing tree first.
- Confirm the user's scaffold command (or template tree under
  `auto/templates/<stack>/`) is wired. Substrate's `run-scaffold` step
  ships as a placeholder echo — if it still reads
  "replace with your scaffold command", surface that as a workflow
  validation error before continuing.

## Block 3 — Deterministic scaffold (the user's command)

The `run-scaffold` step shells out to whatever scaffold command the
user has wired. Common patterns:

- A repo-local script under `auto/scripts/scaffold/<stack>.sh` that
  the user invokes with `name` as an argument.
- A `substrate create` invocation pointing at a bundled template tree
  (when the user has packaged their stack templates as a substrate
  scaffold under `auto/templates/`).
- A monorepo task runner invocation (e.g. `pnpm turbo gen <stack> --
  --name <name>` for Turborepo + plop).

Whichever shape the user picks, the workflow ships them the structure:
prompt → confirm → scaffold → audit.

## Block 4 — Chained audit (`audit-package`)

The `audit-new-module` step invokes `audit-package` as a sub-workflow
against the freshly-scaffolded module. The chained audit:

- Verifies the new module's RULES.yaml + standards docs are loaded.
- Runs the script detectors in `--scope=<name>` mode so only the new
  tree is inspected.
- Emits a report at `substrate/audits/package/<name>-YYYY-MM-DD.md`.

If the audit reports critical findings, the workflow exits with
`exit_code: 1` (conditional) — the scaffold did land but the new
module starts life flagged. The reviewer can fix the findings in the
same PR.

## Block 5 — Followup

After the workflow completes:

- Open a PR with the scaffolded module + the audit report attached so
  the reviewer sees both at once.
- If the audit was clean, add the new module to whichever monorepo
  workspace registry the repo uses (`pnpm-workspace.yaml`,
  `pyproject.toml` workspaces, `turbo.json` pipeline filters, etc.).

## Acceptance

- Exit 0 — name resolved, scaffold completed, audit reported zero
  critical findings.
- Exit 1 — name resolved, scaffold completed, audit reported critical
  findings (conditional pass; reviewer must address).
- Exit 2 — pre-flight failed (name collision, unknown stack, scaffold
  placeholder still in place) or scaffold itself errored. Nothing was
  written.
