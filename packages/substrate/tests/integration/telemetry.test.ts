/**
 * Integration coverage for the v0.8 telemetry opt-in flow.
 *
 * Exercises:
 *   - `substrate config --telemetry on` records enabled=true
 *   - `substrate config --telemetry off` records enabled=false
 *   - `substrate config` (no flag) prints the current preference
 *   - `substrate config --telemetry banana` rejects with exit 2
 *   - After `--telemetry on`, running any command writes one event
 *     line to telemetry.log
 *   - `substrate init` flips the prompted flag so the first-run notice
 *     surfaces exactly once
 *
 * The tests override XDG_CONFIG_HOME so the real ~/.config/substrate is
 * never touched.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

describe("substrate config --telemetry (integration)", () => {
  let tmp: string;
  let xdgDir: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    xdgDir = mkdtempSync(join(tmpdir(), "substrate-telemetry-xdg-"));
  });

  afterEach(() => {
    removeTmpDir(tmp);
    rmSync(xdgDir, { recursive: true, force: true });
  });

  function withXdg(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { ...env, XDG_CONFIG_HOME: xdgDir };
  }

  it("`substrate config --telemetry on` records enabled=true", () => {
    const result = runCli(["config", "--telemetry", "on"], {
      cwd: tmp,
      env: withXdg(),
    });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.output).toMatch(/telemetry enabled/i);

    const prefPath = join(xdgDir, "substrate", "telemetry.json");
    expect(existsSync(prefPath)).toBe(true);
    const pref = JSON.parse(readFileSync(prefPath, "utf8"));
    expect(pref.enabled).toBe(true);
    expect(pref.prompted).toBe(true);
  });

  it("`substrate config --telemetry off` records enabled=false", () => {
    const result = runCli(["config", "--telemetry", "off"], {
      cwd: tmp,
      env: withXdg(),
    });
    expect(result.status).toBe(0);
    const pref = JSON.parse(
      readFileSync(join(xdgDir, "substrate", "telemetry.json"), "utf8"),
    );
    expect(pref.enabled).toBe(false);
  });

  it("`substrate config` (no flag) prints the current preference", () => {
    runCli(["config", "--telemetry", "on"], { cwd: tmp, env: withXdg() });
    const result = runCli(["config"], { cwd: tmp, env: withXdg() });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/enabled/i);
    expect(result.output).toMatch(/pref file/i);
    expect(result.output).toMatch(/log file/i);
  });

  it("`substrate config --telemetry banana` rejects with exit 2", () => {
    const result = runCli(["config", "--telemetry", "banana"], {
      cwd: tmp,
      env: withXdg(),
    });
    expect(result.status).toBe(2);
    expect(result.output).toMatch(/"on" or "off"/i);
  });

  it("after --telemetry on, a subsequent command writes its event to telemetry.log", () => {
    runCli(["config", "--telemetry", "on"], { cwd: tmp, env: withXdg() });
    runCli(["doctor", "--json"], { cwd: tmp, env: withXdg() });
    const logFile = join(xdgDir, "substrate", "telemetry.log");
    expect(existsSync(logFile)).toBe(true);
    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    // The first runCli call (config --telemetry on) flipped telemetry
    // ON and then emitted its own event AFTER the parser completed —
    // so the log has both a `config` event and a `doctor` event.
    const events = lines.map((l) => JSON.parse(l));
    expect(events.some((e) => e.command === "doctor"), `events: ${JSON.stringify(events)}`).toBe(true);
    expect(events[0].substrateVersion).toBeDefined();
    expect(events[0].osFamily).toBeDefined();
  });

  it("after --telemetry off, no events are written even when commands run", () => {
    runCli(["config", "--telemetry", "off"], { cwd: tmp, env: withXdg() });
    runCli(["doctor", "--json"], { cwd: tmp, env: withXdg() });
    runCli(["audit", "--list"], { cwd: tmp, env: withXdg() });
    const logFile = join(xdgDir, "substrate", "telemetry.log");
    expect(existsSync(logFile)).toBe(false);
  });

  it("`substrate init` surfaces the opt-in notice and flips `prompted` exactly once", () => {
    // First run shows the banner.
    const first = runCli(
      ["init", "--name", "tele1", "--short-code", "T1"],
      { cwd: tmp, env: withXdg() },
    );
    expect(first.status).toBe(0);
    expect(first.output).toMatch(/Telemetry.*off by default/i);
    expect(first.output).toMatch(/substrate config --telemetry on/);

    // Preference file now exists with prompted=true, enabled=false.
    const pref = JSON.parse(
      readFileSync(join(xdgDir, "substrate", "telemetry.json"), "utf8"),
    );
    expect(pref.prompted).toBe(true);
    expect(pref.enabled).toBe(false);

    // Second init in a different tmp dir, same XDG: banner is NOT shown.
    const tmp2 = makeTmpDir();
    try {
      const second = runCli(
        ["init", "--name", "tele2", "--short-code", "T2"],
        { cwd: tmp2, env: withXdg() },
      );
      expect(second.status).toBe(0);
      expect(second.output).not.toMatch(/Telemetry.*off by default/i);
    } finally {
      removeTmpDir(tmp2);
    }
  });
});
