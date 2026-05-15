/**
 * Public contract for task adapters (v0.5 plugin interface).
 *
 * Cadence keeps its task-management surface neutral: a thin set of verbs
 * (find / search / create / update / complete) that any external tracker
 * — Linear, Jira, GitHub Issues, OP4Z's `./exc api` — can implement. The
 * config field `extensions.taskAdapter` either points at an npm package
 * exposing this interface as its default export OR is null (the v0.5
 * default — `cadence task` commands then emit a "no adapter configured"
 * error with the install hint).
 *
 * Design call: the interface is *boring on purpose*. No callbacks, no
 * batching, no streaming. Each method is a one-shot async call returning
 * a normalized shape. Adapter authors can implement the methods as
 * minimal stubs and grow them as their tracker's surface needs.
 *
 * The reference stub adapter (`@cadence/adapter-stub`, shipped in this
 * monorepo at `packages/adapter-stub/`) implements every method as a
 * "would call <verb>" log line, proving the plugin contract works
 * end-to-end without binding cadence to any specific tracker SDK.
 */

/**
 * A tracker-agnostic task. Fields beyond the required core are optional
 * because each tracker exposes a different surface; adapters should map
 * what they can and leave the rest undefined rather than fabricating
 * values.
 */
export interface CadenceTask {
  /** Display ID surfaced to the user (e.g. "OP-660", "LIN-12345"). */
  id: string;
  /** One-line summary. */
  title: string;
  /** Long-form description. */
  description?: string;
  /**
   * Domain-shaped status string. Cadence does not enumerate the valid
   * set — adapters expose whatever their tracker uses (`open`,
   * `in_progress`, `done`). UI surfaces should treat this as opaque.
   */
  status?: string;
  /** Priority label as defined by the tracker. */
  priority?: string;
  /** Type label as defined by the tracker. */
  type?: string;
  /** Assignee identifier as defined by the tracker. */
  assignee?: string;
  /** Free-form labels / tags. */
  labels?: string[];
  /** Estimated effort in hours, if the tracker captures it. */
  estimatedHours?: number;
  /** Actual effort recorded against the task. */
  actualHours?: number;
  /** Native tracker URL (for "open in browser" UX). */
  url?: string;
}

export interface FindTaskInput {
  id: string;
}

export interface SearchTasksInput {
  query: string;
  /** Optional filters; adapter-defined keys (kept loose intentionally). */
  filters?: Record<string, string | number | boolean | undefined>;
  /** Max results to return. */
  limit?: number;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  type?: string;
  priority?: string;
  category?: string;
  complexity?: string;
  estimatedHours?: number;
  /** Pre-stamping the task as completed (retrospective work entry). */
  status?: string;
  actualHours?: number;
  /** Free-form labels. */
  labels?: string[];
  /** Project / area key, as the tracker defines it. */
  project?: string;
  /** Assignee identifier. */
  assignee?: string;
}

export interface UpdateTaskInput {
  id: string;
  status?: string;
  priority?: string;
  estimatedHours?: number;
  actualHours?: number;
  assignee?: string;
  labels?: string[];
}

export interface CompleteTaskInput {
  id: string;
  /** Wall-clock effort to record on completion. */
  actualHours?: number;
}

/**
 * The minimal verb surface cadence relies on. Adapters return promises
 * uniformly — even when the underlying call is synchronous — so the
 * caller doesn't need to special-case.
 */
export interface TaskAdapter {
  /** Display name, surfaced in `cadence doctor` and CLI banners. */
  readonly name: string;
  /** Semver string of the adapter (informational; not enforced by cadence). */
  readonly version: string;

  findTask(input: FindTaskInput): Promise<CadenceTask | null>;
  searchTasks(input: SearchTasksInput): Promise<CadenceTask[]>;
  createTask(input: CreateTaskInput): Promise<CadenceTask>;
  updateTask(input: UpdateTaskInput): Promise<CadenceTask>;
  completeTask(input: CompleteTaskInput): Promise<CadenceTask>;
}

/**
 * Type guard used by the loader to assert a dynamically-imported module
 * actually conforms to the adapter shape. Catches the common mistake of
 * a package shipping a class or factory instead of an instance.
 */
export function isTaskAdapter(value: unknown): value is TaskAdapter {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.version === "string" &&
    typeof v.findTask === "function" &&
    typeof v.searchTasks === "function" &&
    typeof v.createTask === "function" &&
    typeof v.updateTask === "function" &&
    typeof v.completeTask === "function"
  );
}
