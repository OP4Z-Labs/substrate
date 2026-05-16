/**
 * `substrate run <workflow>` — orchestration-layer command.
 *
 * Layer: AI-aware orchestration. Loads context, dispatches steps via
 * the step engine (`step-handlers.ts`), emits lifecycle events to the
 * session-event-log, fires cross-cutting hooks at each boundary, and
 * surfaces the composed result. The runtime supports every step type:
 *
 *   - `invoke-deterministic` / `run-tool` — shell-out (kept inline
 *     here; deterministic).
 *   - `prompt` / `prompt-and-action` / `invoke-sub-workflow` / `gate`
 *     / `discover` / `propose-doc-change` — dispatched to the step
 *     engine in `./step-handlers.ts`. AI-step types run against the
 *     attached `OrchestrationTransport` (or no-transport mode in
 *     tests / CI).
 *
 * Returned exit codes (delegated to the CLI):
 *   0 — workflow completed all runnable steps successfully.
 *   1 — a step failed at runtime.
 *   2 — workflow not found or manifest invalid.
 */

import { spawnSync } from "node:child_process";
import kleur from "kleur";
import { discoverWorkflows, type DiscoveryResult } from "../discoverer.js";
import { loadContext, type ResolvedContext } from "../context-loader.js";
import { resolveTargetRoot } from "../../util/paths.js";
import { discoverHooks } from "../hooks.js";
import { dispatchHooks, type HookRunRecord } from "./hook-dispatch.js";
import {
  checkComposition,
  type CompositionCheckResult,
} from "../composition.js";
import {
  SessionEventWriter,
  computeManifestHash,
  resolveSessionLogPath,
  type SessionLogPaths,
} from "./session-log.js";
import {
  isScheduled,
  recordWorkflowRun,
} from "../deterministic/scheduler.js";
import {
  runPromptStep,
  runPromptAndActionStep,
  runInvokeSubWorkflowStep,
  runGateStep,
  runDiscoverStep,
  runProposeDocChangeStep,
  type StepHandlerContext,
} from "./step-handlers.js";
import type { OrchestrationTransport } from "./transport.js";
import type { RunStepResult } from "./run-command-types.js";
import type { WorkflowDescriptor, WorkflowStep } from "../types.js";

export type { RunStepResult } from "./run-command-types.js";

export interface RunWorkflowOptions {
  workflowId: string;
  cwd?: string;
  /** Variables pre-filled by the user (e.g. `--var key=value`). */
  vars?: Record<string, string>;
  json?: boolean;
  quiet?: boolean;
  dryRun?: boolean;
  /** Attached AI transport. When omitted, the step engine runs in
   *  no-transport mode (prompts emit events; responses default to
   *  null; gates auto-approve). */
  transport?: OrchestrationTransport;
  /** Sub-workflow nesting depth (set by the invoke-sub-workflow
   *  handler). Top-level calls leave it 0. */
  depth?: number;
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
  /** Cross-cutting hook invocations (workflow-start / step / completion). */
  hookRuns?: HookRunRecord[];
  /** Result of evaluating `composes_findings_of` declarations. */
  composition?: CompositionCheckResult;
  /** Path to the session-event-log written for this run. */
  sessionLogPath?: string;
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

  // Discover hooks once per workflow run — pass the descriptor list to
  // each dispatchHooks() call to avoid re-walking the filesystem.
  const hooksDiscovery = discoverHooks({ cwd });
  const allHookRuns: HookRunRecord[] = [];

  // Open the session-event-log. Dry runs use the in-memory writer so
  // we never pollute substrate/sessions/ with skipped-step runs that
  // would muddy the drift signal.
  const sessionStartedAt = new Date();
  const sessionPaths: SessionLogPaths = resolveSessionLogPath(
    workflow.manifest.id,
    { cwd, startedAt: sessionStartedAt },
  );
  const sessionWriter = new SessionEventWriter({
    paths: sessionPaths,
    inMemoryOnly: options.dryRun === true,
  });
  const manifestHash = computeManifestHash(workflow.manifest);
  sessionWriter.emit({
    ts: sessionStartedAt.toISOString(),
    event: "workflow-start",
    workflow: workflow.manifest.id,
    "manifest-hash": manifestHash,
  });
  emitContextLoadedEvents(sessionWriter, context);

  // Composition freshness check (`composes_findings_of`). Stale deps
  // surface as warnings BEFORE the workflow runs so the user can
  // decide whether to refresh first. We never fail the workflow on
  // stale composition deps — they're advisory.
  const composition = checkComposition(workflow.manifest, { cwd });
  if (
    composition.warnings.length > 0 &&
    !options.quiet &&
    !options.json
  ) {
    for (const warning of composition.warnings) {
      console.log(kleur.yellow(`  ! ${warning}`));
    }
    console.log();
  }

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
  const stepOutputs = new Map<string, RunStepResult>();
  let exitCode: 0 | 1 | 2 = 0;

