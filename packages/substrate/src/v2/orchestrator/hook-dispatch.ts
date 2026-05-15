/**
 * Hook dispatch — orchestrator-side runner for v2 cross-cutting hooks.
 *
 * Discovers hooks via `discoverHooks`, filters by firing context, and
 * runs each matching hook in declared `order`. Two step types:
 *
 *   - `run-deterministic` — shells out to `step.command`. Optionally
 *     passes the firing context's exit code / result as JSON on stdin.
 *   - `noop` — resolves a substrate-internal handler by name. Used for
 *     hooks whose logic lives in TS rather than a shell command.
 *
 * Hooks are advisory by default: a non-zero exit (or a handler throw)
 * surfaces a warning but does not fail the workflow. Setting
 * `step.fail-on-error: true` on a hook escalates that.
 *
 * Layer: orchestration. The discovery + matching pieces live in
 * `../hooks.ts` and are pure-deterministic.
 */

import { spawnSync } from "node:child_process";
import kleur from "kleur";
import {
  discoverHooks,
  findMatchingHooks,
  type HookDescriptor,
  type HookFiringContext,
} from "../hooks.js";

export interface HookDispatchOptions {
  cwd?: string;
  /** Suppress per-hook stdout/stderr noise; defaults to false. */
  quiet?: boolean;
  /**
   * Pre-discovered hook set, useful for tests + repeated calls during a
   * single workflow run. When omitted, discovery happens on each call.
   */
  hooks?: HookDescriptor[];
}

export interface HookRunRecord {
  hookId: string;
  trigger: string;
  status: "ok" | "failed" | "skipped" | "deferred";
  message?: string;
}

export type NoopHandler = (
  context: HookFiringContext,
  hook: HookDescriptor,
) => Promise<HookRunRecord> | HookRunRecord;

/**
 * Built-in handler registry for `step.type: noop` hooks. The map's
 * keys are matched against `step.handler` (or, when handler is unset,
 * the hook id is used as a fallback so simple references work without
 * a redundant `handler:` field).
 *
 * Why a registry instead of dynamic import? Hook handlers ship with
 * Substrate itself. Consumer-authored handlers route through
 * `run-deterministic` (i.e. a shell command), which keeps the v2
 * extensibility story uniform: external == process boundary; internal
 * == this registry.
 */
const BUILTIN_HANDLERS: Record<string, NoopHandler> = {
  /**
   * `auto-drift-detect` — placeholder for the B3 proposal pipeline.
   *
   * In B2 it logs that the proposal pipeline is pending and exits
   * cleanly. The hook itself ships in `templates/hooks/` so workflows
   * can already reference it; B3 swaps in a handler that runs drift
   * detection on the workflow's session-event-log.
   */
  "auto-drift-detect": (_context, hook) => ({
    hookId: hook.manifest.id,
    trigger: _context.trigger,
    status: "deferred",
    message:
      "proposal pipeline pending (B3). Hook recorded but no drift detection performed.",
  }),
};

/**
 * Register a built-in handler for a `noop` hook. Used by B3 when the
 * proposal pipeline replaces the auto-drift-detect skeleton.
 */
export function registerHookHandler(name: string, handler: NoopHandler): void {
  BUILTIN_HANDLERS[name] = handler;
}

/**
 * Dispatch all hooks matching the firing context. Returns one record
 * per hook actually invoked.
 */
export async function dispatchHooks(
  context: HookFiringContext,
  options: HookDispatchOptions = {},
): Promise<HookRunRecord[]> {
  const hooks = options.hooks ?? discoverHooks({ cwd: options.cwd }).hooks;
  const matching = findMatchingHooks(hooks, context);
  const records: HookRunRecord[] = [];

  for (const descriptor of matching) {
    const record = await runHook(descriptor, context, options);
    records.push(record);
  }
  return records;
}

async function runHook(
  descriptor: HookDescriptor,
  context: HookFiringContext,
  options: HookDispatchOptions,
): Promise<HookRunRecord> {
  const { manifest } = descriptor;
  if (manifest.step.type === "noop") {
    const handlerName = manifest.step.handler ?? manifest.id;
    const handler = BUILTIN_HANDLERS[handlerName];
    if (!handler) {
      const msg = `noop hook "${manifest.id}" references unknown handler "${handlerName}"`;
      if (!options.quiet) {
        console.log(kleur.yellow(`  ! hook ${manifest.id}: ${msg}`));
      }
      return {
        hookId: manifest.id,
        trigger: context.trigger,
        status: "skipped",
        message: msg,
      };
    }
    try {
      const record = await handler(context, descriptor);
      if (!options.quiet) {
        logHookOutcome(record);
      }
      return record;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failOnError = manifest.step["fail-on-error"] === true;
      const record: HookRunRecord = {
        hookId: manifest.id,
        trigger: context.trigger,
        status: failOnError ? "failed" : "skipped",
        message: msg,
      };
      if (!options.quiet) logHookOutcome(record);
      return record;
    }
  }

  // run-deterministic
  const command = manifest.step.command ?? "";
  if (!command) {
    return {
      hookId: manifest.id,
      trigger: context.trigger,
      status: "skipped",
      message: `hook "${manifest.id}" has no command`,
    };
  }
  const passResult = manifest.step["pass-result"] === true;
  const stdinPayload = passResult ? JSON.stringify(context) + "\n" : undefined;
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    cwd: options.cwd ?? process.cwd(),
    stdio: stdinPayload
      ? ["pipe", "pipe", "pipe"]
      : ["ignore", "pipe", "pipe"],
    input: stdinPayload,
  });
  if (result.error) {
    const failOnError = manifest.step["fail-on-error"] === true;
    const record: HookRunRecord = {
      hookId: manifest.id,
      trigger: context.trigger,
      status: failOnError ? "failed" : "skipped",
      message: result.error.message,
    };
    if (!options.quiet) logHookOutcome(record);
    return record;
  }
  if (result.status !== 0) {
    const failOnError = manifest.step["fail-on-error"] === true;
    const record: HookRunRecord = {
      hookId: manifest.id,
      trigger: context.trigger,
      status: failOnError ? "failed" : "skipped",
      message: `command exited with status ${result.status}`,
    };
    if (!options.quiet) logHookOutcome(record);
    return record;
  }
  const record: HookRunRecord = {
    hookId: manifest.id,
    trigger: context.trigger,
    status: "ok",
  };
  if (!options.quiet) logHookOutcome(record);
  return record;
}

function logHookOutcome(record: HookRunRecord): void {
  switch (record.status) {
    case "ok":
      console.log(kleur.dim(`  ↳ hook ${record.hookId} ok`));
      break;
    case "failed":
      console.log(kleur.red(`  ↳ hook ${record.hookId} failed — ${record.message ?? ""}`));
      break;
    case "skipped":
      console.log(kleur.yellow(`  ↳ hook ${record.hookId} skipped — ${record.message ?? ""}`));
      break;
    case "deferred":
      console.log(
        kleur.yellow(`  ↳ hook ${record.hookId} deferred — ${record.message ?? ""}`),
      );
      break;
  }
}
