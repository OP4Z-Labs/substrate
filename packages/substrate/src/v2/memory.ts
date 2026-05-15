/**
 * Substrate v2 — First-class memory (Primitive 5).
 *
 * Bridges Claude Code's memory directory into substrate's
 * deterministic context-load pipeline. Closes OP4Z Gap 6 (memory
 * existed but wasn't wired into per-workflow context).
 *
 * Storage discovery (plan §6.1):
 *
 *   1. `--memory-path <dir>` / `MemoryQueryOptions.memoryPath`
 *   2. `$SUBSTRATE_MEMORY_PATH` environment variable
 *   3. `substrate.config.json` `memory.path` field (when present)
 *   4. `~/.claude/projects/<encoded-project-path>/memory/`
 *   5. None — query returns empty list with a "no memory store" warning
 *
 * Frontmatter (plan §6.2): existing Claude Code memories work
 * unchanged. Substrate-aware memories ADD optional fields under
 * `metadata`: `type`, `scope`, `tags`, `applies_to_globs`,
 * `related_rules`, `expires`. The parser tolerates either the legacy
 * `type: feedback` at the top level OR the extended `metadata.type`
 * form.
 *
 * Layer: deterministic. Read-only filesystem + frontmatter parsing.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { resolveTargetRoot } from "../util/paths.js";
import { matchGlob } from "./doc-checks.js";

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryFrontmatter {
  name?: string;
  description?: string;
  /** Substrate-extended fields (plan §6.2). */
  type?: MemoryType | string;
  scope?: string;
  tags?: string[];
  applies_to_globs?: string[];
  related_rules?: string[];
  expires?: string;
}

export interface MemoryEntry {
  /** Memory file id (filename without extension). */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Frontmatter description (legacy or extended). */
  description?: string;
  /** Memory body content (after frontmatter). */
  body: string;
  /** Memory type per frontmatter (`feedback` | `project` | etc.). */
  type?: string;
  /** Memory scope (e.g. `backend`). */
  scope?: string;
  /** Tags. */
  tags?: string[];
  /** File globs the memory applies to. */
  appliesToGlobs?: string[];
  /** Rule ids related to this memory. */
  relatedRules?: string[];
  /** Expiry date (ISO YYYY-MM-DD) if set. */
  expires?: string;
  /** mtime in ms; used for recency sort. */
  mtimeMs: number;
  /** Whole-days since the memory was last written. */
  ageDays: number;
  /**
   * Optional "recommended frontmatter fields" warnings. Each memory
   * carries its own list so `substrate doctor` can summarise.
   */
  warnings: string[];
}

export interface MemoryQueryOptions {
  types?: string[];
  scope?: string;
  tags?: string[];
  /** Repo-relative file paths to intersect against `applies_to_globs`. */
  intersectWithFiles?: string[];
  /** Override the memory store path (highest precedence). */
  memoryPath?: string;
  /** Override the consumer repo root (used for substrate.config.json lookup). */
  cwd?: string;
  /** Test seam: override now() for age calculations. */
  now?: Date;
  /** Test seam: stub homedir() for Claude Code default path lookups. */
  homeDir?: string;
}

export interface MemoryQueryResult {
  memories: MemoryEntry[];
  memoryPath: string | null;
  source: "flag" | "env" | "config" | "claude-code" | "none";
  warnings: string[];
}

/**
 * Resolve the active memory store path per plan §6.1's precedence
 * order. Returns both the path (or null) and the `source` that
 * populated it.
 */
export function locateMemoryDir(
  options: {
    memoryPath?: string;
    cwd?: string;
    homeDir?: string;
  } = {},
): { path: string | null; source: MemoryQueryResult["source"] } {
  // 1. Explicit flag wins
  if (options.memoryPath) {
    const abs = resolve(options.memoryPath);
    return existsSync(abs)
      ? { path: abs, source: "flag" }
      : { path: null, source: "none" };
  }

  // 2. Environment variable
  const envPath = process.env.SUBSTRATE_MEMORY_PATH;
  if (envPath && envPath.length > 0) {
    const abs = resolve(envPath);
    if (existsSync(abs)) {
      return { path: abs, source: "env" };
    }
  }

  // 3. substrate.config.json memory.path
  const configPath = readMemoryPathFromConfig(options.cwd);
  if (configPath) {
    return { path: configPath, source: "config" };
  }

  // 4. Claude Code default — ~/.claude/projects/<encoded>/memory/
  const claudePath = locateClaudeCodeMemoryDir(options.cwd, options.homeDir);
  if (claudePath) {
    return { path: claudePath, source: "claude-code" };
  }

  return { path: null, source: "none" };
}

