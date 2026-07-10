/**
 * Audit runner.
 *
 * Loads RULES.yaml, runs every rule (or a filtered subset), and produces
 * a structured {@link AuditReport}. Composite rules are evaluated last so
 * they can read the results of their referenced rules.
 *
 * The runner is asynchronous because script detectors run in worker
 * threads. Ripgrep detectors are synchronous internally but the runner's
 * public surface stays uniform.
 */

import { createHash } from "node:crypto";
import { isAbsolute, relative } from "node:path";
import { SUBSTRATE_VERSION } from "../util/version.js";
import { runCompositeDetector } from "./detectors/composite.js";
import { runRipgrepDetector } from "./detectors/ripgrep.js";
import { runScriptDetector } from "./detectors/script.js";
import type {
  AuditReport,
  Finding,
  RuleDefinition,
  RuleResult,
  RuleRunError,
  Severity,
} from "./types.js";

export interface RunAuditOptions {
  /** Absolute repo root. */
  repoRoot: string;
  /** Path to RULES.yaml that was loaded (recorded in the report). */
  rulesPath: string;
  /** Rules to run. Caller is responsible for any filtering (--rule, --diff). */
  rules: RuleDefinition[];
  /** Audit scope label (e.g. "all", "diff", "<rule-id>"). */
  scope: string;
  /**
   * Restrict ripgrep detectors to these paths only. Used by `--diff` so
   * the audit ignores files outside the staged-changes set.
   */
  pathFilter?: string[];
  /** Total rule count BEFORE filtering — used to populate the report. */
  totalRules?: number;
  /**
   * Content hash of the full effective ruleset (before `--rule`/`--diff`
   * filtering). The audit command computes this over the merged rule set so it
   * survives extends. Falls back to a hash of `rules` when not provided.
   */
  rulesetHash?: string;
}

/**
 * Run a list of rules against a repository and return the structured report.
 */
export async function runAudit(options: RunAuditOptions): Promise<AuditReport> {
  const start = Date.now();
  const results: RuleResult[] = [];
  const subResultMap = new Map<string, RuleResult>();

  // Phase 1: run all non-composite rules first.
  const composites: RuleDefinition[] = [];
  for (const rule of options.rules) {
    if (rule.detector?.type === "composite") {
      composites.push(rule);
      continue;
    }
    const r = await runSingleRule(rule, options);
    results.push(r);
    subResultMap.set(rule.id, r);
  }

  // Phase 2: composites can now read the sub-results.
  for (const rule of composites) {
    const r = await runSingleRule(rule, options, subResultMap);
    results.push(r);
    subResultMap.set(rule.id, r);
  }

  // Order results by rule id for stable output.
  results.sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  const durationMs = Date.now() - start;
  const findingsBySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  let totalFindings = 0;
  let firedRules = 0;
  const errors: RuleRunError[] = [];
  for (const r of results) {
    for (const f of r.findings) {
      findingsBySeverity[f.severity] += 1;
      totalFindings += 1;
    }
    if (r.error) {
      errors.push({
        ruleId: r.ruleId,
        severity: r.severity,
        detectorType: r.detectorType,
        message: r.error,
      });
    } else if (!r.skipped) {
      // Fired = ran a detector to completion. Excludes manual/no-detector
      // (skipped) and errored rules (skipped with an error), so it is the
      // honest count of the registry that is actually live.
      firedRules += 1;
    }
  }

  return {
    schemaVersion: 1,
    substrateVersion: SUBSTRATE_VERSION,
    generatedAt: new Date().toISOString(),
    repoRoot: options.repoRoot,
    rulesPath: options.rulesPath,
    scope: options.scope,
    totalRules: options.totalRules ?? options.rules.length,
    executedRules: options.rules.length,
    firedRules,
    rulesetHash: options.rulesetHash ?? hashRuleset(options.rules),
    totalFindings,
    findingsBySeverity,
    rules: results,
    errors,
    durationMs,
  };
}

/**
 * The registry file, as a repo-relative glob to exclude from every scan
 * (OP-2085). A rule with `match_count: 0` whose `pattern:` string appears in
 * RULES.yaml would otherwise match its own definition and flag the registry.
 * Returns [] when the rules path is the synthetic `<extends:…>` marker (no
 * on-disk file) or resolves outside the repo.
 */
