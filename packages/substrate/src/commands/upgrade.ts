/**
 * `substrate upgrade` — three-way-merge against bundled templates.
 *
 * v0.5's headline feature, completed in v0.8 with a real three-way anchor
 * via `templates-history/`. Every scaffolded file (`substrate init` + `substrate
 * add`) is recorded in `auto/.substrate-manifest.json` with a templateVersion +
 * sha256 contentHash. `upgrade` walks that manifest and, per file, classifies
 * the drift state:
 *
 *   - **missing**     — manifest tracks it but the file is gone (user
 *                       deleted). Skip; the user clearly opted out.
 *   - **unmodified**  — on-disk hash matches the recorded hash. Auto-apply
 *                       the new template content. Manifest hash + version
 *                       are refreshed.
 *   - **modified**    — hash differs from recorded. User has edited the
 *                       file. Drop into the interactive 3-way merge UX.
 *   - **ejected**     — manifest entry's `ejected: true` flag is set. Skip
 *                       unconditionally.
 *   - **template-gone** — manifest tracks a file whose template no longer
 *                       exists in the bundled substrate package. Log a
 *                       warning; nothing to upgrade against.
 *
 * **Three-way merge anchors (v0.8):**
 *   - **original** — content at `templates-history/<templateVersion>/<rel>`,
 *                    where templateVersion comes from the manifest entry.
 *                    This is the file as substrate ORIGINALLY shipped it,
 *                    before the user edited.
 *   - **current**  — content currently on disk in the user's repo.
 *   - **new**      — content at `templates/<rel>`, i.e. what substrate wants
 *                    to ship in this version.
 *
 * When all three anchors are available, the merge UX shows a richer view:
 *   - "your edits since substrate@<X>" diff (original → current)
 *   - "what substrate changed since <X>"   diff (original → new)
 *   - "raw drift to resolve"             diff (current → new)
 *
 * When `templates-history/<templateVersion>/` is missing (e.g. a user
 * scaffolded against a version this build no longer carries history for),
 * we gracefully fall back to the v0.5 degenerate two-way (`current vs new`).
 *
 * Choices presented per modified file:
 *   - `keep`     : retain the user's copy unchanged
 *   - `take-new` : overwrite with the new template
 *   - `merge`    : write `<file>.substrate-merge` containing the new template
 *                  beside the user's copy; the user resolves manually
 *   - `eject`    : flag the manifest entry as ejected so future upgrades
 *                  skip this file entirely
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { select } from "@inquirer/prompts";
import kleur from "kleur";
import { hashContent } from "../util/fs.js";
import { diffLines, formatUnifiedDiff } from "../util/diff.js";
import { manifestPath, readManifest, writeManifest } from "../util/manifest.js";
import {
  getHistoricalTemplate,
  getTemplatesDir,
  getTemplatesHistoryDir,
  resolveTargetRoot,
} from "../util/paths.js";
import type { SubstrateManifest, ManifestEntry } from "../util/types.js";
import { SUBSTRATE_VERSION } from "../util/version.js";

export type UpgradeState =
  | "unmodified"
  | "modified"
  | "missing"
  | "ejected"
  | "template-gone";

export interface UpgradePlanEntry {
  /** Repo-relative path of the scaffolded file. */
  path: string;
  state: UpgradeState;
  /** Manifest-recorded template version (for forensics). */
  recordedTemplateVersion: string;
  /** Current substrate template version (SUBSTRATE_VERSION at upgrade time). */
  currentTemplateVersion: string;
  /** True when on-disk hash matches the manifest hash. */
  hashMatches: boolean;
  /** True when the template still exists in the substrate package. */
  templateExists: boolean;
  /** Absolute path to the new template if it exists, else null. */
  templatePath: string | null;
  /**
   * Absolute path to the ORIGINAL template content at the manifest's
   * `templateVersion`, if `templates-history/` ships that version. Null
   * when v0.8's three-way anchor is unavailable — the merge UX falls back
   * to the v0.5 degenerate two-way in that case.
   *
   * Added in v0.8.
   */
  originalTemplatePath: string | null;
  /**
   * True when the full three-way anchor set is available (original + current
   * + new template). When false, the merge UX falls back to two-way.
   *
   * Added in v0.8.
   */
  threeWay: boolean;
  /** Unified diff of current → new (always populated for modified). */
  diff?: string;
  /**
   * "Your edits" diff: original → current. Only populated when threeWay
   * is true. Shows what the user changed since they scaffolded.
   *
   * Added in v0.8.
   */
  userEditsDiff?: string;
  /**
   * "Template changes" diff: original → new. Only populated when threeWay
   * is true. Shows what substrate changed in the template between the
   * recorded version and SUBSTRATE_VERSION.
   *
   * Added in v0.8.
   */
  templateChangesDiff?: string;
}

