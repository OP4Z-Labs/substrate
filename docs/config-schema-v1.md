# `cadence.config` schema — v1.0 (frozen)

> **Status:** Frozen at v1.0. Any change to this schema requires a
> major version bump (v2.0). Additive changes (new optional fields)
> can land in v1.x.

This document is the authoritative reference for `cadence.config.json`
(or `.yaml`).

## Location and format

```
<repo-root>/cadence.config.json
```

JSON is canonical. YAML is auto-detected if `cadence.config.yaml`
exists. TS support (`cadence.config.ts`) is on the v1.x roadmap.

## Schema

```ts
interface CadenceConfig {
  /** Optional JSON Schema URL pointer for editor support. */
  $schema?: string;
  /** Schema version. v1.0 = "1". */
  version: string;
  /** Project identity. */
  project: {
    /** Human-readable project name. */
    name: string;
    /** Optional short name for displays. */
    shortName?: string;
    /** Short code for task tags, e.g. "OP" → [OP-123]. 1-5 uppercase letters. */
    shortCode?: string;
    /** One-line description. */
    description?: string;
  };
  /** Detected/declared stacks: "python", "typescript", "go", "rust". */
  stacks: string[];
  /** Where the various code lives. Defaults shipped by `cadence init`. */
  paths: {
    backend?: string;
    frontend?: string;
    packagesTs?: string;
    packagesPython?: string;
    docs?: string;
    /** Path to the cadence auto/ tree. Required. Default "auto". */
    auto: string;
  };
  /** Default scaffolds for this project — what `cadence init` pre-enables. */
  defaults: {
    audits: string[];
    standards: string[];
    scaffolds: string[];
    workflows: string[];
  };
  /** AI-bridge configuration. */
  bridges: {
    claude?: { enabled: boolean; commandsDir?: string };
    cursor?: { enabled: boolean; commandsDir?: string };
    mcp?:    { enabled: boolean; commandsDir?: string };
  };
  /** Knowledge discovery (driven by `cadence knowledge refresh`). */
  knowledge?: {
    /** Files to parse for service / env discovery. Default: docker-compose.yml + .env.example */
    sources: string[];
    /** Substring matchers (case-insensitive) for env-var key redaction. */
    redactPatterns: string[];
  };
  /** Plugin extensions. Lazy-loaded at runtime via dynamic import(). */
  extensions?: {
    /** npm package implementing TaskAdapter, or null. */
    taskAdapter?: string | null;
    /** npm package implementing VcsAdapter, or null for built-in git. */
    vcsAdapter?: string | null;
  };
  /** Telemetry preference. */
  telemetry: {
    enabled: boolean;
  };
}
```

## Field-by-field

### `version`

Required. The cadence schema this config conforms to. v1.0 = "1".
Cadence reads `version` first; if it's a version cadence doesn't
recognize, the CLI exits with an actionable error.

### `project`

The single source of truth for project identity. `shortCode` is used
to generate task tags (e.g. `[OP-123]`). The Claude / Cursor / MCP
bridges substitute `{{PROJECT_NAME}}` and `{{SHORT_CODE}}` into
their scaffold output.

### `stacks`

What kind of code lives in this repo. Set by `cadence init` via
auto-detection of marker files (`pyproject.toml`, `package.json`,
`go.mod`, `Cargo.toml`). Manual override:

```json
"stacks": ["typescript", "python"]
```

Drives which audits and standards `cadence init` pre-enables.

### `paths`

Where things live. Only `auto` is required (defaults to `"auto"`).
The other paths are hints for tools and humans — they don't affect
core CLI behavior.

### `defaults`

The scaffolds, audits, standards, and workflows this project
expects to have. `cadence doctor` warns if a default isn't
scaffolded. `cadence init` writes these on first run.

### `bridges`

AI tool integrations. Multiple can be enabled simultaneously:

```json
"bridges": {
  "claude": { "enabled": true, "commandsDir": ".claude/commands" },
  "cursor": { "enabled": true, "commandsDir": ".cursor/commands" }
}
```

Each bridge's `commandsDir` is where its scaffold file lands. Defaults
match the upstream tool conventions.

### `knowledge`

`cadence knowledge refresh` walks the configured `sources` and
generates `auto/docs/KNOWLEDGE.md`. `redactPatterns` is a list of
substrings (case-insensitive) that mark env-var keys as sensitive —
their values get replaced with `***REDACTED***`.

### `extensions`

Plugin packages loaded at runtime:

- `taskAdapter`: e.g. `"@cadence/adapter-linear"` or `null` for no
  adapter. When null, `cadence task` exits with an install hint.
- `vcsAdapter`: e.g. a custom mercurial implementation, or `null`
  for the built-in git adapter.

Both are loaded via dynamic `import()` so their dependencies aren't
in cadence's install tree.

### `telemetry`

```json
"telemetry": { "enabled": false }
```

OFF by default. See [docs/telemetry-transparency.md](telemetry-transparency.md)
for what cadence collects when on, and how to toggle.

## Strict validation

```bash
cadence --strict <command>
```

When `--strict` is passed (where applicable), cadence rejects unknown
top-level fields in `cadence.config.*`. Without `--strict`, unknown
fields produce a warning but don't fail.

## Migration from v0.x

The v0.x → v1.0 schema is mostly identical. The exhaustive list of
changes (and which ones need a hand edit vs which cadence handles
automatically) lives in [docs/migration-from-0.x.md](migration-from-0.x.md).

## Example — minimal config

```json
{
  "$schema": "https://cadence.dev/schema/v1.json",
  "version": "1",
  "project": {
    "name": "my-app",
    "shortCode": "MA"
  },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": {
    "audits": ["pre-merge", "dependencies", "dead-code"],
    "standards": [],
    "scaffolds": [],
    "workflows": []
  },
  "bridges": {
    "claude": { "enabled": true }
  },
  "telemetry": { "enabled": false }
}
```

## Example — fully populated

```json
{
  "$schema": "https://cadence.dev/schema/v1.json",
  "version": "1",
  "project": {
    "name": "Acme Platform",
    "shortName": "Acme",
    "shortCode": "ACME",
    "description": "Internal platform monorepo"
  },
  "stacks": ["typescript", "python"],
  "paths": {
    "backend": "apps/backend",
    "frontend": "apps/web",
    "packagesTs": "packages/typescript",
    "packagesPython": "packages/python",
    "docs": "docs",
    "auto": "auto"
  },
  "defaults": {
    "audits": [
      "pre-merge", "dependencies", "dead-code",
      "backend", "frontend", "security"
    ],
    "standards": [
      "backend/architecture", "backend/api", "backend/security",
      "frontend/react", "frontend/data-management"
    ],
    "scaffolds": ["package-ts", "package-python"],
    "workflows": ["new-service"]
  },
  "bridges": {
    "claude": { "enabled": true },
    "cursor": { "enabled": true },
    "mcp":    { "enabled": false }
  },
  "knowledge": {
    "sources": ["docker-compose.yml", ".env.example"],
    "redactPatterns": ["KEY", "SECRET", "PASSWORD", "TOKEN"]
  },
  "extensions": {
    "taskAdapter": "@cadence/adapter-linear",
    "vcsAdapter": null
  },
  "telemetry": { "enabled": false }
}
```

## Stability commitment

- **Additive changes** (new optional fields, new enum values) ship in
  v1.x.
- **Renames** — never in v1.x.
- **Removals** — never in v1.x.
- **Required-field changes** — never in v1.x.

If we get the schema wrong, we live with it through v1.x and fix it
in v2. That's the deal a v1.0 schema makes.
