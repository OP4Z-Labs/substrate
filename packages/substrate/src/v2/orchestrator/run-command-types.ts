/**
 * Shared types between `run-command.ts` and the step handlers.
 *
 * Lives in its own module to break the circular dep that would
 * otherwise form: `run-command` imports `step-handlers`, and
 * `invoke-sub-workflow`'s handler needs `runV2Workflow` from
 * `run-command`. The types live here so neither side imports the
 * other at module-init time.
 */

export interface RunStepResult {
  stepId: string;
  type: string;
  status: "ok" | "failed" | "deferred" | "skipped";
  message?: string;
  output?: string;
}
