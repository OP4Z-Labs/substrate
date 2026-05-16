/**
 * `substrate scheduler` — deterministic CLI for the `trigger: schedule`
 * runtime.
 *
 * Two modes:
 *   - `--check` (read-only): lists scheduled workflows + due verdicts.
 *     The caller pipes due ids into `substrate run`. Default.
 *   - `--auto-run`: fires every overdue scheduled workflow (or a
 *     single workflow when `--workflow <id>` is also passed). Updates
 *     `substrate/scheduler/state.json` via the orchestrator's normal
 *     `recordWorkflowRun` path.
 *
 * Layer: deterministic for `--check`; calls the orchestrator for
 * `--auto-run` (the orchestrator itself stays in the orchestration
 * layer, but the wrapper here is deterministic).
 */

import kleur from "kleur";
import { checkSchedule } from "./scheduler.js";
import type { OrchestrationTransport } from "../orchestrator/transport.js";

export interface SchedulerCommandOptions {
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
  /** When set, only print workflows currently due. Default lists all scheduled. */
  dueOnly?: boolean;
  /** Test seam — override now(). */
  now?: Date;
}

export interface SchedulerCommandResult {
  due: Array<{ workflowId: string; reason: string }>;
  scheduled: Array<{ workflowId: string; dueIn: string; lastRunAt?: string }>;
  warnings: string[];
}

export function runSchedulerCheck(
  options: SchedulerCommandOptions = {},
): SchedulerCommandResult {
  const result = checkSchedule({ cwd: options.cwd, now: options.now });
  const trimmedDue = result.due.map((d) => ({ workflowId: d.workflowId, reason: d.reason }));
  const trimmedScheduled = result.scheduled.map((s) => ({
    workflowId: s.workflowId,
    dueIn: s.dueIn,
    lastRunAt: s.lastRunAt,
  }));
  const out: SchedulerCommandResult = {
    due: trimmedDue,
    scheduled: trimmedScheduled,
    warnings: result.warnings,
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return out;
  }
  if (options.quiet) return out;

  const visible = options.dueOnly ? result.due : result.scheduled;
  if (visible.length === 0) {
    console.log(
      options.dueOnly
        ? kleur.green("✓ no scheduled workflows are due.")
        : kleur.dim("no scheduled workflows declared."),
    );
  } else {
    if (options.dueOnly) {
      console.log(kleur.bold(`Due workflows (${result.due.length}):`));
      for (const d of result.due) {
        console.log(`  ${kleur.cyan(d.workflowId)} — ${kleur.dim(d.reason)}`);
      }
    } else {
      console.log(kleur.bold(`Scheduled workflows (${result.scheduled.length}):`));
      for (const s of result.scheduled) {
        const dueColor =
          s.dueIn.startsWith("overdue") || s.dueIn === "now"
            ? kleur.red
            : kleur.dim;
        console.log(
          `  ${kleur.cyan(s.workflowId)} — ${dueColor(s.dueIn)}${s.lastRunAt ? kleur.dim(` (last: ${s.lastRunAt})`) : kleur.dim(" (never run)")}`,
        );
      }
    }
  }
  for (const w of result.warnings) {
    console.log(kleur.yellow(`  ! ${w}`));
  }
  return out;
}

export interface SchedulerAutoRunOptions {
  cwd?: string;
  /** Limit to a single workflow id; when omitted, fire all overdue. */
  workflowId?: string;
  /** Suppress per-workflow stdout. */
  quiet?: boolean;
  json?: boolean;
  /** Test seam — override now(). */
  now?: Date;
  /** Optional transport to pass through to runV2Workflow. */
  transport?: OrchestrationTransport;
  /**
   * CI / batch mode: exit cleanly after firing all overdue (no
   * foreground watch). This is the default — `auto-run` always runs
   * to completion. The flag is documented as a hint for callers who
   * may otherwise expect a daemon mode.
   */
  batch?: boolean;
}

export interface SchedulerAutoRunFiredEntry {
  workflowId: string;
  exitCode: number;
  ok: boolean;
}

export interface SchedulerAutoRunResult {
  fired: SchedulerAutoRunFiredEntry[];
  /** Workflows that were due but skipped (e.g. when --workflow filter
   *  excludes them). */
  skipped: string[];
  warnings: string[];
}

/**
 * Fire each overdue scheduled workflow. The orchestrator's
 * `recordWorkflowRun` call already runs on every workflow that
 * declares `trigger: schedule`, so state updates correctly without
 * needing additional bookkeeping here.
 */
export async function runSchedulerAutoRun(
  options: SchedulerAutoRunOptions = {},
): Promise<SchedulerAutoRunResult> {
  // Lazy import to avoid pulling the orchestrator into the
  // deterministic layer's top-level imports (keeps the `--check` path
  // dep-light).
  const { runV2Workflow } = await import("../orchestrator/run-command.js");

  const check = checkSchedule({ cwd: options.cwd, now: options.now });
  const fired: SchedulerAutoRunFiredEntry[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [...check.warnings];

  const targets = options.workflowId
    ? check.due.filter((d) => d.workflowId === options.workflowId)
    : check.due;

  if (options.workflowId && targets.length === 0) {
    // The named workflow either doesn't exist or isn't due — record as skipped.
    skipped.push(options.workflowId);
  }
  // Track non-targeted due workflows when --workflow was specified.
  if (options.workflowId) {
    for (const d of check.due) {
      if (d.workflowId !== options.workflowId) skipped.push(d.workflowId);
    }
  }

  if (!options.quiet && !options.json) {
    if (targets.length === 0) {
      console.log(kleur.green("✓ no overdue scheduled workflows."));
    } else {
      console.log(
        kleur.bold(`Firing ${targets.length} overdue workflow(s):`),
      );
    }
  }

  for (const target of targets) {
    if (!options.quiet && !options.json) {
      console.log(kleur.cyan(`  → ${target.workflowId}`));
    }
    try {
      const result = await runV2Workflow({
        workflowId: target.workflowId,
        cwd: options.cwd,
        quiet: options.quiet || options.json,
        transport: options.transport,
      });
      fired.push({
        workflowId: target.workflowId,
        exitCode: result.exitCode,
        ok: result.ok,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`auto-run ${target.workflowId} failed: ${msg}`);
      fired.push({ workflowId: target.workflowId, exitCode: 1, ok: false });
    }
  }

  const result: SchedulerAutoRunResult = { fired, skipped, warnings };
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!options.quiet) {
    const okCount = fired.filter((f) => f.ok).length;
    if (fired.length > 0) {
      console.log(
        okCount === fired.length
          ? kleur.green(`✓ ${okCount}/${fired.length} workflow(s) completed.`)
          : kleur.yellow(`! ${okCount}/${fired.length} workflow(s) completed.`),
      );
    }
    for (const w of warnings) {
      console.log(kleur.yellow(`  ! ${w}`));
    }
  }
  return result;
}
