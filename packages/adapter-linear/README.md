# @cadence/adapter-linear

Linear `TaskAdapter` implementation for [cadence](../../README.md).

## Install

```bash
npm install @cadence/adapter-linear
```

## Configure

```jsonc
// cadence.config.json
{
  "extensions": {
    "taskAdapter": "@cadence/adapter-linear"
  }
}
```

Set `LINEAR_API_KEY` in your environment. Generate one at
<https://linear.app/settings/api>.

```bash
export LINEAR_API_KEY=lin_api_xxx
```

## Usage

Once configured, the standard `cadence task` verbs route through Linear:

```bash
cadence task find ENG-123
cadence task search "auth refresh" --limit 10
cadence task create \
  --project ENG \
  --title "Fix login redirect race" \
  --description "Session cookie set before redirect; race in next/15." \
  --priority high \
  --type bug
cadence task update ENG-123 --status "In Progress"
cadence task complete ENG-123 --actual-hours 2.5
```

## Mapping

| Cadence field    | Linear field                                        |
| ---------------- | --------------------------------------------------- |
| `id`             | Identifier (`ENG-123`), not GUID                    |
| `title`          | `title`                                             |
| `description`    | `description` (markdown)                            |
| `status`         | Workflow state `name` (e.g. "In Progress")          |
| `priority`       | Priority label (`urgent`, `high`, `medium`, `low`)  |
| `type`           | First label matching `type:<name>` if any           |
| `category`       | Attached as `category:<value>` label                |
| `complexity`     | Attached as `complexity:<value>` label              |
| `estimatedHours` | `estimate` (Linear's "estimate" points field)       |
| `assignee`       | Email or display name of the assigned user          |
| `labels`         | All labels (excluding type:/category:/complexity:)  |
| `url`            | Issue's web URL                                     |

## Caveats

- **`project` is required for `createTask`** — pass the Linear team key
  (e.g. `ENG`). The adapter resolves it to a team ID at create time.
- **`actualHours` is not natively tracked** by Linear and will round-trip
  as `undefined`. Use the `estimate` field via `estimatedHours` for the
  forward-looking hour-budget signal cadence offers.
- **Label attachment on create is deferred to v1.0.** v0.8 creates issues
  with the title/description/priority/estimate set, but labels passed via
  `--labels`, `--type`, `--category`, `--complexity` are not yet attached.
  The issue returns from create without them; you can re-run an `update`
  to add labels.
- **`completeTask` looks up the first workflow state with type
  `completed`.** If your team has multiple completed states ("Done" and
  "Cancelled" are both type=completed) the adapter picks the first one
  returned by Linear's state API. Filter explicitly via `updateTask`
  with the named status if you need a specific completed state.

## Testing

Tests use `nock` to mock Linear's GraphQL API. No real network calls
are made; you do not need a `LINEAR_API_KEY` to run the test suite.
