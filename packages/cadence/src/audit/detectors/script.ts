/**
 * Script detector.
 *
 * Invokes a user-authored script (JS / MJS) from the consumer repo in
 * a Node `worker_threads` worker with a 30s wall-clock timeout. The
 * worker receives a structured `DetectorContext` and is expected to
 * return an array of {@link Finding} objects (or `void` for "no
 * findings").
 *
 * Sandbox shape (v1.0):
 *
 *   - File access: the script can read files inside the configured
 *     `repoRoot` only. Attempting to read outside the tree throws
 *     `EPERM`. (Enforced by wrapping `fs.readFileSync` in a guard the
 *     worker exposes to the script.)
 *   - Network: no enforcement at v1.0 — Node doesn't ship an in-process
 *     network sandbox without external deps. Rule authors are
 *     responsible for not making outbound calls.
 *   - Timeout: 30s default, configurable up to 5 minutes via
 *     `detector.timeoutMs`. Hard-killed via `worker.terminate()` on
 *     overrun.
 *   - Memory: not enforced. Worker inherits the parent's `--max-old-
 *     space-size`.
 *
 * The script contract is documented in `docs/audit-runtime.md` (the
 * authoritative reference for rule authors).
 *
 * Note on TS: cadence does NOT transpile script paths at runtime —
 * consumers ship `.js` / `.mjs`. Adding a TS loader inside the worker
 * is a v1.1 consideration; for v1.0 the rule author handles
 * compilation in their own build step.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { Finding, ScriptDetector, Severity } from "../types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 5 * 60_000;

export interface RunScriptOptions {
  repoRoot: string;
  ruleId: string;
  severity: Severity;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** Resolve the bundled worker harness next to this module. */
function workerHarnessPath(): string {
  // The worker harness is a sibling JS module shipped in dist/. When this
  // module runs from src/ (tests via vitest) the harness doesn't exist
  // next to us — it lives in the compiled dist/ alongside cli.js.
  // Walk up to the package root and join `dist/audit/detectors/`.
  const sibling = join(HERE, "script-worker.js");
  if (existsSync(sibling)) return sibling;
  const distFallback = join(packageRootFromHere(), "dist", "audit", "detectors", "script-worker.js");
  if (existsSync(distFallback)) return distFallback;
  return sibling;
}

function packageRootFromHere(): string {
  // Walk up at most 5 levels looking for a `package.json` with name "cadence".
  // Resilient across src/ and dist/ checkouts.
  let cursor = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    const pkgPath = join(cursor, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg && pkg.name === "cadence") return cursor;
      } catch {
        // ignore — keep walking
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return HERE;
}

export async function runScriptDetector(
  detector: ScriptDetector,
  options: RunScriptOptions,
): Promise<Finding[]> {
  const scriptAbs = isAbsolute(detector.path)
    ? detector.path
    : resolve(options.repoRoot, detector.path);
  if (!existsSync(scriptAbs)) {
    throw new Error(
      `script detector for rule ${options.ruleId}: file not found at ${detector.path}`,
    );
  }
  const timeout = Math.min(detector.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const harness = workerHarnessPath();
  if (!existsSync(harness)) {
    throw new Error(
      `script worker harness not found at ${harness}. This usually means cadence was not built.`,
    );
  }

  return new Promise<Finding[]>((resolvePromise, rejectPromise) => {
    const worker = new Worker(pathToFileURL(harness), {
      workerData: {
        scriptUrl: pathToFileURL(scriptAbs).href,
        exportName: detector.export ?? "default",
        options: detector.options ?? {},
        repoRoot: options.repoRoot,
        ruleId: options.ruleId,
        severity: options.severity,
      },
      // Block env to avoid leaking secrets into rule scripts.
      env: {},
    });

    let settled = false;
    function settle(fn: () => void): void {
      if (settled) return;
      settled = true;
      fn();
    }

    const timer = setTimeout(() => {
      void worker.terminate();
      settle(() =>
        rejectPromise(
          new Error(
            `script detector for rule ${options.ruleId} exceeded ${timeout}ms timeout`,
          ),
        ),
      );
    }, timeout);

    worker.once("message", (msg) => {
      clearTimeout(timer);
      void worker.terminate();
      if (msg && typeof msg === "object" && "error" in msg) {
        settle(() =>
          rejectPromise(
            new Error(
              `script detector for rule ${options.ruleId} threw: ${String((msg as { error: string }).error)}`,
            ),
          ),
        );
        return;
      }
      const findings = ((msg as { findings?: unknown }).findings ?? []) as Finding[];
      const normalized = findings.map((f) => ({
        ...f,
        ruleId: f.ruleId ?? options.ruleId,
        severity: f.severity ?? options.severity,
      }));
      settle(() => resolvePromise(normalized));
    });

    worker.once("error", (err) => {
      clearTimeout(timer);
      void worker.terminate();
      settle(() =>
        rejectPromise(
          new Error(`script detector for rule ${options.ruleId} crashed: ${err.message}`),
        ),
      );
    });

    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null && !settled) {
        settle(() =>
          rejectPromise(
            new Error(
              `script detector for rule ${options.ruleId} exited with code ${code}`,
            ),
          ),
        );
      }
    });
  });
}
