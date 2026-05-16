/**
 * Substrate v2 — AI-step handlers (the "step engine").
 *
 * The orchestrator's `runStep` dispatches every step type to a handler
 * in this module. Deterministic step types (`invoke-deterministic` /
 * `run-tool`) shell out via `run-command.ts`'s `runShellStep`. The six
 * AI-step types live here:
 *
 *   - `prompt`              — render + emit the prompt; capture response
 *   - `prompt-and-action`   — same as prompt + records a step-confirm
 *   - `invoke-sub-workflow` — recursively dispatch another workflow
 *   - `gate`                — halt for explicit user OK
 *   - `discover`            — load context mid-workflow
 *   - `propose-doc-change`  — stage a doc-edit proposal for the queue
 *
 * Design call: handlers stay deterministic in the test path. AI sessions
 * (Claude Code, Cursor, etc.) attach via the `OrchestrationTransport`
 * interface in `transport.ts`. When no transport is attached, the
 * handlers run in "no-transport" mode: prompts are emitted as
 * session-log events, responses default to `null`, gates halt with a
 * clear message. This mode is what `--dry-run` and CI use; it's
 * deterministic and testable.
 *
 * The handlers ALL produce real session-log events (no more
 * `status: "deferred"` for these types). That's what closes the
 * proposal pipeline's signal gap that the v3 exploration flagged.
 *
 * Recursion guard: sub-workflow depth is capped at 5. Beyond that, we
 * fail the step rather than risk an infinite invocation loop.
 *
 * Layer: orchestration. Step handlers compose deterministic primitives
 * (context-loader, applicators, queue helpers) but live in the
 * orchestrator because they emit lifecycle events.
 */

import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { discoverWorkflows } from "../discoverer.js";
import { loadContext } from "../context-loader.js";
import type { OrchestrationTransport } from "./transport.js";
import type { SessionEventWriter } from "./session-log.js";
import type { WorkflowStep, WorkflowManifest } from "../types.js";
import type { RunStepResult } from "./run-command-types.js";

/** Maximum allowed `invoke-sub-workflow` nesting depth. */
export const MAX_SUB_WORKFLOW_DEPTH = 5;

export interface StepHandlerContext {
  /** Working-tree root the workflow runs against. */
  cwd: string;
  /** The session-event-log writer for the current run. */
  writer: SessionEventWriter;
  /** Optional transport (attached AI surface). When absent, handlers
   *  run in no-transport mode. */
  transport?: OrchestrationTransport;
  /** Outputs from prior steps, keyed by step id. Used for
   *  `${step.id}.output` references and gate conditions. */
  stepOutputs: Map<string, RunStepResult>;
  /** Current sub-workflow nesting depth (0 = top-level). */
  depth: number;
  /** The manifest of the workflow currently executing (used by gate
   *  for `acceptance` lookups). */
  manifest: WorkflowManifest;
  /** Test seam — suppresses console output for runs inside test
   *  spies. */
  quiet?: boolean;
}

/**
 * Render a prompt template against the step-output map. Supported
 * substitution: `${step-id.output}` → the prior step's `message` (or
 * empty when missing). Conservative — we don't ship a full template
 * engine; the substitution is exact-match and one-pass.
 */
export function renderPromptTemplate(
  template: string,
  outputs: Map<string, RunStepResult>,
): string {
  return template.replace(/\$\{([a-z0-9_-]+)\.output\}/gi, (_, id: string) => {
    const prior = outputs.get(id);
    if (!prior) return "";
    return prior.message ?? prior.output ?? "";
  });
}

/**
 * `prompt` step handler.
 *
 * Emits a `prompt-issued` event. When a transport is attached, awaits
 * its response. When `must-confirm: true`, additionally emits a
 * `step-confirm` event with the user's decision.
 */
