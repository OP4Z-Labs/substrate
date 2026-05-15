/**
 * Substrate v2 — Conditional Doc-Check Registry (Primitive 4).
 *
 * A data-driven `<files-changed-any> → required-doc-or-prompt`
 * registry. Walked by audit + review workflows via
 * `substrate query doc-checks --for-files <files>`. Closes OP4Z's
 * Gap 1 (lost public-docs check) by making the "did you update X
 * when Y changed?" pattern declarative + auditable.
 *
 * Layer: deterministic. Discovery + matching + require-evaluation are
 * pure file-system + glob operations.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { resolveTargetRoot } from "../util/paths.js";
import type { ValidationError } from "./validate.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export type DocCheckSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "should-fix"
  | "nice-to-have";

export interface DocCheckMatch {
  "files-changed-any"?: string[];
  "files-changed-all"?: string[];
  "commit-message-pattern"?: string;
  "branch-pattern"?: string;
}

export interface DocCheckRequire {
  "one-of"?: string[];
  "all-of"?: string[];
}

export interface DocCheckManifest {
  schema_version: "v2.0";
  id: string;
  description?: string;
  when: DocCheckMatch;
  require?: DocCheckRequire;
  prompt: string;
  severity?: DocCheckSeverity;
  authors?: string[];
  last_updated?: string;
}

export interface DocCheckDescriptor {
  manifest: DocCheckManifest;
  manifestPath: string;
}

export interface InvalidDocCheckManifest {
  manifestPath: string;
  errors: ValidationError[];
}

export interface DocCheckDiscoveryResult {
  docChecks: DocCheckDescriptor[];
  invalidDocChecks: InvalidDocCheckManifest[];
  docChecksDir: string;
}

const DOC_CHECKS_RELPATH = join("substrate", "doc-checks");

let cachedValidator:
  | { validate: (data: unknown) => boolean; errors: () => ValidationError[] }
  | null = null;

function resolveSchemaPath(): string {
  let cursor = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(cursor, "schemas", "doc-check.schema.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    `Substrate v2: could not locate doc-check.schema.json (started from ${HERE}).`,
  );
}

interface AjvErrorShape {
  instancePath?: string;
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
    errors: () =>
      (validate.errors ?? []).map((e: AjvErrorShape) => ({
        path: e.instancePath || "",
        keyword: e.keyword ?? "unknown",
        message: e.message ?? "validation failed",
        params: e.params ?? undefined,
      })),
  };
  return cachedValidator;
}

export function validateDocCheckManifest(data: unknown): {
  ok: boolean;
  errors: ValidationError[];
} {
  const v = getValidator();
  const ok = v.validate(data);
  return { ok, errors: ok ? [] : v.errors() };
}

export interface DocCheckDiscoveryOptions {
  cwd?: string;
}

export function discoverDocChecks(
  options: DocCheckDiscoveryOptions = {},
): DocCheckDiscoveryResult {
  const root = resolveTargetRoot(options.cwd);
  const docChecksDir = join(root, DOC_CHECKS_RELPATH);
  const result: DocCheckDiscoveryResult = {
    docChecks: [],
    invalidDocChecks: [],
    docChecksDir,
  };
  if (!existsSync(docChecksDir)) return result;

  const files = listYamlFilesShallow(docChecksDir);
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      result.invalidDocChecks.push({
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
    const validation = validateDocCheckManifest(parsed);
    if (!validation.ok) {
      result.invalidDocChecks.push({
        manifestPath: file,
        errors: validation.errors,
      });
      continue;
    }
    result.docChecks.push({
      manifest: parsed as DocCheckManifest,
      manifestPath: file,
    });
  }
  result.docChecks.sort((a, b) =>
    a.manifest.id.localeCompare(b.manifest.id),
  );
  result.invalidDocChecks.sort((a, b) =>
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

export interface DocCheckEvaluationContext {
  /** Files changed in the working tree (repo-relative paths). */
  changedFiles: string[];
  /** Commit message, if available. */
  commitMessage?: string;
  /** Current branch name, if available. */
  branch?: string;
}

export interface DocCheckFinding {
  id: string;
  severity: DocCheckSeverity;
  prompt: string;
  missing?: string[];
  matchedTriggers: string[];
  manifestPath: string;
}

/**
 * Filter the registry to checks whose `when` clauses match the given
 * context. Returns descriptors only — call `evaluateDocCheck` per
 * descriptor to materialise a Finding.
 */
