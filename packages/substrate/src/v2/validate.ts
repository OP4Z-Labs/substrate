/**
 * Substrate v2 — workflow manifest validator.
 *
 * Validates a parsed YAML/JSON object against
 * `packages/substrate/schemas/workflow.schema.json`. Used by:
 *   - `substrate validate <path>` (CLI; deterministic layer)
 *   - The Discoverer (registers only valid manifests)
 *   - The orchestrator (defense-in-depth)
 *
 * Design call: we ship ajv@8 as a runtime dep. The schema is loaded
 * lazily from disk on first use and cached, so commands that don't
 * touch v2 pay nothing.
 *
 * Why ajv: it's the de-facto JSON-Schema validator for Node, supports
 * draft-07 (matches our schema), and surfaces structured error
 * objects we can format for CLI output.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import type { WorkflowManifest } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the bundled workflow schema. Mirrors the
 * `getTemplatesDir()` walk-up so it works from both `src/` (vitest)
 * and `dist/` (compiled).
 */
function resolveSchemaPath(): string {
  let cursor = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(cursor, "schemas", "workflow.schema.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    `Substrate v2: could not locate workflow.schema.json (started from ${HERE}). ` +
      `This usually means the package was built without bundling the schemas/ folder.`,
  );
}

interface CachedValidator {
  validate: (data: unknown) => boolean;
  errors: () => ValidationError[];
  schemaPath: string;
}

let cached: CachedValidator | null = null;

export interface ValidationError {
  /** JSON pointer into the document, e.g. `/steps/0/type`. Empty string for root. */
  path: string;
  /** Human-readable description. */
  message: string;
  /** ajv's keyword (e.g. "required", "enum", "pattern"). */
  keyword: string;
  /** ajv's params bag, kept for richer CLI output. */
  params?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  /** Path of the schema used (mostly for diagnostics). */
  schemaPath: string;
}

function getValidator(): CachedValidator {
  if (cached) return cached;

  const schemaPath = resolveSchemaPath();
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

  // ajv@8 ships with strict mode that rejects keywords like `description`
  // on schemas with `oneOf`. We turn the strict-keywords warning OFF
  // because our schema authors comments via `description` on every
  // sub-schema; the warning would spam the console.
  //
  // ajv ships as a CJS module with both `module.exports = Ajv` AND
  // named exports. With `esModuleInterop` on, `Ajv` (the default
  // import) is the constructor; some tooling resolves it as the
  // namespace object instead. The `default ?? Ajv` dance handles both
  // shapes — TypeScript's type for the import is the namespace, but
  // the runtime value is the class.
  const AjvAny = Ajv as unknown as {
    default?: new (opts: Record<string, unknown>) => unknown;
  };
  const AjvCtor = (AjvAny.default ??
    (Ajv as unknown)) as new (opts: Record<string, unknown>) => {
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

  cached = {
    validate: (data) => validate(data),
    errors: () => formatAjvErrors(validate.errors ?? []),
    schemaPath,
  };
  return cached;
}

interface AjvErrorShape {
  instancePath?: string;
  schemaPath?: string;
  keyword?: string;
  params?: Record<string, unknown>;
  message?: string;
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
 * Validate a parsed manifest object against the schema. The input
 * should already be parsed YAML/JSON; if you have a filesystem path,
 * use `validateManifestFile` instead.
 */
export function validateManifest(data: unknown): ValidationResult {
  const v = getValidator();
  const ok = v.validate(data);
  return { ok, errors: ok ? [] : v.errors(), schemaPath: v.schemaPath };
}

/**
 * Parse + validate a manifest file at the given path. Returns the
 * `ValidationResult`; on success, callers can safely cast the parsed
 * data through `WorkflowManifest` (we don't return the parsed value
 * to keep the boundary tight — see `loadManifestFile` for the parse +
 * load path).
 */
export function validateManifestFile(path: string): ValidationResult & {
  parsed: WorkflowManifest | null;
} {
  if (!existsSync(path)) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          keyword: "file-not-found",
          message: `Manifest file not found: ${path}`,
        },
      ],
      schemaPath: resolveSchemaPath(),
      parsed: null,
    };
  }
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    // YAML and JSON are both supported (YAML is a superset of JSON syntax
    // in the eyes of the `yaml` package). We use `yaml.parse` for both.
    parsed = parseYaml(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          keyword: "parse-error",
          message: `YAML/JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      schemaPath: resolveSchemaPath(),
      parsed: null,
    };
  }
  const result = validateManifest(parsed);
  return {
    ...result,
    parsed: result.ok ? (parsed as WorkflowManifest) : null,
  };
}
