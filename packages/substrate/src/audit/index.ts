/**
 * Audit subsystem — public surface.
 *
 * The `runAudit` function is the high-level entry point. It orchestrates
 * loading RULES.yaml, filtering rules, running detectors, and writing
 * reports. CLI and programmatic callers both go through here.
 */

export { loadRules, locateRulesFile, RulesLoadError } from "./rules.js";
export type { LoadRulesOptions, LoadRulesResult } from "./rules.js";
export { runAudit } from "./runner.js";
export type { RunAuditOptions } from "./runner.js";
export { writeAuditReport, renderMarkdownReport } from "./report.js";
export type { WriteReportOptions, WriteReportResult } from "./report.js";
export { listDiffPaths } from "./diff-paths.js";
export { readTrend } from "./trend.js";
export type { TrendEntry, TrendSummary } from "./trend.js";
export {
  applyEscalations,
  buildFirstSeenIndex,
  computeEffectiveSeverity,
  fingerprintFinding,
  readHistoricalSidecars,
} from "./escalation.js";
export type {
  ApplyEscalationsOptions,
  HistoricalSidecar,
} from "./escalation.js";
export type {
  AuditReport,
  CompositeDetector,
  Detector,
  EscalationStep,
  Finding,
  RipgrepDetector,
  RuleDefinition,
  RuleResult,
  RulesYamlDocument,
  ScriptDetector,
  Severity,
} from "./types.js";
