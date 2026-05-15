/**
 * Tests for the session-event-log emitter, sanitiser, reader, and index
 * helpers. Component A of the proposal pipeline (Phase B3).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionEventWriter,
  TEXT_FIELD_MAX_CHARS,
  computeManifestHash,
  indexSessionLogs,
  readSessionLog,
  resolveSessionLogPath,
  sanitiseEvent,
  type SessionEvent,
} from "../src/v2/orchestrator/session-log.js";
import type { WorkflowManifest } from "../src/v2/types.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-session-log-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const SAMPLE_MANIFEST: WorkflowManifest = {
  schema_version: "v2.0",
  id: "tackle-task",
  name: "Tackle task",
  steps: [
    { id: "research", type: "prompt", prompt: "research" },
    { id: "implement", type: "prompt", prompt: "implement" },
  ],
};

describe("resolveSessionLogPath", () => {
  it("produces deterministic paths when salt + startedAt are pinned", () => {
    const fixedDate = new Date("2026-05-15T10:00:00Z");
    const a = resolveSessionLogPath("tackle-task", {
      cwd: tmpRoot,
      salt: "abc12345",
      startedAt: fixedDate,
    });
    const b = resolveSessionLogPath("tackle-task", {
      cwd: tmpRoot,
      salt: "abc12345",
      startedAt: fixedDate,
    });
    expect(a.path).toBe(b.path);
    expect(a.shaPrefix).toMatch(/^[0-9a-f]{8}$/);
    expect(a.path).toMatch(/tackle-task-[0-9a-f]{8}\.jsonl$/);
  });

  it("produces different paths for different salts (same workflow + time)", () => {
    const fixedDate = new Date("2026-05-15T10:00:00Z");
    const a = resolveSessionLogPath("tackle-task", {
      cwd: tmpRoot,
      salt: "AAA",
      startedAt: fixedDate,
    });
    const b = resolveSessionLogPath("tackle-task", {
      cwd: tmpRoot,
      salt: "BBB",
      startedAt: fixedDate,
    });
    expect(a.path).not.toBe(b.path);
  });
});

describe("computeManifestHash", () => {
  it("returns a 16-char hex digest", () => {
    const h = computeManifestHash(SAMPLE_MANIFEST);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same manifest", () => {
    expect(computeManifestHash(SAMPLE_MANIFEST)).toBe(
      computeManifestHash(SAMPLE_MANIFEST),
    );
  });

  it("differs when the manifest changes", () => {
    const altered: WorkflowManifest = {
      ...SAMPLE_MANIFEST,
      steps: [...(SAMPLE_MANIFEST.steps ?? []), { id: "tests", type: "prompt", prompt: "tests" }],
    };
    expect(computeManifestHash(altered)).not.toBe(
      computeManifestHash(SAMPLE_MANIFEST),
    );
  });
});

describe("sanitiseEvent", () => {
  it("redacts /home/ paths from description fields", () => {
    const ev: SessionEvent = {
      ts: "2026-05-15T10:00:00Z",
      event: "adhoc-step",
      description:
        "check the migration guide at /home/beaug/dev/public/substrate/docs/migration.md",
      origin: "user-requested",
    };
    const s = sanitiseEvent(ev) as typeof ev;
    expect(s.description).toContain("[redacted:path]");
    expect(s.description).not.toContain("/home/beaug");
  });

  it("redacts /Users/ paths", () => {
    const ev: SessionEvent = {
      ts: "2026-05-15T10:00:00Z",
      event: "prompt-issued",
      step: "research",
      prompt: "see /Users/alice/secrets.txt for the token",
    };
    const s = sanitiseEvent(ev) as typeof ev;
    expect(s.prompt).toContain("[redacted:path]");
  });

  it("redacts Bearer tokens", () => {
    const ev: SessionEvent = {
      ts: "2026-05-15T10:00:00Z",
      event: "prompt-issued",
      step: "x",
      prompt: "the request used Bearer sk-1234567890abcdefABCDEF for auth",
    };
    const s = sanitiseEvent(ev) as typeof ev;
    expect(s.prompt).toContain("[redacted:token]");
  });

  it("redacts emails", () => {
    const ev: SessionEvent = {
      ts: "2026-05-15T10:00:00Z",
      event: "adhoc-step",
      description: "ping beau@beaugoldberg.dev about the schema",
      origin: "user-requested",
    };
    const s = sanitiseEvent(ev) as typeof ev;
    expect(s.description).toContain("[redacted:email]");
  });

  it(`truncates description / prompt / output to ${TEXT_FIELD_MAX_CHARS} chars with an ellipsis`, () => {
    const long = "x".repeat(500);
    const ev: SessionEvent = {
      ts: "2026-05-15T10:00:00Z",
      event: "adhoc-step",
      description: long,
      origin: "user-requested",
    };
    const s = sanitiseEvent(ev) as typeof ev;
    expect(s.description.length).toBeLessThanOrEqual(TEXT_FIELD_MAX_CHARS);
    expect(s.description.endsWith("…")).toBe(true);
  });

  it("leaves non-string fields and short string fields untouched", () => {
    const ev: SessionEvent = {
      ts: "2026-05-15T10:00:00Z",
      event: "workflow-completion",
      exit: "pass",
      duration: 1234,
    };
    const s = sanitiseEvent(ev) as typeof ev;
    expect(s.exit).toBe("pass");
    expect(s.duration).toBe(1234);
  });
});

describe("SessionEventWriter", () => {
  it("appends each emitted event as a JSONL line", () => {
    const paths = resolveSessionLogPath("demo", { cwd: tmpRoot, salt: "test" });
    const writer = new SessionEventWriter({ paths });
    writer.emit({
      ts: "2026-05-15T10:00:00Z",
      event: "workflow-start",
      workflow: "demo",
      "manifest-hash": "abc12345abc12345",
    });
    writer.emit({
      ts: "2026-05-15T10:00:01Z",
      event: "step-start",
      step: "research",
    });
    writer.emit({
      ts: "2026-05-15T10:00:02Z",
      event: "step-completion",
      step: "research",
    });
    writer.emit({
      ts: "2026-05-15T10:00:03Z",
      event: "workflow-completion",
      exit: "pass",
      duration: 3000,
    });

    expect(existsSync(paths.path)).toBe(true);
    const raw = readFileSync(paths.path, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(4);
    const first = JSON.parse(lines[0]);
    expect(first.event).toBe("workflow-start");
    expect(first.workflow).toBe("demo");
  });

  it("sanitises every event written to disk", () => {
    const paths = resolveSessionLogPath("demo", { cwd: tmpRoot, salt: "test" });
    const writer = new SessionEventWriter({ paths });
    writer.emit({
      ts: "2026-05-15T10:00:00Z",
      event: "adhoc-step",
      description: "/home/beaug/dev/foo — Bearer secrettokendata1234567",
      origin: "user-requested",
    });
    const raw = readFileSync(paths.path, "utf8");
    expect(raw).toContain("[redacted:path]");
    expect(raw).toContain("[redacted:token]");
    expect(raw).not.toContain("/home/beaug");
  });

  it("inMemoryOnly mode does not write to disk", () => {
    const paths = resolveSessionLogPath("demo", { cwd: tmpRoot, salt: "test" });
    const writer = new SessionEventWriter({ paths, inMemoryOnly: true });
    writer.emit({
      ts: "2026-05-15T10:00:00Z",
      event: "workflow-start",
      workflow: "demo",
      "manifest-hash": "abc",
    });
    expect(existsSync(paths.path)).toBe(false);
    expect(writer.events).toHaveLength(1);
  });

  it("swallows write errors silently (telemetry is advisory)", () => {
    // Point the log inside a non-existent + unwritable parent. The
    // writer should not throw.
    const paths = {
      path: join("/this/path/does/not/exist", "demo.jsonl"),
      shaPrefix: "deadbeef",
      sessionsDir: "/this/path/does/not/exist",
    };
    const writer = new SessionEventWriter({ paths });
    expect(() =>
      writer.emit({
        ts: "2026-05-15T10:00:00Z",
        event: "workflow-start",
        workflow: "x",
        "manifest-hash": "y",
      }),
    ).not.toThrow();
  });
});

describe("readSessionLog", () => {
  it("returns events when the file is well-formed", () => {
    const paths = resolveSessionLogPath("demo", { cwd: tmpRoot, salt: "t" });
    const writer = new SessionEventWriter({ paths });
    writer.emit({
      ts: "2026-05-15T10:00:00Z",
      event: "workflow-start",
      workflow: "demo",
      "manifest-hash": "abc",
    });
    const result = readSessionLog(paths.path);
    expect(result.warnings).toHaveLength(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event).toBe("workflow-start");
  });

  it("warns about malformed lines without aborting", () => {
    const paths = resolveSessionLogPath("demo", { cwd: tmpRoot, salt: "t" });
    mkdirSync(paths.sessionsDir, { recursive: true });
    writeFileSync(
      paths.path,
      '{"ts":"2026-05-15T10:00:00Z","event":"workflow-start","workflow":"demo","manifest-hash":"x"}\n' +
        "not json\n" +
        '{"missing":"event-field"}\n',
      "utf8",
    );
    const result = readSessionLog(paths.path);
    expect(result.events).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("warns when the file is missing", () => {
    const result = readSessionLog(join(tmpRoot, "nope.jsonl"));
    expect(result.events).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/not found/);
  });
});

describe("indexSessionLogs", () => {
  it("returns entries sorted by mtime asc", () => {
    const sessionsDir = join(tmpRoot, "substrate", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "demo-aaaaaaaa.jsonl"), "", "utf8");
    writeFileSync(join(sessionsDir, "demo-bbbbbbbb.jsonl"), "", "utf8");
    const entries = indexSessionLogs({ cwd: tmpRoot, workflowId: "demo" });
    expect(entries.map((e) => e.workflowId)).toEqual(["demo", "demo"]);
    expect(entries[0].mtimeMs).toBeLessThanOrEqual(entries[1].mtimeMs);
  });

  it("filters by workflowId when requested", () => {
    const sessionsDir = join(tmpRoot, "substrate", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "demo-aaaaaaaa.jsonl"), "", "utf8");
    writeFileSync(join(sessionsDir, "other-bbbbbbbb.jsonl"), "", "utf8");
    const entries = indexSessionLogs({ cwd: tmpRoot, workflowId: "demo" });
    expect(entries).toHaveLength(1);
    expect(entries[0].workflowId).toBe("demo");
  });

  it("returns empty array when sessions/ is absent", () => {
    expect(indexSessionLogs({ cwd: tmpRoot })).toEqual([]);
  });

  it("ignores files that don't match the <workflow>-<8hex>.jsonl shape", () => {
    const sessionsDir = join(tmpRoot, "substrate", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "demo-aaaaaaaa.jsonl"), "", "utf8");
    writeFileSync(join(sessionsDir, "README.md"), "", "utf8");
    writeFileSync(join(sessionsDir, "no-sha.jsonl"), "", "utf8");
    const entries = indexSessionLogs({ cwd: tmpRoot });
    expect(entries.map((e) => e.workflowId)).toEqual(["demo"]);
  });
});