export interface UpgradePlan {
  entries: UpgradePlanEntry[];
  /** Counts by state for the summary line. */
  counts: Record<UpgradeState, number>;
}

export type UpgradeChoice = "keep" | "take-new" | "merge" | "eject";

export interface UpgradeAppliedEntry {
  path: string;
  choice: UpgradeChoice | "auto-update" | "skip";
  /** Set when choice === "merge"; the path of the `.substrate-merge` file. */
  mergePath?: string;
}

export interface UpgradeOptions {
  cwd?: string;
  /** Don't write anything; print what would happen. */
  check?: boolean;
  /** Run the interactive merge UX. */
  apply?: boolean;
  /** Like check, but explicit alias matching `--dry-run` flag. */
  dryRun?: boolean;
  /** Suppress informational output (used by tests). */
  quiet?: boolean;
  /**
   * Non-interactive choice resolver for tests. Receives the plan entry,
   * returns a UpgradeChoice. When omitted, real prompts run via @inquirer.
   */
  resolveChoice?: (entry: UpgradePlanEntry) => Promise<UpgradeChoice> | UpgradeChoice;
}

export interface UpgradeResult {
  plan: UpgradePlan;
  /** Applied actions (empty when --check / --dry-run was used). */
  applied: UpgradeAppliedEntry[];
}

/**
 * Build the upgrade plan without performing any writes. Pure read-side —
 * safe to call from `--check`, `--dry-run`, or as part of the interactive
 * apply flow.
 */
export function planUpgrade(cwd?: string): UpgradePlan {
  const root = resolveTargetRoot(cwd);
  const autoDir = join(root, "auto");
  const manifest = readManifest(autoDir);

  let templatesDir: string;
  try {
    templatesDir = getTemplatesDir();
  } catch {
    // Without templates we can't classify anything; return an empty plan
    // and let the renderer say so.
    return { entries: [], counts: emptyCounts() };
  }

  const entries: UpgradePlanEntry[] = manifest.entries.map((entry) =>
    classifyEntry(root, templatesDir, entry),
  );

  const counts = emptyCounts();
  for (const e of entries) counts[e.state] += 1;

  return { entries, counts };
}

function emptyCounts(): Record<UpgradeState, number> {
  return {
    unmodified: 0,
    modified: 0,
    missing: 0,
    ejected: 0,
    "template-gone": 0,
  };
}

/**
 * Resolve the bundled template path for a manifest entry. Returns null
 * when the template no longer exists (renamed / removed in a later substrate
 * version) or the entry's path doesn't map to a known template surface.
 *
 * The mapping mirrors `substrate add`:
 *   - auto/instructions/main/audit-<name>.md → templates/audits/audit-<name>.md
 *   - auto/standards/<scope>/<area>.md      → templates/standards/<scope>/<area>.md
 *   - auto/standards/<scope>/<area>.yaml    → templates/standards/<scope>/<area>.yaml
 *   - auto/.../* (any file copied by init/copyTemplate) → templates/init/<path-after-auto>
 *
 * Generated registries (auto/config/scaffolds.yaml, workflows.yaml) and
 * stub command files have no template counterpart and resolve to null
 * deliberately — those aren't upgradeable in the same sense.
 */
