/**
 * Tests for `substrate query sessions` (Phase B4 — CLI wrapper around
 * B3's `indexSessionLogs` + `readSessionLog` primitives).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQuerySessions } from "../src/v2/deterministic/query-command.js";
import { runInit } from "../src/commands/init.js";

let tmpRoot: string;
let previousCwd: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-query-sessions-"));
  previousCwd = process.cwd();
  process.chdir(tmpRoot);
  runInit({ projectName: "sessions-test", shortCode: "ST", quiet: true });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  logSpy.mockRestore();
  stdoutSpy.mockRestore();
  process.chdir(previousCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  process.exitCode = 0;
});

function writeSessionLog(filename: string, events: Array<Record<string, unknown>>): void {
  const dir = join(tmpRoot, "substrate", "sessions");
  mkdirSync(dir, { recursive: true });
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(dir, filename), body, "utf8");
}

describe("substrate query sessions", () => {
  it("returns an empty index when no sessions directory exists", () => {
    const result = runQuerySessions({ quiet: true });
    expect(result.entries).toHaveLength(0);
  });

  it("indexes session logs newest first", async () => {
    writeSessionLog("alpha-aaaaaaaa.jsonl", [
      { ts: "2026-05-10T00:00:00Z", event: "workflow-start", workflow: "alpha", "manifest-hash": "h1" },
    ]);
    // Force a measurable mtime delta — the index is sorted by mtime.
    await new Promise((r) => setTimeout(r, 20));
    writeSessionLog("beta-bbbbbbbb.jsonl", [
      { ts: "2026-05-11T00:00:00Z", event: "workflow-start", workflow: "beta", "manifest-hash": "h2" },
      { ts: "2026-05-11T00:00:10Z", event: "workflow-completion", exit: "pass", duration: 10 },
    ]);
    const result = runQuerySessions({ quiet: true });
    expect(result.entries).toHaveLength(2);
    // beta is more recent — should be first.
    expect(result.entries[0]?.workflowId).toBe("beta");
    expect(result.entries[0]?.eventCount).toBe(2);
    expect(result.entries[1]?.workflowId).toBe("alpha");
    expect(result.entries[1]?.eventCount).toBe(1);
  });

  it("filters by workflow id", () => {
    writeSessionLog("alpha-aaaaaaaa.jsonl", [
      { ts: "2026-05-10T00:00:00Z", event: "workflow-start", workflow: "alpha", "manifest-hash": "h1" },
    ]);
    writeSessionLog("beta-bbbbbbbb.jsonl", [
      { ts: "2026-05-11T00:00:00Z", event: "workflow-start", workflow: "beta", "manifest-hash": "h2" },
    ]);
    const result = runQuerySessions({ workflowId: "alpha", quiet: true });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.workflowId).toBe("alpha");
  });

  it("respects the --limit option", async () => {
    writeSessionLog("alpha-11111111.jsonl", [
      { ts: "2026-05-10T00:00:00Z", event: "workflow-start", workflow: "alpha", "manifest-hash": "h1" },
    ]);
    await new Promise((r) => setTimeout(r, 5));
    writeSessionLog("alpha-22222222.jsonl", [
      { ts: "2026-05-11T00:00:00Z", event: "workflow-start", workflow: "alpha", "manifest-hash": "h2" },
    ]);
    await new Promise((r) => setTimeout(r, 5));
    writeSessionLog("alpha-33333333.jsonl", [
      { ts: "2026-05-12T00:00:00Z", event: "workflow-start", workflow: "alpha", "manifest-hash": "h3" },
    ]);
    const result = runQuerySessions({ limit: 2, quiet: true });
    expect(result.entries).toHaveLength(2);
    // Newest-first sort means we expect 33333333 then 22222222.
    expect(result.entries[0]?.path).toMatch(/33333333\.jsonl$/);
    expect(result.entries[1]?.path).toMatch(/22222222\.jsonl$/);
  });

  it("returns events inline when --include-events is set", () => {
    writeSessionLog("alpha-aaaaaaaa.jsonl", [
      { ts: "2026-05-10T00:00:00Z", event: "workflow-start", workflow: "alpha", "manifest-hash": "h1" },
      { ts: "2026-05-10T00:00:10Z", event: "workflow-completion", exit: "pass", duration: 10 },
    ]);
    const result = runQuerySessions({ includeEvents: true, quiet: true });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.events).toBeDefined();
    expect(result.entries[0]?.events).toHaveLength(2);
    expect(result.entries[0]?.events?.[0]?.event).toBe("workflow-start");
  });

  it("--json emits a serialisable result object", () => {
    writeSessionLog("alpha-aaaaaaaa.jsonl", [
      { ts: "2026-05-10T00:00:00Z", event: "workflow-start", workflow: "alpha", "manifest-hash": "h1" },
    ]);
    runQuerySessions({ json: true });
    // The stdout spy captured the JSON write — verify it parses + carries entries.
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(written);
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries[0]?.workflowId).toBe("alpha");
    expect(parsed.entries[0]?.eventCount).toBe(1);
  });
});
