/**
 * `substrate task <verb>` — adapter-driven task commands (v0.5).
 *
 * Mirrors OP4Z's `./exc api` task surface (find / search / create /
 * update / complete) but routed through the v0.5 `TaskAdapter` plugin
 * contract. Substrate itself stays neutral — the verbs delegate to
 * whatever adapter the user has configured via
 * `extensions.taskAdapter` in substrate.config.json.
 *
 * When no adapter is configured, every verb prints an actionable error
 * with the install hint and exits non-zero. That's by design — public
 * substrate ships zero opinion on which tracker you use; pick one and
 * install its adapter.
 */

import kleur from "kleur";
import { loadTaskAdapter } from "../extensions/loader.js";
import type {
  SubstrateTask,
  CompleteTaskInput,
  CreateTaskInput,
  FindTaskInput,
  SearchTasksInput,
  TaskAdapter,
  UpdateTaskInput,
} from "../extensions/task-adapter.js";

export interface TaskCommonOptions {
  cwd?: string;
  /** Emit machine-readable JSON instead of human-formatted output. */
  json?: boolean;
  /** Suppress all stdout (tests). */
  quiet?: boolean;
}

async function loadOrError(options: TaskCommonOptions): Promise<TaskAdapter> {
  const adapter = await loadTaskAdapter({ cwd: options.cwd });
  if (!adapter) {
    throw new Error(
      "Substrate: no task adapter configured.\n" +
        "  Set `extensions.taskAdapter` in substrate.config.json to a package name (e.g.\n" +
        "  `@op4z/substrate-adapter-stub` for testing). The reference stub ships at\n" +
        "  packages/adapter-stub/ in the substrate repo.",
    );
  }
  return adapter;
}

function renderTask(task: SubstrateTask): string {
  const lines: string[] = [];
  lines.push(kleur.bold(task.id) + " — " + task.title);
  if (task.status) lines.push(kleur.dim(`  status: ${task.status}`));
  if (task.priority) lines.push(kleur.dim(`  priority: ${task.priority}`));
  if (task.type) lines.push(kleur.dim(`  type: ${task.type}`));
  if (task.assignee) lines.push(kleur.dim(`  assignee: ${task.assignee}`));
  if (task.estimatedHours !== undefined)
    lines.push(kleur.dim(`  estimated: ${task.estimatedHours}h`));
  if (task.actualHours !== undefined)
    lines.push(kleur.dim(`  actual:    ${task.actualHours}h`));
  if (task.labels && task.labels.length > 0)
    lines.push(kleur.dim(`  labels: ${task.labels.join(", ")}`));
  if (task.url) lines.push(kleur.dim(`  url: ${task.url}`));
  return lines.join("\n");
}

function emit(options: TaskCommonOptions, payload: SubstrateTask | SubstrateTask[] | null): void {
  if (options.quiet) return;
  if (options.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }
  if (payload === null) {
    console.log(kleur.yellow("Not found."));
    return;
  }
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      console.log(kleur.dim("No matches."));
      return;
    }
    for (const t of payload) console.log(renderTask(t) + "\n");
    return;
  }
  console.log(renderTask(payload));
}

// --- Verbs ------------------------------------------------------------------

export interface FindOptions extends TaskCommonOptions, FindTaskInput {}
export async function runTaskFind(options: FindOptions): Promise<SubstrateTask | null> {
  const adapter = await loadOrError(options);
  const result = await adapter.findTask({ id: options.id });
  emit(options, result);
  return result;
}

export interface SearchOptions extends TaskCommonOptions, SearchTasksInput {}
export async function runTaskSearch(options: SearchOptions): Promise<SubstrateTask[]> {
  const adapter = await loadOrError(options);
  const result = await adapter.searchTasks({
    query: options.query,
    filters: options.filters,
    limit: options.limit,
  });
  emit(options, result);
  return result;
}

export interface CreateOptions extends TaskCommonOptions, CreateTaskInput {}
export async function runTaskCreate(options: CreateOptions): Promise<SubstrateTask> {
  const adapter = await loadOrError(options);
  const { cwd: _cwd, json: _json, quiet: _quiet, ...input } = options;
  const result = await adapter.createTask(input);
  emit(options, result);
  return result;
}

export interface UpdateOptions extends TaskCommonOptions, UpdateTaskInput {}
export async function runTaskUpdate(options: UpdateOptions): Promise<SubstrateTask> {
  const adapter = await loadOrError(options);
  const { cwd: _cwd, json: _json, quiet: _quiet, ...input } = options;
  const result = await adapter.updateTask(input);
  emit(options, result);
  return result;
}

export interface CompleteOptions extends TaskCommonOptions, CompleteTaskInput {}
export async function runTaskComplete(options: CompleteOptions): Promise<SubstrateTask> {
  const adapter = await loadOrError(options);
  const { cwd: _cwd, json: _json, quiet: _quiet, ...input } = options;
  const result = await adapter.completeTask(input);
  emit(options, result);
  return result;
}
