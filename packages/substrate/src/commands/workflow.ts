/**
 * `substrate workflow` — multi-step automation runtime (v0.5).
 *
 * Workflows are YAML manifests defined in `auto/config/workflows.yaml`.
 * Each manifest declares an id, name, description, and an ordered list
 * of steps. v0.5 supports three step types:
 *
 *   - `command`: shell command (spawned, stdio inherited). The
 *     simplest case — "run this script."
 *   - `audit`  : invokes `substrate audit --type <name>` via the
 *     in-process runner. Surfaces the same stub output as direct
 *     invocation; v0.8's audit executor will make this useful.
 *   - `prompt` : asks the user a question via @inquirer/prompts and
 *     stores the answer in the variable bag so later steps can
 *     reference it as `${var}` in their command / message.
 *
 * Variable substitution uses `${name}` syntax in step strings.
 * Resolution order: --var CLI overrides win; then prompt answers;
 * then defaults declared on the step (if any). Unknown vars at
 * substitution time are left as-is (the spawned shell will see them
 * literally), which keeps the substitution boring and predictable.
 *
 * Public API:
 *   - `runWorkflowList`     — enumerate workflows from the manifest
 *   - `runWorkflowDescribe` — pretty-print one workflow's definition
 *   - `runWorkflowStart`    — execute a workflow's steps in sequence
 *
 * Schema (locked for v0.5 — extending in v0.8 will be additive):
 *
 *   workflows:
 *     - id: new-service
 *       name: New Service Scaffold
 *       description: Scaffold a new backend microservice from substrate templates
 *       steps:
 *         - name: Ask for service name
 *           type: prompt
 *           prompt: "What's the service name?"
 *           var: SERVICE_NAME
 *         - name: Run the scaffold
 *           type: command
 *           command: "substrate create --template service-fastapi --name ${SERVICE_NAME}"
 *         - name: Audit the new service
 *           type: audit
 *           audit: backend
 *           condition: "${SERVICE_NAME}"
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { input } from "@inquirer/prompts";
import kleur from "kleur";
import { parse as parseYaml } from "yaml";
import { runAuditType } from "./audit.js";
import { getTemplatesDir, resolveTargetRoot } from "../util/paths.js";

export type WorkflowStepType = "command" | "audit" | "prompt";

export interface WorkflowStep {
  name: string;
  type: WorkflowStepType;
  /** For type=command: the shell-like command to run. */
  command?: string;
  /** For type=audit: the audit type (e.g. "backend"). */
  audit?: string;
  /** For type=prompt: the question shown to the user. */
  prompt?: string;
  /** For type=prompt: the variable name to store the answer under. */
  var?: string;
  /**
   * Optional condition. When set and evaluates to falsy after variable
   * substitution, the step is skipped. v0.5 supports the simplest form:
   * literal "${VAR}" — truthy if the var has a non-empty value.
   */
  condition?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export interface WorkflowListOptions {
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface WorkflowDescribeOptions {
  id: string;
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface WorkflowStartOptions {
  id: string;
  cwd?: string;
  /** Pre-filled variables from --var key=value pairs. */
  vars?: Record<string, string>;
  /**
   * Test seam: stubs out @inquirer for type=prompt steps. When undefined,
   * real prompts run.
   */
  resolvePrompt?: (step: WorkflowStep) => Promise<string> | string;
  quiet?: boolean;
}

export interface WorkflowStepResult {
  step: WorkflowStep;
  status: "ok" | "skipped" | "failed";
  /** For type=prompt: the answer; for type=command: the stdout; etc. */
  output?: string;
  /** Set when status is "failed". */
  error?: string;
}

export interface WorkflowStartResult {
  workflow: WorkflowDefinition;
  steps: WorkflowStepResult[];
  vars: Record<string, string>;
}

const MANIFEST_RELPATH = join("auto", "config", "workflows.yaml");

// --- Manifest loading -------------------------------------------------------

/**
 * Read the workflows manifest from the user's repo.
 *
 * The manifest schema MUST be either:
 *   - the v0.3 list-of-IDs shape: `workflows: [id1, id2]`
 *   - the v0.5 list-of-definitions shape: `workflows: [{id, name, ...}, ...]`
 *
 * v0.3's shape is preserved for backwards compat — entries appear in
 * `workflow list` but `workflow describe / start` can't operate on them
 * (they're just placeholder IDs without step definitions).
 *
 * v0.5 also looks up step definitions in the bundled
 * `templates/workflows/<id>.yaml` files when the manifest only carries
 * the ID — that's how the shipped default `new-service` works without
 * the user pasting its full body into auto/config/workflows.yaml.
 */
export function readWorkflowsManifest(cwd?: string): WorkflowDefinition[] {
  const root = resolveTargetRoot(cwd);
  const path = join(root, MANIFEST_RELPATH);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const list = (doc as { workflows?: unknown }).workflows;
  if (!Array.isArray(list)) return [];

  const out: WorkflowDefinition[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      // v0.3 shape — look up the bundled template.
      const def = loadBundledWorkflow(item);
      if (def) out.push(def);
      else
        out.push({
          id: item,
          name: item,
          description: "(no bundled definition found; edit workflows.yaml to fill in)",
          steps: [],
        });
    } else if (item && typeof item === "object") {
      const def = normalizeWorkflowDefinition(item as Record<string, unknown>);
      if (def) out.push(def);
    }
  }
  return out;
}

function normalizeWorkflowDefinition(
  raw: Record<string, unknown>,
): WorkflowDefinition | null {
  if (typeof raw.id !== "string") return null;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map(normalizeStep).filter((s): s is WorkflowStep => s !== null)
    : [];
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.id,
    description: typeof raw.description === "string" ? raw.description : "",
    steps,
  };
}

