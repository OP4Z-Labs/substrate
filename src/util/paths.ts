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
 * Locate the bundled `templates-history/` directory. Added in v0.8 to
 * support the real three-way merge in `cadence upgrade --apply`.
 *
 * Layout:
 *   templates-history/
 *     0.5.0/                  ← snapshot of `templates/` shipped with cadence@0.5.0
 *     0.8.0/                  ← snapshot of `templates/` shipped with cadence@0.8.0
 *     ...                     ← one per shipped version going forward
 *
 * The directory is OPTIONAL — if a cadence build lacks it (e.g. someone is
 * running from a partial checkout), the upgrade flow falls back to the v0.5
 * degenerate two-way diff. `getTemplatesHistoryDir()` returns `null` in that
 * case rather than throwing, so the caller can branch cleanly.
 *
 * The directory is sibling to `templates/` — i.e. the package root, NOT a
 * subdirectory of `templates/`. That keeps the npm bundle clear about the
 * difference between "current template" and "historical reference."
 */
export function getTemplatesHistoryDir(): string | null {
  let cursor = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(cursor, "templates-history");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

/**
 * Resolve the path to a specific version's bundled template snapshot. Used
 * by the three-way merge to fetch the *original* template content at the
 * version recorded in the manifest entry.
 *
 * Returns null when:
 *   - `templates-history/` itself is missing (very old / partial install)
 *   - the requested version was never published in this build's history
 *   - the specific file within that version's snapshot doesn't exist
 *     (e.g. the file was added in a later version)
 *
 * The relativeTemplatePath is the path **inside** the templates directory,
 * e.g. `audits/audit-backend.md` or `standards/backend/architecture.md`.
 * Callers use `resolveTemplatePath()` from `upgrade.ts` to compute that.
 */
export function getHistoricalTemplate(
  version: string,
  relativeTemplatePath: string,
): string | null {
  const historyDir = getTemplatesHistoryDir();
  if (!historyDir) return null;
  const versionDir = join(historyDir, version);
  if (!existsSync(versionDir)) return null;
  const candidate = join(versionDir, relativeTemplatePath);
  return existsSync(candidate) ? candidate : null;
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
