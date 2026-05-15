/**
 * Audit runtime — shared types.
 *
 * The runtime executes rules loaded from `cadence/RULES.yaml` (or whatever
 * path `cadence.config` points at) and produces a structured
 * {@link AuditReport}. Both the CLI (`cadence audit`) and the
 * programmatic API (`audit()`) return this shape.
 *
 * Design call: the runtime is detector-type-extensible but not
 * detector-type-promiscuous. v1.0 ships three concrete detectors:
 *
 *   - `ripgrep`   : pattern match against file contents
 *   - `script`    : invoke a JS / TS file in the consumer repo
 *   - `composite` : combine other rules with all / any / none operators
 *
 * Adding a fourth detector is a v1.x additive change — define a new
 * literal in {@link RuleDefinition.detector.type}, add a runner under
 * `src/audit/detectors/`, and wire it into `runDetector()`.
 */

export type Severity = "critical" | "high" | "medium" | "low";

export interface RipgrepDetector {
  type: "ripgrep";
  /** The regex pattern handed to ripgrep (or the JS fallback). */
  pattern: string;
  /**
   * Paths (repo-relative) to scan. Glob expansion happens inside the
   * detector — ripgrep handles globs natively, the JS fallback uses
   * `fast-glob`-equivalent semantics built on Node `readdir`.
   */
  paths?: string[];
  /** Repo-relative globs to skip. */
  exclude?: string[];
  /** Case sensitivity. Default false (rg's default is case-sensitive; we flip it to mirror most use cases). */
  caseSensitive?: boolean;
  /** Treat pattern as a fixed string, not a regex. */
  fixedString?: boolean;
  /**
   * Multi-line matching. Off by default (ripgrep's default). Turning on
   * is significantly more expensive on large trees so we surface it
   * explicitly per rule.
   */
  multiline?: boolean;
}

export interface ScriptDetector {
  type: "script";
  /**
   * Repo-relative path to the script (e.g. `cadence/detectors/no-large-files.js`).
   * The runtime imports the file in a Node worker thread with the sandbox
   * described in `docs/audit-runtime.md`. Must be `.js` or `.mjs` — TS files
   * must be compiled by the consumer first (cadence does not bundle a TS
   * runtime for sandboxed code).
   */
  path: string;
  /** Optional named export to call. Defaults to `default`. */
  export?: string;
  /**
   * Arbitrary options the rule author wants to pass to the script. Cadence
   * forwards this verbatim — the script defines its own schema.
   */
  options?: Record<string, unknown>;
  /** Override the 30s default timeout (ms). Capped at 5 minutes for safety. */
  timeoutMs?: number;
}

export interface CompositeDetector {
  type: "composite";
  /** Other rule IDs to combine. */
  rules: string[];
  /** Boolean operator: `all` fires when every sub-rule fires; `any` when any does; `none` when none does. */
  operator: "all" | "any" | "none";
}

export type Detector = RipgrepDetector | ScriptDetector | CompositeDetector;

export interface RuleDefinition {
  id: string;
  title: string;
  /** Repo-relative path to the standards doc that owns this rule. */
  doc?: string;
  severity: Severity;
  /** Free-text description displayed in reports. */
  description?: string;
  /**
   * Category buckets rules into report sections. Free-form by convention
   * (e.g. `"backend"`, `"frontend"`, `"security"`).
   */
  category?: string;
  /** The detector definition. Undefined when severity-only (manual review). */
  detector?: Detector;
  /**
   * Tags for filtering. The CLI's `--tag foo` flag matches against this list.
   */
  tags?: string[];
}

export interface RulesYamlMeta {
  version?: string;
  generated?: string;
  rule_count?: number;
  description?: string;
}

export interface RulesYamlDocument {
  meta?: RulesYamlMeta;
  rules: RuleDefinition[];
}

/**
 * A single finding emitted by a detector.
 *
 * `path` is repo-relative so reports survive movement between
 * checkouts. `line` is 1-indexed (matches what humans see in editors).
 */
export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  /** A snippet for the report. Capped to keep reports readable. */
  snippet?: string;
}

export interface RuleResult {
  ruleId: string;
  ruleTitle: string;
  severity: Severity;
  detectorType: Detector["type"] | "manual";
  /** Findings emitted by this rule (may be empty). */
  findings: Finding[];
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** True when the detector skipped (manual-only, no detector defined, missing dependency). */
  skipped: boolean;
  /** Skip reason or runtime error message. */
  note?: string;
}

export interface AuditReport {
  /** Schema version for the report JSON. */
  schemaVersion: 1;
  /** Cadence version that produced the report. */
  cadenceVersion: string;
  /** ISO 8601 timestamp. */
  generatedAt: string;
  /** Absolute repo root the audit ran against. */
  repoRoot: string;
  /** Path to the RULES.yaml file consumed. */
  rulesPath: string;
  /** Audit scope label (e.g. `"all"`, `"diff"`, `"<rule-id>"`). */
  scope: string;
  /** Total rule count discovered. */
  totalRules: number;
  /** Rules that were executed (after `--rule` / `--diff` filtering). */
  executedRules: number;
  /** Total findings across all rules. */
  totalFindings: number;
  /** Findings broken down by severity. */
  findingsBySeverity: Record<Severity, number>;
  /** Per-rule results. */
  rules: RuleResult[];
  /** Total wall-clock duration in ms. */
  durationMs: number;
}
