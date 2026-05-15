/**
 * `substrate run <workflow>` — orchestration-layer command.
 *
 * Layer: AI-aware orchestration. Loads context, renders the prompt
 * (in later phases), and dispatches steps. In B1, the runtime
 * supports `invoke-deterministic` steps end-to-end (they shell out
 * to deterministic primitives) and surfaces a clear
 * deferred-feature message for AI-step types (`prompt`,
 * `prompt-and-action`, etc.). The full multi-step AI engine lands
 * in B2/B3.
 *
 * Returned exit codes (delegated to the CLI):
 *   0 — workflow completed all runnable steps successfully.
 *   1 — a step failed at runtime.
 *   2 — workflow not found, manifest invalid, or unsupported step
 *       type encountered without `--dry-run`.
 */

import { spawnSync } from "node:child_process";
import kleur from "kleur";
import { discoverWorkflows, type DiscoveryResult } from "../discoverer.js";
import { loadContext } from "../context-loader.js";
import { resolveTargetRoot } from "../../util/paths.js";
import type { WorkflowDescriptor, WorkflowStep } from "../types.js";

export interface RunWorkflowOptions {
  workflowId: string;
  cwd?: string;
  /** Variables pre-filled by the user (e.g. `--var key=value`). Reserved for B2. */
  vars?: Record<string, string>;
  json?: boolean;
  quiet?: boolean;
  dryRun?: boolean;
}

export interface RunStepResult {
  stepId: string;
  type: string;
  status: "ok" | "failed" | "deferred" | "skipped";
  message?: string;
  /** Captured stdout for `invoke-deterministic` steps when feasible. */
  output?: string;
}

export interface RunWorkflowResult {
  workflowId: string;
  ok: boolean;
  exitCode: 0 | 1 | 2;
  steps: RunStepResult[];
  /** Resolved context summary (counts of standards/memory/rules loaded). */
  contextSummary: {
    standardsLoaded: number;
    memoriesLoaded: number;
    rulesMatched: number;
  };
}

