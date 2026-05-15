/**
 * Unit tests for the opt-in telemetry layer.
 *
 * v0.8: preference + local log file only. No real network calls. The
 * tests override XDG_CONFIG_HOME so each test gets a fresh tmp config
 * directory; the real ~/.config/substrate is never touched.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitTelemetryEvent,
  logPath,
  preferencePath,
  readPreference,
  recordPromptResponse,
  setTelemetryEnabled,
  shouldPromptForOptIn,
} from "../src/util/telemetry.js";

describe("telemetry preference + emission", () => {
  let tmp: string;
  let origXdg: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "substrate-telemetry-"));
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmp;
  });

  afterEach(() => {
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("readPreference returns prompted=false / enabled=null on a fresh install", () => {
    const pref = readPreference();
    expect(pref.prompted).toBe(false);
    expect(pref.enabled).toBeNull();
  });

  it("shouldPromptForOptIn is true until a preference is recorded", () => {
    expect(shouldPromptForOptIn()).toBe(true);
    recordPromptResponse(false);
    expect(shouldPromptForOptIn()).toBe(false);
  });

  it("setTelemetryEnabled persists the choice to ~/.config/substrate/telemetry.json", () => {
    setTelemetryEnabled(true);
    const path = preferencePath();
    expect(existsSync(path)).toBe(true);
    const pref = JSON.parse(readFileSync(path, "utf8"));
    expect(pref.enabled).toBe(true);
    expect(pref.prompted).toBe(true);
    expect(pref.substrateVersion).toBeDefined();
  });

  it("emitTelemetryEvent is a no-op when telemetry is disabled", () => {
    setTelemetryEnabled(false);
    emitTelemetryEvent("audit", { audit: "backend" });
    expect(existsSync(logPath())).toBe(false);
  });

  it("emitTelemetryEvent writes a line to telemetry.log when enabled", () => {
    setTelemetryEnabled(true);
    emitTelemetryEvent("audit", { audit: "backend" });
    expect(existsSync(logPath())).toBe(true);
    const content = readFileSync(logPath(), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]);
    expect(event.v).toBe(2);
    expect(event.command).toBe("audit");
    expect(event.audit).toBe("backend");
    expect(event.substrateVersion).toBeDefined();
    expect(event.osFamily).toBeDefined();
    expect(event.ts).toBeDefined();
  });

  it("emitTelemetryEvent appends, doesn't overwrite", () => {
    setTelemetryEnabled(true);
    emitTelemetryEvent("audit", { audit: "backend" });
    emitTelemetryEvent("doctor");
    emitTelemetryEvent("upgrade", { errorType: "AdapterLoadError" });
    const lines = readFileSync(logPath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).command).toBe("audit");
    expect(JSON.parse(lines[1]).command).toBe("doctor");
    expect(JSON.parse(lines[2]).command).toBe("upgrade");
    expect(JSON.parse(lines[2]).errorType).toBe("AdapterLoadError");
  });

  it("emitted events never include forbidden fields (paths, identifiers, message bodies)", () => {
    setTelemetryEnabled(true);
    emitTelemetryEvent("audit", { audit: "backend", errorType: "Error" });
    const event = JSON.parse(readFileSync(logPath(), "utf8").trim().split("\n")[0]);
    const allowedKeys = ["v", "ts", "substrateVersion", "osFamily", "command", "audit", "errorType"];
    for (const key of Object.keys(event)) {
      expect(
        allowedKeys.includes(key),
        `unexpected telemetry key: ${key}`,
      ).toBe(true);
    }
    // Spot-check the values don't leak the kind of thing they shouldn't.
    expect(typeof event.command).toBe("string");
    expect(event.command.length).toBeLessThan(30);
    if (event.audit) expect(event.audit.length).toBeLessThan(30);
  });

  it("recordPromptResponse(true) opts in and stamps prompted=true", () => {
    const pref = recordPromptResponse(true);
    expect(pref.prompted).toBe(true);
    expect(pref.enabled).toBe(true);
    // Re-reading from disk returns the same shape.
    const reread = readPreference();
    expect(reread).toEqual(pref);
  });

  it("a corrupt preference file is treated as never-prompted", () => {
    // Simulate corruption by writing garbage.
    const path = preferencePath();
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(path, "this is not json", "utf8");
    const pref = readPreference();
    expect(pref.prompted).toBe(false);
    expect(pref.enabled).toBeNull();
  });
});
