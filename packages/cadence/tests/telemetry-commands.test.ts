/**
 * Unit tests for `cadence telemetry show / purge / export`.
 *
 * Uses XDG_CONFIG_HOME redirection to isolate the test's telemetry
 * state from the developer's real config.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runTelemetryExport,
  runTelemetryPurge,
  runTelemetryShow,
} from "../src/commands/telemetry.js";
import { setTelemetryEnabled } from "../src/util/telemetry.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("telemetry commands", () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = makeTempDir("cadence-tel-home-");
    process.env.XDG_CONFIG_HOME = tmpHome;
    // Silence stdout / stderr noise during tests; restored afterEach.
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    removeTempDir(tmpHome);
    vi.restoreAllMocks();
  });

  function seedLog(events: Array<Record<string, unknown>>): string {
    const dir = join(tmpHome, "cadence");
    mkdirSync(dir, { recursive: true });
    const log = join(dir, "telemetry.log");
    for (const e of events) appendFileSync(log, JSON.stringify(e) + "\n", "utf8");
    return log;
  }

  it("show returns the preference + parsed events from the log", () => {
    setTelemetryEnabled(true);
    seedLog([
      { v: 1, ts: "2026-05-14T01:00:00Z", cadenceVersion: "1.0.0", osFamily: "linux", command: "audit" },
      { v: 1, ts: "2026-05-14T01:00:01Z", cadenceVersion: "1.0.0", osFamily: "linux", command: "init" },
    ]);
    const result = runTelemetryShow({ quiet: true });
    expect(result.preference.enabled).toBe(true);
    expect(result.events).toHaveLength(2);
  });

  it("show tolerates malformed log lines silently", () => {
    setTelemetryEnabled(true);
    const log = seedLog([{ v: 1, ts: "x", command: "ok" }]);
    appendFileSync(log, "this is not json\n", "utf8");
    const result = runTelemetryShow({ quiet: true });
    expect(result.events).toHaveLength(1);
  });

  it("purge without --yes is a no-op (with hint)", () => {
    setTelemetryEnabled(true);
    seedLog([{ v: 1, command: "audit" }]);
    const result = runTelemetryPurge({});
    expect(result.removedPreference).toBe(false);
    expect(result.removedLog).toBe(false);
    // Files remain on disk.
    expect(existsSync(join(tmpHome, "cadence", "telemetry.json"))).toBe(true);
    expect(existsSync(join(tmpHome, "cadence", "telemetry.log"))).toBe(true);
  });

  it("purge --yes removes both files", () => {
    setTelemetryEnabled(true);
    seedLog([{ v: 1, command: "audit" }]);
    const result = runTelemetryPurge({ yes: true, quiet: true });
    expect(result.removedPreference).toBe(true);
    expect(result.removedLog).toBe(true);
    expect(existsSync(join(tmpHome, "cadence", "telemetry.json"))).toBe(false);
    expect(existsSync(join(tmpHome, "cadence", "telemetry.log"))).toBe(false);
  });

  it("export writes JSONL by default", () => {
    setTelemetryEnabled(true);
    seedLog([
      { v: 1, ts: "a", command: "audit" },
      { v: 1, ts: "b", command: "init" },
    ]);
    const out = join(tmpHome, "export.jsonl");
    const result = runTelemetryExport({ outPath: out, quiet: true });
    expect(result.written).toBe(2);
    expect(result.format).toBe("jsonl");
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).command).toBe("audit");
  });

  it("export writes CSV with header when format=csv", () => {
    setTelemetryEnabled(true);
    seedLog([
      { v: 1, ts: "2026-01-01T00:00:00Z", cadenceVersion: "1.0.0", osFamily: "linux", command: "audit" },
    ]);
    const out = join(tmpHome, "export.csv");
    runTelemetryExport({ outPath: out, format: "csv", quiet: true });
    const text = readFileSync(out, "utf8");
    expect(text).toContain("v,ts,cadenceVersion,osFamily,command,audit,errorType");
    expect(text).toContain("audit");
  });

  it("export quotes cells containing commas", () => {
    seedLog([{ command: "a,b,c", cadenceVersion: "1.0.0" }]);
    const out = join(tmpHome, "comma.csv");
    runTelemetryExport({ outPath: out, format: "csv", quiet: true });
    const text = readFileSync(out, "utf8");
    expect(text).toContain('"a,b,c"');
  });

  it("show with no log returns empty events without throwing", () => {
    // No log file at all.
    writeFileSync(join(tmpHome, "cadence-marker"), "x", "utf8"); // ensure dir exists for other reason
    const result = runTelemetryShow({ quiet: true });
    expect(result.events).toEqual([]);
  });
});
