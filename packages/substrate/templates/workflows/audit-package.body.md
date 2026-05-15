# Audit: shared package

Package-level review designed for one shared package at a time
(`packages/python/<name>` or `packages/typescript/<name>`).

The body below is the prose program for the AI session (B2+). In B1
the detector pass runs deterministically; AI scoring + per-finding
recommendations follow.

---

## Inputs

- **package** (required) — the package directory under
  `packages/{python,typescript}/<name>`.

## Output

- `substrate/audits/packages/<package>-YYYY-MM-DD.md`
- `substrate/audits/packages/<package>-latest.json`

## Block 1 — Pre-flight (B2 prompt step)

- Confirm the package directory exists and has the conventional shape
  (Python: `pyproject.toml` + `src/<pkg>/`; TypeScript: `package.json`
  + `src/`).
- Note which language the package is in — the AI uses that to weight
  the language-specific standards under `context.standards`.
- Confirm the package has tests; flag if not.

## Block 2 — Deterministic detector pass (B1; runs)

`substrate audit --json` walks the rules glob (`BE-PY-*`, `FE-TS-*`,
`CROSS-*`) and produces findings. Read the JSON sidecar to drive the
scoring + recommendations.

## Block 3 — Score + recommend (B2 prompt step)

Special considerations for shared packages versus services:

- **Breaking-change risk** — any rule violation touching public exports
  (Python `__init__.py`, TypeScript `index.ts`) escalates by one
  severity. Packages are consumed by N services; a regression here
  is a multiplicative cost.
- **Coverage threshold** — packages must hit 90% line coverage (vs
  70% for services). A coverage drop should surface as a finding
  even if no rule flagged it.
- **Documentation** — packages must have a README with a usage
  example for every public export.

## Block 4 — Followups

See the manifest's `followups:` block. The B2 prompt engine surfaces
specific next-step commands; for B1 they appear as informational
hints after the deterministic pass completes.

---

## Notes for the workflow author

- Avoid loading standards from both `backend/` and `frontend/` for
  the same package — pick the one matching the package's language and
  drop the other to keep the AI prompt focused.
- Adjust the `rules:` glob to the prefix(es) your RULES.yaml uses
  for package-level concerns. The shipped defaults assume the OP4Z
  convention.
