/**
 * Substrate — programmatic entry point.
 *
 * The CLI is the primary interface (see {@link ./cli.ts}). This module
 * re-exports the building blocks for users who want to invoke Substrate
 * commands programmatically (e.g. from a custom script or test).
 */

export { runInit } from "./commands/init.js";
export {
  runAuditExecute,
  runAuditList,
  runAuditTrend,
  runAuditType,
} from "./commands/audit.js";
export { runCreate } from "./commands/create.js";
export { runDoctor } from "./commands/doctor.js";
export { runKnowledgeRefresh, runKnowledgeShow } from "./commands/knowledge.js";
export { runUpgrade } from "./commands/upgrade.js";
export {
  loadRules,
  locateRulesFile,
  RulesLoadError,
  runAudit,
  writeAuditReport,
  renderMarkdownReport,
  readTrend,
} from "./audit/index.js";
export type {
  AuditExecuteOptions,
  AuditExecuteResult,
  AuditTrendOptions,
} from "./commands/audit.js";
export type {
  AuditReport,
  Detector,
  Finding,
  RuleDefinition,
  RuleResult,
  RulesYamlDocument,
  Severity,
} from "./audit/index.js";
export type {
  SubstrateConfig,
  SubstrateManifest,
  ManifestEntry,
} from "./util/types.js";
export { SUBSTRATE_VERSION } from "./util/version.js";
