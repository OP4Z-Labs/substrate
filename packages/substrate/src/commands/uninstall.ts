/**
 * `substrate uninstall` — remove everything substrate wrote to this repo.
 *
 * Discovers:
 *   - `auto/` directory and its contents
 *   - `substrate/` directory (audit reports, RULES.yaml)
 *   - `substrate.config.json` / `substrate.config.yaml`
 *   - Scaffolded standards docs (from `auto/standards/`)
 *   - Bridge files (`.claude/commands/substrate.md`, `.cursor/commands/substrate.md`,
 *     `.substrate/mcp/...`)
 *   - The manifest at `auto/.substrate-manifest.json`
 *
 * Discovery sources:
 *   - The manifest itself (when present and non-empty) lists every file
 *     substrate scaffolded with a content hash.
 *   - Known-location fallback: even when the manifest is gone, we
 *     remove the canonical layout above.
 *
 * Safety:
 *   - `--dry-run` shows what WOULD be removed without touching anything.
 *   - Without `--yes`, an interactive confirmation is required.
 *   - User-modified files (whose current hash differs from the manifest's
 *     `contentHash`) are preserved unless `--force` is passed.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { hashContent } from "../util/fs.js";
import { manifestPath, readManifest } from "../util/manifest.js";

export interface UninstallOptions {
  cwd?: string;
  /** Don't write — just print the plan. */
  dryRun?: boolean;
  /** Skip the confirmation prompt. */
  yes?: boolean;
  /** Remove modified files too (manifest hash mismatch). */
  force?: boolean;
  json?: boolean;
  quiet?: boolean;
}

export interface UninstallPlanItem {
  path: string;
  reason: "manifest-tracked" | "known-location";
  modified: boolean;
  willRemove: boolean;
  skipReason?: string;
}

export interface UninstallResult {
  dryRun: boolean;
  planned: UninstallPlanItem[];
  removed: string[];
  skipped: string[];
}

const KNOWN_TOP_LEVEL = [
  "auto",
  "substrate",
  "substrate.config.json",
  "substrate.config.yaml",
];

const KNOWN_BRIDGE_PATHS = [
  ".claude/commands/substrate.md",
  ".cursor/commands/substrate.md",
  ".substrate/mcp/substrate-server.json",
  ".substrate/mcp/README.md",
];

export function runUninstall(options: UninstallOptions = {}): UninstallResult {
  const repoRoot = options.cwd ?? process.cwd();
  const plan: UninstallPlanItem[] = [];

  // Pass 1: manifest-tracked files (precise, with modified detection).
  const autoDir = join(repoRoot, "auto");
  if (existsSync(autoDir) && existsSync(manifestPath(autoDir))) {
    const manifest = readManifest(autoDir);
    for (const entry of manifest.entries) {
      const abs = join(repoRoot, entry.path);
      if (!existsSync(abs)) continue;
      let modified = false;
      try {
        const text = readFileSync(abs, "utf8");
        const currentHash = `sha256:${hashContent(text)}`;
        modified = currentHash !== entry.contentHash;
      } catch {
        // Binary or unreadable — assume unmodified.
        modified = false;
      }
      const willRemove = options.force || !modified;
      plan.push({
        path: entry.path,
        reason: "manifest-tracked",
        modified,
        willRemove,
        skipReason: willRemove ? undefined : "user-modified — pass --force to remove",
      });
    }
  }

  // Pass 2: known locations (best-effort fallback when manifest is missing
  // or when items live outside it — bridge files, etc.).
  //
  // Skip a known-location directory if it CONTAINS a manifest-tracked file
  // that we're preserving — otherwise we'd nuke the user's edits via the
  // parent dir removal.
  const trackedPaths = new Set(plan.map((p) => p.path));
  const preservedFiles = new Set(
    plan.filter((p) => !p.willRemove).map((p) => p.path),
  );
  for (const rel of [...KNOWN_TOP_LEVEL, ...KNOWN_BRIDGE_PATHS]) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs) || trackedPaths.has(rel)) continue;
    // Check whether this path contains any preserved file (path starts
    // with this dir).
    const blockedByPreserved = Array.from(preservedFiles).some((p) =>
      p === rel || p.startsWith(rel + "/"),
    );
    if (blockedByPreserved) {
      plan.push({
        path: rel,
        reason: "known-location",
        modified: false,
        willRemove: false,
        skipReason: "contains user-modified files (pass --force to remove anyway)",
      });
      continue;
    }
    plan.push({
      path: rel,
      reason: "known-location",
      modified: false,
      willRemove: true,
    });
  }

  if (options.dryRun) {
    if (options.json) {
      process.stdout.write(
        JSON.stringify({ dryRun: true, planned: plan, removed: [], skipped: [] }, null, 2) + "\n",
      );
    } else if (!options.quiet) {
      renderPlan(plan, true);
    }
    return { dryRun: true, planned: plan, removed: [], skipped: [] };
  }

  if (!options.yes && !options.json) {
    if (!options.quiet) {
      renderPlan(plan, false);
      console.log(
        kleur.yellow(
          `\nPass --yes to proceed, or --dry-run to inspect the plan again.`,
        ),
      );
    }
    return { dryRun: false, planned: plan, removed: [], skipped: [] };
  }

  const removed: string[] = [];
  const skipped: string[] = [];
  for (const item of plan) {
    if (!item.willRemove) {
      skipped.push(item.path);
      continue;
    }
    const abs = join(repoRoot, item.path);
    try {
      const st = statSync(abs);
      if (st.isDirectory()) rmSync(abs, { recursive: true, force: true });
      else unlinkSync(abs);
      removed.push(item.path);
    } catch {
      skipped.push(item.path);
    }
  }

  // Clean up now-empty parent dirs left behind by file-only removals
  // (e.g., `.substrate/`, `.cursor/commands/`).
  for (const rel of [".substrate/mcp", ".substrate", ".cursor/commands", ".claude/commands"]) {
    const abs = join(repoRoot, rel);
    if (existsSync(abs) && isEmptyDir(abs)) {
      try {
        rmSync(abs, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  const result: UninstallResult = { dryRun: false, planned: plan, removed, skipped };
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!options.quiet) {
    console.log(
      kleur.green(`\n✓ uninstall complete — `) +
        `${removed.length} removed, ${skipped.length} preserved.`,
    );
    for (const s of skipped) {
      console.log(kleur.dim(`  preserved: ${s}`));
    }
  }
  return result;
}

function renderPlan(plan: UninstallPlanItem[], isDryRun: boolean): void {
  console.log(
    kleur.bold(isDryRun ? "\nSubstrate uninstall — dry run\n" : "\nSubstrate uninstall plan\n"),
  );
  if (plan.length === 0) {
    console.log(kleur.dim("  Nothing to remove. (No substrate artefacts found.)"));
    return;
  }
  for (const item of plan) {
    const tag = item.modified
      ? kleur.yellow("  modified")
      : item.reason === "manifest-tracked"
        ? kleur.dim("  tracked ")
        : kleur.dim("  known   ");
    const verdict = item.willRemove ? kleur.red("REMOVE") : kleur.yellow("KEEP  ");
    console.log(`${verdict} ${tag}  ${item.path}`);
    if (item.skipReason) {
      console.log(`         ${kleur.dim(item.skipReason)}`);
    }
  }
  console.log(kleur.dim(`\n  ${plan.filter((p) => p.willRemove).length} will be removed, ${plan.filter((p) => !p.willRemove).length} preserved.`));
}

function isEmptyDir(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}
