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

// And the v1 deterministic primitives — explicit re-export so the
// surface is discoverable from one place.
export {
  loadRules,
  locateRulesFile,
  RulesLoadError,
  runAudit,
} from "../../audit/index.js";
