/**
 * `substrate scheduler --check` — deterministic CLI for the
 * `trigger: schedule` runtime.
 *
 * Lists scheduled workflows + due verdicts. Output is consumed by
 * humans (default) or by automation (--json), and the CLI is
 * deliberately non-invasive: it never invokes workflows. The caller
 * pipes due ids into `substrate run`.
 *
 * Layer: deterministic.
 */

import kleur from "kleur";
import { checkSchedule } from "./scheduler.js";

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
