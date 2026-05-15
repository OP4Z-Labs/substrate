/**
 * `cadence telemetry` subcommands — transparency surfaces.
 *
 * v1.0 adds three commands beyond the v0.8 `config --telemetry on|off`:
 *
 *   - `cadence telemetry show`    : dump the current preference + log
 *                                   tail.
 *   - `cadence telemetry purge`   : wipe preference + log (with prompt).
 *   - `cadence telemetry export`  : copy the log to a user-specified
 *                                   file (CSV or JSONL).
 *
 * Plus the `--telemetry-endpoint <url>` flag plumbing for users who
 * want events forwarded to their own collector. Telemetry stays
 * local-by-default; the endpoint is an opt-in extra.
 *
 * Locked: telemetry events never contain paths, tokens, user IDs, or
 * error message bodies. The transparency commands above expose exactly
 * the data cadence collects.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import kleur from "kleur";
import { atomicWriteFileSync } from "../util/atomic-write.js";
import {
  logPath,
  preferencePath,
  readPreference,
} from "../util/telemetry.js";

export interface TelemetryShowOptions {
  json?: boolean;
  quiet?: boolean;
  /** How many recent events to display in the human view. */
  tail?: number;
}

export function runTelemetryShow(options: TelemetryShowOptions = {}): {
  preference: ReturnType<typeof readPreference>;
  events: unknown[];
} {
  const pref = readPreference();
  const log = logPath();
  const events: unknown[] = [];
  if (existsSync(log)) {
    const text = readFileSync(log, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        // Tolerate malformed lines silently.
      }
    }
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ preference: pref, events }, null, 2) + "\n");
    return { preference: pref, events };
  }
  if (options.quiet) return { preference: pref, events };

  console.log(kleur.bold("Cadence telemetry status"));
  console.log(
    `  state    : ${
      pref.enabled === true
        ? kleur.green("enabled")
        : pref.enabled === false
          ? kleur.dim("disabled")
          : kleur.yellow("not yet asked")
    }`,
  );
  console.log(`  prompted : ${pref.prompted ? "yes" : "no"}`);
  console.log(kleur.dim(`  pref file: ${preferencePath()}`));
  console.log(kleur.dim(`  log file : ${log}`));
  console.log(kleur.dim(`  events   : ${events.length} on file`));
  console.log("");
  if (events.length === 0) {
    console.log(kleur.dim("  (no events recorded)"));
    return { preference: pref, events };
  }
  const tail = options.tail ?? 10;
  const recent = events.slice(-tail);
  console.log(kleur.bold(`Last ${recent.length} event(s):`));
  for (const e of recent) {
    const o = e as { ts?: string; command?: string; cadenceVersion?: string; osFamily?: string; errorType?: string };
    console.log(
      `  ${o.ts ?? "?"}  ${kleur.cyan((o.command ?? "?").padEnd(12))}  ${kleur.dim(`v${o.cadenceVersion ?? "?"} ${o.osFamily ?? "?"}`)}${o.errorType ? kleur.red(`  err=${o.errorType}`) : ""}`,
    );
  }
  return { preference: pref, events };
}

export interface TelemetryPurgeOptions {
  /** Skip the confirmation; used for non-interactive flows / tests. */
  yes?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function runTelemetryPurge(options: TelemetryPurgeOptions = {}): {
  removedPreference: boolean;
  removedLog: boolean;
} {
  if (!options.yes && !options.json) {
    console.log(
      kleur.yellow("This will delete cadence's local telemetry preference and event log."),
    );
    console.log(kleur.dim("Pass --yes to confirm."));
    return { removedPreference: false, removedLog: false };
  }
  let removedPreference = false;
  let removedLog = false;
  const pref = preferencePath();
  if (existsSync(pref)) {
    try {
      unlinkSync(pref);
      removedPreference = true;
    } catch {
      // ignore — best-effort
    }
  }
  const log = logPath();
  if (existsSync(log)) {
    try {
      unlinkSync(log);
      removedLog = true;
    } catch {
      // ignore — best-effort
    }
  }
  const result = { removedPreference, removedLog };
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (!options.quiet) {
    console.log(
      kleur.green("✓ telemetry purged.") +
        " " +
        kleur.dim(
          `(pref ${removedPreference ? "removed" : "absent"}, log ${removedLog ? "removed" : "absent"})`,
        ),
    );
  }
  return result;
}

export interface TelemetryExportOptions {
  /** Destination file. Required. */
  outPath: string;
  /** "jsonl" (default) or "csv". */
  format?: "jsonl" | "csv";
  json?: boolean;
  quiet?: boolean;
}

export function runTelemetryExport(options: TelemetryExportOptions): {
  written: number;
  outPath: string;
  format: "jsonl" | "csv";
} {
  const format = options.format ?? "jsonl";
  const log = logPath();
  const events: Record<string, unknown>[] = [];
  if (existsSync(log)) {
    const text = readFileSync(log, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // skip malformed
      }
    }
  }

  let payload: string;
  if (format === "csv") {
    const cols = ["v", "ts", "cadenceVersion", "osFamily", "command", "audit", "errorType"];
    const header = cols.join(",") + "\n";
    const rows = events
      .map((e) => cols.map((c) => csvCell(e[c])).join(","))
      .join("\n");
    payload = header + rows + (rows ? "\n" : "");
  } else {
    payload = events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
  }
  atomicWriteFileSync(options.outPath, payload);

  const result = { written: events.length, outPath: options.outPath, format };
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (!options.quiet) {
    console.log(
      kleur.green("✓ exported ") +
        `${events.length} event(s) as ${format} to ${options.outPath}`,
    );
  }
  return result;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