export function findMatchingDocChecks(
  docChecks: DocCheckDescriptor[],
  context: DocCheckEvaluationContext,
): DocCheckDescriptor[] {
  return docChecks.filter((d) => matchesWhen(d.manifest.when, context));
}

function matchesWhen(
  when: DocCheckMatch,
  context: DocCheckEvaluationContext,
): boolean {
  if (when["files-changed-any"]) {
    const ok = when["files-changed-any"].some((glob) =>
      context.changedFiles.some((f) => matchGlob(glob, f)),
    );
    if (!ok) return false;
  }
  if (when["files-changed-all"]) {
    const ok = when["files-changed-all"].every((glob) =>
      context.changedFiles.some((f) => matchGlob(glob, f)),
    );
    if (!ok) return false;
  }
  if (when["commit-message-pattern"]) {
    if (!context.commitMessage) return false;
    const re = new RegExp(when["commit-message-pattern"]);
    if (!re.test(context.commitMessage)) return false;
  }
  if (when["branch-pattern"]) {
    if (!context.branch) return false;
    const re = new RegExp(when["branch-pattern"]);
    if (!re.test(context.branch)) return false;
  }
  return true;
}

/**
 * Evaluate a single doc-check against the context. Always returns a
 * finding (the check has already matched `when`); `missing` reports
 * which `require.{one-of,all-of}` entries were NOT touched. When the
 * require clause is satisfied, `missing` is undefined and the caller
 * should treat the check as satisfied (still surfaces an info finding
 * so prompts can be shown unconditionally if desired).
 */
export function evaluateDocCheck(
  descriptor: DocCheckDescriptor,
  context: DocCheckEvaluationContext,
): DocCheckFinding {
  const m = descriptor.manifest;
  const finding: DocCheckFinding = {
    id: m.id,
    severity: m.severity ?? "should-fix",
    prompt: m.prompt,
    matchedTriggers: matchedTriggerList(m.when, context),
    manifestPath: descriptor.manifestPath,
  };

  if (m.require) {
    const missing: string[] = [];
    if (m.require["one-of"] && m.require["one-of"].length > 0) {
      const anyTouched = m.require["one-of"].some((path) =>
        context.changedFiles.some((f) => matchGlob(path, f) || f === path),
      );
      if (!anyTouched) {
        // Report all candidates as missing — none satisfied.
        missing.push(...m.require["one-of"]);
      }
    }
    if (m.require["all-of"]) {
      for (const path of m.require["all-of"]) {
        const touched = context.changedFiles.some(
          (f) => matchGlob(path, f) || f === path,
        );
        if (!touched) missing.push(path);
      }
    }
    if (missing.length > 0) finding.missing = missing;
  }

  return finding;
}

function matchedTriggerList(
  when: DocCheckMatch,
  context: DocCheckEvaluationContext,
): string[] {
  const out: string[] = [];
  if (when["files-changed-any"]) {
    for (const glob of when["files-changed-any"]) {
      if (context.changedFiles.some((f) => matchGlob(glob, f))) {
        out.push(`files-changed-any:${glob}`);
      }
    }
  }
  if (when["files-changed-all"]) {
    for (const glob of when["files-changed-all"]) {
      out.push(`files-changed-all:${glob}`);
    }
  }
  if (when["commit-message-pattern"]) {
    out.push(`commit-message-pattern:${when["commit-message-pattern"]}`);
  }
  if (when["branch-pattern"]) {
    out.push(`branch-pattern:${when["branch-pattern"]}`);
  }
  return out;
}

/**
 * Glob matcher supporting `*`, `**`, `?`, and bracket character classes.
 * We deliberately implement this in-house — pulling in micromatch /
 * minimatch widens substrate's runtime surface for a feature whose
 * needs are narrow: file-path globs against repo-relative paths.
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  return globToRegex(pattern).test(filePath);
}

function globToRegex(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**` matches any number of path segments (including zero).
        // Consume optional trailing slash that often follows `**/`.
        re += "(?:.*)";
        i += 2;
        if (pattern[i] === "/") i += 1;
      } else {
        // single `*` matches anything except `/`
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (c === "[") {
      // bracket class — copy until closing `]`
      const end = pattern.indexOf("]", i);
      if (end === -1) {
        re += "\\[";
        i += 1;
      } else {
        re += pattern.slice(i, end + 1);
        i = end + 1;
      }
    } else if (".+^${}()|\\".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}
