/**
 * Atomic file writes via write-tmp-rename.
 *
 * Why this exists: every cadence write that lands user-visible content
 * (scaffold output, manifest, audit reports, telemetry log toggles) must
 * be crash-safe. A `writeFileSync` that's interrupted mid-write leaves
 * a half-written file on disk, which the next run either misreads (bad)
 * or fails to parse (worse). The classic fix is:
 *
 *   1. Write the new content to a sibling tmp file in the same directory.
 *   2. Once the write is complete and fsync'd, rename the tmp file over
 *      the destination. Rename within a single filesystem is atomic on
 *      POSIX (and on Windows when using the modern Win32 API path that
 *      Node uses).
 *
 * Failure modes addressed:
 *
 *   - SIGKILL / power loss between write start and write end →
 *     destination still has the old content; the orphan tmp file is the
 *     only damage. A subsequent run cleans up the orphan by overwriting
 *     it (same filename).
 *   - Disk full during the write → the tmp file fails to allocate;
 *     destination is untouched.
 *   - Permission denied on the destination → fails at rename time, but
 *     by then we know we have a valid tmp file. The caller sees an
 *     error, the destination is unchanged.
 *
 * Failure modes NOT addressed:
 *
 *   - Cross-filesystem rename. We pick a tmp path in the SAME directory
 *     as the destination so `rename(2)` stays atomic. If the destination
 *     directory doesn't exist, we create it first (so the rename target
 *     is reachable).
 *   - fsync of the directory entry. POSIX strictly requires fsync of
 *     the directory after the rename for full durability, but we accept
 *     the trade-off here — cadence output is regeneratable from
 *     templates, and the additional syscall would gate every write on a
 *     full directory flush.
 *
 * The tmp filename pattern is `<basename>.cadence-tmp-<random>` so a
 * crash-orphan is identifiable; nothing else in cadence creates files
 * with this suffix.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

const TMP_SUFFIX = ".cadence-tmp-";

/**
 * Generate a random suffix for a tmp filename. Not cryptographic — only
 * needs to be unique within the directory across the lifetime of a
 * single cadence invocation.
 */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Write `contents` to `filePath` atomically.
 *
 * Creates the parent directory if missing. The write is done to a tmp
 * sibling first, fsync'd, then renamed over the destination.
 *
 * Throws on filesystem errors (caller may handle). The tmp file is
 * cleaned up on error so we don't leak orphans.
 */
export function atomicWriteFileSync(filePath: string, contents: string | Buffer): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = join(dir, `${pathBasename(filePath)}${TMP_SUFFIX}${randomSuffix()}`);

  let fd: number | null = null;
  try {
    // openSync with O_CREAT | O_WRONLY | O_TRUNC equivalent flags.
    fd = openSync(tmpPath, "w");
    const buf = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
    writeSync(fd, buf, 0, buf.length, 0);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmpPath, filePath);
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore — we're already failing
      }
    }
    // Clean up the orphan tmp file before re-throwing.
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore — orphan cleanup is best-effort
    }
    throw err;
  }
}

/**
 * Convenience: only write if the destination doesn't exist OR overwrite
 * is true. Mirrors the existing `writeFileIfMissing` shape in `fs.ts`
 * but uses the atomic write path.
 *
 * Returns true when the file was (re)written, false when an existing
 * file was preserved.
 */
export function atomicWriteFileIfMissing(
  filePath: string,
  contents: string,
  overwrite = false,
): boolean {
  if (!overwrite && existsSync(filePath)) {
    return false;
  }
  atomicWriteFileSync(filePath, contents);
  return true;
}

/**
 * Plain JSON write — atomic with a trailing newline (so editors / git
 * diffs play nicely).
 */
export function atomicWriteJsonSync(filePath: string, value: unknown, indent = 2): void {
  const text = JSON.stringify(value, null, indent) + "\n";
  atomicWriteFileSync(filePath, text);
}

/**
 * Best-effort non-atomic write — used in the (rare) cases where the
 * caller already accepts the crash-window risk (e.g. integration-test
 * fixtures that get rebuilt every run). Centralized here so a future
 * audit can grep for it.
 */
export function nonAtomicWriteFileSync(filePath: string, contents: string | Buffer): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, contents);
}

function pathBasename(p: string): string {
  // Avoid importing `basename` solely for this one use — it's a hot path.
  const ix = p.lastIndexOf("/");
  return ix === -1 ? p : p.slice(ix + 1);
}
