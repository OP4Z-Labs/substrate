---
scope: cross-cutting
area: markdown-format
last_updated: TODO
rules:
  - XCUT-MD-001
update_triggers:
  - New doc category
  - Front-matter schema changes
---

# Markdown Format Specification

> Cadence scaffold — fill in the TODOs.

How docs in this repo are structured so tooling and humans can find
their way around.

## 1. Front matter

Every standards doc starts with YAML front matter declaring at least:

```yaml
---
scope: backend|frontend|infrastructure|operations|cross-cutting
area: <subarea>
last_updated: YYYY-MM-DD
rules:
  - RULE-ID-001
  - RULE-ID-002
update_triggers:
  - what kinds of changes should prompt a refresh
---
```

`rules` cross-references entries in `cross-cutting/RULES.yaml`.

## 2. Headings

- `# H1` — document title, exactly one per file.
- `## H2` — major sections.
- Numbered `## 1. Section` for ordered standards docs (this convention).
- Lower-level headings as needed; avoid going past `####`.

## 3. Code blocks

- Always fence with the language: `` ```python ``, `` ```ts ``, `` ```bash ``.
- Inline code for short identifiers: `` `useTaskMutations` ``.
- Avoid screenshots of code; the text is searchable.

## 4. Tables

- Use markdown tables for structured comparisons.
- Keep them narrow enough to read at standard terminal widths.
- Header row required.

## 5. Links

- Relative links for in-repo references.
- Always include link text (no bare URLs).
- Section anchors (`#section-name`) for deep links within long docs.

## 6. Callouts

```
> **Note:** Background information.
> **Warning:** Operational caution.
> **TODO:** Outstanding work.
```

## 7. Acceptance tests for a standards doc

A doc is "complete" enough to ship when:

- Front matter present and valid.
- Each numbered section has a real body (not just TODO).
- Cross-references to other docs are working.
- Examples compile / run.

## 8. Living-doc lifecycle

- Docs declare `update_triggers` so reviewers know when to touch them.
- Quarterly review: walk every doc, confirm currency, update
  `last_updated`.

## 9. Tooling

TODO: Linters / format checkers wired to standards docs. Pre-commit
hook posture.

## 10. Common anti-patterns

- Docs without front matter
- Long screenshots that don't load
- "TODO: write this" sections that never get written
- Multiple H1s in one doc
