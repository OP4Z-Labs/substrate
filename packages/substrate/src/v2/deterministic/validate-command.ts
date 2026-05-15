/**
 * `substrate validate [path]` — workflow manifest schema validation.
 *
 * Layer: deterministic. No AI, no network, machine-output friendly.
 *
 * Exit codes:
 *   0 — all manifests valid
 *   1 — at least one schema violation
 *   2 — file or directory not found
 *
 * Modes:
 *   - With <path>: validate a single manifest file.
 *   - Without <path>: walk `substrate/workflows/**\/*.yaml` under the
 *     consumer repo root, validate each, summarize.
 *
 * Output:
 *   - Default: human-readable Markdown-style table.
 *   - --json: stable shape `{ ok, files: [{ path, ok, errors }] }`
 *     suitable for CI parsing.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import kleur from "kleur";
import { resolveTargetRoot } from "../../util/paths.js";
import { validateManifestFile, type ValidationError } from "../validate.js";

export interface ValidateOptions {
  /** Path to a single manifest to validate; if undefined, walks workflows dir. */
  path?: string;
  /** Override the repo root (test seam). */
  cwd?: string;
  /** Emit machine-readable JSON instead of human text. */
  json?: boolean;
  /** Suppress progress output (errors still print on stderr). */
  quiet?: boolean;
}

export interface ValidateFileResult {
  path: string;
  ok: boolean;
  errors: ValidationError[];
}

export interface ValidateResult {
  ok: boolean;
  files: ValidateFileResult[];
  /** Exit code the CLI should use. */
  exitCode: 0 | 1 | 2;
}

/**
 * Walk a directory recursively returning all `*.yaml` and `*.yml` files.
 * Used to enumerate workflow manifests. We deliberately don't use a
 * glob lib here — Substrate has zero glob runtime dependencies and the
 * directory shape is small and predictable.
 */
function listManifestFiles(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && (name.endsWith(".yaml") || name.endsWith(".yml"))) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

export function runValidate(options: ValidateOptions = {}): ValidateResult {
  const root = resolveTargetRoot(options.cwd);
  const targets: string[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  if (options.path) {
    const abs = resolve(root, options.path);
    if (!existsSync(abs)) {
      const result: ValidateResult = {
        ok: false,
        files: [
          {
            path: abs,
            ok: false,
            errors: [
              {
                path: "",
                keyword: "file-not-found",
                message: `File not found: ${abs}`,
              },
            ],
          },
        ],
        exitCode: 2,
      };
      emit(result, options);
      return result;
    }
    targets.push(abs);
  } else {
    const workflowsDir = join(root, "substrate", "workflows");
    if (!existsSync(workflowsDir)) {
      const result: ValidateResult = {
        ok: false,
        files: [
          {
            path: workflowsDir,
            ok: false,
            errors: [
              {
                path: "",
                keyword: "file-not-found",
                message: `No substrate/workflows/ directory found at ${workflowsDir}`,
              },
            ],
          },
        ],
        exitCode: 2,
      };
      emit(result, options);
      return result;
    }
    targets.push(...listManifestFiles(workflowsDir));
  }

  const files: ValidateFileResult[] = [];
  for (const file of targets) {
    const result = validateManifestFile(file);
    files.push({ path: file, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      // A `file-not-found` error from validateManifestFile means the file
      // existed when we listed it but disappeared (race). Treat as 2;
      // otherwise treat schema violations as 1.
      if (result.errors.some((e) => e.keyword === "file-not-found")) {
        exitCode = 2;
      } else if (exitCode === 0) {
        exitCode = 1;
      }
    }
  }

  const ok = files.every((f) => f.ok);
  const result: ValidateResult = { ok, files, exitCode };
  emit(result, options);
  return result;
}

function emit(result: ValidateResult, options: ValidateOptions): void {
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (options.quiet) return;

  if (result.files.length === 0) {
    console.log(kleur.yellow("No manifest files found."));
    return;
  }

  for (const file of result.files) {
    const display = relative(process.cwd(), file.path) || file.path;
    if (file.ok) {
      console.log(`${kleur.green("✓")} ${display}`);
    } else {
      console.log(`${kleur.red("✗")} ${display}`);
      for (const err of file.errors) {
        const pointer = err.path || "(root)";
        console.log(`    ${kleur.dim(pointer)}  ${err.message}`);
      }
    }
  }

  const failed = result.files.filter((f) => !f.ok).length;
  const total = result.files.length;
  if (result.ok) {
    console.log(`\n${kleur.green("✓")} ${total} manifest(s) valid.`);
  } else {
    console.log(
      `\n${kleur.red("✗")} ${failed} of ${total} manifest(s) failed validation.`,
    );
  }
}