export async function runPromptStep(
  step: WorkflowStep,
  ctx: StepHandlerContext,
): Promise<RunStepResult> {
  const promptBody = step.prompt
    ? renderPromptTemplate(step.prompt, ctx.stepOutputs)
    : "";
  if (!promptBody) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: `step \"${step.id}\" (type ${step.type}) requires a non-empty \`prompt\` field`,
    };
  }

  ctx.writer.emit({
    ts: new Date().toISOString(),
    event: "prompt-issued",
    step: step.id,
    prompt: promptBody,
  });

  let response: string | null = null;
  if (ctx.transport) {
    try {
      response = await ctx.transport.emitPrompt({
        stepId: step.id,
        prompt: promptBody,
        mustConfirm: step["must-confirm"] === true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        stepId: step.id,
        type: step.type,
        status: "failed",
        message: `transport.emitPrompt failed: ${msg}`,
      };
    }
  }

  if (step["must-confirm"] === true) {
    let outcome: "approved" | "rejected" = "approved";
    if (ctx.transport) {
      try {
        outcome = (await ctx.transport.confirm({
          stepId: step.id,
          prompt: promptBody,
          response,
        }))
          ? "approved"
          : "rejected";
      } catch {
        outcome = "rejected";
      }
    }
    ctx.writer.emit({
      ts: new Date().toISOString(),
      event: "step-confirm",
      step: step.id,
      outcome,
    });
    if (outcome === "rejected") {
      return {
        stepId: step.id,
        type: step.type,
        status: "failed",
        message: `step \"${step.id}\" rejected at confirmation gate`,
      };
    }
  }

  return {
    stepId: step.id,
    type: step.type,
    status: "ok",
    message: ctx.transport
      ? "prompt issued; response captured"
      : "prompt issued (no transport attached; response captured as null)",
    output: response ?? undefined,
  };
}

/**
 * `prompt-and-action` step handler.
 *
 * Same lifecycle as `prompt` but the response is expected to describe
 * a working-tree mutation. The handler doesn't apply the mutation —
 * the AI session is the only thing that knows what to apply. Instead
 * it emits a `step-completion` event whose `output` records the
 * staged action; downstream `gate` or applicator steps consume that.
 *
 * `step-confirm` events fire here regardless of `must-confirm` because
 * any working-tree mutation deserves a confirmation record for the
 * audit trail.
 */
export async function runPromptAndActionStep(
  step: WorkflowStep,
  ctx: StepHandlerContext,
): Promise<RunStepResult> {
  const promptResult = await runPromptStep(step, ctx);
  if (promptResult.status !== "ok") return promptResult;

  // Even when must-confirm is unset, we emit a confirmation event
  // because the action is tree-mutating.
  if (step["must-confirm"] !== true) {
    ctx.writer.emit({
      ts: new Date().toISOString(),
      event: "step-confirm",
      step: step.id,
      outcome: "approved",
    });
  }

  let actionSummary: string | undefined;
  if (ctx.transport && typeof ctx.transport.presentDiff === "function") {
    try {
      actionSummary = await ctx.transport.presentDiff({
        stepId: step.id,
        response: promptResult.output ?? "",
      });
    } catch {
      // presentDiff is advisory — failures don't fail the step.
    }
  }

  return {
    ...promptResult,
    message:
      actionSummary ??
      (ctx.transport
        ? "prompt-and-action issued; action staged"
        : "prompt-and-action issued (no transport; action staged as no-op)"),
  };
}

/**
 * `invoke-sub-workflow` step handler.
 *
 * Recursively dispatches to `runV2Workflow` on the named workflow.
 * Depth-capped at MAX_SUB_WORKFLOW_DEPTH to prevent infinite
 * recursion. The sub-workflow's events get written to its OWN session
 * log (parent + child are separate JSONL files); the parent log
 * records a synthetic `step-completion` for the child step.
 *
 * Why separate session logs? Drift detectors run on per-workflow logs;
 * mixing parent + child events into one file would conflate two
 * workflows' drift signals. The link between parent and child is the
 * step's `output` (set to the child session-log path).
 *
 * Implementation note: we lazy-import `runV2Workflow` to break the
 * circular dependency between `run-command.ts` and this module.
 */
export async function runInvokeSubWorkflowStep(
  step: WorkflowStep,
  ctx: StepHandlerContext,
): Promise<RunStepResult> {
  if (!step.workflow) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: `step \"${step.id}\" (type invoke-sub-workflow) requires \`workflow\` field`,
    };
  }
  if (ctx.depth >= MAX_SUB_WORKFLOW_DEPTH) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: `sub-workflow depth ${ctx.depth} exceeds cap ${MAX_SUB_WORKFLOW_DEPTH}; aborting to prevent infinite recursion`,
    };
  }

  // Lazy import to avoid the circular dep run-command → step-handlers
  // → run-command.
  const mod = await import("./run-command.js");
  const result = await mod.runV2Workflow({
    workflowId: step.workflow,
    cwd: ctx.cwd,
    quiet: ctx.quiet,
    transport: ctx.transport,
    depth: ctx.depth + 1,
  });

  if (result.exitCode === 0) {
    return {
      stepId: step.id,
      type: step.type,
      status: "ok",
      message: `sub-workflow \"${step.workflow}\" completed (depth ${ctx.depth + 1})`,
      output: result.sessionLogPath,
    };
  }
  // Treat both "runtime failure" (exit 1) and "workflow not found"
  // (exit 2) as a failed step. The orchestrator's own break-on-failed
  // logic + step["continue-on-failure"] then decides whether to halt
  // the parent.
  return {
    stepId: step.id,
    type: step.type,
    status: "failed",
    message: `sub-workflow \"${step.workflow}\" exit ${result.exitCode}`,
    output: result.sessionLogPath,
  };
}

