/**
 * Substrate v2 — workflow manifest types.
 *
 * These types model the JSON Schema at
 * `packages/substrate/schemas/workflow.schema.json`. Keep the two in
 * sync: the schema is the source of truth for validation; this file is
 * the source of truth for type inference inside Substrate.
 *
 * Layer: deterministic (no AI required). These types are referenced
 * from both the deterministic primitives layer (Discoverer, Context
 * loader, validator) and the orchestration layer (`substrate run`).
 */

export type SchemaVersion = "v2.0";

export type WorkflowKind = "audit" | "review" | "scaffold" | "task-tackle" | "other";

export type MemoryType = "user" | "feedback" | "project" | "reference";

export type StepType =
  | "prompt"
  | "prompt-and-action"
  | "run-tool"
  | "invoke-sub-workflow"
  | "invoke-deterministic"
  | "gate"
  | "discover"
  | "propose-doc-change";

export type SimpleTrigger =
  | "manual-command"
  | "pre-commit"
  | "pre-push"
  | "workflow-completion"
  | "file-change";

export interface ScheduleTrigger {
  schedule: {
    cron?: string;
    interval?: string;
    "every-n-commits"?: number;
  };
}

export type Trigger = SimpleTrigger | ScheduleTrigger;

export interface WhenClause {
  "files-changed-any"?: string[];
  "files-changed-all"?: string[];
  "branch-pattern"?: string;
  "commit-message-pattern"?: string;
  "exit-code-of"?: { workflow: string; equals: number };
  "custom-predicate"?: { command: string };
}

export interface MemoryContext {
  types?: MemoryType[];
  scope?: string;
  tags?: string[];
  "intersect-with-changed-files"?: boolean;
}

export interface ContextClause {
  standards?: string[];
  memory?: MemoryContext;
  rules?: string[];
  "knowledge-sections"?: string[];
}

export interface ComposedFinding {
  workflow: string;
  section?: string;
  "require-fresh-within"?: string;
}

export interface WorkflowStep {
  id: string;
  name?: string;
  type: StepType;
  prompt?: string;
  run?: string;
  workflow?: string;
  "must-confirm"?: boolean;
  "continue-on-failure"?: boolean;
  timeout?: string;
  description?: string;
}

export interface Followup {
  if?: string;
  suggest: string;
}

export interface Acceptance {
  exit_codes?: { pass?: number; conditional?: number; fail?: number };
  "required-steps"?: string[];
  "required-checks"?: string[];
}

/**
 * The shape of a single `<id>.yaml` manifest file under
 * `substrate/workflows/`. The `<id>.body.md` sibling holds the prose
 * body the AI follows literally during orchestration; see
 * `WorkflowDescriptor` for the combined object.
 */
export interface WorkflowManifest {
  schema_version: SchemaVersion;
  id: string;
  name: string;
  description?: string;
  kind?: WorkflowKind;
  authors?: string[];
  last_updated?: string;
  trigger?: Trigger[];
  when?: WhenClause;
  context?: ContextClause;
  composes_findings_of?: ComposedFinding[];
  hooks?: { "cross-cutting"?: string[] };
  steps?: WorkflowStep[];
  followups?: Followup[];
  acceptance?: Acceptance;
}

/**
 * A workflow descriptor pairs a parsed manifest with its prose body
 * (loaded from `<id>.body.md` when present) and the absolute path of
 * the manifest file on disk. Returned by the Discoverer.
 */
export interface WorkflowDescriptor {
  manifest: WorkflowManifest;
  body: string | null;
  manifestPath: string;
  bodyPath: string | null;
}
