/**
 * Substrate telemetry — opt-in only (v0.8).
 *
 * Mirrors the Flint v0.9 pattern: preference stored in
 * `~/.config/substrate/telemetry.json`, opt-in prompt on first run,
 * events emitted locally to `~/.config/substrate/telemetry.log` for v0.8.
 *
 * **No real endpoint is wired in v0.8.** Events go to the local log
 * file only. v1.0 will add an optional collector with explicit user
 * consent on top of the existing opt-in prompt.
 *
 * **Locked event shape (public-ish API — record any changes in HANDOFF):**
 *
 * ```ts
 * interface TelemetryEvent {
 *   v: 2;                          // schema version (bumped to 2 in the
 *                                  //   cadence → @op4z/substrate rename:
 *                                  //   `cadenceVersion` → `substrateVersion`
 *                                  //   is a forbidden-field change, so the
 *                                  //   contract version moves with it.)
 *   ts: string;                    // ISO 8601 timestamp
 *   substrateVersion: string;      // e.g. "1.0.0"
 *   osFamily: string;              // "darwin" | "linux" | "win32"
 *   command: string;               // e.g. "audit", "init", "upgrade"
 *   audit?: string;                // e.g. "backend", "frontend"
 *   errorType?: string;            // e.g. "AdapterLoadError" (no message body)
 * }
 * ```
 *
 * **Redaction discipline:**
 * - No project paths
 * - No user identifiers
 * - No rule body content
 * - No audit findings
 * - No environment values
 *
 * Error type is the class name (or "Error" generic) — never the message,
 * which can contain user-data substrings.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { SUBSTRATE_VERSION } from "./version.js";

const SCHEMA_VERSION = 2;

export interface TelemetryPreference {
  /** Has the user been asked the opt-in question? */
  prompted: boolean;
  /** Did they say yes? null when not yet prompted. */
  enabled: boolean | null;
  /** ISO 8601 of when the preference was last updated. */
  updatedAt: string;
  /** Substrate version that last touched this preference. */
  substrateVersion: string;
}

export interface TelemetryEvent {
  v: number;
  ts: string;
  substrateVersion: string;
  osFamily: string;
  command: string;
  audit?: string;
  errorType?: string;
}

function configDir(): string {
  // Honor XDG_CONFIG_HOME so users on systems with non-standard layout
  // (or CI sandboxes) can override.
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "substrate");
}

export function preferencePath(): string {
  return join(configDir(), "telemetry.json");
}

export function logPath(): string {
  return join(configDir(), "telemetry.log");
}

/**
 * Read the preference file. Returns a default-shaped preference (prompted=false,
 * enabled=null) when the file doesn't exist.
 */
export function readPreference(): TelemetryPreference {
  const p = preferencePath();
  if (!existsSync(p)) {
    return {
      prompted: false,
      enabled: null,
      updatedAt: new Date().toISOString(),
      substrateVersion: SUBSTRATE_VERSION,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as Partial<TelemetryPreference>;
    return {
      prompted: parsed.prompted ?? false,
      enabled: parsed.enabled ?? null,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      substrateVersion: parsed.substrateVersion ?? SUBSTRATE_VERSION,
    };
  } catch {
    // Corrupt preference — treat as never-prompted; user will see the
    // first-run prompt again.
    return {
      prompted: false,
      enabled: null,
      updatedAt: new Date().toISOString(),
      substrateVersion: SUBSTRATE_VERSION,
    };
  }
}

/**
 * Write a preference. Creates the config dir if missing.
 */
export function writePreference(pref: TelemetryPreference): void {
  const p = preferencePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(pref, null, 2) + "\n", "utf8");
}

/**
 * Set the user's preference explicitly (the API behind
 * `substrate config --telemetry on|off`). Sets prompted=true so the
 * first-run prompt isn't shown again.
 */
export function setTelemetryEnabled(enabled: boolean): TelemetryPreference {
  const pref: TelemetryPreference = {
    prompted: true,
    enabled,
    updatedAt: new Date().toISOString(),
    substrateVersion: SUBSTRATE_VERSION,
  };
  writePreference(pref);
  return pref;
}

/**
 * Emit a telemetry event IF the user has opted in. No-op when the
 * preference is null/false. v0.8 writes the event JSON to a local log
 * file only; v1.0 also (optionally) POSTs to a user-configured
 * collector via the `SUBSTRATE_TELEMETRY_ENDPOINT` env var or the
 * `--telemetry-endpoint <url>` flag (passed through here by the CLI).
 *
 * **Local logging is the default.** The endpoint is opt-in extra; if
 * configured, the JSONL line is also POSTed there. Failures POSTing
 * never surface to the user — telemetry must not break substrate.
 *
 * The function is intentionally silent on errors — telemetry must never
 * cause a user-facing failure.
 */
export function emitTelemetryEvent(
  command: string,
  options: { audit?: string; errorType?: string; endpoint?: string } = {},
): void {
  try {
    const pref = readPreference();
    if (pref.enabled !== true) return;
    const event: TelemetryEvent = {
      v: SCHEMA_VERSION,
      ts: new Date().toISOString(),
      substrateVersion: SUBSTRATE_VERSION,
      osFamily: platform(),
      command,
      audit: options.audit,
      errorType: options.errorType,
    };
    const p = logPath();
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(event) + "\n", "utf8");

    // Optional outbound forward to a user-configured collector.
    const endpoint = options.endpoint ?? process.env.SUBSTRATE_TELEMETRY_ENDPOINT;
    if (endpoint) {
      // Best-effort, fire-and-forget. Don't await — we don't want
      // network latency on the CLI exit path.
      void forwardEvent(endpoint, event).catch(() => {
        // Swallow — telemetry must not break.
      });
    }
  } catch {
    // Telemetry must not break substrate — swallow errors.
  }
}

async function forwardEvent(endpoint: string, event: TelemetryEvent): Promise<void> {
  // Use the global fetch (Node 18+). We don't import a heavy http
  // library because this is fire-and-forget and the surface is one
  // POST.
  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    // Reasonable cap so a slow collector doesn't hang substrate exit.
    signal: AbortSignal.timeout(2000),
  });
}

/**
 * Determine whether to surface the opt-in prompt to the user. True when
 * the user has never been prompted before. CLI callers should set
 * `prompted=true` regardless of the user's answer so the prompt is
 * shown exactly once.
 */
export function shouldPromptForOptIn(): boolean {
  return readPreference().prompted === false;
}

/**
 * Programmatic helper for the prompt UX. Substrate's `init` command (and
 * any other first-run hook) calls this to ask the user, then records
 * their answer.
 *
 * The actual interactive prompt lives in the command layer (so it can
 * use inquirer); this helper only mutates the preference file.
 */
export function recordPromptResponse(enabled: boolean): TelemetryPreference {
  return setTelemetryEnabled(enabled);
}