function registryExcludes(options: RunAuditOptions): string[] {
  const p = options.rulesPath;
  if (!p || p.startsWith("<")) return [];
  const abs = isAbsolute(p) ? p : `${options.repoRoot}/${p}`;
  const rel = relative(options.repoRoot, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return [];
  return [rel.split("\\").join("/")];
}

/**
 * A stable short content hash of a rule set. Keyed on each rule's identity and
 * detection config (id, severity, detector), sorted by id so array order does
 * not perturb it. Used to detect that the ruleset changed between two trend
 * entries — not a security digest, so a truncated sha256 is fine.
 */
export function hashRuleset(rules: RuleDefinition[]): string {
  const normalized = rules
    .map((r) => ({ id: r.id, severity: r.severity, detector: r.detector ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 12);
}

async function runSingleRule(
  rule: RuleDefinition,
  options: RunAuditOptions,
  subResults?: Map<string, RuleResult>,
): Promise<RuleResult> {
  const start = Date.now();
  const detectorType = (rule.detector?.type ?? rule.declaredManualType ?? "manual") as RuleResult["detectorType"];
  if (!rule.detector) {
    // Three distinct no-detector cases, reported distinctly (RC8):
    //   shell  — declared a type this runtime cannot run (latent break)
    //   manual — declared type: manual (intentional review)
    //   (none) — no detector block at all (intentional review)
    const note =
      rule.declaredManualType === "shell"
        ? "declared type 'shell' is not executable in this runtime — migrate to 'script'"
        : rule.declaredManualType === "manual"
          ? "manual review — declared type: manual"
          : "manual review — no detector configured";
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      severity: rule.severity,
      detectorType,
      findings: [],
      durationMs: Date.now() - start,
      skipped: true,
      note,
    };
  }
  try {
    if (rule.detector.type === "ripgrep") {
      const { findings, unmatched } = runRipgrepDetector(rule.detector, {
        repoRoot: options.repoRoot,
        ruleId: rule.id,
        severity: rule.severity,
        pathFilter: options.pathFilter,
        alwaysExclude: registryExcludes(options),
      });
      return {
        ruleId: rule.id,
        ruleTitle: rule.title,
        severity: rule.severity,
        detectorType,
        findings,
        durationMs: Date.now() - start,
        skipped: false,
        ...(unmatched.length > 0 ? { unmatchedPaths: unmatched } : {}),
      };
    }
    if (rule.detector.type === "script") {
      const findings = await runScriptDetector(rule.detector, {
        repoRoot: options.repoRoot,
        ruleId: rule.id,
        severity: rule.severity,
      });
      return {
        ruleId: rule.id,
        ruleTitle: rule.title,
        severity: rule.severity,
        detectorType,
        findings,
        durationMs: Date.now() - start,
        skipped: false,
      };
    }
    if (rule.detector.type === "composite") {
      const map = subResults ?? new Map<string, RuleResult>();
      const { findings, note } = runCompositeDetector(rule.detector, {
        ruleId: rule.id,
        ruleTitle: rule.title,
        severity: rule.severity,
        subResults: map,
      });
      return {
        ruleId: rule.id,
        ruleTitle: rule.title,
        severity: rule.severity,
        detectorType,
        findings,
        durationMs: Date.now() - start,
        skipped: false,
        note,
      };
    }
    // Unknown detector type — should have been caught at load time.
    return errorResult(rule, start, `unknown detector type`);
  } catch (err) {
    return errorResult(rule, start, (err as Error).message);
  }
}

/**
 * A detector that threw. `error` is set (not just `note`) so the failure is
 * machine-visible and gets hoisted into {@link AuditReport.errors}: a rule that
 * could not run must never be reported as `skipped` clean. `skipped` stays true
 * so legacy consumers keying on it still exclude the rule from the "ran clean"
 * set, but `error` is the load-bearing signal.
 */
function errorResult(rule: RuleDefinition, start: number, note: string): RuleResult {
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    severity: rule.severity,
    detectorType: (rule.detector?.type ?? "manual") as RuleResult["detectorType"],
    findings: [] as Finding[],
    durationMs: Date.now() - start,
    skipped: true,
    error: note,
    note: `detector error: ${note}`,
  };
}
