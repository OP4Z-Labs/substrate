/**
 * Detector path resolution.
 *
 * `detector.paths` entries are author-controlled strings that have to become a
 * concrete list of files and directories before either execution path (ripgrep
 * or the Node fallback walker) can scan them. That translation used to happen
 * nowhere, and each execution path failed differently:
 *
 *  1. **Globs were never expanded.** `runWithRipgrep` hands `paths` straight to
 *     `spawnSync("rg", ...)` as positional arguments. There is no shell in that
 *     call — deliberately, so a RULES.yaml pattern can never reach a shell
 *     metacharacter — and rg does not glob its own path operands. So a star
 *     path like `apps/backend/<star>/app/services` was looked up as a literal
 *     directory name. rg exited 2 (`No such file or directory`) and the rule
 *     was reported as a skip; the fallback `resolve()`d the same literal, found
 *     nothing, and returned zero findings. Two different wrong answers, and the
 *     second one reads as "clean".
 *
 *  2. **`pathFilter` overrode `detector.paths` instead of intersecting.** Under
 *     `--diff`, a rule scoped to a `apps/backend` glob scanned every changed
 *     file, including shell scripts and Markdown.
 *
 *  3. **Nothing kept the scan inside the repo.** `paths: ["../../etc"]` resolved
 *     outside `repoRoot` on the rg path, and the matched line was copied into
 *     the report as a snippet. A registry is data, often reviewed less carefully
 *     than code, and on CI it frequently arrives from a pull request.
 *
 * Resolution happens once, here, and both execution paths consume the same
 * concrete list — divergence between them is a bug (see `detectors/ripgrep.ts`).
 *
 * A declared path that matches nothing on disk is *reported* via `unmatched`,
 * never silently dropped. A rule that scanned no files must never be
 * indistinguishable from a rule that scanned everything and found nothing.
 */

import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Directory names a glob segment never descends into. The scan-time exclude
 * globs (`DEFAULT_EXCLUDES`) still apply afterwards; this is only about keeping
 * expansion itself from walking into a 1 GB `node_modules` to answer `*`.
 */
const EXPANSION_SKIP_DIRS = new Set(["node_modules", ".git"]);

/** Bound on `**` recursion. Deep enough for any real source tree. */
const MAX_GLOBSTAR_DEPTH = 24;

export interface ResolvedDetectorPaths {
  /**
   * Concrete repo-relative paths to scan, after glob expansion and any
   * `pathFilter` intersection. The single entry `"."` means the whole repo.
   * An empty array means the rule has nothing to scan — the caller must
   * surface that, not treat it as a clean result.
   */
  targets: string[];
  /**
   * Glob expansion of `declared` alone, before `pathFilter` was applied.
   * Lets the caller tell "this rule's paths no longer exist" (empty) apart
   * from "the diff touched nothing under this rule's paths" (non-empty).
   */
  expanded: string[];
  /**
   * Declared entries that matched nothing: a glob with no hits, a literal path
   * that does not exist, or a path that escaped the repo root.
   */
  unmatched: string[];
}

/**
 * Resolve a detector's declared paths against the working tree.
 *
 * | `declared`  | `pathFilter` | `targets`                                  |
 * | ----------- | ------------ | ------------------------------------------ |
 * | absent      | absent       | `["."]` — whole repo                        |
 * | absent      | given        | the filter's files (whole-repo ∩ diff)      |
 * | given       | absent       | expanded globs                              |
 * | given       | given        | filter files that live under expanded globs |
 */
export function resolveDetectorPaths(
  repoRoot: string,
  declared: string[] | undefined,
  pathFilter: string[] | undefined,
): ResolvedDetectorPaths {
  const expanded: string[] = [];
  const unmatched: string[] = [];

  if (!declared || declared.length === 0) {
    expanded.push(".");
  } else {
    for (const entry of declared) {
      const matches = expandOne(repoRoot, entry);
      if (matches.length === 0) unmatched.push(entry);
      else expanded.push(...matches);
    }
  }
  const uniqueExpanded = dedupe(expanded);

  if (!pathFilter) {
    return { targets: uniqueExpanded, expanded: uniqueExpanded, unmatched };
  }

  const targets = dedupe(
    pathFilter
      .map(toPosix)
      .filter((file) => uniqueExpanded.some((scope) => isUnder(file, scope)))
      .filter((file) => isContained(repoRoot, file) && existsSync(resolve(repoRoot, file))),
  );
  return { targets, expanded: uniqueExpanded, unmatched };
}

