/**
 * Type definitions for the cadence v0.1 surface.
 *
 * Schema versions are tracked explicitly so that v0.5's three-way-merge
 * upgrade flow (plan §7) can detect format changes and migrate user
 * configs / manifests without guessing.
 */

/**
 * The root configuration scaffolded into the user's repo as
 * `cadence.config.json`. Mirrors the schema described in the plan §4.
 *
 * v0.1 intentionally omits several plan-§4 fields (knowledge sources,
 * extension adapters, bridge configuration beyond a flag) because the
 * features they configure don't ship in v0.1. They appear in the
 * scaffolded template as commented-out hints so users know they're
 * coming.
 */
export interface CadenceConfig {
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
    cursor?: { enabled: boolean };
  };
  /**
   * Knowledge-discovery configuration. Drives `cadence knowledge refresh`.
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
  telemetry: {
    enabled: boolean;
  };
}

/**
 * One row of the manifest at `auto/.cadence-manifest.json`.
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
 * yet beyond the directory shape). v0.3's `cadence add` will populate
 * entries per-item.
 */
export interface ManifestEntry {
  /** Repo-relative path to the scaffolded file. */
  path: string;
  /** Cadence template version that produced this file. */
  templateVersion: string;
  /** SHA-256 of the file content at scaffold time. */
  contentHash: string;
  /** True if the user explicitly opted out of future upgrades. */
  ejected: boolean;
}

export interface CadenceManifest {
  /** Manifest schema version, independent of cadence version. */
  schemaVersion: number;
  /** Cadence CLI version that created or last touched the manifest. */
  cadenceVersion: string;
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
