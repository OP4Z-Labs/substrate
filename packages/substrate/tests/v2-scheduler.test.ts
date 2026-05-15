/**
 * Tests for the `trigger: schedule` runtime (Phase B3, Primitive 8).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import {
  bumpCommitCounter,
  checkSchedule,
  clearSchedulerState,
  isScheduled,
  loadSchedulerState,
  recordWorkflowRun,
  saveSchedulerState,
} from "../src/v2/deterministic/scheduler.js";
import type { WorkflowManifest } from "../src/v2/types.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-scheduler-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seedManifest(filename: string, body: string): void {
  const dir = join(tmpRoot, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), body, "utf8");
}

describe("isScheduled", () => {
  it("returns true when manifest declares trigger.schedule", () => {
    const manifest: WorkflowManifest = {
      schema_version: "v2.0",
      id: "x",
      name: "x",
      trigger: [{ schedule: { cron: "0 9 * * MON" } }],
    };
    expect(isScheduled(manifest)).toBe(true);
  });

  it("returns false for plain manifests", () => {
    const manifest: WorkflowManifest = {
      schema_version: "v2.0",
      id: "x",
      name: "x",
    };
    expect(isScheduled(manifest)).toBe(false);
  });
});

describe("loadSchedulerState / saveSchedulerState", () => {
  it("returns canonical empty shape when the file is missing", () => {
    const state = loadSchedulerState(tmpRoot);
    expect(state).toEqual({ version: 1, workflows: {} });
  });

  it("persists state across load/save", () => {
    saveSchedulerState(
      { version: 1, workflows: { foo: { lastRunAt: "2026-05-15T00:00:00.000Z" } } },
      tmpRoot,
    );
    const reloaded = loadSchedulerState(tmpRoot);
    expect(reloaded.workflows.foo?.lastRunAt).toBe("2026-05-15T00:00:00.000Z");
  });

  it("returns empty when state file is malformed", () => {
    const stateDir = join(tmpRoot, "substrate", "scheduler");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "state.json"), "not json", "utf8");
    expect(loadSchedulerState(tmpRoot)).toEqual({ version: 1, workflows: {} });
  });
});

describe("recordWorkflowRun", () => {
  it("stamps lastRunAt and resets commits", () => {
    const fixedDate = new Date("2026-05-15T09:00:00Z");
    recordWorkflowRun("weekly-proposal-walk", { cwd: tmpRoot, now: fixedDate });
    const state = loadSchedulerState(tmpRoot);
    expect(state.workflows["weekly-proposal-walk"]?.lastRunAt).toBe(
      "2026-05-15T09:00:00.000Z",
    );
    expect(state.workflows["weekly-proposal-walk"]?.commitsSinceLastRun).toBe(0);
  });
});

describe("checkSchedule — cron", () => {
  it("flags a never-run cron workflow as awaiting first tick when the minute doesn't match", () => {
    seedManifest(
      "weekly.yaml",
      `schema_version: v2.0
id: weekly
name: Weekly
trigger:
  - schedule: { cron: "0 9 * * MON" }
`,
    );
    const result = checkSchedule({
      cwd: tmpRoot,
      now: new Date("2026-05-15T14:00:00Z"), // Friday 14:00
    });
    expect(result.due).toHaveLength(0);
    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0].dueIn).toBe("awaiting first tick");
  });

  it("flags a workflow as overdue when a cron tick has elapsed since last run", () => {
    seedManifest(
      "weekly.yaml",
      `schema_version: v2.0
id: weekly
name: Weekly
trigger:
  - schedule: { cron: "0 9 * * MON" }
`,
    );
    // Record last run as 2 weeks ago — at least one Monday 09:00 tick has elapsed.
    saveSchedulerState(
      {
        version: 1,
        workflows: {
          weekly: { lastRunAt: "2026-05-01T09:00:00.000Z" },
        },
      },
      tmpRoot,
    );
    const result = checkSchedule({
      cwd: tmpRoot,
      now: new Date("2026-05-12T09:00:00Z"), // Monday 09:00
    });
    expect(result.due.map((d) => d.workflowId)).toEqual(["weekly"]);
  });

  it("warns + treats unparseable cron as always due", () => {
    seedManifest(
      "broken.yaml",
      `schema_version: v2.0
id: broken
name: Broken
trigger:
  - schedule: { cron: "not a cron" }
`,
    );
    const result = checkSchedule({ cwd: tmpRoot });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.due[0]?.workflowId).toBe("broken");
  });
});

describe("checkSchedule — interval", () => {
  it("marks a workflow as due when elapsed >= interval", () => {
    seedManifest(
      "daily.yaml",
      `schema_version: v2.0
id: daily
name: Daily
trigger:
  - schedule: { interval: "24h" }
`,
    );
    saveSchedulerState(
      {
        version: 1,
        workflows: { daily: { lastRunAt: "2026-05-14T00:00:00.000Z" } },
      },
      tmpRoot,
    );
    const result = checkSchedule({
      cwd: tmpRoot,
      now: new Date("2026-05-15T01:00:00Z"),
    });
    expect(result.due.map((d) => d.workflowId)).toEqual(["daily"]);
  });

  it("reports remaining time when not due", () => {
    seedManifest(
      "daily.yaml",
      `schema_version: v2.0
id: daily
name: Daily
trigger:
  - schedule: { interval: "24h" }
`,
    );
    saveSchedulerState(
      {
        version: 1,
        workflows: { daily: { lastRunAt: "2026-05-15T00:00:00.000Z" } },
      },
      tmpRoot,
    );
    const result = checkSchedule({
      cwd: tmpRoot,
      now: new Date("2026-05-15T06:00:00Z"),
    });
    expect(result.due).toHaveLength(0);
    expect(result.scheduled[0].dueIn).toMatch(/due in/);
  });
});

describe("checkSchedule — every-n-commits", () => {
  it("marks due when commit counter >= threshold", () => {
    seedManifest(
      "burst.yaml",
      `schema_version: v2.0
id: burst
name: Burst
trigger:
  - schedule: { every-n-commits: 5 }
`,
    );
    saveSchedulerState(
      {
        version: 1,
        workflows: { burst: { commitsSinceLastRun: 5 } },
      },
      tmpRoot,
    );
    const result = checkSchedule({ cwd: tmpRoot });
    expect(result.due.map((d) => d.workflowId)).toEqual(["burst"]);
  });

  it("counts remaining commits when below threshold", () => {
    seedManifest(
      "burst.yaml",
      `schema_version: v2.0
id: burst
name: Burst
trigger:
  - schedule: { every-n-commits: 5 }
`,
    );
    saveSchedulerState(
      {
        version: 1,
        workflows: { burst: { commitsSinceLastRun: 2 } },
      },
      tmpRoot,
    );
    const result = checkSchedule({ cwd: tmpRoot });
    expect(result.due).toHaveLength(0);
    expect(result.scheduled[0].dueIn).toMatch(/3 commits remaining/);
  });
});

describe("bumpCommitCounter", () => {
  it("increments the counter on every tracked workflow", () => {
    saveSchedulerState(
      {
        version: 1,
        workflows: {
          a: { commitsSinceLastRun: 2 },
          b: { commitsSinceLastRun: 0 },
        },
      },
      tmpRoot,
    );
    bumpCommitCounter(tmpRoot);
    const state = loadSchedulerState(tmpRoot);
    expect(state.workflows.a.commitsSinceLastRun).toBe(3);
    expect(state.workflows.b.commitsSinceLastRun).toBe(1);
  });
});

describe("clearSchedulerState", () => {
  it("zeroes the state file when present", () => {
    saveSchedulerState(
      { version: 1, workflows: { x: { lastRunAt: "2020-01-01T00:00:00.000Z" } } },
      tmpRoot,
    );
    clearSchedulerState(tmpRoot);
    const state = loadSchedulerState(tmpRoot);
    expect(state.workflows).toEqual({});
  });

  it("no-ops when state directory absent", () => {
    expect(() => clearSchedulerState(tmpRoot)).not.toThrow();
  });
});

describe("file layout", () => {
  it("writes state.json under substrate/scheduler/", () => {
    saveSchedulerState({ version: 1, workflows: { x: {} } }, tmpRoot);
    expect(existsSync(join(tmpRoot, "substrate", "scheduler", "state.json"))).toBe(
      true,
    );
    const raw = readFileSync(
      join(tmpRoot, "substrate", "scheduler", "state.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
  });
});
