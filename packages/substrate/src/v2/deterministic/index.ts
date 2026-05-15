/**
 * Substrate v2 — deterministic layer barrel.
 *
 * Pure shell-invocable operations. No AI session required. Every
 * function here is safe to call from CI scripts, git hooks, or other
 * non-interactive contexts. Output is machine-parseable first
 * (`--json` everywhere a CLI command exposes one).
 *
 * Members of this layer never:
 *   - call an AI model
 *   - prompt the user via stdin
 *   - depend on a network resource
 *   - mutate state outside the consumer repo's working tree (and even
 *     then, only when the function name says "write" / "emit")
 *
 * The orchestration layer (in `../orchestrator/`) builds on top of
 * these primitives. Drift between layers (e.g. orchestrator
 * re-implementing rule execution) is a v2.0 design smell — see plan
 * §12 (Risks → R3).
 */

export { runValidate } from "./validate-command.js";
export type {
  ValidateOptions,
  ValidateResult,
  ValidateFileResult,
} from "./validate-command.js";

export {
  runQueryRules,
  runQueryStandards,
  runQueryMemory,
  runQueryDocChecks,
  runQuerySessions,
} from "./query-command.js";
export type {
  QueryRulesOptions,
  QueryRulesResult,
  QueryStandardsOptions,
  QueryStandardsResult,
  QueryMemoryOptions,
  QueryMemoryResult,
  QueryDocChecksOptions,
  QueryDocChecksResult,
  QuerySessionsOptions,
  QuerySessionsResult,
  QuerySessionsResultEntry,
} from "./query-command.js";

export { runHooksList, runHooksDescribe } from "./hooks-command.js";
export type {
  HooksListOptions,
  HooksListResult,
  HooksDescribeOptions,
  HooksDescribeResult,
} from "./hooks-command.js";

export {
  discoverHooks,
  findMatchingHooks,
  validateHookManifest,
} from "../hooks.js";
export type {
  HookDescriptor,
  HookDiscoveryOptions,
  HookDiscoveryResult,
  HookFiringContext,
  HookManifest,
  HookMatches,
  HookStep,
  HookStepType,
  HookTrigger,
  InvalidHookManifest,
} from "../hooks.js";

export {
  discoverDocChecks,
  findMatchingDocChecks,
  validateDocCheckManifest,
} from "../doc-checks.js";
export type {
  DocCheckDescriptor,
  DocCheckDiscoveryOptions,
  DocCheckDiscoveryResult,
  DocCheckManifest,
  DocCheckMatch,
  DocCheckRequire,
  DocCheckSeverity,
  InvalidDocCheckManifest,
} from "../doc-checks.js";

export { queryMemory, locateMemoryDir } from "../memory.js";
export type {
  MemoryEntry,
  MemoryQueryOptions,
  MemoryQueryResult,
  MemoryFrontmatter,
} from "../memory.js";

// Re-export pure modules so consumers don't need a separate import.
export { validateManifest, validateManifestFile } from "../validate.js";
export {
  discoverWorkflows,
  findWorkflowById,
  findWorkflowsByKind,
} from "../discoverer.js";
export { loadContext } from "../context-loader.js";

// Proposal pipeline (B3) — drift detection happens in the
// orchestrator layer, but classification, queue I/O, and applicators
// all live here. Single entry point: `runProposalPipeline`.
export {
  parseSessionLogFilename,
  runProposalPipeline,
} from "./proposals/pipeline.js";
export type {
  RunProposalPipelineOptions,
  RunProposalPipelineResult,
} from "./proposals/pipeline.js";
export {
  classifyDrifts,
} from "./proposals/classifier.js";
export type { ClassifyOptions } from "./proposals/classifier.js";
export {
  deferProposal,
  ensureQueueLayout,
  listByStatus,
  listPending,
  moveProposal,
  parsePendingFile,
  queueStats,
  renderPendingFile,
  resolveQueueLayout,
  updatePendingProposal,
  writePendingFile,
} from "./proposals/queue.js";
export type {
  ListByStatusOptions,
  MoveProposalOptions,
  MoveProposalResult,
  ParsedPendingFile,
  QueueLayout,
  QueueStats,
  UpdatePendingOptions,
  WritePendingFileOptions,
  WritePendingFileResult,
} from "./proposals/queue.js";
export { applyProposal } from "./proposals/applicators.js";
export type {
  ApplicatorOptions,
  ApplicatorResult,
} from "./proposals/applicators.js";
export { walkProposals } from "./proposals/review-command.js";
export type {
  WalkAction,
  WalkDecision,
  WalkProposalsOptions,
  WalkProposalsOutcome,
  WalkProposalsResult,
} from "./proposals/review-command.js";
export type {
  AddToAdrProposal,
  AddToDocCheckRegistryProposal,
  AddToMemoryProposal,
  AddToRuleProposal,
  AddToStandardsDocProposal,
  AddToWorkflowStepProposal,
  CrossLinkExistingProposal,
  Proposal,
  ProposalBase,
  ProposalConfidence,
  ProposalKind,
  ProposalStatus,
  StrengthenContextLoadProposal,
} from "./proposals/types.js";

// Scheduler (B3 / Primitive 8).
export {
  bumpCommitCounter,
  checkSchedule,
  clearSchedulerState,
  isScheduled,
  loadSchedulerState,
  recordWorkflowRun,
  saveSchedulerState,
} from "./scheduler.js";
export type {
  DueWorkflow,
  SchedulerCheckOptions,
  SchedulerCheckResult,
  SchedulerState,
  SchedulerWorkflowRecord,
} from "./scheduler.js";
export { runSchedulerCheck } from "./scheduler-command.js";
export type {
  SchedulerCommandOptions,
  SchedulerCommandResult,
} from "./scheduler-command.js";

// Comment-preserving YAML edit helpers (used by applicators; exposed
// so consumer-side tooling can reuse the same surgical-edit primitives).
export {
  YamlEditError,
  appendListItem,
  appendToMapKey,
  insertListItemAfter,
} from "./yaml-edit.js";
export type { YamlEditOptions } from "./yaml-edit.js";

// And the v1 deterministic primitives — explicit re-export so the
// surface is discoverable from one place.
export {
  loadRules,
  locateRulesFile,
  RulesLoadError,
  runAudit,
} from "../../audit/index.js";
