/**
 * Substrate v2 — Session event log (Phase B3, Primitive 9 Component A).
 *
 * Every `substrate run` invocation appends JSONL lifecycle events to
 * `substrate/sessions/<workflow>-<sha-prefix>.jsonl`. The log is the
 * raw substrate the proposal pipeline reads from: drift detectors
 * (B3 Component B) and cross-session pattern detection both consume
 * these files.
 *
 * Event shape (plan §3.9 Component A + §7 worked example):
 *
 *   { "ts": "<iso>", "event": "workflow-start",        "workflow": "...", "manifest-hash": "..." }
 *   { "ts": "<iso>", "event": "context-loaded",        "kind": "memory|standards|rules|knowledge", "ids": [...] }
 *   { "ts": "<iso>", "event": "step-start",            "step": "..." }
 *   { "ts": "<iso>", "event": "step-confirm",          "step": "...", "outcome": "approved|rejected" }
 *   { "ts": "<iso>", "event": "adhoc-step",            "description": "...", "origin": "user-requested|ai-suggested", "at-step": "..." }
 *   { "ts": "<iso>", "event": "step-completion",       "step": "...", "output": "..." }
 *   { "ts": "<iso>", "event": "prompt-issued",         "step": "...", "prompt": "..." }
 *   { "ts": "<iso>", "event": "workflow-completion",   "exit": "pass|conditional|fail", "duration": <ms> }
 *
 * Telemetry contract version: v: 3 (B3 extends B1's v: 2). Each line
 * is a self-contained JSON object — readers can stream-parse without
 * needing a header.
 *
 * Forbidden fields (PII boundary). The session log is checked into the
 * consumer repo by default; substrate ships explicit forbidden-field
 * rules so accidental leakage doesn't ride along:
 *   - No filesystem paths beyond workflow / step ids
 *   - No tokens, credentials, secrets
 *   - No user identifiers (email, username, machine name)
 *   - No error message bodies (status code / exit code is fine)
 *
 * The emitter sanitises strings against an internal blocklist of obvious
 * leakage shapes (`/home/`, `Bearer `, `@`, etc.) and truncates
 * `prompt` / `description` / `output` fields to ~120 chars. Tests
 * verify the sanitisation explicitly.
 *
 * Layer: orchestration (consumed by the proposal pipeline, which lives
 * in the deterministic layer). The emitter touches the filesystem
 * during a workflow run — that's fine because it's inside the
 * orchestrator's IO budget.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { resolveTargetRoot } from "../../util/paths.js";
import type { WorkflowManifest } from "../types.js";

/**
 * Discriminated union of event types. The proposal pipeline narrows on
 * `event` so each detector can match on the exact shape it cares about.
 */
export type SessionEvent =
  | WorkflowStartEvent
  | ContextLoadedEvent
  | StepStartEvent
  | StepConfirmEvent
  | AdhocStepEvent
  | StepCompletionEvent
  | PromptIssuedEvent
  | WorkflowCompletionEvent;

export interface WorkflowStartEvent {
  ts: string;
  event: "workflow-start";
  workflow: string;
  "manifest-hash": string;
}

export interface ContextLoadedEvent {
  ts: string;
  event: "context-loaded";
  kind: "memory" | "standards" | "rules" | "knowledge";
  ids: string[];
}

export interface StepStartEvent {
  ts: string;
  event: "step-start";
  step: string;
}

export interface StepConfirmEvent {
  ts: string;
  event: "step-confirm";
  step: string;
  outcome: "approved" | "rejected";
}

export interface AdhocStepEvent {
  ts: string;
  event: "adhoc-step";
  description: string;
  origin: "user-requested" | "ai-suggested";
  "at-step"?: string;
}

export interface StepCompletionEvent {
  ts: string;
  event: "step-completion";
  step: string;
  output?: string;
}

export interface PromptIssuedEvent {
  ts: string;
  event: "prompt-issued";
  step?: string;
  prompt: string;
}