export function resolveTemplatePath(
  templatesDir: string,
  entryPath: string,
): string | null {
  // Normalize on POSIX-style separators for matching; the manifest writes
  // forward slashes regardless of host.
  const p = entryPath.replace(/\\/g, "/");

  // Audits
  const auditMatch = p.match(/^auto\/instructions\/main\/(audit-[^/]+\.md)$/);
  if (auditMatch) {
    const candidate = join(templatesDir, "audits", auditMatch[1]);
    return existsSync(candidate) ? candidate : null;
  }

  // Standards (markdown or yaml)
  const standardMatch = p.match(/^auto\/standards\/([^/]+)\/([^/]+\.(md|yaml))$/);
  if (standardMatch) {
    const candidate = join(templatesDir, "standards", standardMatch[1], standardMatch[2]);
    return existsSync(candidate) ? candidate : null;
  }

  // Init-copied content: templates/init/<sub>/<...>
  const initMatch = p.match(/^auto\/(.+)$/);
  if (initMatch) {
    const candidate = join(templatesDir, "init", initMatch[1]);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function classifyEntry(
  root: string,
  templatesDir: string,
  entry: ManifestEntry,
): UpgradePlanEntry {
  const absPath = join(root, entry.path);
  const templatePath = resolveTemplatePath(templatesDir, entry.path);
  // Look up the original-at-recorded-version template anchor (v0.8).
  // The relative path within `templates/` is the part after the templates
  // directory itself; we reconstruct it by stripping the templatesDir prefix.
  const originalTemplatePath = templatePath
    ? resolveHistoricalTemplate(templatesDir, templatePath, entry.templateVersion)
    : null;
  const base: UpgradePlanEntry = {
    path: entry.path,
    state: "unmodified",
    recordedTemplateVersion: entry.templateVersion,
    currentTemplateVersion: SUBSTRATE_VERSION,
    hashMatches: false,
    templateExists: templatePath !== null,
    templatePath,
    originalTemplatePath,
    threeWay: originalTemplatePath !== null,
  };

  if (entry.ejected) {
    return { ...base, state: "ejected" };
  }
  if (!existsSync(absPath)) {
    return { ...base, state: "missing" };
  }
  if (!templatePath) {
    return { ...base, state: "template-gone" };
  }

  const current = readFileSync(absPath, "utf8");
  const currentHash = `sha256:${hashContent(current)}`;
  const hashMatches = currentHash === entry.contentHash;
  const newTemplate = readFileSync(templatePath, "utf8");

  // Three-way anchor: read original template content if available.
  const original = base.originalTemplatePath
    ? readFileSync(base.originalTemplatePath, "utf8")
    : null;

  // No drift at all — file is unmodified AND the template hasn't changed.
  // Manifest is already up-to-date; no work for upgrade to do.
  if (hashMatches && current === newTemplate) {
    return { ...base, hashMatches: true, state: "unmodified" };
  }

  if (hashMatches) {
    // File is unchanged from what we wrote, but the template HAS changed.
    // This is the auto-upgrade case.
    const diff = diffLines(current, newTemplate);
    return {
      ...base,
      hashMatches: true,
      state: "unmodified",
      diff: formatUnifiedDiff(diff),
    };
  }

  // User has edited. May or may not also need a template bump.
  const diff = diffLines(current, newTemplate);
  const out: UpgradePlanEntry = {
    ...base,
    hashMatches: false,
    state: "modified",
    diff: formatUnifiedDiff(diff),
  };
  if (original !== null) {
    out.userEditsDiff = formatUnifiedDiff(diffLines(original, current));
    out.templateChangesDiff = formatUnifiedDiff(diffLines(original, newTemplate));
  }
  return out;
}

/**
 * Given the absolute path to the current new-template (e.g.
 * `/.../substrate/templates/audits/audit-backend.md`), compute the
 * matching historical-template path at the recorded version, or null
 * when the historical snapshot isn't shipped.
 */
function resolveHistoricalTemplate(
  templatesDir: string,
  templatePath: string,
  recordedVersion: string,
): string | null {
  // The current-template path always starts with templatesDir; strip that
  // prefix to get the relative path used inside templates-history/.
  const prefix = templatesDir.endsWith("/") ? templatesDir : `${templatesDir}/`;
  const rel = templatePath.startsWith(prefix)
    ? templatePath.slice(prefix.length)
    : templatePath;
  return getHistoricalTemplate(recordedVersion, rel);
}

/**
 * Entry point for `substrate upgrade`. Dispatches to either the
 * read-only `--check` branch or the interactive `--apply` branch
 * based on options.
 */
export async function runUpgrade(options: UpgradeOptions = {}): Promise<UpgradeResult> {
  const checkOnly = options.check === true || options.dryRun === true;
  const apply = options.apply === true;
  if (!checkOnly && !apply) {
    throw new Error(
      "Substrate: pass `--check` (or `--dry-run`) to inspect drift, or `--apply` to merge changes.",
    );
  }
  if (checkOnly && apply) {
    throw new Error("Substrate: `--check` and `--apply` are mutually exclusive.");
  }

  const plan = planUpgrade(options.cwd);
  if (!options.quiet) {
    renderPlanHeader(plan);
  }

  if (checkOnly) {
    if (!options.quiet) {
      renderPlanDetail(plan);
    }
    return { plan, applied: [] };
  }

  // --apply path.
  const applied: UpgradeAppliedEntry[] = [];
  const root = resolveTargetRoot(options.cwd);
  const autoDir = join(root, "auto");
  const manifest = readManifest(autoDir);

  for (const entry of plan.entries) {
    switch (entry.state) {
      case "ejected":
      case "missing":
      case "template-gone":
        applied.push({ path: entry.path, choice: "skip" });
        continue;
      case "unmodified":
        // Auto-upgrade if there's actually a diff against the new template.
        if (entry.diff && entry.templatePath) {
          const newContent = readFileSync(entry.templatePath, "utf8");
          writeFileSync(join(root, entry.path), newContent, "utf8");
          updateManifestEntry(manifest, entry.path, newContent);
          if (!options.quiet) {
            console.log(kleur.green("✓") + ` auto-updated ${entry.path}`);
          }
          applied.push({ path: entry.path, choice: "auto-update" });
        } else {
          applied.push({ path: entry.path, choice: "skip" });
        }
        continue;
      case "modified": {
        if (!entry.templatePath) {
          // Defensive — shouldn't happen because templateExists is false
          // would have routed this to template-gone.
          applied.push({ path: entry.path, choice: "skip" });
          continue;
        }
        if (!options.quiet) {
          renderEntryDiff(entry);
        }
        const choice = await resolveModifiedChoice(entry, options.resolveChoice);
        const applyResult = applyModifiedChoice(
          root,
          manifest,
          entry,
          choice,
        );
        applied.push(applyResult);
        if (!options.quiet) {
          renderAppliedSummary(applyResult);
        }
        continue;
      }
    }
  }

  writeManifest(autoDir, manifest);
  if (!options.quiet) {
    console.log(
      "\n" + kleur.bold("Manifest written: ") + kleur.dim(manifestPath(autoDir)),
    );
  }
  return { plan, applied };
}

function updateManifestEntry(
  manifest: SubstrateManifest,
  path: string,
  contents: string,
): void {
  const entry = manifest.entries.find((e) => e.path === path);
  if (!entry) return;
  entry.contentHash = `sha256:${hashContent(contents)}`;
  entry.templateVersion = SUBSTRATE_VERSION;
  // `ejected` preserved.
  manifest.substrateVersion = SUBSTRATE_VERSION;
}

async function resolveModifiedChoice(
  entry: UpgradePlanEntry,
  override?: UpgradeOptions["resolveChoice"],
): Promise<UpgradeChoice> {
  if (override) {
    return Promise.resolve(override(entry));
  }
  return select<UpgradeChoice>({
    message: `How should substrate handle ${entry.path}?`,
    choices: [
      {
        value: "keep",
        name: "keep      — leave the user's copy unchanged",
      },
      {
        value: "take-new",
        name: "take-new  — overwrite with the new template",
      },
      {
        value: "merge",
        name: "merge     — write <file>.substrate-merge for manual resolution",
      },
      {
        value: "eject",
        name: "eject     — flag this file as opted-out of future upgrades",
      },
    ],
  });
}

function applyModifiedChoice(
  root: string,
  manifest: SubstrateManifest,
  entry: UpgradePlanEntry,
  choice: UpgradeChoice,
): UpgradeAppliedEntry {
  const absPath = join(root, entry.path);
  switch (choice) {
    case "keep": {
      // Refresh the manifest hash to reflect the user's current copy.
      // That way "modified" state doesn't keep firing on every upgrade
      // when the user has already decided "I want my edits".
      const current = readFileSync(absPath, "utf8");
      updateManifestEntry(manifest, entry.path, current);
      return { path: entry.path, choice };
    }
    case "take-new": {
      if (!entry.templatePath) {
        return { path: entry.path, choice: "skip" };
      }
      const newContent = readFileSync(entry.templatePath, "utf8");
      writeFileSync(absPath, newContent, "utf8");
      updateManifestEntry(manifest, entry.path, newContent);
      return { path: entry.path, choice };
    }
    case "merge": {
      if (!entry.templatePath) {
        return { path: entry.path, choice: "skip" };
      }
      const newContent = readFileSync(entry.templatePath, "utf8");
      const mergePath = `${absPath}.substrate-merge`;
      // v0.8: when the three-way anchor is available, write a richer
      // merge file with all three anchors clearly delimited. Otherwise
      // fall back to the v0.5 behavior of writing just the new template.
      if (entry.threeWay && entry.originalTemplatePath) {
        const originalContent = readFileSync(entry.originalTemplatePath, "utf8");
        const currentContent = readFileSync(absPath, "utf8");
        const sections = [
          `<<<<<<< ORIGINAL (substrate ${entry.recordedTemplateVersion} — what was scaffolded)`,
          originalContent.replace(/\n$/, ""),
          `||||||| CURRENT (your repo right now)`,
          currentContent.replace(/\n$/, ""),
          `=======`,
          newContent.replace(/\n$/, ""),
          `>>>>>>> NEW (substrate ${entry.currentTemplateVersion} — what substrate wants to ship)`,
          "",
        ];
        writeFileSync(mergePath, sections.join("\n"), "utf8");
      } else {
        writeFileSync(mergePath, newContent, "utf8");
      }
      // Manifest is NOT updated — user still owes a resolution. Next
      // upgrade run will re-classify as `modified` until the user
      // reconciles and re-runs.
      return {
        path: entry.path,
        choice,
        mergePath: relative(root, mergePath),
      };
    }
    case "eject": {
      const target = manifest.entries.find((e) => e.path === entry.path);
      if (target) target.ejected = true;
      return { path: entry.path, choice };
    }
  }
}

// --- Rendering --------------------------------------------------------------

function renderPlanHeader(plan: UpgradePlan): void {
  const { counts } = plan;
  console.log(
    kleur.bold(`\nUpgrade plan — substrate ${SUBSTRATE_VERSION}`),
  );
  const threeWayCount = plan.entries.filter((e) => e.threeWay).length;
  const twoWayFallback = plan.entries.length - threeWayCount;
  const historyDir = getTemplatesHistoryDir();
  console.log(
    kleur.dim(
      `  ${plan.entries.length} tracked file(s) ` +
        `(unmodified: ${counts.unmodified}, modified: ${counts.modified}, ` +
        `ejected: ${counts.ejected}, missing: ${counts.missing}, ` +
        `template-gone: ${counts["template-gone"]})`,
    ),
  );
  if (historyDir && twoWayFallback === 0) {
    console.log(kleur.dim(`  merge mode: three-way (templates-history/ available)\n`));
  } else if (historyDir && twoWayFallback > 0) {
    console.log(
      kleur.dim(
        `  merge mode: mixed (${threeWayCount} three-way, ${twoWayFallback} two-way fallback)\n`,
      ),
    );
  } else {
    console.log(
      kleur.dim(
        `  merge mode: two-way (templates-history/ not present in this build)\n`,
      ),
    );
  }
}

function renderPlanDetail(plan: UpgradePlan): void {
  if (plan.entries.length === 0) {
    console.log(
      kleur.yellow(
        "No tracked files — `substrate init` and `substrate add` write entries to auto/.substrate-manifest.json.",
      ),
    );
    return;
  }
  for (const entry of plan.entries) {
    const label =
      entry.state === "modified"
        ? kleur.yellow("modified")
        : entry.state === "unmodified" && entry.diff
          ? kleur.cyan("auto-update")
          : entry.state === "unmodified"
            ? kleur.green("up-to-date")
            : entry.state === "ejected"
              ? kleur.dim("ejected")
              : entry.state === "missing"
                ? kleur.red("missing")
                : kleur.red("template-gone");
    console.log(`  ${label.padEnd(20)} ${entry.path}`);
    if (entry.diff && (entry.state === "modified" || entry.state === "unmodified")) {
      const truncated = truncateDiff(entry.diff, 40);
      console.log(kleur.dim(truncated.split("\n").map((l) => `    ${l}`).join("\n")));
    }
  }
  console.log();
}

function renderEntryDiff(entry: UpgradePlanEntry): void {
  console.log(
    "\n" + kleur.bold(`${entry.path}`) + kleur.dim(" — drift detected"),
  );
  if (entry.threeWay && entry.userEditsDiff && entry.templateChangesDiff) {
    // Three-way view: show what the user changed AND what substrate changed
    // since the recorded version, side by side. Helps the user decide
    // whether their edits collide with template improvements.
    console.log(
      kleur.cyan(
        `\n[1/3] your edits since substrate@${entry.recordedTemplateVersion} (original → current)`,
      ),
    );
    console.log(entry.userEditsDiff || kleur.dim("  (no edits — file unchanged?)"));
    console.log(
      kleur.cyan(
        `\n[2/3] substrate template changes (original → new, substrate@${entry.currentTemplateVersion})`,
      ),
    );
    console.log(
      entry.templateChangesDiff || kleur.dim("  (template unchanged across versions)"),
    );
    console.log(kleur.cyan(`\n[3/3] raw drift you must resolve (current → new)`));
    console.log(entry.diff || kleur.dim("  (no diff)"));
  } else if (entry.diff) {
    if (!entry.threeWay) {
      console.log(
        kleur.dim(
          `(two-way fallback — templates-history/${entry.recordedTemplateVersion}/ not bundled)`,
        ),
      );
    }
    console.log(entry.diff);
  } else {
    console.log(kleur.dim("  (no diff available)"));
  }
  console.log();
}

function renderAppliedSummary(applied: UpgradeAppliedEntry): void {
  const verb =
    applied.choice === "keep"
      ? kleur.cyan("kept")
      : applied.choice === "take-new"
        ? kleur.green("updated")
        : applied.choice === "merge"
          ? kleur.yellow("staged merge")
          : applied.choice === "eject"
            ? kleur.dim("ejected")
            : kleur.dim("skipped");
  console.log(`  ${verb} ${applied.path}` + (applied.mergePath ? ` → ${applied.mergePath}` : ""));
}

function truncateDiff(diff: string, maxLines: number): string {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) return diff;
  return [...lines.slice(0, maxLines), `... (${lines.length - maxLines} more lines)`].join("\n");
}

// re-export for tests
export { basename, dirname };
