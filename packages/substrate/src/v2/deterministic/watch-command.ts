/**
 * `substrate watch [path]` — file-change trigger producer.
 *
 * Monitors a directory tree for filesystem changes and fires matching
 * v2 hooks whose `trigger: [file-change]` clauses include the changed
 * path. Closes the producer gap that `HookTrigger` declares but no
 * code path was firing.
 *
 * Implementation:
 *   - Uses `node:fs.watch` (recursive option on Linux requires Node
 *     20+; we set `engines.node >= 20.0.0`). No external dep.
 *   - Debounces rapid back-to-back save events at 100ms per path to
 *     avoid double-firing (editors often emit two events per save).
 *   - Exits cleanly on SIGINT / SIGTERM with a summary.
 *
 * Layer: deterministic-ish — the watcher itself is pure I/O, but it
 * dispatches hooks via the orchestrator's hook-dispatch module. We
 * keep the command here (under `deterministic/`) because the user-
 * facing surface is a long-running deterministic loop; firing hooks is
 * the side-effect.
 */

import { existsSync, statSync, watch } from "node:fs";
import { resolve, relative, join } from "node:path";
import kleur from "kleur";
import { resolveTargetRoot } from "../../util/paths.js";
import { discoverHooks } from "../hooks.js";
import { dispatchHooks } from "../orchestrator/hook-dispatch.js";

export interface WatchCommandOptions {
  /** Path to watch. Defaults to the repo root. */
  path?: string;
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
  /** Test seam — stop the watcher after this many events fire. */
  maxEvents?: number;
  /** Test seam — invoked when each event has been dispatched. */
  onEvent?: (changedPath: string) => void;
}

export interface WatchCommandHandle {
  /** Stop the watcher; returns the number of events dispatched. */
  stop: () => Promise<number>;
}

const DEBOUNCE_MS = 100;

/**
 * Start the watcher in the background and return a handle the caller
 * can use to stop it. For CLI use, `runWatchCommand` is the wrapper
 * that registers SIGINT and blocks until the user interrupts.
 */
export function startWatcher(
  options: WatchCommandOptions = {},
): WatchCommandHandle {
  const cwd = resolveTargetRoot(options.cwd);
  const watchPath = options.path ? resolve(cwd, options.path) : cwd;
  if (!existsSync(watchPath)) {
    throw new Error(`watch: path "${watchPath}" does not exist`);
  }
  const stat = statSync(watchPath);
  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error(`watch: path "${watchPath}" is not a file or directory`);
  }

  const hooks = discoverHooks({ cwd }).hooks.filter((h) =>
    h.manifest.trigger.includes("file-change"),
  );

  if (!options.quiet && !options.json) {
    console.log(
      kleur.bold(`substrate watch:`) +
        kleur.dim(
          ` monitoring ${watchPath} (${hooks.length} file-change hook(s) registered)`,
        ),
    );
    if (hooks.length === 0) {
      console.log(
        kleur.yellow(
          "  ! no hooks with `trigger: [file-change]` declared in substrate/hooks/ — watcher will dispatch nothing.",
        ),
      );
    }
  }

  let eventCount = 0;
  const lastFireTimes = new Map<string, number>();
  let stopped = false;
  let stopResolve: (() => void) | null = null;
  const stopPromise = new Promise<void>((res) => {
    stopResolve = res;
  });

  const onChange = async (changedRel: string) => {
    if (stopped) return;
    const fullPath = join(watchPath, changedRel);
    // Debounce: drop events that fired for the same path within
    // DEBOUNCE_MS.
    const now = Date.now();
    const last = lastFireTimes.get(fullPath) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    lastFireTimes.set(fullPath, now);

    const relPath = relative(cwd, fullPath);
    if (!options.quiet && !options.json) {
      console.log(kleur.dim(`  ~ change: ${relPath}`));
    }
    try {
      await dispatchHooks(
        {
          trigger: "file-change",
          cwd,
        },
        { cwd, quiet: options.quiet, hooks },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!options.quiet && !options.json) {
        console.log(kleur.red(`  ! hook dispatch failed: ${msg}`));
      }
    }
    eventCount += 1;
    options.onEvent?.(relPath);
    if (options.maxEvents !== undefined && eventCount >= options.maxEvents) {
      stopped = true;
      stopResolve?.();
    }
  };

  // `recursive: true` works on macOS + Linux (Node 20+) + Windows.
  // We pass eventType-agnostic; only filename is needed for dispatch.
  const watcher = watch(
    watchPath,
    { recursive: true },
    (_eventType, filename) => {
      if (!filename) return;
      // Filter out noise — substrate's own session log dir writes
      // constantly during a workflow run; if a watcher fires on
      // those, it'd loop forever.
      if (filename.includes("substrate/sessions/")) return;
      if (filename.includes("substrate/proposals/")) return;
      // Ignore .git/ churn.
      if (filename.startsWith(".git/") || filename.includes("/.git/")) return;
      // Ignore typical build artefacts that scribble during dev.
      if (filename.includes("node_modules/")) return;
      if (filename.includes("/dist/") || filename.startsWith("dist/")) return;
      onChange(filename).catch(() => {
        // Swallow async errors; we never want the watcher to crash.
      });
    },
  );

  return {
    stop: async () => {
      if (stopped) return eventCount;
      stopped = true;
      watcher.close();
      stopResolve?.();
      await stopPromise;
      return eventCount;
    },
  };
}

/**
 * CLI entry point — starts the watcher, registers SIGINT/SIGTERM, and
 * blocks until the process is interrupted (or `maxEvents` is reached).
 */
export async function runWatchCommand(
  options: WatchCommandOptions = {},
): Promise<{ ok: boolean; eventCount: number }> {
  const handle = startWatcher(options);
  let interrupted = false;
  const onSignal = (sig: NodeJS.Signals) => {
    if (interrupted) return;
    interrupted = true;
    if (!options.quiet && !options.json) {
      console.log(kleur.dim(`\nsubstrate watch: received ${sig}; shutting down...`));
    }
    handle
      .stop()
      .then((eventCount) => {
        if (!options.quiet && !options.json) {
          console.log(
            kleur.green(`✓ watcher stopped after ${eventCount} event(s).`),
          );
        }
      })
      .catch(() => {
        // Swallow — process is exiting anyway.
      });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  // Block until the watcher stops (either via signal or via maxEvents).
  return new Promise((resolveOuter) => {
    const tick = () => {
      if (interrupted) {
        handle.stop().then((eventCount) => {
          resolveOuter({ ok: true, eventCount });
        });
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}