export interface WorkflowCompletionEvent {
  ts: string;
  event: "workflow-completion";
  exit: "pass" | "conditional" | "fail";
  duration: number;
}

/**
 * One-line truncation limit for human-text fields (`description`,
 * `prompt`, `output`). Plan §3.9 specifies ~120 chars. We hold to that
 * exactly so the contract is uniform.
 */
export const TEXT_FIELD_MAX_CHARS = 120;

/**
 * Pattern blocklist applied to every string field. Any match triggers
 * a redaction (`[redacted]`). Keep the patterns conservative — false
 * positives are preferable to leaking secrets.
 */
const FORBIDDEN_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "path", re: /\/home\/[^\s'"]+/g },
  { kind: "path", re: /\/Users\/[^\s'"]+/g },
  { kind: "path", re: /[A-Z]:\\\\Users\\\\[^\s'"]+/gi },
  { kind: "token", re: /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/g },
  { kind: "token", re: /sk-[A-Za-z0-9_-]{16,}/g },
  { kind: "token", re: /ghp_[A-Za-z0-9]{16,}/g },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

export interface SessionLogPaths {
  /** Absolute path to the session-events JSONL file. */
  path: string;
  /** The sha-prefix segment used in the filename. */
  shaPrefix: string;
  /** Resolved `substrate/sessions/` directory. */
  sessionsDir: string;
}

/**
 * Compute (and ensure) the session log path for a given workflow run.
 *
 * Naming convention: `<workflow-id>-<sha-prefix>.jsonl` where the
 * `sha-prefix` is the first 8 chars of `sha256(workflow-id +
 * start-iso-ts + random-salt)`. Encoding the random salt means
 * back-to-back runs of the same workflow don't clobber each other.
 */
export function resolveSessionLogPath(
  workflowId: string,
  options: { cwd?: string; salt?: string; startedAt?: Date } = {},
): SessionLogPaths {
  const root = resolveTargetRoot(options.cwd);
  const sessionsDir = join(root, "substrate", "sessions");
  const startedAt = (options.startedAt ?? new Date()).toISOString();
  const salt = options.salt ?? Math.random().toString(36).slice(2, 10);
  const shaPrefix = createHash("sha256")
    .update(`${workflowId}|${startedAt}|${salt}`)
    .digest("hex")
    .slice(0, 8);
  return {
    path: join(sessionsDir, `${workflowId}-${shaPrefix}.jsonl`),
    shaPrefix,
    sessionsDir,
  };
}

/**
 * Compute a deterministic manifest hash. The proposal pipeline records
 * this on `workflow-start` so drift detectors can later check whether
 * the manifest changed between the run + the analysis pass.
 */
export function computeManifestHash(manifest: WorkflowManifest): string {
  const canonical = JSON.stringify(manifest, Object.keys(manifest).sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Strip / truncate fields against the forbidden-pattern list. Returns a
 * new object — the input is never mutated.
 */
export function sanitiseEvent<E extends SessionEvent>(event: E): E {
  const cloned = { ...event } as Record<string, unknown>;
  for (const key of Object.keys(cloned)) {
    const value = cloned[key];
    if (typeof value === "string") {
      cloned[key] = sanitiseString(value, key);
    } else if (Array.isArray(value)) {
      cloned[key] = value.map((v) =>
        typeof v === "string" ? sanitiseString(v, key) : v,
      );
    }
  }
  return cloned as E;
}

function sanitiseString(input: string, key: string): string {
  let out = input;
  for (const pattern of FORBIDDEN_PATTERNS) {
    out = out.replace(pattern.re, `[redacted:${pattern.kind}]`);
  }
  // Truncate the long human-text fields. Other fields (ids, kinds, etc.)
  // are short enough already; trimming them would change their
  // identity.
  if (
    key === "description" ||
    key === "prompt" ||
    key === "output"
  ) {
    if (out.length > TEXT_FIELD_MAX_CHARS) {
      out = out.slice(0, TEXT_FIELD_MAX_CHARS - 1) + "…";
    }
  }
  return out;
}

export interface SessionEventWriterOptions {
  /** The substrate/sessions/ directory and file path. */
  paths: SessionLogPaths;
  /** Disable filesystem writes (used by tests that read back via `events`). */
  inMemoryOnly?: boolean;
}

/**
 * Append-mode session event writer. Open once per workflow run; call
 * `emit()` at every lifecycle boundary; `flush()` ensures the JSONL
 * file ends with a trailing newline (it always does, since we append
 * `line + "\n"` each call — but the helper makes the intent obvious).
 */
export class SessionEventWriter {
  readonly paths: SessionLogPaths;
  private readonly inMemoryOnly: boolean;
  private readonly buffer: SessionEvent[] = [];
  private dirReady = false;

  constructor(options: SessionEventWriterOptions) {
    this.paths = options.paths;
    this.inMemoryOnly = options.inMemoryOnly === true;
  }

  /** Currently-buffered events (for tests + the in-memory mode). */
  get events(): readonly SessionEvent[] {
    return this.buffer;
  }

  /**
   * Append a single event. Sanitisation is applied uniformly. Failures
   * to write are NOT surfaced as runtime errors — telemetry is advisory
   * by design; the orchestrator shouldn't crash because the sessions
   * directory is unwritable.
   */
  emit(event: SessionEvent): void {
    const sanitised = sanitiseEvent(event);
    this.buffer.push(sanitised);
    if (this.inMemoryOnly) return;
    try {
      if (!this.dirReady) {
        if (!existsSync(this.paths.sessionsDir)) {
          mkdirSync(this.paths.sessionsDir, { recursive: true });
        }
        this.dirReady = true;
      }
      appendFileSync(this.paths.path, JSON.stringify(sanitised) + "\n", "utf8");
    } catch {
      // Telemetry is advisory; swallow IO errors silently.
    }
  }
}

/**
 * Read all events from a session log file. Used by drift detectors.
 * Malformed lines are skipped with a warning entry; the rest of the
 * file remains usable.
 */
export interface ReadSessionLogResult {
  events: SessionEvent[];
  warnings: string[];
  path: string;
}

export function readSessionLog(path: string): ReadSessionLogResult {
  const result: ReadSessionLogResult = { events: [], warnings: [], path };
  if (!existsSync(path)) {
    result.warnings.push(`session log not found: ${path}`);
    return result;
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    result.warnings.push(
      `failed to read session log ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as SessionEvent;
      if (parsed && typeof parsed === "object" && typeof (parsed as { event?: unknown }).event === "string") {
        result.events.push(parsed);
      } else {
        result.warnings.push(`malformed event at ${path}:${i + 1}: missing 'event' field`);
      }
    } catch {
      result.warnings.push(`unparseable JSON at ${path}:${i + 1}`);
    }
  }
  return result;
}

/**
 * Discover all session-log files for a workflow id. Returns paths sorted
 * by mtime ascending (oldest first). Used by cross-session drift
 * detectors (recurrence + repeated-prompt patterns).
 */
export interface SessionLogIndexEntry {
  path: string;
  workflowId: string;
  mtimeMs: number;
}

export function indexSessionLogs(
  options: { cwd?: string; workflowId?: string } = {},
): SessionLogIndexEntry[] {
  const root = resolveTargetRoot(options.cwd);
  const dir = join(root, "substrate", "sessions");
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SessionLogIndexEntry[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    // Filename shape: <workflow-id>-<sha-prefix>.jsonl. We extract the
    // id by stripping the last -<8hex>.jsonl suffix; the id itself may
    // contain hyphens.
    const m = name.match(/^(.+)-[0-9a-f]{8}\.jsonl$/);
    if (!m) continue;
    const workflowId = m[1];
    if (options.workflowId && workflowId !== options.workflowId) continue;
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.push({ path: full, workflowId, mtimeMs: st.mtimeMs });
  }
  out.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return out;
}