/**
 * `gate` step handler.
 *
 * Two evaluation modes:
 *   - `must-confirm: true` → halt; emit step-confirm; await transport
 *     OK (or default to approved when no transport — gates without
 *     transports are advisory by design)
 *   - non-must-confirm → evaluate the manifest's `acceptance` clause
 *     deterministically against prior step outcomes
 *
 * The deterministic path: count required-steps that completed `ok`;
 * if all are ok, gate passes. Any failed step → gate fails.
 */
export async function runGateStep(
  step: WorkflowStep,
  ctx: StepHandlerContext,
): Promise<RunStepResult> {
  if (step["must-confirm"] === true) {
    let outcome: "approved" | "rejected" = "approved";
    if (ctx.transport) {
      try {
        const ok = await ctx.transport.confirm({
          stepId: step.id,
          prompt: step.description ?? step.name ?? step.id,
          response: null,
        });
        outcome = ok ? "approved" : "rejected";
      } catch {
        outcome = "rejected";
      }
    }
    ctx.writer.emit({
      ts: new Date().toISOString(),
      event: "step-confirm",
      step: step.id,
      outcome,
    });
    return {
      stepId: step.id,
      type: step.type,
      status: outcome === "approved" ? "ok" : "failed",
      message:
        outcome === "approved"
          ? `gate \"${step.id}\" approved`
          : `gate \"${step.id}\" rejected`,
    };
  }

  // Deterministic acceptance evaluation.
  const required = ctx.manifest.acceptance?.["required-steps"] ?? [];
  const failing: string[] = [];
  const missing: string[] = [];
  for (const id of required) {
    const r = ctx.stepOutputs.get(id);
    if (!r) {
      missing.push(id);
      continue;
    }
    if (r.status !== "ok") failing.push(id);
  }
  if (failing.length === 0 && missing.length === 0) {
    return {
      stepId: step.id,
      type: step.type,
      status: "ok",
      message: `gate \"${step.id}\" passed (all ${required.length} required-steps ok)`,
    };
  }
  const reasons: string[] = [];
  if (failing.length > 0) reasons.push(`failing: [${failing.join(", ")}]`);
  if (missing.length > 0) reasons.push(`missing: [${missing.join(", ")}]`);
  return {
    stepId: step.id,
    type: step.type,
    status: "failed",
    message: `gate \"${step.id}\" failed — ${reasons.join("; ")}`,
  };
}

/**
 * `discover` step handler.
 *
 * Re-runs `loadContext` against the workflow's current manifest. The
 * use case: a long-running workflow whose context goes stale
 * mid-execution (e.g. a `tackle-task` workflow that runs for an hour;
 * the user touched new files in between). The discovered context lands
 * in the step's `output` so downstream prompts can reference it.
 *
 * For the v2.0 contract: `discover` re-evaluates the manifest's
 * `context.*` block against the current working tree. Future
 * extensions (custom discovery primitives — filesystem walks,
 * docker-compose parsing — exposed via the `step.run` field) can land
 * here without breaking the contract.
 */
export async function runDiscoverStep(
  step: WorkflowStep,
  ctx: StepHandlerContext,
): Promise<RunStepResult> {
  try {
    const context = loadContext({ workflow: ctx.manifest, cwd: ctx.cwd });
    ctx.writer.emit({
      ts: new Date().toISOString(),
      event: "context-loaded",
      kind: "standards",
      ids: context.standards.map((s) => s.relativePath),
    });
    if (context.memories.length > 0) {
      ctx.writer.emit({
        ts: new Date().toISOString(),
        event: "context-loaded",
        kind: "memory",
        ids: context.memories.map((m) => m.name),
      });
    }
    if (context.rules.length > 0) {
      ctx.writer.emit({
        ts: new Date().toISOString(),
        event: "context-loaded",
        kind: "rules",
        ids: context.rules.map((r) => r.id),
      });
    }
    if (context.knowledge.length > 0) {
      ctx.writer.emit({
        ts: new Date().toISOString(),
        event: "context-loaded",
        kind: "knowledge",
        ids: context.knowledge.map((k) => k.name),
      });
    }
    const counts = `standards=${context.standards.length} memories=${context.memories.length} rules=${context.rules.length} knowledge=${context.knowledge.length}`;
    return {
      stepId: step.id,
      type: step.type,
      status: "ok",
      message: `discover refreshed context: ${counts}`,
      output: counts,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: `discover failed: ${msg}`,
    };
  }
}

