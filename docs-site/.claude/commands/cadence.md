---
description: Run Cadence commands (audits, scaffolds, standards) with lazy-loaded instructions.
argument-hint: <command> [--<action>] [<prompt>]
---

# /cadence — Claude Code Bridge for cadence-docs-site

This slash command shells out to the `cadence` CLI for execution while
loading the relevant instruction file into your context for AI-guided
steps (audits, reviews, ADRs). It is **not** the source of truth for
any cadence behaviour — running `npx cadence <command>` from a shell
produces the same result.

The bridge format is intentionally minimal in v0.1. The richer parsing
surface (`[contexts]`, `{params}`, `**<saveId>`) ships when the
underlying CLI grows the matching features (v0.3+).

## Command format

```
/cadence <command> [--<action>] [<prompt>]
```

| Component | Syntax            | Required |
| --------- | ----------------- | -------- |
| Command   | `<command>`       | Yes      |
| Action    | `--<action>`      | Per cmd  |
| Prompt    | `<free text>`     | No       |

## Execution

### Step 1 — Parse the user input

Extract from the message after `/cadence`:

- `<command>` — the first word (e.g. `audit`, `create`, `init`).
- `--<action>` — optional action flag (e.g. `--list`, `--type`).
- `<prompt>` — any remaining free-text instructions.

If the user passes `--help` or `-h`, run `npx cadence <command> --help`
and surface the output. Stop.

### Step 2 — Dispatch

Map `<command>` to a shell invocation:

| Command  | Action            | Run                                                |
| -------- | ----------------- | -------------------------------------------------- |
| `init`   | (none)            | `npx cadence init <flags>`                         |
| `audit`  | `--list`          | `npx cadence audit --list`                         |
| `audit`  | `--type <name>`   | `npx cadence audit --type <name>`                  |
| `create` | (none)            | `npx cadence create --template <t> --name <n>`     |

For `audit --type <name>`, **also read** the matching instruction file
into your context before executing the CLI:

```
auto/instructions/main/audit-<name>.md
```

The instruction file is the audit's playbook — the CLI's `--type` flag
emits a structured report in v0.1, but the actual interpretive work
(severity calls, finding-vs-pre-existing classification, follow-up
recommendations) is yours to perform against the playbook.

### Step 3 — Report

Surface the CLI's stdout to the user verbatim, then layer your audit
judgments on top (which findings to fix first, what to defer, which to
mark as false positives).

## Cadence task tags

Commits in this repo use `[DOC-NNN]` task tags. Webhooks
match on this prefix to link commits to tasks. Never rewrite history
to change existing tags.

## Roadmap

The bridge will grow to match Cadence as new commands land:

- v0.3: `cadence add`, `cadence review`, `cadence standards`, `cadence knowledge`, `cadence doctor`.
- v0.5: `cadence workflow`, `cadence config`, `cadence upgrade`.

When new CLI commands ship, refresh this bridge by re-running
`cadence init --with-claude` (which is idempotent — it will not
overwrite your local edits, only add new sections you opted into).
