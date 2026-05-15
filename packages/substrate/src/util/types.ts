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
  telemetry: {
    enabled: boolean;
  };
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
