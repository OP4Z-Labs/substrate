/**
 * Type definitions for the substrate v0.1 surface.
 *
 * Schema versions are tracked explicitly so that v0.5's three-way-merge
 * upgrade flow (plan §7) can detect format changes and migrate user
 * configs / manifests without guessing.
 */

/**
 * The root configuration scaffolded into the user's repo as
 * `substrate.config.json`. Mirrors the schema described in the plan §4.
 *
 * v0.1 intentionally omits several plan-§4 fields (knowledge sources,
 * extension adapters, bridge configuration beyond a flag) because the
 * features they configure don't ship in v0.1. They appear in the
 * scaffolded template as commented-out hints so users know they're
 * coming.
 */
export interface SubstrateConfig {
  $schema?: string;
  version: string;
  project: {
    name: string;
    shortName?: string;
    shortCode?: string;
    description?: string;
  };
  stacks: string[];
  paths: {
    backend?: string;
    frontend?: string;
    packagesTs?: string;
    packagesPython?: string;
    docs?: string;
    auto: string;
  };
  defaults: {
    audits: string[];
    standards: string[];
    scaffolds: string[];
    workflows: string[];
  };
  bridges: {
    claude?: { enabled: boolean; commandsDir?: string };
    /**
     * v0.5: Cursor bridge support. `commandsDir` mirrors the Claude
     * convention (default `.cursor/commands`). Both bridges can be
     * enabled simultaneously — they read the same dispatch table.
     */
    cursor?: { enabled: boolean; commandsDir?: string };
    /**
     * v0.8: MCP bridge support. Unlike Claude/Cursor (which scaffold a
     * slash-command markdown file the editor reads at startup), the MCP
     * bridge scaffolds a JSON server-registration snippet at
     * `.substrate/mcp/substrate-server.json` that the user copies into their
     * MCP host's config (e.g. Claude Desktop's
     * `claude_desktop_config.json`). Substrate itself runs as the MCP
     * server via `substrate mcp serve` (stdio transport).
     */
    mcp?: { enabled: boolean; commandsDir?: string };
  };
  /**
   * Knowledge-discovery configuration. Drives `substrate knowledge refresh`.
   *
   * - `sources`: files at repo root that the discovery walker parses. Today
   *   `docker-compose.yml` (services / ports / volumes) and `.env.example`
   *   (env-var surface, redacted).
   * - `redactPatterns`: substring matchers (case-insensitive). Any env-var
   *   whose key contains one is replaced with `***REDACTED***` in the
   *   generated `auto/docs/KNOWLEDGE.md`.
   *
   * Added in v0.3; older configs without this field are tolerated by
   * `knowledge refresh` (it falls back to these same defaults).
   */
  knowledge?: {
    sources: string[];
    redactPatterns: string[];
  };
  /**
   * Plugin extension points (added in v0.5).
   *
   * - `taskAdapter`: npm package name implementing the TaskAdapter
   *   contract, or null for "no adapter configured". When null, the
   *   `substrate task` family exits non-zero with an install hint.
   * - `vcsAdapter`: npm package name implementing the VcsAdapter
   *   contract, or null for "use the built-in git adapter".
   *
   * Both are loaded lazily at runtime via dynamic `import()` so the
   * adapter package's dependencies aren't pulled into substrate's
   * install footprint.
   */
  extensions?: {
    taskAdapter?: string | null;
    vcsAdapter?: string | null;
  };
  /**
   * Memory subsystem configuration (added in v2.0.0).
   *
   * - `path`: explicit memory directory location. When unset, the loader
   *   falls back to `$SUBSTRATE_MEMORY_PATH` then to Claude Code's
   *   default at `~/.claude/projects/<encoded>/memory/`.
   * - `ignore`: additional filenames to skip when walking the memory
   *   dir. Defaults already cover `MEMORY.md`, `README.md`, `INDEX.md`
   *   (Claude Code's index / readme conventions). Add entries here for
   *   any per-repo index files you keep alongside memories.
   *
   * Both fields are optional — substrate's defaults work for the
   * standard Claude Code memory layout out of the box.
   */
  memory?: {
    path?: string;
    ignore?: string[];
  };
  /**
   * Org-scoped content composition (added in v3.0; NE-11).
   *
   * Each entry declares an upstream "substrate-content" source whose
   * `substrate/` tree is merged into the consumer's effective registry
   * of workflows, hooks, doc-checks, standards, and RULES.yaml rows.
   *
   * Three source kinds (see `ExtendsSource.source`):
   *   - `npm:<pkg-name>`     resolved via the consumer's `node_modules`.
   *   - `github:<org>/<repo>` cloned into `substrate/.cache/extends/`.
   *   - `file:<relative-path>` read live from a local directory.
   *
   * Ordering semantics (like ESLint's `extends`): entries earlier in
   * the array are the conceptual base; later entries override earlier;
   * the repo's own `substrate/` overrides all. Same-id workflows /
   * hooks / doc-checks collide with "repo-local wins"; standards docs
   * collide on relative path with "repo-local wins"; RULES.yaml rows
   * collide on rule id with "repo-local wins". See plan §2 for the
   * full collision matrix.
   *
   * Air-gap: when `SUBSTRATE_OFFLINE=1`, the resolver refuses to clone
   * `github:` sources and surfaces a discrete error so adopters can
   * mirror via `file:` or a private npm registry.
   */
  extends?: ExtendsSource[];
  telemetry: {
    enabled: boolean;
  };
}

