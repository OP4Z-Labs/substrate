# Cadence compatibility matrix

> **Last updated:** v1.0 release. Bump per minor version when support
> changes.

## Node.js

| Version | Status     | Notes                                          |
| ------- | ---------- | ---------------------------------------------- |
| 20.x    | Supported  | LTS. Cadence's minimum.                        |
| 22.x    | Supported  | Recommended. CI runs on this.                  |
| 24.x    | Supported  | Latest. CI runs on this.                       |
| <20     | Not supported | TypeScript build target requires ES2022 + modern Node. |

`cadence doctor` reports your Node version and warns if you're on the
minimum (20) rather than a current version.

## Operating systems

| OS              | Status        | Notes                                         |
| --------------- | ------------- | --------------------------------------------- |
| Linux (x86_64)  | Supported     | Primary CI target.                            |
| Linux (arm64)   | Supported     | Tested on Graviton-class hosts.               |
| macOS (Intel)   | Supported     |                                               |
| macOS (Apple Si)| Supported     | Apple Silicon = arm64.                        |
| Windows (WSL2)  | Supported     | Use WSL2; native Windows is not in v1.0.      |
| Windows native  | Deferred      | v1.1+ — most paths work but untested at v1.0. |

The reason for the WSL-only Windows stance: a handful of paths in
cadence assume POSIX-style behavior (signal handling in
`worker_threads`, atomic-write tmp file naming). They probably work on
native Windows but we haven't fully tested.

## Optional tooling

| Tool       | When needed                  | Doctor checks |
| ---------- | ---------------------------- | ------------- |
| ripgrep    | Faster ripgrep detectors     | yes           |
| git        | `audit --diff`, VCS adapter  | yes           |
| Docker     | Optional integration tests   | no            |
| Python 3.12+ | Only the Python adapter pkg | no            |

When ripgrep is absent, cadence falls back to a Node-only regex scan.
Functionally equivalent; just slower on large trees.

## CI matrix (cadence repo)

```yaml
strategy:
  matrix:
    node: ["20", "22", "24"]
    os: ["ubuntu-latest", "macos-latest"]
```

Windows-native CI is intentionally absent. Users on Windows are
expected to use WSL2.

## What `cadence doctor` reports

Run `cadence doctor` to verify your environment. Sample output:

```
✓ tooling.node       Running on v22.18.0 (linux/x64).
✓ tooling.ripgrep    Available on PATH — audit ripgrep detectors will use the fast path.
✓ tooling.git        Available on PATH.
```

Or `cadence doctor --json` for CI integration.
