# /cadence — Cursor Bridge for {{PROJECT_NAME}}

<!--
Bridge file format assumption (v0.5):
  Cursor's slash-command spec is still stabilizing; cadence assumes
  `.cursor/commands/<name>.md` based on the convention shared with
  Claude Code's `.claude/commands/` and the broader VSCode-extension
  community pattern. If Cursor's docs land on a different location
  (e.g. `.cursor/prompts/` or `.cursor/rules/`), regenerate the bridge
  by re-running `cadence init --bridge cursor`. The assumption is
  isolated to this template — the dispatch contract below is bridge-
  agnostic.
-->

This file documents the `/cadence` slash command for the Cursor editor.
It shells out to the `cadence` CLI the same way the Claude Code bridge
does; agents loading this file should follow the same dispatch table.

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

- `<command>` — the first word (e.g. `audit`, `create`, `init`, `task`,
  `workflow`, `upgrade`).
- `--<action>` — optional action flag (e.g. `--list`, `--type`).
- `<prompt>` — any remaining free-text instructions.

If the user passes `--help` or `-h`, run `npx cadence <command> --help`
and surface the output. Stop.

### Step 2 — Dispatch

Map `<command>` to a shell invocation:

| Command    | Action            | Run                                                |
| ---------- | ----------------- | -------------------------------------------------- |
| `init`     | (none)            | `npx cadence init <flags>`                         |
| `audit`    | `--list`          | `npx cadence audit --list`                         |
| `audit`    | `--type <name>`   | `npx cadence audit --type <name>`                  |
| `create`   | (none)            | `npx cadence create --template <t> --name <n>`     |
| `add`      | `<sub> <item>`    | `npx cadence add <sub> <item>`                     |
| `knowledge`| `refresh|show`    | `npx cadence knowledge <action>`                   |
| `doctor`   | (none)            | `npx cadence doctor`                               |
| `upgrade`  | `--check|--apply` | `npx cadence upgrade <flag>`                       |
| `task`     | `<verb>`          | `npx cadence task <verb> <args>`                   |
| `workflow` | `list|describe|start` | `npx cadence workflow <action> <args>`         |

For `audit --type <name>`, **also read** the matching instruction file
into your context before executing the CLI:

```
auto/instructions/main/audit-<name>.md
```

### Step 3 — Report

Surface the CLI's stdout to the user verbatim, then layer your audit
judgments on top.

## Cadence task tags

Commits in this repo use `[{{SHORT_CODE}}-NNN]` task tags. The
`extensions.taskAdapter` field in `cadence.config.json` controls which
tracker the `task` verbs hit; with no adapter configured `task` exits
with an install hint.

## Bridge parity

This bridge mirrors `.claude/commands/cadence.md`. Both files are
generated from the same dispatch contract; when cadence ships a new
command, re-run `cadence init --bridge cursor` (idempotent) to refresh.

Both bridges coexist — agents in Cursor read this file; agents in
Claude Code read the Claude bridge; the underlying CLI surface is
identical.
