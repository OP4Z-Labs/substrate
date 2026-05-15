import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Filesystem primitives used by init/create/audit commands.
 *
 * Kept narrow and synchronous on purpose: v0.1's commands are single-shot
 * (no concurrent I/O, no long-running tasks). Async wrappers can be
 * added in v0.3 if/when we introduce parallel detector runs.
 */

/** Ensure a directory exists; idempotent. */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write a file, creating its parent directory as needed.
 *
 * Returns true if a new file was written, false if it already existed
 * and `overwrite` was false. Callers use this to decide whether to log
 * "created" vs "skipped (exists)".
 */
export function writeFileIfMissing(
  filePath: string,
  contents: string,
  overwrite = false,
): boolean {
  if (!overwrite && existsSync(filePath)) {
    return false;
  }
  ensureDir(dirname(filePath));
  writeFileSync(filePath, contents, "utf8");
  return true;
}

/** Read a UTF-8 text file. Throws on missing — caller decides recovery. */
export function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

/**
 * SHA-256 of a string. Used by the manifest to track scaffolded files
 * for the v0.5 upgrade flow. SHA-256 is overkill for collision concerns
 * but it's the boring choice and Node's `crypto` ships it natively.
 */
export function hashContent(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Recursively copy a template directory into a target location.
 *
 * `replacements` is applied to both file *contents* and *paths*. Path
 * substitution lets templates use `{{NAME_SNAKE}}` as a directory name
 * (e.g. for Python packages where the source folder must match the
 * package name).
 *
 * Per the brief, the substitution is plain `String.split().join()`
 * against the keys — no Handlebars, no regex special-character risk.
 *
 * If a target file already exists, it's skipped (init is idempotent).
 */
export function copyTemplate(
  sourceDir: string,
  targetDir: string,
  replacements: Record<string, string> = {},
  binaryExtensions: ReadonlyArray<string> = [".png", ".jpg", ".gif", ".ico"],
): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(sourceDir)) {
    throw new Error(`Substrate: template source missing at ${sourceDir}`);
  }

  walk(sourceDir, (absPath) => {
    const rel = relative(sourceDir, absPath);
    const finalRel = applyReplacements(rel, replacements);
    const target = join(targetDir, finalRel);
    if (existsSync(target)) {
      skipped.push(finalRel);
      return;
    }
    const isBinary = binaryExtensions.some((ext) => absPath.endsWith(ext));
    if (isBinary) {
      ensureDir(dirname(target));
      copyFileSync(absPath, target);
    } else {
      const contents = applyReplacements(readText(absPath), replacements);
      ensureDir(dirname(target));
      writeFileSync(target, contents, "utf8");
    }
    created.push(finalRel);
  });

  return { created, skipped };
}

function applyReplacements(input: string, replacements: Record<string, string>): string {
  let out = input;
  for (const [key, value] of Object.entries(replacements)) {
    // Plain global string replacement — no regex special-character risk
    // as long as keys are restricted to `{{TOKEN}}`-shaped placeholders.
    out = out.split(key).join(value);
  }
  return out;
}

function walk(dir: string, visit: (absPath: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, visit);
    } else if (st.isFile()) {
      visit(full);
    }
  }
}

/** List immediate children (files only) of a directory. Returns [] if missing. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isFile());
}
