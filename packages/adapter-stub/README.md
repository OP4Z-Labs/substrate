# @op4z/substrate-adapter-stub

Reference `TaskAdapter` for [substrate](../../README.md). Every method
logs the verb + the inputs it received to stderr (with the literal
prefix `[stub-adapter] would call`), then returns a deterministic
synthetic task.

Useful for:

- Proving the plugin contract works end-to-end without a real tracker
- Substrate's own integration tests (see `packages/substrate/tests/adapters.test.ts`)
- A copy-paste starting point for new adapter packages
  (Linear, Jira, GitHub Issues all follow this exact shape)

## Configure

```jsonc
// substrate.config.json
{
  "extensions": {
    "taskAdapter": "@op4z/substrate-adapter-stub"
  }
}
```

No environment variables needed; the stub doesn't touch the network.

## Usage

```bash
substrate task find STUB-1
# [stub-adapter] would call findTask({"id":"STUB-1"})
# { "id": "STUB-1", "title": "Synthetic task STUB-1", ... }

substrate task search anything --limit 3
# [stub-adapter] would call searchTasks({"query":"anything","limit":3})
# Returns 3 synthetic tasks
```

## Why duplicate the TaskAdapter interface inline?

The adapter is a *peer* of substrate (sibling workspace package), not a
downstream consumer. The stub's source file duplicates the
`TaskAdapter` interface inline so the package can build without
importing from substrate's build artifact. Type compatibility is
enforced by structural typing at runtime via substrate's
`isTaskAdapter()` guard.

All reference adapters (`@op4z/substrate-adapter-linear`,
`@op4z/substrate-adapter-jira`, `@op4z/substrate-adapter-github`) follow this exact
pattern.
