/**
 * Substrate v2 — Cross-cutting hooks (Primitive 3).
 *
 * Hooks are workflow-orthogonal handlers that fire at lifecycle
 * events: `workflow-start`, `workflow-step-completion`,
 * `workflow-completion`, `session-start`, `session-end`,
 * `file-change`. They live as YAML manifests under
 * `substrate/hooks/<name>.yaml` and are discovered by walking that
 * directory at orchestrator startup.
 *
 * Layer: deterministic (discovery + matching are pure); the actual
 * `step.type=run-deterministic` execution shells out via the
 * orchestrator's runner. `step.type=noop` hooks resolve to
 * substrate-internal handlers — used for B2-skeleton hooks whose full
 * logic lands in B3 (e.g. `auto-drift-detect`).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTargetRoot } from "../util/paths.js";
import type { ValidationError } from "./validate.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export type HookTrigger =
  | "workflow-start"
  | "workflow-step-completion"
  | "workflow-completion"
  | "session-start"
  | "session-end"
  | "file-change";

export type HookStepType = "run-deterministic" | "noop";

export interface HookMatches {
  "workflow-id"?: string;
  "workflow-kind"?: string;
  "exit-code"?: number | "any" | "pass" | "fail";
  "step-id"?: string;
}

export interface HookStep {
  type: HookStepType;
  command?: string;
  "pass-result"?: boolean;
  "fail-on-error"?: boolean;
  handler?: string;
}

/**
 * Parsed shape of a single `substrate/hooks/<name>.yaml` manifest.
 */
export interface HookManifest {
  schema_version: "v2.0";
  id: string;
  description?: string;
  trigger: HookTrigger[];
  matches?: HookMatches;
  enabled?: boolean;
  order?: number;
  step: HookStep;
  authors?: string[];
  last_updated?: string;
}

export interface HookDescriptor {
  manifest: HookManifest;
  manifestPath: string;
}

export interface InvalidHookManifest {
  manifestPath: string;
  errors: ValidationError[];
}

export interface HookDiscoveryResult {
  hooks: HookDescriptor[];
  invalidHooks: InvalidHookManifest[];
  hooksDir: string;
}

const HOOKS_RELPATH = join("substrate", "hooks");

let cachedValidator:
  | { validate: (data: unknown) => boolean; errors: () => ValidationError[] }
  | null = null;

function resolveSchemaPath(): string {
  let cursor = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(cursor, "schemas", "hook.schema.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    `Substrate v2: could not locate hook.schema.json (started from ${HERE}).`,
  );
}

interface AjvErrorShape {
  instancePath?: string;
  schemaPath?: string;
  keyword?: string;
  params?: Record<string, unknown>;
  message?: string;
}

