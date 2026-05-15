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

import { CADENCE_VERSION } from "../util/version.js";
import { runCompositeDetector } from "./detectors/composite.js";
import { runRipgrepDetector } from "./detectors/ripgrep.js";
import { runScriptDetector } from "./detectors/script.js";
import type {
  AuditReport,
  Finding,
  RuleDefinition,
  RuleResult,
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
  for (const r of results) {
    for (const f of r.findings) {
      findingsBySeverity[f.severity] += 1;
      totalFindings += 1;
    }
  }

  return {
    schemaVersion: 1,
    cadenceVersion: CADENCE_VERSION,
    generatedAt: new Date().toISOString(),
    repoRoot: options.repoRoot,
    rulesPath: options.rulesPath,
    scope: options.scope,
    totalRules: options.totalRules ?? options.rules.length,
    executedRules: options.rules.length,
    totalFindings,
    findingsBySeverity,
    rules: results,
    durationMs,
  };
}

async function runSingleRule(
  rule: RuleDefinition,
  options: RunAuditOptions,
  subResults?: Map<string, RuleResult>,
): Promise<RuleResult> {
  const start = Date.now();
  const detectorType = (rule.detector?.type ?? "manual") as RuleResult["detectorType"];
  if (!rule.detector) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      severity: rule.severity,
      detectorType,
      findings: [],
      durationMs: Date.now() - start,
      skipped: true,
      note: "manual review — no detector configured",
    };
  }
  try {
    if (rule.detector.type === "ripgrep") {
      const findings = runRipgrepDetector(rule.detector, {
        repoRoot: options.repoRoot,
        ruleId: rule.id,
        severity: rule.severity,
        pathFilter: options.pathFilter,
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

function errorResult(rule: RuleDefinition, start: number, note: string): RuleResult {
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    severity: rule.severity,
    detectorType: (rule.detector?.type ?? "manual") as RuleResult["detectorType"],
    findings: [] as Finding[],
    durationMs: Date.now() - start,
    skipped: true,
    note: `detector error: ${note}`,
  };
}
