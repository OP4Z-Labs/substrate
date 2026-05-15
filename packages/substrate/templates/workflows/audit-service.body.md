# Audit: backend service

Service-level review designed for one backend service at a time. The
manifest (`audit-service.yaml`) declares context — standards, rules,
memory — and a single deterministic detector pass. The body below is
the prose program the orchestrator hands to the AI session in B2.

In B1 the detector pass runs; AI-driven scoring + recommendations
land in B2.

---

## Inputs

- **service** (required) — the service directory under
  `apps/backend/<service-name>` (e.g. `authentication-service`).

The orchestrator resolves the value via `${service}` in subsequent
prompts (B2 — variable substitution and `--var key=value` parity with
v1's `substrate workflow start`).

## Output

- `substrate/audits/backend/<service>-YYYY-MM-DD.md`
- `substrate/audits/backend/<service>-latest.json` (sidecar; consumed
  by `composes_findings_of` declarations in audit-all-style flows in
  B2/B3).

## Block 1 — Pre-flight (B2 prompt step)

> When B2 ships the prompt-step engine, this block becomes a
> `prompt` step with `must-confirm: true`. For B1 the prose lives in
> the body for reference, but execution skips straight to the
> deterministic detector pass.

- Verify the target directory exists and follows the conventional
  service layout (`app/api/`, `app/services/`, `app/models/`, etc.).
- Confirm the service has migrations, tests, and the standards listed
  in `context.standards` are loaded into your working context.

## Block 2 — Deterministic detector pass (B1; runs)

The `run-detector` step shells out to `substrate audit --json`. The
audit subsystem (v1.0) walks `RULES.yaml`, runs each detector against
the service files, and emits a Markdown report + JSON sidecar.

Read the JSON sidecar at
`substrate/audits/backend/<service>-latest.json` to drive the next
blocks.

## Block 3 — Score + recommend (B2 prompt step)

When the prompt engine ships in B2, the AI receives the loaded
standards + memory + rule results and produces a scored summary:

- **Pass** — no critical findings; under 5 high-severity findings.
- **Conditional** — under 3 critical findings; under 15 high.
- **Fail** — 3+ critical or 15+ high findings.

Each finding gets one of:

- **Fix now** (blocks merge) — critical findings on auth, billing,
  uploads, or tenant isolation.
- **Should fix** (this sprint) — high-severity findings or
  recurring-pattern violations.
- **Track** (backlog) — medium / low severity.

The AI proposes one task per fix-now finding via
`substrate run tackle-task --from-finding <id>` (B3).

## Block 4 — Followups

The manifest's `followups:` block surfaces next-step suggestions
based on the gate outcome. Until the prompt engine ships, the
followup hints are informational only — printed by `substrate run`
after the deterministic pass completes.

---

## Notes for the workflow author

- Keep this body concise. The orchestrator concatenates the body
  into the AI prompt; long bodies eat the model's working context.
- Reference standards by name when discussing findings — the
  orchestrator preloads the docs declared in `context.standards`
  so the AI can quote them directly.
- The `composes_findings_of` cross-workflow primitive (B2) lets
  larger flows like `audit-all` aggregate this workflow's sidecar
  output. Reference fields:
  `composes_findings_of[*].workflow = audit-service`.
