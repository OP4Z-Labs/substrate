/**
 * Worker harness for script detectors.
 *
 * Runs inside a Node worker thread spawned by `runScriptDetector`. The
 * harness is responsible for:
 *
 *   - Loading the user's script via dynamic `import()` of a file:// URL.
 *   - Resolving the requested export (default, or a named export).
 *   - Invoking the function with a {@link DetectorContext}.
 *   - Posting findings back to the parent thread, or an error envelope.
 *
 * The sandbox is intentionally light: we constrain filesystem reads to
 * the repoRoot but do not block network or arbitrary node:* imports.
 * Rule authors run in a trusted context (their own RULES.yaml).
 *
 * This module is invoked only as a Worker entrypoint — never imported.
 */

import * as fs from "node:fs";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

interface WorkerData {
  scriptUrl: string;
  exportName: string;
  options: Record<string, unknown>;
  repoRoot: string;
  ruleId: string;
  severity: string;
}

interface DetectorContext {
  repoRoot: string;
  ruleId: string;
  severity: string;
  options: Record<string, unknown>;
  /** Filesystem-restricted readFile. Throws EPERM on out-of-tree reads. */
  readFile(relPath: string, encoding?: BufferEncoding): string;
  /** Filesystem-restricted readdir. */
  readdir(relPath: string): string[];
  /** Filesystem-restricted existsSync. */
  exists(relPath: string): boolean;
  /** Helper to construct a finding with rule + severity pre-filled. */
  finding(input: { message: string; path?: string; line?: number; column?: number; snippet?: string }): {
    ruleId: string;
    severity: string;
    message: string;
    path?: string;
    line?: number;
    column?: number;
    snippet?: string;
  };
}

async function main(): Promise<void> {
  const data = workerData as WorkerData;
  if (!parentPort) {
    throw new Error("script-worker must be invoked as a Worker thread");
  }

  const ctx: DetectorContext = buildContext(data);
  let userModule: Record<string, unknown>;
  try {
    userModule = (await import(data.scriptUrl)) as Record<string, unknown>;
  } catch (err) {
    parentPort.postMessage({
      error: `could not load script ${data.scriptUrl}: ${(err as Error).message}`,
    });
    return;
  }

  const exportName = data.exportName || "default";
  const exported = userModule[exportName];
  if (typeof exported !== "function") {
    parentPort.postMessage({
      error: `script export "${exportName}" is not a function (got ${typeof exported})`,
    });
    return;
  }

  let raw: unknown;
  try {
    raw = await (exported as (ctx: DetectorContext) => unknown)(ctx);
  } catch (err) {
    parentPort.postMessage({ error: (err as Error).message });
    return;
  }

  const findings = Array.isArray(raw) ? raw : [];
  parentPort.postMessage({ findings });
}

function buildContext(data: WorkerData): DetectorContext {
  const repoRoot = data.repoRoot;

  function resolveSafely(relPath: string): string {
    const abs = isAbsolute(relPath) ? normalize(relPath) : normalize(resolve(repoRoot, relPath));
    const inside = !relative(repoRoot, abs).startsWith("..");
    if (!inside) {
      const err = new Error(`EPERM: path ${relPath} escapes repoRoot`);
      // Mark the error so callers can detect it without parsing the message.
      (err as NodeJS.ErrnoException).code = "EPERM";
      throw err;
    }
    return abs;
  }

  return {
    repoRoot,
    ruleId: data.ruleId,
    severity: data.severity,
    options: data.options,
    readFile(relPath: string, encoding: BufferEncoding = "utf8"): string {
      const abs = resolveSafely(relPath);
      return fs.readFileSync(abs, encoding);
    },
    readdir(relPath: string): string[] {
      const abs = resolveSafely(relPath);
      return fs.readdirSync(abs);
    },
    exists(relPath: string): boolean {
      try {
        const abs = resolveSafely(relPath);
        return fs.existsSync(abs);
      } catch {
        return false;
      }
    },
    finding(input) {
      return {
        ruleId: data.ruleId,
        severity: data.severity,
        message: input.message,
        path: input.path,
        line: input.line,
        column: input.column,
        snippet: input.snippet,
      };
    },
  };
}

// Use a void-returning IIFE so import-time errors get bubbled out cleanly.
void main().catch((err: unknown) => {
  if (parentPort) {
    parentPort.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Avoid "noUnusedLocals" yelling at us when imports are minimal.
void join;