function normalizeStep(raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  // v1 step types (legacy `auto/config/workflows.yaml` shape).
  if (type === "command" || type === "audit" || type === "prompt") {
    return {
      name: typeof r.name === "string" ? r.name : "(unnamed step)",
      type,
      command: typeof r.command === "string" ? r.command : undefined,
      audit: typeof r.audit === "string" ? r.audit : undefined,
      prompt: typeof r.prompt === "string" ? r.prompt : undefined,
      var: typeof r.var === "string" ? r.var : undefined,
      condition: typeof r.condition === "string" ? r.condition : undefined,
    };
  }
  // v2 step types — bundled `templates/workflows/<id>.yaml` files now
  // ship in the v2 shape (`schema_version: v2.0`, step types like
  // `invoke-deterministic`, `invoke-sub-workflow`). The legacy
  // `substrate workflow describe` surface still needs a sensible
  // rendering for these. Map each v2 type to its nearest v1 analogue
  // so existing `[prompt|command|audit]` consumers (tests, scripts,
  // docs) keep working without rewriting against the v2 shape.
  if (
    type === "prompt-and-action" ||
    type === "gate" ||
    type === "discover" ||
    type === "propose-doc-change"
  ) {
    return {
      name: typeof r.name === "string" ? r.name : "(unnamed step)",
      type: "prompt",
      prompt: typeof r.prompt === "string" ? r.prompt : undefined,
    };
  }
  if (type === "invoke-deterministic" || type === "run-tool") {
    return {
      name: typeof r.name === "string" ? r.name : "(unnamed step)",
      type: "command",
      command: typeof r.run === "string" ? r.run : undefined,
    };
  }
  if (type === "invoke-sub-workflow") {
    const wf = typeof r.workflow === "string" ? r.workflow : "";
    // Workflows whose id starts with `audit-` are conventionally audit
    // sub-workflows; render them with the audit pill so the legacy
    // describe surface stays informative.
    if (wf.startsWith("audit-")) {
      return {
        name: typeof r.name === "string" ? r.name : "(unnamed step)",
        type: "audit",
        audit: wf.replace(/^audit-/, ""),
      };
    }
    return {
      name: typeof r.name === "string" ? r.name : "(unnamed step)",
      type: "command",
      command: `substrate run ${wf}`,
    };
  }
  return null;
}

/**
 * Look up a bundled workflow definition (templates/workflows/<id>.yaml).
 * Returns null when no such bundled definition exists.
 */
function loadBundledWorkflow(id: string): WorkflowDefinition | null {
  let templatesDir: string;
  try {
    templatesDir = getTemplatesDir();
  } catch {
    return null;
  }
  const path = join(templatesDir, "workflows", `${id}.yaml`);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  return normalizeWorkflowDefinition(doc as Record<string, unknown>);
}

