/**
 * Substrate v2 — orchestration layer barrel.
 *
 * AI-aware operations. Members of this layer:
 *   - load workflow context (delegated to the deterministic loader),
 *   - render prompts for the AI session,
 *   - dispatch step-by-step execution,
 *   - emit session-event telemetry (B3),
 *   - invoke cross-cutting hooks (B2).
 *
 * In B1, the only AI-step-aware dispatcher is `runV2Workflow`. It
 * fully runs `invoke-deterministic` and `run-tool` steps; AI-step
 * types (`prompt`, `prompt-and-action`, `invoke-sub-workflow`, etc.)
 * surface a deferred-feature message. The full multi-step engine
 * lands in B2 (memory + hook integration) and B3 (proposal pipeline).
 *
 * Drift between this layer and the deterministic layer is a design
 * smell — see plan §12 R3.
 */

export { runV2Workflow } from "./run-command.js";
export type {
  RunWorkflowOptions,
  RunWorkflowResult,
  RunStepResult,
} from "./run-command.js";

// Session event log (B3 Component A).
export {
  SessionEventWriter,
  computeManifestHash,
  indexSessionLogs,
  readSessionLog,
  resolveSessionLogPath,
  sanitiseEvent,
  TEXT_FIELD_MAX_CHARS,
} from "./session-log.js";
export type {
  AdhocStepEvent,
  ContextLoadedEvent,
  PromptIssuedEvent,
  ReadSessionLogResult,
  SessionEvent,
  SessionEventWriterOptions,
  SessionLogIndexEntry,
  SessionLogPaths,
  StepCompletionEvent,
  StepConfirmEvent,
  StepStartEvent,
  WorkflowCompletionEvent,
  WorkflowStartEvent,
} from "./session-log.js";

// Drift detectors (B3 Component B). Detectors are pure functions over
// session-event logs; the deterministic-layer proposal pipeline glues
// them to the classifier + queue.
export {
  REPEATED_PROMPT_THRESHOLD,
  detectAdhocSteps,
  detectContextGaps,
  detectOutOfOrder,
  detectRepeatedPrompts,
  detectRuleViolationRecurrence,
  detectSkippedSteps,
  runDriftDetectors,
} from "./drift-detectors.js";
export type {
  DriftDetectorRun,
  DriftFinding,
  DriftKind,
  DriftLoadedContext,
  RuleViolationRecord,
  RunDriftDetectorsOptions,
} from "./drift-detectors.js";

// Hook dispatch + handler registry.
export { dispatchHooks, registerHookHandler } from "./hook-dispatch.js";
export type {
  HookDispatchOptions,
  HookRunRecord,
  NoopHandler,
} from "./hook-dispatch.js";
