/**
 * Ripgrep detector.
 *
 * Uses `spawnSync('rg', [...])` (NOT shell-mode exec — argv array, no
 * shell interpolation) when ripgrep is on PATH, and falls back to a
 * Node-only regex scan when it isn't. The two paths must produce
 * equivalent findings — divergence between them is a bug.
 *
 * Why ripgrep when available? It's an order of magnitude faster on large
 * trees and respects `.gitignore` natively. The Node fallback exists so
 * substrate is usable on systems without rg installed (some CI runners,
 * some Windows boxes).
 *
 * Security note: we never construct shell commands. All arguments go
 * through `spawnSync`'s argv array, so pattern values (which can come
 * from user-authored RULES.yaml) cannot escape into shell metacharacters.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import type { Finding, RipgrepDetector, Severity } from "../types.js";

/** Cap snippet length so reports stay readable. */
const SNIPPET_MAX_LEN = 200;
/** Default exclusions when the rule doesn't specify any. */
const DEFAULT_EXCLUDES = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "coverage/**",
  ".next/**",
  ".turbo/**",
  "__pycache__/**",
  ".venv/**",
  "venv/**",
  ".pytest_cache/**",
  "*.lock",
  "package-lock.json",
];

export interface RunRipgrepOptions {
  repoRoot: string;
  ruleId: string;
  severity: Severity;
  /** Force the Node fallback even when rg is available (used by tests for parity). */
  forceFallback?: boolean;
  /** Restrict to these paths (overrides detector.paths). Used by `--diff`. */
  pathFilter?: string[];
}