export async function runV2Workflow(
  options: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
  const cwd = resolveTargetRoot(options.cwd);
  const discovery = discoverWorkflows({ cwd });

  const workflow = findWorkflow(discovery, options.workflowId);
  if (!workflow) {
    return emitFatal(options, {
      workflowId: options.workflowId,
      ok: false,
      exitCode: 2,
      steps: [],
      contextSummary: { standardsLoaded: 0, memoriesLoaded: 0, rulesMatched: 0 },
    }, `Workflow "${options.workflowId}" not found in substrate/workflows/. ` +
        `Discovered: ${discovery.workflows.map((w) => w.manifest.id).join(", ") || "(none)"}`);
  }

  const context = loadContext({ workflow: workflow.manifest, cwd });
  const contextSummary = {
    standardsLoaded: context.standards.length,
    memoriesLoaded: context.memories.length,
    rulesMatched: context.rules.length,
  };

  if (!options.quiet && !options.json) {
    console.log(kleur.bold(`\nRunning v2 workflow: ${workflow.manifest.id}`));
    if (workflow.manifest.description) {
      console.log(kleur.dim(`  ${workflow.manifest.description}`));
    }
    console.log(
      kleur.dim(
        `  context: standards=${contextSummary.standardsLoaded} ` +
          `memories=${contextSummary.memoriesLoaded} ` +
          `rules=${contextSummary.rulesMatched}`,
      ),
    );
    if (options.dryRun) {
      console.log(kleur.yellow("  (dry-run; steps will not execute)"));
    }
    console.log();
  }

  const steps = workflow.manifest.steps ?? [];
  const stepResults: RunStepResult[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const label = `Step ${i + 1}/${steps.length}: ${step.name ?? step.id}`;
    if (!options.quiet && !options.json) {
      console.log(kleur.bold(label) + kleur.dim(`  [${step.type}]`));
    }

    if (options.dryRun) {
      stepResults.push({
        stepId: step.id,
        type: step.type,
        status: "skipped",
        message: "dry-run",
      });
      if (!options.quiet && !options.json) {
        console.log(kleur.dim("  (dry-run; skipped)\n"));
      }
      continue;
    }

    const result = await runStep(step, cwd);
    stepResults.push(result);

    if (!options.quiet && !options.json) {
      switch (result.status) {
        case "ok":
          console.log(kleur.green("  ✓ done") + (result.message ? kleur.dim(` — ${result.message}`) : "") + "\n");
          break;
        case "failed":
          console.log(kleur.red(`  ✗ failed — ${result.message ?? "unknown error"}\n`));
          break;
        case "deferred":
          console.log(kleur.yellow(`  ↷ deferred — ${result.message}\n`));
          break;
        case "skipped":
          console.log(kleur.dim(`  ↷ skipped — ${result.message ?? ""}\n`));
          break;
      }
    }

    if (result.status === "failed") {
      exitCode = 1;
      break;
    }
    if (result.status === "deferred") {
      // Any prompt-style step requires the B2 step engine. We surface
      // the deferred message and halt so the user knows where execution
      // stopped, exiting with code 2 to distinguish from clean success
      // and runtime failure.
      exitCode = 2;
      break;
    }
  }

  const ok = exitCode === 0;
  const summary: RunWorkflowResult = {
    workflowId: workflow.manifest.id,
    ok,
    exitCode,
    steps: stepResults,
    contextSummary,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else if (!options.quiet) {
    if (ok) {
      console.log(kleur.green(`✓ workflow ${summary.workflowId} completed.`));
    } else if (exitCode === 1) {
      console.log(kleur.red(`✗ workflow ${summary.workflowId} failed.`));
    } else {
      console.log(
        kleur.yellow(`↷ workflow ${summary.workflowId} halted (deferred step).`),
      );
      console.log(
        kleur.dim(
          "  AI-step orchestration (prompt / prompt-and-action / invoke-sub-workflow) lands in B2.",
        ),
      );
    }
  }

  return summary;
}

function findWorkflow(
  discovery: DiscoveryResult,
  id: string,
): WorkflowDescriptor | null {
  return discovery.workflows.find((w) => w.manifest.id === id) ?? null;
}

async function runStep(step: WorkflowStep, cwd: string): Promise<RunStepResult> {
  switch (step.type) {
    case "invoke-deterministic":
    case "run-tool":
      return runShellStep(step, cwd);
    case "prompt":
    case "prompt-and-action":
    case "invoke-sub-workflow":
    case "gate":
    case "discover":
    case "propose-doc-change":
      return {
        stepId: step.id,
        type: step.type,
        status: "deferred",
        message: `step type "${step.type}" requires the B2 step engine; deferred`,
      };
  }
}

function runShellStep(step: WorkflowStep, cwd: string): RunStepResult {
  if (!step.run) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: `step missing required \`run\` field for type ${step.type}`,
    };
  }
  // We use shell=true here for the same reason `commands/workflow.ts`
  // does: the `run` field is author-supplied workflow content (their
  // repo, their config) and is trusted in the same way npm scripts are.
  const result = spawnSync(step.run, {
    shell: true,
    stdio: "inherit",
    encoding: "utf8",
    cwd,
  });
  if (result.error) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: `command exited with status ${result.status}`,
    };
  }
  return {
    stepId: step.id,
    type: step.type,
    status: "ok",
  };
}

function emitFatal(
  options: RunWorkflowOptions,
  partial: RunWorkflowResult,
  message: string,
): RunWorkflowResult {
  if (options.json) {
    process.stdout.write(
      JSON.stringify({ ...partial, error: message }, null, 2) + "\n",
    );
  } else if (!options.quiet) {
    console.error(kleur.red("✗ ") + message);
  }
  return partial;
}
