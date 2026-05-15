/**
 * Substrate v2 — `trigger: schedule` runtime (Phase B3, Primitive 8).
 *
 * The workflow manifest's `trigger: [{ schedule: { cron|interval|
 * every-n-commits } }]` declaration becomes an invocable schedule via
 * three runtime paths (plan §3.8):
 *
 *   - CI mode      → GitHub Actions `schedule:` event (docs/scheduling.md)
 *   - Local mode   → `substrate scheduler --check` from cron / systemd
 *   - AI-session mode → orchestrator prompts "X hasn't run in N days"
 *
 * Scheduler state lives at `substrate/scheduler/state.json` and tracks
 * the most recent run timestamp + every-n-commits counter per
 * scheduled workflow.
 *
 * Layer: deterministic. Reading state + computing due workflows is
 * pure I/O; invoking the workflows is the orchestrator's job (the
 * `substrate scheduler --check` CLI just lists what's due and the
 * caller pipes that into `substrate run`).
 *
 * Why a tiny in-house cron parser instead of `cron-parser` (npm)?
 * The set of cron expressions we need to support is the standard
 * 5-field syntax with `*`, slash-N (step), lists, and ranges. That's
 * small enough to keep dependency-free; substrate's no-runtime-deps
 * story from B2 applies. If the consumer needs full cron semantics,
 * the runtime falls back gracefully and treats unknown expressions
 * as "always due".
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolveTargetRoot } from "../../util/paths.js";
import { parseDuration } from "../composition.js";
import { discoverWorkflows } from "../discoverer.js";
import type { ScheduleTrigger, Trigger, WorkflowManifest } from "../types.js";

export interface SchedulerState {
  version: 1;
  /** Per-workflow last-run records keyed by workflow id. */
  workflows: Record<string, SchedulerWorkflowRecord>;
}

export interface SchedulerWorkflowRecord {
  /** ISO timestamp of last invocation (any path). */
  lastRunAt?: string;
  /** Cumulative count of commits since the last run (for every-n-commits). */
  commitsSinceLastRun?: number;
}

export interface SchedulerCheckOptions {
  cwd?: string;
  /** Test seam — override "now". */
  now?: Date;
}

export interface DueWorkflow {
  workflowId: string;
  /** Which trigger fired this evaluation. */
  reason: string;
  /** The parsed schedule clause. */
  schedule: ScheduleTrigger["schedule"];
}

export interface SchedulerCheckResult {
  /** Workflows that are due to run. */
  due: DueWorkflow[];
  /** Workflows checked, even if not due (used for `--all` mode). */
  scheduled: Array<{
    workflowId: string;
    schedule: ScheduleTrigger["schedule"];
    lastRunAt?: string;
    /** Human-readable due-in message. */
    dueIn: string;
  }>;
  warnings: string[];
}

const STATE_FILE_RELPATH = ["substrate", "scheduler", "state.json"];

function resolveStateFilePath(cwd?: string): string {
  return join(resolveTargetRoot(cwd), ...STATE_FILE_RELPATH);
}

/**
 * Load the scheduler state JSON. Returns the canonical empty shape
 * when the file is missing or unreadable.
 */