// --- Verbs ------------------------------------------------------------------

export function runWorkflowList(options: WorkflowListOptions = {}): WorkflowDefinition[] {
  const workflows = readWorkflowsManifest(options.cwd);
  if (options.json) {
    process.stdout.write(JSON.stringify(workflows, null, 2) + "\n");
    return workflows;
  }
  if (options.quiet) return workflows;
  if (workflows.length === 0) {
    console.log(
      kleur.yellow("No workflows registered.") +
        "\n" +
        kleur.dim("  Register one with `substrate add workflow <id>`."),
    );
    return workflows;
  }
  console.log(kleur.bold(`\nWorkflows — ${workflows.length}\n`));
  const widest = Math.max(...workflows.map((w) => w.id.length));
  for (const w of workflows) {
    const stepCount = w.steps.length;
    const stepHint = stepCount === 0
      ? kleur.yellow("(no steps defined)")
      : kleur.dim(`${stepCount} step(s)`);
    console.log(
      `  ${kleur.cyan(w.id.padEnd(widest))}  ${kleur.dim(w.description || w.name)}  ${stepHint}`,
    );
  }
  console.log("\n" + kleur.dim("  Describe: substrate workflow describe <id>"));
  console.log(kleur.dim("  Start:    substrate workflow start <id> [--var key=value ...]\n"));
  return workflows;
}

export function runWorkflowDescribe(
  options: WorkflowDescribeOptions,
): WorkflowDefinition {
  const workflows = readWorkflowsManifest(options.cwd);
  const wf = workflows.find((w) => w.id === options.id);
  if (!wf) {
    throw new Error(
      `Substrate: workflow "${options.id}" not found. ` +
        `Available: ${workflows.map((w) => w.id).join(", ") || "(none)"}`,
    );
  }
  if (options.json) {
    process.stdout.write(JSON.stringify(wf, null, 2) + "\n");
    return wf;
  }
  if (options.quiet) return wf;
  console.log(kleur.bold(`\nWorkflow: ${wf.id}`));
  console.log(kleur.dim(`  ${wf.name}`));
  if (wf.description) console.log(kleur.dim(`  ${wf.description}`));
  console.log("\n" + kleur.bold("Steps:"));
  if (wf.steps.length === 0) {
    console.log(kleur.yellow("  (no steps defined)\n"));
    return wf;
  }
  wf.steps.forEach((step, i) => {
    console.log(`  ${i + 1}. ${kleur.cyan(step.name)} ${kleur.dim(`[${step.type}]`)}`);
    if (step.command) console.log(kleur.dim(`     command: ${step.command}`));
    if (step.audit) console.log(kleur.dim(`     audit:   ${step.audit}`));
    if (step.prompt) console.log(kleur.dim(`     prompt:  ${step.prompt}`));
    if (step.var) console.log(kleur.dim(`     var:     ${step.var}`));
    if (step.condition) console.log(kleur.dim(`     when:    ${step.condition}`));
  });
  console.log();
  return wf;
}

export async function runWorkflowStart(
  options: WorkflowStartOptions,
): Promise<WorkflowStartResult> {
  const workflows = readWorkflowsManifest(options.cwd);
  const wf = workflows.find((w) => w.id === options.id);
  if (!wf) {
    throw new Error(
      `Substrate: workflow "${options.id}" not found. ` +
        `Available: ${workflows.map((w) => w.id).join(", ") || "(none)"}`,
    );
  }
  if (wf.steps.length === 0) {
    throw new Error(
      `Substrate: workflow "${options.id}" has no steps defined.\n` +
        `  Edit auto/config/workflows.yaml or the bundled template to add steps.`,
    );
  }

  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const vars: Record<string, string> = { ...(options.vars ?? {}) };
  const results: WorkflowStepResult[] = [];

  log(kleur.bold(`\nRunning workflow: ${wf.id}`));
  log(kleur.dim(`  ${wf.description || wf.name}\n`));

  for (let i = 0; i < wf.steps.length; i += 1) {
    const step = wf.steps[i];
    log(kleur.bold(`Step ${i + 1}/${wf.steps.length}: ${step.name}`));

    // Condition check.
    //
    // We evaluate conditions with unknown-var-as-empty semantics: a
    // condition like `${FLAG}` is truthy ONLY when FLAG is set. Leaving
    // the literal `${FLAG}` through (the command-substitution semantic)
    // would make conditions always-truthy, defeating the feature.
    if (step.condition) {
      const substituted = substituteVars(step.condition, vars, /* keepUnknown */ false);
      if (!substituted || substituted.trim() === "") {
        log(kleur.dim(`  skipped (condition "${step.condition}" is empty)\n`));
        results.push({ step, status: "skipped" });
        continue;
      }
    }

    try {
      const result = await runStep(step, vars, options, options.cwd);
      results.push(result);
      if (result.status === "failed") {
        log(kleur.red(`  ✗ failed: ${result.error}\n`));
        // Halt on first failure — workflows are sequential by design.
        break;
      }
      log(kleur.green("  ✓ done\n"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ step, status: "failed", error: message });
      log(kleur.red(`  ✗ ${message}\n`));
      break;
    }
  }

  return { workflow: wf, steps: results, vars };
}

