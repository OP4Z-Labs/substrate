import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Filesystem helpers shared across commands.
 *
 * Design decision: we resolve the bundled `templates/` directory by
 * walking up from this module's own `import.meta.url`. That works in
 * both `dist/` (compiled) and `src/` (tests via vitest) because the
 * `templates/` directory always sits at the package root.
 *
 * Why not `require.resolve("cadence/templates")`? That requires
 * `cadence` to be installed (or a self-reference declared in
 * package.json), which adds a packaging foot-gun. The walk-up is
 * boring and explicit.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the templates directory bundled with this package.
 *
 * Walks up from the current module until it finds a sibling
 * `templates/` directory containing the expected subfolders.
 */
export function getTemplatesDir(): string {
  let cursor = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(cursor, "templates");
    if (existsSync(candidate) && existsSync(join(candidate, "init"))) {
      return candidate;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    `Cadence: could not locate bundled templates directory (started from ${HERE}). ` +
      `This usually means the package was not built or is missing the templates/ folder.`,
  );
}

/**
 * Resolve a target repository root.
 *
 * For v0.1 we don't walk up looking for a marker — the user's CWD is
 * the root. v0.3's `cadence doctor` may add upward search once we have
 * `cadence.config.json` to anchor on, but commands are explicit for now.
 */
export function resolveTargetRoot(input?: string): string {
  return resolve(process.cwd(), input ?? ".");
}

/**
 * The seven directories that `cadence init` creates under `auto/`.
 *
 * Locked from plan §2. Adding to this list is a v0.x feature; removing
 * is a breaking change.
 */
export const AUTO_SUBDIRS = [
  "commands",
  "instructions",
  "scripts",
  "config",
  "standards",
  "audits",
  "docs",
] as const;

export type AutoSubdir = (typeof AUTO_SUBDIRS)[number];