export function loadSchedulerState(cwd?: string): SchedulerState {
  const path = resolveStateFilePath(cwd);
  if (!existsSync(path)) {
    return { version: 1, workflows: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SchedulerState;
    if (parsed && parsed.version === 1 && parsed.workflows) {
      return parsed;
    }
  } catch {
    // Treat malformed state as empty — better than failing the runtime.
  }
  return { version: 1, workflows: {} };
}

/**
 * Save the scheduler state JSON, creating the parent directory when
 * absent.
 */
export function saveSchedulerState(state: SchedulerState, cwd?: string): void {
  const path = resolveStateFilePath(cwd);
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/**
 * Record a workflow run in the scheduler state. The orchestrator calls
 * this after every `substrate run` invocation of a workflow that has
 * a `trigger: schedule` clause.
 */
export function recordWorkflowRun(
  workflowId: string,
  options: { cwd?: string; now?: Date } = {},
): void {
  const now = options.now ?? new Date();
  const state = loadSchedulerState(options.cwd);
  state.workflows[workflowId] = {
    ...state.workflows[workflowId],
    lastRunAt: now.toISOString(),
    commitsSinceLastRun: 0,
  };
  saveSchedulerState(state, options.cwd);
}

/**
 * Increment the per-workflow commit counter. Called by the user-side
 * post-commit hook (substrate ships a documented snippet for this; we
 * don't auto-install).
 */
export function bumpCommitCounter(cwd?: string): void {
  const state = loadSchedulerState(cwd);
  for (const id of Object.keys(state.workflows)) {
    const rec = state.workflows[id];
    rec.commitsSinceLastRun = (rec.commitsSinceLastRun ?? 0) + 1;
  }
  saveSchedulerState(state, cwd);
}

/**
 * Compute which scheduled workflows are due to run. Discovers manifests
 * via `discoverWorkflows`, then evaluates each `schedule` trigger
 * against the current state.
 */
export function checkSchedule(
  options: SchedulerCheckOptions = {},
): SchedulerCheckResult {
  const now = options.now ?? new Date();
  const discovery = discoverWorkflows({ cwd: options.cwd });
  const state = loadSchedulerState(options.cwd);
  const due: DueWorkflow[] = [];
  const scheduled: SchedulerCheckResult["scheduled"] = [];
  const warnings: string[] = [];

  for (const desc of discovery.workflows) {
    const manifest = desc.manifest;
    const schedules = extractSchedules(manifest);
    if (schedules.length === 0) continue;
    const record = state.workflows[manifest.id];
    for (const sched of schedules) {
      const verdict = evaluateSchedule(sched.schedule, record, now);
      const item = {
        workflowId: manifest.id,
        schedule: sched.schedule,
        lastRunAt: record?.lastRunAt,
        dueIn: verdict.dueIn,
      };
      scheduled.push(item);
      if (verdict.due) {
        due.push({
          workflowId: manifest.id,
          reason: verdict.reason,
          schedule: sched.schedule,
        });
      }
      if (verdict.warning) warnings.push(verdict.warning);
    }
  }
  return { due, scheduled, warnings };
}

function extractSchedules(manifest: WorkflowManifest): ScheduleTrigger[] {
  const out: ScheduleTrigger[] = [];
  for (const t of manifest.trigger ?? []) {
    if (typeof t === "object" && t !== null && "schedule" in (t as object)) {
      out.push(t as ScheduleTrigger);
    }
  }
  return out;
}

interface Verdict {
  due: boolean;
  reason: string;
  /** Friendly "due in <duration>" / "due now" / "overdue by <duration>" string. */
  dueIn: string;
  warning?: string;
}

function evaluateSchedule(
  schedule: ScheduleTrigger["schedule"],
  record: SchedulerWorkflowRecord | undefined,
  now: Date,
): Verdict {
  if (schedule.cron !== undefined) {
    return evaluateCron(schedule.cron, record?.lastRunAt, now);
  }
  if (schedule.interval !== undefined) {
    return evaluateInterval(schedule.interval, record?.lastRunAt, now);
  }
  if (schedule["every-n-commits"] !== undefined) {
    return evaluateEveryNCommits(
      schedule["every-n-commits"]!,
      record?.commitsSinceLastRun ?? 0,
    );
  }
  return { due: false, reason: "no schedule clause", dueIn: "—" };
}

/**
 * Tiny cron evaluator. Supports the standard 5-field cron (m h dom mon
 * dow) with `*`, step (slash-N), comma-lists, and `a-b` ranges.
 * Day-of-month and day-of-week are OR-combined when both are non-`*`
 * (cron's historical quirk).
 *
 * The "due" verdict: a workflow with cron is due if (a) it has never
 * run, OR (b) at least one cron-matching minute has elapsed since its
 * last run.
 */
function evaluateCron(
  cronExpr: string,
  lastRunIso: string | undefined,
  now: Date,
): Verdict {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return {
      due: true, // unknown cron → safer to surface than swallow
      reason: `unparseable cron "${cronExpr}" — treated as always due`,
      dueIn: "always (parse failed)",
      warning: `cron expression "${cronExpr}" not in the supported 5-field form`,
    };
  }
  const minuteOk = cronFieldMatches(fields[0], now.getUTCMinutes(), 0, 59);
  const hourOk = cronFieldMatches(fields[1], now.getUTCHours(), 0, 23);
  const domOk = cronFieldMatches(fields[2], now.getUTCDate(), 1, 31);
  const monOk = cronFieldMatches(fields[3], now.getUTCMonth() + 1, 1, 12);
  const dowOk = cronFieldMatches(fields[4], now.getUTCDay(), 0, 6);
  // POSIX cron: when both DOM and DOW are restricted, EITHER match is enough.
  const domOrDow =
    fields[2] === "*" || fields[4] === "*" ? domOk && dowOk : domOk || dowOk;
  const matchesNow = minuteOk && hourOk && monOk && domOrDow;

  if (!lastRunIso) {
    return {
      due: matchesNow,
      reason: matchesNow ? `cron "${cronExpr}" matches now` : `awaiting first matching tick`,
      dueIn: matchesNow ? "now" : "awaiting first tick",
    };
  }
  const lastRun = new Date(lastRunIso);
  // "Has at least one matching minute passed since last run?" Approximate:
  // sample minute-by-minute back from `now` to `lastRun` for cheap correctness.
  // For typical intervals (daily / weekly) this is bounded. We cap at 30 days
  // of look-back so a stale state file doesn't loop forever.
  const horizonMs = 30 * 24 * 60 * 60 * 1000;
  const startMs = Math.max(lastRun.getTime() + 60 * 1000, now.getTime() - horizonMs);
  for (let t = startMs; t <= now.getTime(); t += 60 * 1000) {
    const d = new Date(t);
    if (
      cronFieldMatches(fields[0], d.getUTCMinutes(), 0, 59) &&
      cronFieldMatches(fields[1], d.getUTCHours(), 0, 23) &&
      cronFieldMatches(fields[3], d.getUTCMonth() + 1, 1, 12) &&
      (fields[2] === "*" || fields[4] === "*"
        ? cronFieldMatches(fields[2], d.getUTCDate(), 1, 31) &&
          cronFieldMatches(fields[4], d.getUTCDay(), 0, 6)
        : cronFieldMatches(fields[2], d.getUTCDate(), 1, 31) ||
          cronFieldMatches(fields[4], d.getUTCDay(), 0, 6))
    ) {
      return {
        due: true,
        reason: `cron "${cronExpr}" tick at ${d.toISOString()} not yet honoured`,
        dueIn: "overdue",
      };
    }
  }
  return {
    due: false,
    reason: `last ran ${lastRunIso}; no cron tick since`,
    dueIn: "next tick pending",
  };
}

const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};
const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