// --- Step execution ---------------------------------------------------------

async function runStep(
  step: WorkflowStep,
  vars: Record<string, string>,
  options: WorkflowStartOptions,
  cwd: string | undefined,
): Promise<WorkflowStepResult> {
  switch (step.type) {
    case "command":
      return runCommandStep(step, vars, cwd);
    case "audit":
      return runAuditStep(step, vars, cwd);
    case "prompt":
      return runPromptStep(step, vars, options);
  }
}

function runCommandStep(
  step: WorkflowStep,
  vars: Record<string, string>,
  cwd: string | undefined,
): WorkflowStepResult {
  if (!step.command) {
    return { step, status: "failed", error: "command step missing `command` field" };
  }
  const substituted = substituteVars(step.command, vars);
  // We deliberately use shell=true here — the schema's `command` field is
  // free-form user-authored content (their workflow), not user *input*. The
  // workflow author is trusted in the same way Make targets and npm
  // scripts are trusted: it's THEIR repo and THEIR config.
  const result = spawnSync(substituted, {
    shell: true,
    stdio: "inherit",
    encoding: "utf8",
    cwd,
  });
  if (result.error) {
    return { step, status: "failed", error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      step,
      status: "failed",
      error: `command exited with status ${result.status}`,
    };
  }
  return { step, status: "ok" };
}

function runAuditStep(
  step: WorkflowStep,
  _vars: Record<string, string>,
  cwd: string | undefined,
): WorkflowStepResult {
  if (!step.audit) {
    return { step, status: "failed", error: "audit step missing `audit` field" };
  }
  try {
    runAuditType(step.audit, { cwd, quiet: true });
    return { step, status: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { step, status: "failed", error: message };
  }
}

async function runPromptStep(
  step: WorkflowStep,
  vars: Record<string, string>,
  options: WorkflowStartOptions,
): Promise<WorkflowStepResult> {
  if (!step.prompt) {
    return { step, status: "failed", error: "prompt step missing `prompt` field" };
  }
  if (!step.var) {
    return {
      step,
      status: "failed",
      error: "prompt step missing `var` field (where to store the answer)",
    };
  }
  let answer: string;
  if (options.resolvePrompt) {
    answer = await Promise.resolve(options.resolvePrompt(step));
  } else {
    answer = await input({
      message: substituteVars(step.prompt, vars),
    });
  }
  vars[step.var] = answer;
  return { step, status: "ok", output: answer };
}

// --- Helpers ----------------------------------------------------------------

/**
 * Replace `${name}` tokens with the matching var value.
 *
 * By default (`keepUnknown=true`): unknown vars are left as `${NAME}` so
 * the spawned shell sees them literally — matches the principle of least
 * surprise for command steps (a typo doesn't silently delete part of the
 * command).
 *
 * When `keepUnknown=false`: unknown vars resolve to empty string. Used
 * for condition evaluation, where the question is "did this var get set?"
 * and the literal-preservation behavior would make conditions always
 * truthy.
 */
function substituteVars(
  input: string,
  vars: Record<string, string>,
  keepUnknown = true,
): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name];
    }
    return keepUnknown ? match : "";
  });
}