/**
 * Expand a single declared entry into the concrete repo-relative paths it
 * names. Returns `[]` when it names nothing we are willing to scan — a glob
 * with no matches, a path that does not exist, an absolute path, or anything
 * that resolves outside the repo.
 */
function expandOne(repoRoot: string, rawEntry: string): string[] {
  if (isAbsolute(rawEntry)) return [];
  const entry = toPosix(rawEntry).replace(/\/+$/, "");
  if (entry === "" || entry === ".") return ["."];

  const segments = entry.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.length === 0) return ["."];
  // `..` can only ever take us toward the repo root or out of it. Neither is a
  // legitimate way to express a scan scope, and the second is an exfiltration
  // primitive, so refuse the whole entry rather than try to normalize it.
  if (segments.includes("..")) return [];

  let current: string[] = [""];
  for (const segment of segments) {
    if (current.length === 0) return [];
    current =
      segment === "**"
        ? expandGlobstar(repoRoot, current)
        : hasGlob(segment)
          ? expandGlobSegment(repoRoot, current, segment)
          : expandLiteralSegment(repoRoot, current, segment);
  }
  return current.filter((rel) => isContained(repoRoot, rel));
}

function expandLiteralSegment(repoRoot: string, prefixes: string[], segment: string): string[] {
  const next: string[] = [];
  for (const prefix of prefixes) {
    const rel = joinRel(prefix, segment);
    if (existsSync(resolve(repoRoot, rel))) next.push(rel);
  }
  return next;
}

function expandGlobSegment(repoRoot: string, prefixes: string[], segment: string): string[] {
  const re = segmentRegex(segment);
  const next: string[] = [];
  for (const prefix of prefixes) {
    for (const name of safeReaddir(resolve(repoRoot, prefix || "."))) {
      if (EXPANSION_SKIP_DIRS.has(name) || !re.test(name)) continue;
      const rel = joinRel(prefix, name);
      // Symlinks are skipped: rg does not follow them by default, and a repo
      // that symlinks a directory (a worktree's `node_modules`, say) would
      // otherwise be scanned twice or escape the root entirely.
      if (isSymlink(resolve(repoRoot, rel))) continue;
      next.push(rel);
    }
  }
  return next;
}

/** `**` matches zero or more directory levels. */
function expandGlobstar(repoRoot: string, prefixes: string[]): string[] {
  const out: string[] = [...prefixes];
  let frontier = prefixes;
  for (let depth = 0; depth < MAX_GLOBSTAR_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const name of safeReaddir(resolve(repoRoot, prefix || "."))) {
        if (EXPANSION_SKIP_DIRS.has(name)) continue;
        const rel = joinRel(prefix, name);
        const abs = resolve(repoRoot, rel);
        if (isSymlink(abs) || !isDirectory(abs)) continue;
        next.push(rel);
      }
    }
    out.push(...next);
    frontier = next;
  }
  return out;
}

/** `*` matches within one segment; `?` matches one character. Never crosses `/`. */
function segmentRegex(segment: string): RegExp {
  const source = segment
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${source}$`);
}

function hasGlob(segment: string): boolean {
  return segment.includes("*") || segment.includes("?");
}

/** `file` is `scope` itself, or lives beneath it. `"."` contains everything. */
function isUnder(file: string, scope: string): boolean {
  if (scope === ".") return true;
  return file === scope || file.startsWith(`${scope}/`);
}

/**
 * True when `rel` resolves to a location inside `repoRoot`. Uses realpath so a
 * symlinked ancestor cannot smuggle the target out of the tree; falls back to
 * lexical containment when the path cannot be realpath'd.
 */
function isContained(repoRoot: string, rel: string): boolean {
  if (rel === ".") return true;
  const abs = resolve(repoRoot, rel);
  try {
    const realRoot = realpathSync(repoRoot);
    const realAbs = realpathSync(abs);
    const rp = relative(realRoot, realAbs);
    return rp !== "" && !rp.startsWith("..") && !isAbsolute(rp);
  } catch {
    const rp = relative(repoRoot, abs);
    return rp !== "" && !rp.startsWith("..") && !isAbsolute(rp);
  }
}

function joinRel(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function isSymlink(abs: string): boolean {
  try {
    return lstatSync(abs).isSymbolicLink();
  } catch {
    return false;
  }
}

function isDirectory(abs: string): boolean {
  try {
    return lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
