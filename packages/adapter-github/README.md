# @op4z/substrate-adapter-github

GitHub Issues `TaskAdapter` for [substrate](../../README.md). Uses
Octokit + the GitHub REST API.

## Install

```bash
npm install @op4z/substrate-adapter-github
```

## Configure

```jsonc
// substrate.config.json
{
  "extensions": {
    "taskAdapter": "@op4z/substrate-adapter-github"
  }
}
```

Set the following environment variables:

```bash
export GITHUB_TOKEN=ghp_xxx        # fine-grained or classic PAT, repo + issues scope
export GITHUB_OWNER=acme           # default owner for numeric / un-prefixed task IDs
export GITHUB_REPO=api-server      # default repo for numeric / un-prefixed task IDs
```

## Usage

```bash
# Canonical ID form: owner/repo#number
substrate task find acme/api-server#42

# Numeric form works when GITHUB_OWNER + GITHUB_REPO are set
substrate task find 42

substrate task search "auth refresh" --limit 10
substrate task create \
  --project acme/api-server \
  --title "Fix login redirect race" \
  --description "Session cookie set before redirect; race in next/15." \
  --priority high \
  --type bug
substrate task update acme/api-server#42 --status "In Progress"
substrate task complete acme/api-server#42
```

## Mapping

| Substrate field    | GitHub field                                              |
| ---------------- | --------------------------------------------------------- |
| `id`             | `owner/repo#number` (e.g. `acme/api#42`)                  |
| `title`          | `title`                                                   |
| `description`    | `body`                                                    |
| `status`         | `state` (`open` or `closed`), refined by `state_reason`   |
| `priority`       | First label matching `priority:<...>`                     |
| `type`           | First label matching `type:<...>`                         |
| `category`       | Attached as `category:<value>` label                      |
| `complexity`     | Attached as `complexity:<value>` label                    |
| `assignee`       | First assignee's `login`                                  |
| `labels`         | All labels                                                |
| `estimatedHours` | Not natively tracked by GitHub Issues                     |
| `actualHours`    | Not natively tracked by GitHub Issues                     |
| `url`            | Issue's `html_url`                                        |

## Caveats

- **GitHub status is binary.** Issues are either `open` or `closed`.
  When closed, `state_reason` can be `completed`, `not_planned`, or
  `reopened` — the adapter promotes that into the `status` string
  (so closed-and-completed reports as `completed`, not just `closed`).
- **`updateTask --status`** maps `open`/`reopened` → `state: open`
  and `closed`/`completed`/`done`/`not_planned` → `state: closed`.
  Other status strings are silently ignored — there's nowhere for them
  to go in GitHub's data model.
- **`estimatedHours` and `actualHours` round-trip as `undefined`.**
  GitHub Issues have no native hour tracking. Use the `substrate task
  update --hours` only with adapters that support it (Linear, OP4Z).
- **Search defaults to repo-scoped** when `GITHUB_OWNER` + `GITHUB_REPO`
  are set. Without those env vars, the search hits all of GitHub —
  intentional, but rarely useful.
- **`updateTask --labels` replaces the full label set** (matching
  GitHub's PATCH /issues/{n} semantics). To add a single label,
  fetch first via `findTask`, append, then update.

## Testing

Tests inject an `OctokitLike` fake (no real HTTP). You do NOT need
a GitHub token to run the suite.
