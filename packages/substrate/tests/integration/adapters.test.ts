/**
 * Integration coverage for the v0.5 plugin contract surfaces.
 *
 * Exercises the spawned CLI binary so the user-visible `substrate task`
 * surface (and the adapter load error path) are pinned. The
 * programmatic test suite in tests/adapters.test.ts covers the
 * library-level contracts; this file rounds out the CLI side.
 *
 * The stub adapter is wired in by patching substrate.config.json to point
 * at its absolute path on disk — same pattern a real adapter would use
 * if it were installed via `npm link` or `file:`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Post-monorepo (v0.8): HERE = packages/substrate/tests/integration, so the
// stub adapter is up four levels (../../.. → monorepo root → packages/...).
const STUB_ADAPTER_PATH = resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "adapter-stub",
  "dist",
  "index.js",
);

function setStubAdapter(tmp: string): void {
  const configPath = join(tmp, "substrate.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (!config.extensions) config.extensions = {};
  config.extensions.taskAdapter = STUB_ADAPTER_PATH;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

describe("substrate task (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    const init = runCli(
      ["init", "--name", "task-int", "--short-code", "TI", "--quiet"],
      { cwd: tmp },
    );
    if (init.status !== 0) {
      throw new Error(`init failed: ${init.stderr}`);
    }
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("task find with no adapter configured exits non-zero with install hint", () => {
    const result = runCli(["task", "find", "OP-1"], { cwd: tmp });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/no task adapter configured/i);
    expect(result.output).toMatch(/extensions\.taskAdapter/);
  });

  it("task find with stub adapter returns a synthetic task", () => {
    setStubAdapter(tmp);
    const result = runCli(["task", "find", "OP-77", "--json"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // Adapter chatter goes to stderr; JSON payload goes to stdout.
    expect(result.stderr).toMatch(/\[stub-adapter\] would call findTask/);
    const payload = JSON.parse(result.stdout);
    expect(payload.id).toBe("OP-77");
    expect(payload.title).toContain("OP-77");
  });

  it("task search returns N synthetic results matching --limit", () => {
    setStubAdapter(tmp);
    const result = runCli(
      ["task", "search", "needle", "--limit", "4", "--json"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBe(4);
  });

  it("task create round-trips title/description/priority through the adapter", () => {
    setStubAdapter(tmp);
    const result = runCli(
      [
        "task",
        "create",
        "--title",
        "Fix broken thing",
        "--description",
        "Reproducible bug in module X.",
        "--priority",
        "high",
        "--hours",
        "3",
        "--json",
      ],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stderr).toMatch(/createTask/);
    const payload = JSON.parse(result.stdout);
    expect(payload.title).toBe("Fix broken thing");
    expect(payload.description).toBe("Reproducible bug in module X.");
    expect(payload.priority).toBe("high");
    expect(payload.estimatedHours).toBe(3);
  });

  it("task complete records actualHours through the adapter", () => {
    setStubAdapter(tmp);
    const result = runCli(
      ["task", "complete", "TI-9", "--actual-hours", "1.5", "--json"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stderr).toMatch(/completeTask/);
    const payload = JSON.parse(result.stdout);
    expect(payload.id).toBe("TI-9");
    expect(payload.actualHours).toBe(1.5);
    expect(payload.status).toBe("completed");
  });

  it("task update changes status through the adapter", () => {
    setStubAdapter(tmp);
    const result = runCli(
      ["task", "update", "TI-3", "--status", "in_progress", "--json"],
      { cwd: tmp },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stderr).toMatch(/updateTask/);
    const payload = JSON.parse(result.stdout);
    expect(payload.id).toBe("TI-3");
    expect(payload.status).toBe("in_progress");
  });

  it("task create without --description fails with commander's required-option error", () => {
    setStubAdapter(tmp);
    const result = runCli(
      ["task", "create", "--title", "no desc"],
      { cwd: tmp },
    );
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/required.*description|--description/i);
  });
});