function readMemoryPathFromConfig(cwd: string | undefined): string | null {
  const root = resolveTargetRoot(cwd);
  const configFile = join(root, "substrate.config.json");
  if (!existsSync(configFile)) return null;
  try {
    const raw = readFileSync(configFile, "utf8");
    const parsed = JSON.parse(raw) as {
      memory?: { path?: string };
    };
    if (parsed.memory && typeof parsed.memory.path === "string") {
      const abs = resolve(root, parsed.memory.path);
      if (existsSync(abs)) return abs;
    }
  } catch {
    // Malformed config — fall through to next discovery step.
  }
  return null;
}

/**
 * Locate the Claude Code memory directory for the consumer repo,
 * following Claude Code's encoding convention:
 * `/home/user/foo` → `-home-user-foo`. Returns null when the directory
 * doesn't exist.
 */
function locateClaudeCodeMemoryDir(
  cwd: string | undefined,
  homeOverride: string | undefined,
): string | null {
  const root = resolveTargetRoot(cwd);
  const home = homeOverride ?? homedir();
  const encoded = encodeProjectPath(root);
  const candidate = join(home, ".claude", "projects", encoded, "memory");
  return existsSync(candidate) ? candidate : null;
}

/**
 * Claude Code encodes absolute paths by replacing `/` with `-`. Leading
 * slash becomes a leading `-`. We mirror that exact convention.
 */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/\//g, "-");
}

/**
 * Programmatic memory query. Returns memories matching all provided
 * filters, sorted most-recent first.
 */
export function queryMemory(options: MemoryQueryOptions = {}): MemoryQueryResult {
  const loc = locateMemoryDir({
    memoryPath: options.memoryPath,
    cwd: options.cwd,
    homeDir: options.homeDir,
  });
  const warnings: string[] = [];
  if (!loc.path) {
    warnings.push(
      "No memory store found. Set --memory-path, SUBSTRATE_MEMORY_PATH, " +
        "or memory.path in substrate.config.json. Claude Code's default " +
        "(~/.claude/projects/<encoded>/memory/) is also checked.",
    );
    return { memories: [], memoryPath: null, source: "none", warnings };
  }

  const now = options.now ?? new Date();
  const entries = readMemoriesFromDir(loc.path, now, warnings);
  let memories = entries;

  if (options.types && options.types.length > 0) {
    const wanted = new Set(options.types);
    memories = memories.filter((m) => (m.type ? wanted.has(m.type) : false));
  }
  if (options.scope) {
    memories = memories.filter((m) => m.scope === options.scope);
  }
  if (options.tags && options.tags.length > 0) {
    memories = memories.filter((m) =>
      options.tags!.every((t) => m.tags?.includes(t)),
    );
  }
  if (options.intersectWithFiles && options.intersectWithFiles.length > 0) {
    memories = memories.filter((m) => {
      // Memory matches if it has no globs (applies-to-everything) OR
      // at least one of its globs matches at least one changed file.
      if (!m.appliesToGlobs || m.appliesToGlobs.length === 0) return true;
      return m.appliesToGlobs.some((glob) =>
        options.intersectWithFiles!.some((f) => matchGlob(glob, f)),
      );
    });
  }

  // Drop expired memories — they remain on disk but don't surface in
  // queries (so workflows don't act on stale guidance). `substrate
  // doctor` can flag them separately.
  memories = memories.filter((m) => !isExpired(m, now));

  memories.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return { memories, memoryPath: loc.path, source: loc.source, warnings };
}

function isExpired(m: MemoryEntry, now: Date): boolean {
  if (!m.expires) return false;
  const t = Date.parse(m.expires);
  if (Number.isNaN(t)) return false;
  return t < now.getTime();
}

function readMemoriesFromDir(
  dir: string,
  now: Date,
  warnings: string[],
): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    warnings.push(
      `Failed to read memory directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return out;
  }
  for (const name of entries) {
    // Skip non-memory files. Claude Code memories are typically .md;
    // we accept .markdown too. Anything else (README, indexes, etc.)
    // is ignored.
    if (!name.endsWith(".md") && !name.endsWith(".markdown")) continue;
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    try {
      const raw = readFileSync(full, "utf8");
      const { frontmatter, body, warnings: parseWarnings } =
        parseMemoryFrontmatter(raw);
      const mtimeMs = st.mtimeMs;
      const ageDays = Math.max(
        0,
        Math.floor((now.getTime() - mtimeMs) / (1000 * 60 * 60 * 24)),
      );
      const entry: MemoryEntry = {
        name: basename(name, name.endsWith(".markdown") ? ".markdown" : ".md"),
        path: full,
        description: frontmatter.description,
        body,
        type: frontmatter.type,
        scope: frontmatter.scope,
        tags: frontmatter.tags,
        appliesToGlobs: frontmatter.applies_to_globs,
        relatedRules: frontmatter.related_rules,
        expires: frontmatter.expires,
        mtimeMs,
        ageDays,
        warnings: parseWarnings,
      };
      out.push(entry);
    } catch (err) {
      warnings.push(
        `Failed to read memory ${full}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
}

