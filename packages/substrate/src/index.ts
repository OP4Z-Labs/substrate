/**
 * Substrate — programmatic entry point.
 *
 * The CLI is the primary interface (see {@link ./cli.ts}). This module
 * re-exports the building blocks for users who want to invoke Substrate
 * commands programmatically (e.g. from a custom script or test).
 *
 * v2 layer split
 * --------------
 * From v2.0 onwards the surface is split into two namespaces so
 * consumers can be explicit about which layer they depend on:
 *
 *   - `deterministic`  — pure shell-invocable operations. No AI calls,
 *                        no network, machine-output friendly. Stable
 *                        contract: changes follow semver.
 *   - `orchestrator`   — AI-aware orchestration. Loads context,
 *                        renders prompts, dispatches steps. Requires
 *                        an AI session to run AI-step types (B2/B3).
 *
 * v1.0's flat exports stay for backwards compatibility. New code is
 * encouraged to use the namespaced API; the flat exports may be
 * deprecated (but not removed) in v3.
 *
 * See `docs/architecture.md` for the full two-layer model.
 */

// --- Layer namespaces (v2; preferred) --------------------------------------
import * as deterministicLayer from "./v2/deterministic/index.js";
import * as orchestratorLayer from "./v2/orchestrator/index.js";

export const deterministic = deterministicLayer;
export const orchestrator = orchestratorLayer;

// --- v2 building blocks (re-exported flat for convenience) -----------------
export {
  validateManifest,
  validateManifestFile,
} from "./v2/validate.js";
export type {
  ValidationError,
  ValidationResult,
} from "./v2/validate.js";
export {
  discoverWorkflows,
  findWorkflowById,
  findWorkflowsByKind,
} from "./v2/discoverer.js";
export type {
  DiscoveryOptions,
  DiscoveryResult,
  InvalidManifest,
} from "./v2/discoverer.js";
export { loadContext } from "./v2/context-loader.js";
export type {
  KnowledgeBlock,
  LoadContextOptions,
  LoadedMemory,
  LoadedStandard,
  ResolvedContext,
  WorkingTreeState,
} from "./v2/context-loader.js";
export type {
  Acceptance,
  ComposedFinding,
  ContextClause,
  Followup,
  MemoryContext,
  MemoryType,
  SchemaVersion,
  ScheduleTrigger,
  SimpleTrigger,
  StepType,
  Trigger,
  WhenClause,
  WorkflowDescriptor,
  WorkflowKind,
  WorkflowManifest,
  WorkflowStep,
} from "./v2/types.js";

// --- v1.0 flat exports (backwards compatibility) ---------------------------
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
