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
