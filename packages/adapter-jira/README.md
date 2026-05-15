# @cadence/adapter-jira

Jira `TaskAdapter` implementation for [cadence](../../README.md). Works
against both Jira Cloud (api.atlassian.com) and self-hosted Jira Server.

## Install

```bash
npm install @cadence/adapter-jira
```

## Configure

```jsonc
// cadence.config.json
{
  "extensions": {
    "taskAdapter": "@cadence/adapter-jira"
  }
}
```

Set the following environment variables:

```bash
export JIRA_HOST=your-org.atlassian.net     # no protocol
export JIRA_USERNAME=you@example.com         # email for Cloud, username for Server
export JIRA_API_TOKEN=xxx                    # Atlassian API token / password
# export JIRA_PROTOCOL=https                 # optional, defaults to "https"
```

Generate API tokens at <https://id.atlassian.com/manage-profile/security/api-tokens>.

## Usage

```bash
cadence task find PROJ-123
cadence task search "auth refresh" --limit 10
cadence task create \
  --project PROJ \
  --title "Fix login redirect race" \
  --description "Session cookie set before redirect; race in next/15." \
  --priority High \
  --type Bug
cadence task update PROJ-123 --status "In Progress"
cadence task complete PROJ-123
```

## Mapping

| Cadence field    | Jira field                                          |
| ---------------- | --------------------------------------------------- |
| `id`             | Issue key (`PROJ-123`), not numeric ID              |
| `title`          | `summary`                                           |
| `description`    | `description` (ADF on Cloud, plain on Server)       |
| `status`         | `status.name`                                       |
| `priority`       | `priority.name` (case-insensitive on input)         |
| `type`           | `issuetype.name`                                    |
| `category`       | `category:<value>` attached to `labels`             |
| `complexity`     | `complexity:<value>` attached to `labels`           |
| `estimatedHours` | `timetracking.originalEstimateSeconds / 3600`       |
| `actualHours`    | `timetracking.timeSpentSeconds / 3600` (read only)  |
| `assignee`       | `assignee.emailAddress` (Cloud) or `name` (Server)  |
| `labels`         | `labels` (string array)                             |
| `url`            | `https://<host>/browse/<key>`                       |

## Caveats

- **`actualHours` is read-only** in this adapter. Logging time spent
  on a Jira issue requires a separate worklog entry; the `--actual-hours`
  flag on `task complete` is currently a no-op. v1.0 should call
  `addWorklog`.
- **Status updates are workflow transitions, not field writes.** The
  adapter looks up available transitions for the issue and matches by
  name (case-insensitive). If your workflow's transition is named
  something exotic ("Mark As Awaiting Triage"), pass that exact string.
- **`completeTask`** picks the first transition matching `Done`,
  `Closed`, `Resolved`, or `Complete` (regex, case-insensitive). For
  finer control use `updateTask --status <NAME>`.
- **`description` is returned as JSON (stringified ADF) on Jira Cloud.**
  v0.8 punts on ADF → markdown rendering; v1.0 should add it.
- **Assignee updates assume Jira Server semantics (`{ name: ... }`).**
  Jira Cloud uses `{ accountId: ... }`. We don't auto-detect host kind
  in v0.8 — Cloud users may need to wrap `updateTask` to translate.

## Testing

Tests inject a `JiraClientLike` fake (no real HTTP). You do NOT need
Jira credentials to run the suite.