/**
 * Parse memory file frontmatter. Supports both the legacy Claude Code
 * shape (top-level scalars) and the substrate-extended shape with a
 * `metadata:` nested block. Uses the YAML parser so nested fields +
 * arrays work; falls back gracefully when frontmatter is absent.
 */
export function parseMemoryFrontmatter(source: string): {
  frontmatter: MemoryFrontmatter;
  body: string;
  warnings: string[];
} {
  const stripped = source.replace(/^﻿/, "");
  if (!stripped.startsWith("---")) {
    return {
      frontmatter: {},
      body: stripped,
      warnings: ["memory missing frontmatter block — no metadata to filter on"],
    };
  }
  const end = stripped.indexOf("\n---", 3);
  if (end === -1) {
    return {
      frontmatter: {},
      body: stripped,
      warnings: ["memory frontmatter block not closed"],
    };
  }
  const headerBlock = stripped.slice(3, end).trim();
  const bodyStart = end + 4;
  const body = stripped.slice(bodyStart).replace(/^\n/, "");

  let parsed: Record<string, unknown> = {};
  try {
    const raw = parseYaml(headerBlock);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      parsed = raw as Record<string, unknown>;
    }
  } catch (err) {
    return {
      frontmatter: {},
      body,
      warnings: [
        `memory frontmatter YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  const fm: MemoryFrontmatter = {};
  if (typeof parsed.name === "string") fm.name = parsed.name;
  if (typeof parsed.description === "string") fm.description = parsed.description;

  // The substrate-extended shape nests under `metadata:`. Fall back to
  // top-level keys for legacy memories.
  const md = (parsed.metadata && typeof parsed.metadata === "object"
    ? (parsed.metadata as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  fm.type =
    pickString(md.type) ?? pickString(parsed.type) ?? undefined;
  fm.scope =
    pickString(md.scope) ?? pickString(parsed.scope) ?? undefined;
  fm.tags =
    pickStringArray(md.tags) ?? pickStringArray(parsed.tags) ?? undefined;
  fm.applies_to_globs =
    pickStringArray(md.applies_to_globs) ??
    pickStringArray(parsed.applies_to_globs) ??
    undefined;
  fm.related_rules =
    pickStringArray(md.related_rules) ??
    pickStringArray(parsed.related_rules) ??
    undefined;
  fm.expires =
    pickString(md.expires) ?? pickString(parsed.expires) ?? undefined;

  const warnings: string[] = [];
  if (!fm.type && !fm.scope && !fm.tags) {
    warnings.push(
      "memory frontmatter lacks recommended substrate fields (type, scope, tags). " +
        "Queries by those filters will skip this memory.",
    );
  }
  return { frontmatter: fm, body, warnings };
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Render the deterministic injection block (plan §6.4). Given a list
 * of memories + the query metadata, return the markdown string that
 * the orchestrator should prepend to the workflow's AI prompt.
 *
 * Substrate is opinionated about the format: a `## Relevant prior
 * decisions and feedback` heading, a `verify before asserting`
 * reminder, each memory under its own `### <name> (written N days
 * ago)` subheading, then a one-line query echo at the end.
 */
export function renderMemoryInjection(
  memories: MemoryEntry[],
  queryEcho: { types?: string[]; scope?: string; tags?: string[] } = {},
): string {
  if (memories.length === 0) return "";
  const lines: string[] = [];
  lines.push("## Relevant prior decisions and feedback");
  lines.push("");
  lines.push(
    "The following memories matched this workflow's context query and apply to the",
  );
  lines.push(
    "files being worked on. Verify accuracy against current state before relying",
  );
  lines.push("on any specific detail.");
  lines.push("");
  for (const m of memories) {
    const age = m.ageDays === 1 ? "1 day ago" : `${m.ageDays} days ago`;
    lines.push(`### ${m.name} (written ${age})`);
    lines.push(m.body.trim());
    lines.push("");
  }
  const parts: string[] = [];
  if (queryEcho.types && queryEcho.types.length > 0) {
    parts.push(`types=${queryEcho.types.join(",")}`);
  }
  if (queryEcho.scope) parts.push(`scope=${queryEcho.scope}`);
  if (queryEcho.tags && queryEcho.tags.length > 0) {
    parts.push(`tags=${queryEcho.tags.join(",")}`);
  }
  const echo = parts.length > 0 ? `; query: ${parts.join("; ")}` : "";
  lines.push(`(${memories.length} memories loaded${echo})`);
  return lines.join("\n") + "\n";
}
