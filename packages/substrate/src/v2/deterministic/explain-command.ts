/**
 * `substrate explain <workflow>` — the inspection primitive.
 *
 * Loads context exactly as `substrate run` would, then prints the
 * resolved manifest + loaded context + the rendered prompt blocks
 * each AI step would emit — without invoking any step. Different
 * from:
 *
 *   - `substrate validate` (schema-only)
 *   - `substrate workflow describe` (manifest-only; legacy shape)
 *   - `substrate run --dry-run` (executes the orchestrator and skips
 *     steps; emits a session log)
 *
 * The use case: workflow authors iterate on context tuning. They want
 * to know "what would the AI actually see at workflow start?" without
 * launching a session.
 *
 * Layer: deterministic. Same shape as the other v2 query / inspect
 * commands.
 */

import { join } from "node:path";
import kleur from "kleur";
import { resolveTargetRoot } from "../../util/paths.js";
import { discoverWorkflows } from "../discoverer.js";
import { loadContext, type ResolvedContext } from "../context-loader.js";
import type { WorkflowManifest, WorkflowStep } from "../types.js";

export interface ExplainCommandOptions {
  workflowId: string;
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
  /** Restrict context resolution to these changed files (passed
   *  through to `loadContext({ tree.changedFiles })`). */
  forFiles?: string[];
  /** Test seam — homedir override for memory bridge. */
  homeDir?: string;
}

export interface ExplainStepSummary {
  id: string;
  name?: string;
  type: string;
  /** The rendered prompt body the AI would receive (template
   *  substitution from prior steps is not applied because there are
   *  no prior outputs at explain time). */
  prompt?: string;
  run?: string;
  workflow?: string;
  mustConfirm?: boolean;
}

export interface ExplainCommandResult {
  workflowId: string;
  manifestPath: string;
  body: string | null;
  manifest: WorkflowManifest;
  context: {
    standardsLoaded: Array<{ relativePath: string; absolutePath: string }>;
    memoriesLoaded: Array<{ name: string; type?: string; scope?: string }>;
    rulesMatched: Array<{ id: string; severity?: string }>;
    knowledgeLoaded: Array<{ name: string }>;
    memoryInjection: string;
    warnings: string[];
  };
  steps: ExplainStepSummary[];
  exitCode: 0 | 2;
}