function getValidator() {
  if (cachedValidator) return cachedValidator;
  const schemaPath = resolveSchemaPath();
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const AjvAny = Ajv as unknown as {
    default?: new (opts: Record<string, unknown>) => unknown;
  };
  const AjvCtor = (AjvAny.default ?? (Ajv as unknown)) as new (
    opts: Record<string, unknown>,
  ) => {
    compile: (schema: unknown) => ((data: unknown) => boolean) & {
      errors?: AjvErrorShape[] | null;
    };
  };
  const ajv = new AjvCtor({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  const addFmtAny = addFormats as unknown as {
    default?: (ajv: unknown) => void;
  };
  const addFmt = (addFmtAny.default ?? (addFormats as unknown)) as (
    ajv: unknown,
  ) => void;
  addFmt(ajv);
  const validate = ajv.compile(schema);
  cachedValidator = {
    validate: (data) => validate(data),
    errors: () => formatAjvErrors(validate.errors ?? []),
  };
  return cachedValidator;
}

function formatAjvErrors(errors: AjvErrorShape[]): ValidationError[] {
  return errors.map((e) => ({
    path: e.instancePath || "",
    keyword: e.keyword ?? "unknown",
    message: e.message ?? "validation failed",
    params: e.params ?? undefined,
  }));
}

/**
 * Validate a parsed hook manifest object against the schema.
 */
export function validateHookManifest(data: unknown): {
  ok: boolean;
  errors: ValidationError[];
} {
  const v = getValidator();
  const ok = v.validate(data);
  return { ok, errors: ok ? [] : v.errors() };
}

export interface HookDiscoveryOptions {
  cwd?: string;
}

/**
 * Discover all v2 hook manifests under
 * `<consumer-repo>/substrate/hooks/`. Returns sorted-by-order then-by-id
 * descriptors. Invalid manifests are surfaced separately.
 */
export function discoverHooks(
  options: HookDiscoveryOptions = {},
): HookDiscoveryResult {
  const root = resolveTargetRoot(options.cwd);
  const hooksDir = join(root, HOOKS_RELPATH);
  const result: HookDiscoveryResult = {
    hooks: [],
    invalidHooks: [],
    hooksDir,
  };
  if (!existsSync(hooksDir)) return result;

  const files = listYamlFilesShallow(hooksDir);
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      result.invalidHooks.push({
        manifestPath: file,
        errors: [
          {
            path: "",
            keyword: "parse-error",
            message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      });
      continue;
    }
    const validation = validateHookManifest(parsed);
    if (!validation.ok) {
      result.invalidHooks.push({
        manifestPath: file,
        errors: validation.errors,
      });
      continue;
    }
    const manifest = parsed as HookManifest;
    result.hooks.push({ manifest, manifestPath: file });
  }

  result.hooks.sort((a, b) => {
    const oa = a.manifest.order ?? 100;
    const ob = b.manifest.order ?? 100;
    if (oa !== ob) return oa - ob;
    return a.manifest.id.localeCompare(b.manifest.id);
  });
  result.invalidHooks.sort((a, b) =>
    a.manifestPath.localeCompare(b.manifestPath),
  );
  return result;
}

function listYamlFilesShallow(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    if (name.endsWith(".body.md")) continue;
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile()) out.push(full);
  }
  out.sort();
  return out;
}

/**
 * Lifecycle event context against which hook `matches` filters fire.
 */
export interface HookFiringContext {
  trigger: HookTrigger;
  workflowId?: string;
  workflowKind?: string;
  exitCode?: number;
  stepId?: string;
  /**
   * B3 addition — optional pipeline payload. The orchestrator
   * populates these on `workflow-completion` so the proposal-pipeline
   * handler (auto-drift-detect) has the manifest + the session log
   * path without re-discovery. Other hooks ignore these fields.
   *
   * The fields are typed as `unknown` here to keep `hooks.ts` free of
   * a circular dep on `./types.ts`. The handler casts internally.
   */
  manifest?: unknown;
  sessionLogPath?: string;
  /** Working-tree root the workflow ran against. Used by the handler
   *  to locate substrate/proposals/. */
  cwd?: string;
}

/**
 * Filter the descriptors that should fire for a given context. Returns
 * only hooks whose `enabled !== false`, whose trigger list contains
 * `context.trigger`, and whose `matches` filter (if present) ALL match.
 */
export function findMatchingHooks(
  hooks: HookDescriptor[],
  context: HookFiringContext,
): HookDescriptor[] {
  return hooks.filter((h) => {
    if (h.manifest.enabled === false) return false;
    if (!h.manifest.trigger.includes(context.trigger)) return false;
    return hookMatchesContext(h.manifest.matches, context);
  });
}

function hookMatchesContext(
  matches: HookMatches | undefined,
  context: HookFiringContext,
): boolean {
  if (!matches) return true;
  if (matches["workflow-id"] !== undefined) {
    if (matches["workflow-id"] !== context.workflowId) return false;
  }
  if (matches["workflow-kind"] !== undefined) {
    if (matches["workflow-kind"] !== context.workflowKind) return false;
  }
  if (matches["step-id"] !== undefined) {
    if (matches["step-id"] !== context.stepId) return false;
  }
  if (matches["exit-code"] !== undefined) {
    const want = matches["exit-code"];
    if (want === "any") {
      // Always matches (subject to other filters).
    } else if (want === "pass") {
      if (context.exitCode !== 0) return false;
    } else if (want === "fail") {
      if ((context.exitCode ?? 0) === 0) return false;
    } else if (typeof want === "number") {
      if (context.exitCode !== want) return false;
    }
  }
  return true;
}