/** Probe rg presence once per process. */
let rgAvailable: boolean | null = null;
function hasRipgrep(): boolean {
  if (rgAvailable !== null) return rgAvailable;
  try {
    const r = spawnSync("rg", ["--version"], { stdio: "ignore" });
    rgAvailable = r.status === 0;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable!;
}

export function resetRipgrepProbe(): void {
  rgAvailable = null;
}

/**
 * Execute a ripgrep detector. Returns the findings sorted by path + line.
 */
export function runRipgrepDetector(
  detector: RipgrepDetector,
  options: RunRipgrepOptions,
): Finding[] {
  const useRg = !options.forceFallback && hasRipgrep();
  const findings = useRg
    ? runWithRipgrep(detector, options)
    : runWithFallback(detector, options);
  return findings.sort((a, b) => {
    const pa = a.path ?? "";
    const pb = b.path ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

function runWithRipgrep(detector: RipgrepDetector, options: RunRipgrepOptions): Finding[] {
  const args: string[] = ["--json", "--line-number"];
  if (detector.fixedString) args.push("--fixed-strings");
  if (detector.multiline) args.push("--multiline", "--multiline-dotall");
  if (detector.caseSensitive === false) args.push("--ignore-case");
  for (const exc of detector.exclude ?? DEFAULT_EXCLUDES) {
    args.push("--glob", `!${exc}`);
  }
  args.push("--", detector.pattern);
  const paths = options.pathFilter ?? detector.paths ?? ["."];
  for (const p of paths) args.push(p);

  const result = spawnSync("rg", args, {
    cwd: options.repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  // rg exits 0 when matches found, 1 when no matches, 2 on error.
  // We only treat 2+ as an error condition; 1 is "all good, no findings".
  if (result.status !== null && result.status >= 2) {
    throw new Error(
      `ripgrep failed for rule ${options.ruleId}: ${result.stderr.trim() || `exit ${result.status}`}`,
    );
  }
  const findings: Finding[] = [];
  for (const line of (result.stdout ?? "").split("\n")) {
    if (!line) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(payload) || payload.type !== "match") continue;
    const data = (payload as { data?: unknown }).data;
    if (!isObject(data)) continue;
    const path = (data as { path?: { text?: string } }).path?.text;
    const lineNumber = (data as { line_number?: number }).line_number;
    const lines = (data as { lines?: { text?: string } }).lines?.text;
    if (!path || !lineNumber) continue;
    findings.push({
      ruleId: options.ruleId,
      severity: options.severity,
      message: detector.pattern,
      path,
      line: lineNumber,
      snippet: lines ? truncate(lines.trim(), SNIPPET_MAX_LEN) : undefined,
    });
  }
  return findings;
}

function runWithFallback(detector: RipgrepDetector, options: RunRipgrepOptions): Finding[] {
  const findings: Finding[] = [];
  const flags = (detector.caseSensitive === false ? "i" : "") + (detector.multiline ? "ms" : "m");
  let regex: RegExp;
  if (detector.fixedString) {
    regex = new RegExp(escapeRegex(detector.pattern), flags);
  } else {
    try {
      regex = new RegExp(detector.pattern, flags);
    } catch (err) {
      throw new Error(
        `ripgrep fallback could not compile pattern for rule ${options.ruleId}: ${(err as Error).message}`,
      );
    }
  }
  const excludeGlobs = detector.exclude ?? DEFAULT_EXCLUDES;
  const targets = (options.pathFilter ?? detector.paths ?? ["."]).map((p) =>
    resolve(options.repoRoot, p),
  );
  for (const target of targets) {
    walk(target, options.repoRoot, excludeGlobs, (absPath, rel) => {
      let text: string;
      try {
        text = readFileSync(absPath, "utf8");
      } catch {
        return; // binary or unreadable — skip
      }
      const lines = text.split("\n");
      if (detector.multiline) {
        regex.lastIndex = 0;
        const m = regex.exec(text);
        if (m) {
          // For multiline matches, attribute to the line where the match starts.
          const upto = text.slice(0, m.index);
          const lineNum = upto.split("\n").length;
          findings.push({
            ruleId: options.ruleId,
            severity: options.severity,
            message: detector.pattern,
            path: rel,
            line: lineNum,
            snippet: truncate(m[0].split("\n")[0]!.trim(), SNIPPET_MAX_LEN),
          });
        }
        return;
      }
      for (let i = 0; i < lines.length; i += 1) {
        if (regex.test(lines[i]!)) {
          findings.push({
            ruleId: options.ruleId,
            severity: options.severity,
            message: detector.pattern,
            path: rel,
            line: i + 1,
            snippet: truncate(lines[i]!.trim(), SNIPPET_MAX_LEN),
          });
        }
      }
    });
  }
  return findings;
}

function walk(
  root: string,
  repoRoot: string,
  excludeGlobs: string[],
  visit: (absPath: string, rel: string) => void,
): void {
  if (!existsSync(root)) return;
  const st = statSync(root);
  if (st.isFile()) {
    const rel = relative(repoRoot, root);
    if (!isExcluded(rel, excludeGlobs) && isLikelyTextFile(root)) {
      visit(root, rel);
    }
    return;
  }
  if (!st.isDirectory()) return;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    const rel = relative(repoRoot, full);
    if (isExcluded(rel, excludeGlobs)) continue;
    let entrySt;
    try {
      entrySt = statSync(full);
    } catch {
      continue;
    }
    if (entrySt.isDirectory()) {
      walk(full, repoRoot, excludeGlobs, visit);
    } else if (entrySt.isFile() && isLikelyTextFile(full)) {
      visit(full, rel);
    }
  }
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".webm",
  ".bin",
  ".so",
  ".dll",
  ".dylib",
  ".exe",
  ".class",
  ".jar",
  ".wasm",
]);

function isLikelyTextFile(path: string): boolean {
  return !BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * Glob match limited to the subset substrate rules actually use: `**`,
 * `*`, and literal segments. Sufficient for "exclude node_modules/**"
 * style entries. Not a full minimatch implementation.
 */
function isExcluded(relPath: string, globs: string[]): boolean {
  for (const g of globs) {
    if (matchGlob(relPath, g)) return true;
  }
  return false;
}

function matchGlob(path: string, glob: string): boolean {
  // Translate glob to a regex.
  // `**` → `.*`, `*` → `[^/]*`, segments separated by `/`.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return re.test(path) || re.test(path.split("/")[0] ?? "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