/**
 * One entry in `SubstrateConfig.extends`.
 *
 * `source` carries the kind + identity in one URL-like string so configs
 * stay compact. `version` is only honored for `npm:` sources, `ref` is
 * only honored for `github:` sources; both are passed through unchanged
 * for forward-compat (a future v3.1 may add subpath / integrity fields).
 */
export interface ExtendsSource {
  /** "npm:<pkg>" | "github:<org>/<repo>" | "file:<relative-path>". */
  source: string;
  /** Optional npm semver range (npm: sources only). */
  version?: string;
  /** Optional git ref — tag, branch, or commit SHA (github: sources only). */
  ref?: string;
}

/**
 * One row of the manifest at `auto/.substrate-manifest.json`.
 *
 * `templateVersion` and `contentHash` are the two anchors that the
 * v0.5 upgrade flow uses to decide between auto-upgrade and three-way
 * merge:
 *
 * - If the current on-disk hash equals `contentHash`, the file is
 *   unmodified and can be auto-upgraded.
 * - If it differs, the user has edited; offer a three-way merge using
 *   `templateVersion` to fetch the original.
 * - If `ejected: true`, skip entirely — user opted out of upgrades.
 *
 * v0.1 writes empty entries on `init` (no scaffolded content is tracked
 * yet beyond the directory shape). v0.3's `substrate add` will populate
 * entries per-item.
 */
export interface ManifestEntry {
  /** Repo-relative path to the scaffolded file. */
  path: string;
  /** Substrate template version that produced this file. */
  templateVersion: string;
  /** SHA-256 of the file content at scaffold time. */
  contentHash: string;
  /** True if the user explicitly opted out of future upgrades. */
  ejected: boolean;
}

export interface SubstrateManifest {
  /** Manifest schema version, independent of substrate version. */
  schemaVersion: number;
  /** Substrate CLI version that created or last touched the manifest. */
  substrateVersion: string;
  entries: ManifestEntry[];
}

/**
 * Front matter parsed from an audit instruction file.
 * The runtime (v0.3) will consume this; v0.1 only reads `command`
 * and `action` for the `--list` and `--type` views.
 */
export interface AuditFrontMatter {
  command?: string;
  action?: string;
  schema_version?: number;
  title?: string;
  description?: string;
}
