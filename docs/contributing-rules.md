# Contributing rules to the substrate registry

Substrate ships a default `RULES.yaml` covering the 21 shipped standards
docs. Project-specific rules live in the consumer repo's
`substrate/RULES.yaml`. But there's a third tier: **rules that are
generally applicable and worth promoting to the shipped default**.

This document is how you propose one.

## What belongs in the shipped registry

A rule is shippable if it's:

1. **Generally applicable.** Not specific to one company / framework /
   stack. "No bare `except:` in Python" is general. "No `Optional[X]`
   when `X | None` works" is too style-specific for the default.
2. **Verifiable.** A detector that's measurable (ripgrep pattern,
   script with deterministic output). Pure "manual review" rules
   need exceptionally clear descriptions to make the cut.
3. **Linked to an existing standards doc.** Or paired with a doc
   update if the rule lives somewhere new.
4. **Battle-tested.** You've run it against your own repo (or two)
   and it produces sensible findings.

What does NOT belong:

- Rules tied to one team's stack-specific decisions (e.g. "all
  components use our internal Button").
- Style-only rules covered by formatters (prettier / black handle
  formatting; substrate doesn't relitigate).
- Rules whose detector can't reliably distinguish a true positive
  from a false positive (e.g. "find all TODOs" — too noisy).

## How to propose a rule

1. **Open an issue** using the [rule contribution template](https://github.com/op4z/substrate/issues/new?template=rule_contribution.yml).
   This lets us discuss scope before you put work into a PR.

2. **Draft the rule** in your fork of substrate:

   ```yaml
   # packages/substrate/templates/standards/cross-cutting/RULES.yaml
   - id: BE-PY-003
     title: No print() left in shipped code
     doc: backend/python.md
     severity: low
     category: backend
     description: |
       print() in committed code is debug residue. Use the structured logger.
     detector:
       type: ripgrep
       pattern: '^\s*print\s*\('
       paths: ['apps', 'packages', 'src']
   ```

3. **Update the owning standards doc** to reference the new rule ID
   in its front matter:

   ```yaml
   ---
   scope: backend
   area: python
   rules:
     - BE-PY-001
     - BE-PY-002
     - BE-PY-003   # ← new
   ---
   ```

4. **Add a test** under
   `packages/substrate/tests/integration/audit-runtime.test.ts` that
   exercises your detector against a controlled fixture.

5. **Test it locally** in your own repo. Document the test output in
   the issue / PR.

6. **Open the PR** referencing the issue.

## Review criteria

A maintainer will review on:

- **Scope** — Does this generalize beyond your project?
- **Detector quality** — Does the ripgrep pattern catch the right
  things without too many false positives? Does the script run in
  the sandbox cleanly?
- **Severity** — Is the severity defensible? (Critical = real
  business / security risk; high = likely bug; medium = standards
  conformance; low = style.)
- **Documentation** — Is the linked standards doc actually about this
  rule? Examples present?

## Severity guide

The default registry uses severity conservatively. When in doubt:

- **critical** — Security vulnerability, multi-tenant breach,
  irreversible data loss. Rare.
- **high** — Correctness bug, missing auth on a sensitive path,
  forbidden test pattern (silent test failures).
- **medium** — Standards conformance, structural issue, soft-touch
  bug.
- **low** — Style, doc gap, minor consistency issue.

Don't reach for `critical` for "this is important to me." Reach for
it for "this will cause a paged incident if it ships."

## ID conventions

Format: `<SCOPE>-<CATEGORY>-<NUM>`.

| Scope    | Means                       |
| -------- | --------------------------- |
| `BE`     | Backend                     |
| `FE`     | Frontend                    |
| `INF`    | Infrastructure              |
| `OPS`    | Operations                  |
| `XCUT`   | Cross-cutting               |

Categories follow the standards-doc area names (`ARCH`, `API`, `DB`,
`ERR`, `MSG`, `OBS`, `PY`, `SEC`, `TEST`, `REACT`, `TS`, `A11Y`,
`DATA`, `LOG`, `PERF`, `DOCKER`, `CICD`, `RUN`, `DBOPS`, `FLAG`, `MD`).

Numbers are sequential within `<SCOPE>-<CATEGORY>-`. Pick the next
available number after grepping existing IDs.

## License

Contributions to the shipped RULES.yaml are licensed under the same
license as substrate's content (CC-BY-4.0, see [LICENSES.md](../LICENSES.md)).
By submitting a rule, you agree your contribution is licensable that
way.

## Example: a worked rule contribution

Issue title: `[rule] BE-PY-003 — No print() left in shipped code`

Body:
- Use case: caught 12 debug `print()` calls in our codebase that should
  have used the logger.
- Detector: ripgrep `^\s*print\s*\(` against `apps`, `packages`, `src`.
- False positives: pytest `print()` in test files (excluded via the
  paths config since we don't scan `tests/`).
- Where tested: 3 internal repos, ~50 hits total, ~5 false positives
  (test helper functions named `print_something`). Fixed by tightening
  the pattern to require no preceding word char.

PR diff:
- 1 line added to RULES.yaml
- 1 line added to backend/python.md front matter
- 1 paragraph added to backend/python.md body
- 1 integration test

Total contribution: ~20 lines of code, ~30 minutes of work.

That's the bar. Easy to review; easy to merge.