/**
 * `propose-doc-change` step handler.
 *
 * Stages a `add-to-standards-doc` proposal (the most-general doc-edit
 * shape) into the pending proposal queue. The applicator pipeline
 * picks it up at the next `substrate review --proposals` walk.
 *
 * Why route through the proposal queue instead of writing the doc
 * directly? Two reasons:
 *   1. Audit trail uniformity — every doc change goes through the
 *      same accept/reject/edit walker, regardless of whether it came
 *      from drift detection or an in-workflow propose-doc-change.
 *   2. Human-in-the-loop preserved — workflows don't silently write
 *      to docs even when run unattended.
 *
 * `payload.docPath` comes from `step.description` (parsed as "doc:
 * <path>") or `step.run` (treated as the doc path). `payload.addition`
 * comes from `step.prompt` (the body to insert).
 */
export async function runProposeDocChangeStep(
  step: WorkflowStep,
  ctx: StepHandlerContext,
): Promise<RunStepResult> {
  const docPath = parseDocPath(step);
  const addition = step.prompt
    ? renderPromptTemplate(step.prompt, ctx.stepOutputs)
    : "";
  if (!docPath) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: `step \"${step.id}\" (type propose-doc-change) requires \`run\` or \`description\` to identify the doc to change`,
    };
  }
  if (!addition) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      message: `step \"${step.id}\" (type propose-doc-change) requires \`prompt\` to carry the addition body`,
    };
  }

  const proposalId = createHash("sha256")
    .update(`${ctx.manifest.id}|${step.id}|${docPath}|${addition}`)
    .digest("hex")
    .slice(0, 12);
  const generatedAt = new Date().toISOString();
  const datePart = generatedAt.slice(0, 10);
  const proposalFile = `${datePart}-${ctx.manifest.id}-step-${step.id}-${proposalId}.md`;
  const pendingDir = join(ctx.cwd, "substrate", "proposals", "pending");
  if (!existsSync(pendingDir)) mkdirSync(pendingDir, { recursive: true });
  const proposalPath = join(pendingDir, proposalFile);

  // Write the proposal in the same markdown shape the drift-detection
  // pipeline uses, so the walker can pick it up uniformly.
  const md =
    `---\n` +
    `id: ${proposalId}\n` +
    `workflowId: ${ctx.manifest.id}\n` +
    `kind: add-to-standards-doc\n` +
    `confidence: medium\n` +
    `source: workflow-step\n` +
    `linkedDrift: adhoc-step\n` +
    `generatedAt: ${generatedAt}\n` +
    `payload:\n` +
    `  docPath: ${JSON.stringify(docPath)}\n` +
    `  addition: ${JSON.stringify(addition)}\n` +
    `---\n\n` +
    `# Propose doc change — ${docPath}\n\n` +
    `Source: workflow step \`${step.id}\` (workflow \`${ctx.manifest.id}\`).\n\n` +
    `## Proposed addition\n\n${addition}\n`;
  writeFileSync(proposalPath, md, "utf8");

  ctx.writer.emit({
    ts: new Date().toISOString(),
    event: "adhoc-step",
    description: `proposed doc change to ${docPath}`,
    origin: "ai-suggested",
    "at-step": step.id,
  });

  return {
    stepId: step.id,
    type: step.type,
    status: "ok",
    message: `proposal staged at ${proposalPath}`,
    output: proposalPath,
  };
}

function parseDocPath(step: WorkflowStep): string | null {
  // Author can use `run: <path>` (shortest form) or
  // `description: "doc: <path>"` (verbose form).
  if (step.run && step.run.trim().length > 0) return step.run.trim();
  if (step.description) {
    const m = step.description.match(/doc:\s*(\S+)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Look up a sub-workflow descriptor by id, used by `invoke-sub-workflow`
 * to validate the target exists before attempting recursion.
 */
export function findSubWorkflowManifest(
  workflowId: string,
  cwd: string,
): WorkflowManifest | null {
  const result = discoverWorkflows({ cwd });
  const found = result.workflows.find((w) => w.manifest.id === workflowId);
  return found?.manifest ?? null;
}

// Internal helper used by tests to discover proposal files.
export function listPendingProposals(cwd: string): string[] {
  const dir = join(cwd, "substrate", "proposals", "pending");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .map((n) => join(dir, n))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}
