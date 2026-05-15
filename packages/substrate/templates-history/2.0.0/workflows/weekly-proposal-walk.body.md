# weekly-proposal-walk

Substrate's reinforcement loop runs weekly. This workflow walks the
proposal queue at `substrate/proposals/pending/` and applies the
high-confidence ones automatically. Everything else gets deferred so
a human can review it on the next walk (or via `substrate review
--proposals` interactively).

## Trigger

`schedule: { cron: "0 9 * * MON" }` — every Monday at 09:00 UTC. The
runtime evaluates the trigger on three paths:

- **CI**: GitHub Actions `schedule:` event pointed at this workflow.
- **Local**: `substrate scheduler --check` invoked from cron or
  systemd. The command lists due workflows; pipe into `substrate run`.
- **AI session**: at any `substrate run`, the runtime checks the
  scheduler state file and prompts when this workflow is overdue.

## Step

The single step shells out to `substrate review --proposals
--batch-confirm`. `--batch-confirm` is the contract: don't block on
input; auto-accept high-confidence proposals; defer the rest.

## What happens after

- Accepted proposals move to `substrate/proposals/applied/`. Each
  applicator wrote its file (workflow YAML edit, memory write, etc.)
  before the move.
- Deferred proposals stay in `substrate/proposals/pending/` with
  `status: deferred`. They re-surface in the next interactive walk.
- Failed accepts surface as `ok=false` outcomes; the proposal stays
  in pending so a human can investigate.

## Customisation

The cron expression is the obvious knob — change it to weekly /
biweekly / daily as your team's review cadence dictates. Beyond that,
the workflow is intentionally one step. If you need pre-walk gates
(e.g. "skip if it's a holiday"), add them as additional steps before
`walk` rather than wrapping the walk itself.
