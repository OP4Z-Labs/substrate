# `trigger: schedule` — three invocation paths

Substrate workflows can declare a schedule trigger. The runtime is
deterministic: it tracks last-run timestamps + commit counters per
workflow and exposes them via `substrate scheduler --check`. The
runtime itself never invokes a workflow — the consumer environment
wires that piece, picking one of the three invocation paths below.

## Trigger schema

```yaml
trigger:
  - schedule:
      cron: "0 9 * * MON"           # standard 5-field cron
  - schedule:
      interval: "24h"               # Ns, Nm, Nh, Nd, Nw
  - schedule:
      every-n-commits: 5            # fire after N commits accumulated
```

Cron syntax supports `*`, comma lists, `a-b` ranges, step (`*/N`), and
day / month names (`MON`, `TUE`, … and `JAN`, `FEB`, …). Day-of-month
and day-of-week are OR-combined when both are non-`*` (POSIX cron's
historical quirk).

`interval:` follows the same parser as `composes_findings_of`'s
`require-fresh-within`. `every-n-commits` requires the consumer to
bump the counter on every commit; substrate ships a documented snippet
(see "Local mode" below).

## Path 1 — CI

GitHub Actions natively supports cron via `on.schedule`. Wire it like
so:

```yaml
# .github/workflows/substrate-schedule.yml
name: substrate schedule
on:
  schedule:
    - cron: "0 9 * * MON"
jobs:
  weekly-walk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx @op4z/substrate run weekly-proposal-walk
```

The substrate side records the run timestamp; subsequent
`substrate scheduler --check` invocations see the workflow as
recently run.

## Path 2 — Local scheduler

Invoke `substrate scheduler --check` from cron or systemd. The command
lists due workflows; pipe their ids into `substrate run`:

```bash
# crontab line — every 5 minutes
*/5 * * * *  cd /repo && substrate scheduler --check --due-only --json | jq -r '.due[].workflowId' | xargs -I{} substrate run {}
```

The runtime is non-invasive — `substrate scheduler --check` never
runs a workflow itself.

### `every-n-commits` setup

Add a `post-commit` git hook that bumps the counter:

```bash
# .git/hooks/post-commit
#!/usr/bin/env bash
substrate scheduler --check --quiet  # warms cache, optional
# bumping the counter is exposed programmatically:
node -e "require('@op4z/substrate').deterministic.bumpCommitCounter()"
```

## Path 3 — AI session

At any `substrate run` invocation, the orchestrator can be wired to
check the scheduler state file and prompt: "`weekly-proposal-walk`
hasn't run in 14 days — invoke now?" Pattern documented; integration
is the consumer's choice (e.g. a `pre-run` hook that calls
`checkSchedule` + prints a banner).

## State file

`substrate/scheduler/state.json`. Shape:

```json
{
  "version": 1,
  "workflows": {
    "weekly-proposal-walk": {
      "lastRunAt": "2026-05-15T09:00:00.000Z",
      "commitsSinceLastRun": 0
    }
  }
}
```

Safe to delete: substrate re-creates an empty state on next access.

## Reference workflow

`templates/workflows/weekly-proposal-walk.yaml` ships with substrate.
It fires every Monday at 09:00 UTC and walks the proposal queue with
`--batch-confirm`. Copy it (via `substrate add workflow …` when the
scaffolder is wired in B4, or by hand today) and tune the cron to
match your team's review cadence.