export function runExplain(
  options: ExplainCommandOptions,
): ExplainCommandResult {
  const cwd = resolveTargetRoot(options.cwd);
  const discovery = discoverWorkflows({ cwd });
  const found = discovery.workflows.find(
    (w) => w.manifest.id === options.workflowId,
  );
  if (!found) {
    return emitMissing(options, discovery.workflows.map((w) => w.manifest.id), cwd);
  }

  const context = loadContext({
    workflow: found.manifest,
    cwd,
    tree: options.forFiles
      ? { changedFiles: options.forFiles }
      : undefined,
    homeDir: options.homeDir,
  });

  const result: ExplainCommandResult = {
    workflowId: found.manifest.id,
    manifestPath: found.manifestPath,
    body: found.body,
    manifest: found.manifest,
    context: summariseContext(context),
    steps: (found.manifest.steps ?? []).map(summariseStep),
    exitCode: 0,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (!options.quiet) {
    renderHuman(result);
  }
  return result;
}

function summariseContext(context: ResolvedContext): ExplainCommandResult["context"] {
  return {
    standardsLoaded: context.standards.map((s) => ({
      relativePath: s.relativePath,
      absolutePath: s.absolutePath,
    })),
    memoriesLoaded: context.memories.map((m) => ({
      name: m.name,
      type: m.type,
      scope: m.scope,
    })),
    rulesMatched: context.rules.map((r) => ({
      id: r.id,
      severity: r.severity,
    })),
    knowledgeLoaded: context.knowledge.map((k) => ({ name: k.name })),
    memoryInjection: context.memoryInjection,
    warnings: context.warnings,
  };
}

function summariseStep(step: WorkflowStep): ExplainStepSummary {
  return {
    id: step.id,
    name: step.name,
    type: step.type,
    prompt: step.prompt,
    run: step.run,
    workflow: step.workflow,
    mustConfirm: step["must-confirm"],
  };
}

function emitMissing(
  options: ExplainCommandOptions,
  knownIds: string[],
  cwd: string,
): ExplainCommandResult {
  const stub: ExplainCommandResult = {
    workflowId: options.workflowId,
    manifestPath: join(cwd, "substrate", "workflows", `${options.workflowId}.yaml`),
    body: null,
    // Unused but typed.
    manifest: {
      schema_version: "v2.0",
      id: options.workflowId,
      name: options.workflowId,
    },
    context: {
      standardsLoaded: [],
      memoriesLoaded: [],
      rulesMatched: [],
      knowledgeLoaded: [],
      memoryInjection: "",
      warnings: [],
    },
    steps: [],
    exitCode: 2,
  };
  if (options.json) {
    const errEnvelope = {
      ...stub,
      error: `Workflow "${options.workflowId}" not found. Known: ${knownIds.join(", ") || "(none)"}`,
    };
    process.stdout.write(JSON.stringify(errEnvelope, null, 2) + "\n");
  } else if (!options.quiet) {
    console.error(
      kleur.red(
        `✗ workflow "${options.workflowId}" not found. Known: ${knownIds.join(", ") || "(none)"}`,
      ),
    );
  }
  return stub;
}

function renderHuman(result: ExplainCommandResult): void {
  console.log(
    kleur.bold(`Workflow: ${result.workflowId}`) +
      kleur.dim(`  (${result.manifestPath})`),
  );
  if (result.manifest.description) {
    console.log(kleur.dim(`  ${result.manifest.description}`));
  }
  console.log();

  console.log(kleur.bold("Context loaded:"));
  console.log(
    `  standards: ${result.context.standardsLoaded.length}` +
      (result.context.standardsLoaded.length > 0
        ? "\n" +
          result.context.standardsLoaded
            .map((s) => kleur.dim(`    - ${s.relativePath}`))
            .join("\n")
        : ""),
  );
  console.log(
    `  memories:  ${result.context.memoriesLoaded.length}` +
      (result.context.memoriesLoaded.length > 0
        ? "\n" +
          result.context.memoriesLoaded
            .map((m) =>
              kleur.dim(`    - ${m.name}${m.type ? ` (${m.type})` : ""}`),
            )
            .join("\n")
        : ""),
  );
  console.log(
    `  rules:     ${result.context.rulesMatched.length}` +
      (result.context.rulesMatched.length > 0
        ? "\n" +
          result.context.rulesMatched
            .map((r) =>
              kleur.dim(`    - ${r.id}${r.severity ? ` [${r.severity}]` : ""}`),
            )
            .join("\n")
        : ""),
  );
  console.log(
    `  knowledge: ${result.context.knowledgeLoaded.length}` +
      (result.context.knowledgeLoaded.length > 0
        ? "\n" +
          result.context.knowledgeLoaded
            .map((k) => kleur.dim(`    - ${k.name}`))
            .join("\n")
        : ""),
  );

  if (result.context.memoryInjection) {
    console.log();
    console.log(kleur.bold("Memory injection (prepended to first prompt):"));
    console.log(kleur.dim(result.context.memoryInjection.slice(0, 500)));
    if (result.context.memoryInjection.length > 500) {
      console.log(
        kleur.dim(
          `  ...(${result.context.memoryInjection.length - 500} more chars)`,
        ),
      );
    }
  }

  if (result.context.warnings.length > 0) {
    console.log();
    console.log(kleur.yellow("Context warnings:"));
    for (const w of result.context.warnings) {
      console.log(kleur.yellow(`  ! ${w}`));
    }
  }

  console.log();
  console.log(kleur.bold(`Steps (${result.steps.length}):`));
  for (let i = 0; i < result.steps.length; i += 1) {
    const s = result.steps[i];
    console.log(
      `  ${i + 1}. ${kleur.cyan(s.id)}${s.name ? kleur.dim(` — ${s.name}`) : ""} ${kleur.dim(`[${s.type}]`)}${s.mustConfirm ? kleur.magenta(" (must-confirm)") : ""}`,
    );
    if (s.prompt) {
      const lines = s.prompt.split("\n");
      for (const line of lines.slice(0, 4)) {
        console.log(kleur.dim(`     │ ${line}`));
      }
      if (lines.length > 4) {
        console.log(kleur.dim(`     │ ...(${lines.length - 4} more lines)`));
      }
    }
    if (s.run) {
      console.log(kleur.dim(`     $ ${s.run.split("\n")[0]}`));
    }
    if (s.workflow) {
      console.log(kleur.dim(`     → sub-workflow: ${s.workflow}`));
    }
  }
}