  // workflow-start hooks fire before the first step. In dry-run we
  // still fire them — they may be cheap registrations (telemetry) and
  // skipping them silently would hide configuration drift.
  if (!options.dryRun) {
    const startHooks = await dispatchHooks(
      {
        trigger: "workflow-start",
        workflowId: workflow.manifest.id,
        workflowKind: workflow.manifest.kind,
      },
      { cwd, quiet: options.quiet, hooks: hooksDiscovery.hooks },
    );
    allHookRuns.push(...startHooks);
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const label = `Step ${i + 1}/${steps.length}: ${step.name ?? step.id}`;
    if (!options.quiet && !options.json) {
      console.log(kleur.bold(label) + kleur.dim(`  [${step.type}]`));
    }

    sessionWriter.emit({
      ts: new Date().toISOString(),
      event: "step-start",
      step: step.id,
    });

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

    const handlerCtx: StepHandlerContext = {
      cwd,
      writer: sessionWriter,
      transport: options.transport,
      stepOutputs,
      depth: options.depth ?? 0,
      manifest: workflow.manifest,
      quiet: options.quiet,
    };
    const result = await runStep(step, handlerCtx);
    stepResults.push(result);
    stepOutputs.set(step.id, result);
    sessionWriter.emit({
      ts: new Date().toISOString(),
      event: "step-completion",
      step: step.id,
      output: result.message,
    });

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

    // workflow-step-completion hooks fire after each step (regardless
    // of step outcome). This is the primary hook for "after every step,
    // do X" patterns (e.g. checkpoint sidecar updates).
    if (!options.dryRun) {
      const stepHooks = await dispatchHooks(
        {
          trigger: "workflow-step-completion",
          workflowId: workflow.manifest.id,
          workflowKind: workflow.manifest.kind,
          stepId: step.id,
          exitCode: result.status === "ok" ? 0 : result.status === "failed" ? 1 : undefined,
        },
        { cwd, quiet: options.quiet, hooks: hooksDiscovery.hooks },
      );
      allHookRuns.push(...stepHooks);
    }

    if (result.status === "failed") {
      // `continue-on-failure: true` lets a workflow keep going past a
      // failed step. Useful for review/audit workflows that want to
      // walk every check even when some report failures.
      if (step["continue-on-failure"] === true) {
        // Don't bump exitCode; let later steps overwrite it.
      } else {
        exitCode = 1;
        break;
      }
    }
    if (result.status === "deferred") {
      // Reserved for future step types that legitimately defer (e.g. a
      // long-running async step that's "started but not finished"). No
      // current step type returns this, but the contract supports it.
      exitCode = 2;
      break;
    }
  }

  // Emit workflow-completion BEFORE the completion hook fires — the
  // auto-drift-detect handler reads the log from disk, so it needs
  // the completion event present.
  sessionWriter.emit({
    ts: new Date().toISOString(),
    event: "workflow-completion",
    exit: exitCode === 0 ? "pass" : exitCode === 1 ? "fail" : "conditional",
    duration: Date.now() - sessionStartedAt.getTime(),
  });

  // If the workflow declares `trigger: schedule`, stamp the scheduler
  // state so the next `substrate scheduler --check` sees it as
  // recently run. We do this only on disk-writable runs (skip dryRun)
  // and only for scheduled workflows — non-scheduled workflows skip
  // the state file entirely.
  if (!options.dryRun && isScheduled(workflow.manifest)) {
    recordWorkflowRun(workflow.manifest.id, { cwd });
  }

  // workflow-completion hooks fire once the workflow exits (even on
  // failure / deferral). exitCode is the workflow's final code so
  // `matches.exit-code: { pass | fail | <int> }` filters work.
  // The firing context also carries the parsed manifest + the
  // session-log path so the proposal pipeline handler can read them
  // without re-discovery.
  if (!options.dryRun) {
    const completionHooks = await dispatchHooks(
      {
        trigger: "workflow-completion",
        workflowId: workflow.manifest.id,
        workflowKind: workflow.manifest.kind,
        exitCode,
        manifest: workflow.manifest,
        sessionLogPath: sessionPaths.path,
        cwd,
      },
      { cwd, quiet: options.quiet, hooks: hooksDiscovery.hooks },
    );
    allHookRuns.push(...completionHooks);
  }

  const ok = exitCode === 0;

  const summary: RunWorkflowResult = {
    workflowId: workflow.manifest.id,
    ok,
    exitCode,
    steps: stepResults,
    contextSummary,
    hookRuns: allHookRuns,
    composition,
    sessionLogPath: options.dryRun ? undefined : sessionPaths.path,
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

async function runStep(
  step: WorkflowStep,
  ctx: StepHandlerContext,
): Promise<RunStepResult> {
  switch (step.type) {
    case "invoke-deterministic":
    case "run-tool":
      return runShellStep(step, ctx.cwd);
    case "prompt":
      return runPromptStep(step, ctx);
    case "prompt-and-action":
      return runPromptAndActionStep(step, ctx);
    case "invoke-sub-workflow":
      return runInvokeSubWorkflowStep(step, ctx);
    case "gate":
      return runGateStep(step, ctx);
    case "discover":
      return runDiscoverStep(step, ctx);
    case "propose-doc-change":
      return runProposeDocChangeStep(step, ctx);
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

/**
 * Translate the loaded context into one `context-loaded` event per
 * context kind. Skipped kinds (empty arrays) don't get an event — the
 * drift detector's `context-gap` heuristic needs to know what WAS
 * loaded; absence of an event for a kind means "nothing of that kind".
 */
function emitContextLoadedEvents(
  writer: SessionEventWriter,
  context: ResolvedContext,
): void {
  const now = new Date().toISOString();
  if (context.standards.length > 0) {
    writer.emit({
      ts: now,
      event: "context-loaded",
      kind: "standards",
      ids: context.standards.map((s) => s.relativePath),
    });
  }
  if (context.memories.length > 0) {
    writer.emit({
      ts: now,
      event: "context-loaded",
      kind: "memory",
      ids: context.memories.map((m) => m.name),
    });
  }
  if (context.rules.length > 0) {
    writer.emit({
      ts: now,
      event: "context-loaded",
      kind: "rules",
      ids: context.rules.map((r) => r.id),
    });
  }
  if (context.knowledge.length > 0) {
    writer.emit({
      ts: now,
      event: "context-loaded",
      kind: "knowledge",
      ids: context.knowledge.map((k) => k.name),
    });
  }
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
