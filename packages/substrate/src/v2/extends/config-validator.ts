/**
 * Substrate v3 — `substrate.config.json` validator.
 *
 * v2.0 ships a `config.schema.json` but does not runtime-validate
 * configs (they're parsed as plain JSON and cast through `SubstrateConfig`
 * at call sites). v3 introduces the `extends` field — which adopters
 * will hand-edit — so we need to surface schema errors with a clear
 * message instead of letting a typo silently degrade into "no extends
 * sources resolved."
 *
 * This module mirrors the shape of `v2/validate.ts` (the workflow-manifest
 * validator) but points at `schemas/config.schema.json`. ajv is already a
 * runtime dep, so no new dependencies are added.
 *
 * Used by:
 *   - Sub-phase B resolver: validates the consumer's config before
 *     attempting to walk `extends`.
 *   - Sub-phase D CLI: `substrate extends list` calls this so adopters
 *     get an actionable error before the resolver reports a vague miss.
 *   - Tests: pure-data inputs to `validateExtendsSource` /
 *     `validateConfig` exercise the schema directly without a tempdir.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { ExtendsSource, SubstrateConfig } from "../../util/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Walk up from `src/v2/extends/` or `dist/v2/extends/` to find the bundled schemas. */
function resolveConfigSchemaPath(): string {
  let cursor = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(cursor, "schemas", "config.schema.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    `Substrate v3: could not locate config.schema.json (started from ${HERE}). ` +
      `This usually means the package was built without bundling the schemas/ folder.`,
  );
}

export interface ConfigValidationError {
  /** JSON pointer into the document (e.g. `/extends/0/source`). Empty string for root. */
  path: string;
  /** Human-readable description. */
  message: string;
  /** ajv keyword (`required`, `pattern`, etc.). */
  keyword: string;
  /** ajv params bag. */
  params?: Record<string, unknown>;
}

export interface ConfigValidationResult {
  ok: boolean;
  errors: ConfigValidationError[];
  schemaPath: string;
}

interface AjvErrorShape {
  instancePath?: string;
  schemaPath?: string;
  keyword?: string;
  params?: Record<string, unknown>;
  message?: string;
}

interface CachedValidator {
  validate: (data: unknown) => boolean;
  errors: () => ConfigValidationError[];
  schemaPath: string;
}

let cached: CachedValidator | null = null;

function getValidator(): CachedValidator {
  if (cached) return cached;

  const schemaPath = resolveConfigSchemaPath();
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

  // Mirror v2/validate.ts's ajv-default dance for ESM-vs-CJS compat.
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
    errors: () =>
      formatAjvErrors((validate as unknown as { errors?: AjvErrorShape[] | null }).errors ?? []),
    schemaPath,
  };
  return cached;
}

function formatAjvErrors(errors: AjvErrorShape[]): ConfigValidationError[] {
  return errors.map((e) => ({
    path: e.instancePath || "",
    keyword: e.keyword ?? "unknown",
    message: e.message ?? "validation failed",
    params: e.params ?? undefined,
  }));
}

/**
 * Validate a parsed config object against `config.schema.json`.
 *
 * Backward compat: a v2.0 consumer's config that has no `extends` field
 * passes validation unchanged. The schema is additive (the field is
 * optional and the schema's root already declares `additionalProperties: true`
 * for forward compat, so unknown fields are tolerated).
 */
export function validateConfig(data: unknown): ConfigValidationResult {
  const v = getValidator();
  const ok = v.validate(data);
  return { ok, errors: ok ? [] : v.errors(), schemaPath: v.schemaPath };
}

/**
 * Convenience: read + parse + validate a `substrate.config.json` at the
 * given absolute path. Returns the parsed config when valid, plus the
 * usual `ok` / `errors` shape so callers can distinguish "no config" from
 * "config is invalid."
 */
export function validateConfigFile(path: string): ConfigValidationResult & {
  parsed: SubstrateConfig | null;
} {
  if (!existsSync(path)) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          keyword: "file-not-found",
          message: `Config file not found: ${path}`,
        },
      ],
      schemaPath: resolveConfigSchemaPath(),
      parsed: null,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          keyword: "parse-error",
          message: `Failed to parse JSON: ${(err as Error).message}`,
        },
      ],
      schemaPath: resolveConfigSchemaPath(),
      parsed: null,
    };
  }
  const result = validateConfig(parsed);
  return {
    ...result,
    parsed: result.ok ? (parsed as SubstrateConfig) : null,
  };
}

/**
 * Classify an `extends` source URL into its kind. Returns `null` when the
 * source string doesn't match any known kind — callers should treat that
 * as a hard error (the schema's `pattern` keyword catches it first, but
 * resolver code paths shouldn't rely on schema validation having run).
 */
export type ExtendsKind = "npm" | "github" | "file";

export function classifyExtendsSource(source: string): ExtendsKind | null {
  if (source.startsWith("npm:")) return "npm";
  if (source.startsWith("github:")) return "github";
  if (source.startsWith("file:")) return "file";
  return null;
}

/**
 * Validate a single `ExtendsSource` entry without invoking ajv. Used by
 * the resolver to surface "version on a non-npm source" or "ref on a
 * non-github source" as warnings (the schema accepts both, by design,
 * to keep config edits forgiving — but the resolver flags them so they
 * don't silently no-op).
 */
export function validateExtendsSource(entry: ExtendsSource): {
  ok: boolean;
  kind: ExtendsKind | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const kind = classifyExtendsSource(entry.source);
  if (!kind) {
    return { ok: false, kind: null, warnings };
  }
  if (entry.version && kind !== "npm") {
    warnings.push(
      `extends entry '${entry.source}': 'version' is only meaningful for npm: sources; ignored for ${kind}: sources.`,
    );
  }
  if (entry.ref && kind !== "github") {
    warnings.push(
      `extends entry '${entry.source}': 'ref' is only meaningful for github: sources; ignored for ${kind}: sources.`,
    );
  }
  return { ok: true, kind, warnings };
}