function normalizeNamed(field: string): string {
  // Replace day / month names (case-insensitive) with their integer
  // equivalents. Applies uniformly — cron-name semantics are the same
  // across DOW and MON fields; substitution is harmless when the name
  // doesn't apply.
  return field.replace(/[A-Z]+/gi, (m) => {
    const up = m.toUpperCase();
    if (up in DAY_NAMES) return String(DAY_NAMES[up]);
    if (up in MONTH_NAMES) return String(MONTH_NAMES[up]);
    return m;
  });
}

function cronFieldMatches(
  field: string,
  value: number,
  minV: number,
  maxV: number,
): boolean {
  const normalized = normalizeNamed(field);
  for (const part of normalized.split(",")) {
    if (cronPartMatches(part.trim(), value, minV, maxV)) return true;
  }
  return false;
}

function cronPartMatches(
  part: string,
  value: number,
  minV: number,
  maxV: number,
): boolean {
  if (part === "*") return true;
  const stepIdx = part.indexOf("/");
  let body = part;
  let step = 1;
  if (stepIdx !== -1) {
    body = part.slice(0, stepIdx);
    step = parseInt(part.slice(stepIdx + 1), 10) || 1;
  }
  let lo = minV;
  let hi = maxV;
  if (body !== "*") {
    if (body.includes("-")) {
      const [l, h] = body.split("-").map((s) => parseInt(s, 10));
      lo = l;
      hi = h;
    } else {
      const n = parseInt(body, 10);
      if (Number.isNaN(n)) return false;
      lo = n;
      hi = n;
    }
  }
  if (value < lo || value > hi) return false;
  return (value - lo) % step === 0;
}

function evaluateInterval(
  interval: string,
  lastRunIso: string | undefined,
  now: Date,
): Verdict {
  const ms = parseDuration(interval);
  if (ms === null) {
    return {
      due: true,
      reason: `unparseable interval "${interval}" — treated as always due`,
      dueIn: "always (parse failed)",
      warning: `interval "${interval}" not in <N><smhdw> form`,
    };
  }
  if (!lastRunIso) {
    return { due: true, reason: "never run", dueIn: "due now (no prior run)" };
  }
  const elapsed = now.getTime() - new Date(lastRunIso).getTime();
  if (elapsed >= ms) {
    return {
      due: true,
      reason: `elapsed ${Math.floor(elapsed / (60 * 60 * 1000))}h since last run`,
      dueIn: "overdue",
    };
  }
  return {
    due: false,
    reason: `${Math.floor((ms - elapsed) / (60 * 60 * 1000))}h remaining`,
    dueIn: `due in ${Math.floor((ms - elapsed) / (60 * 60 * 1000))}h`,
  };
}

function evaluateEveryNCommits(
  threshold: number,
  commitsSinceLastRun: number,
): Verdict {
  if (commitsSinceLastRun >= threshold) {
    return {
      due: true,
      reason: `${commitsSinceLastRun} commits since last run (threshold: ${threshold})`,
      dueIn: "overdue",
    };
  }
  return {
    due: false,
    reason: `${commitsSinceLastRun}/${threshold} commits accumulated`,
    dueIn: `${threshold - commitsSinceLastRun} commits remaining`,
  };
}

/**
 * Filter the manifest's triggers to just the `schedule` shapes. Exposed
 * for tests + for callers that want to know whether a workflow IS
 * scheduled without firing the evaluator.
 */
export function isScheduled(manifest: WorkflowManifest): boolean {
  return (manifest.trigger ?? []).some(isScheduleTrigger);
}

function isScheduleTrigger(t: Trigger): t is ScheduleTrigger {
  return typeof t === "object" && t !== null && "schedule" in (t as object);
}

/**
 * Test seam: explicitly clear the scheduler state file (for cleanup
 * between integration test runs).
 */
export function clearSchedulerState(cwd?: string): void {
  const stateDir = join(resolveTargetRoot(cwd), "substrate", "scheduler");
  if (!existsSync(stateDir)) return;
  for (const name of readdirSync(stateDir)) {
    if (name === "state.json") {
      writeFileSync(
        join(stateDir, name),
        JSON.stringify({ version: 1, workflows: {} }, null, 2) + "\n",
        "utf8",
      );
    }
  }
}
