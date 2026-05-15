/**
 * Unit tests for the v0.5 plugin contracts.
 *
 * Surfaces covered:
 *   - TaskAdapter / VcsAdapter interface guards (isTaskAdapter, isVcsAdapter)
 *   - Loader behavior: no-config null, configured-package import, error paths
 *   - Stub adapter end-to-end via importTaskAdapterModule(<absolute path>)
 *   - Built-in git adapter against an actual `git init` tmp repo
 *
 * These tests deliberately do NOT spawn the substrate CLI — that's the
 * integration suite's job. Here we exercise the programmatic API in
 * isolation so contract regressions surface fast.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitAdapter } from "../src/adapters/git.js";
import {
  AdapterLoadError,
  importTaskAdapterModule,
  importVcsAdapterModule,
  loadTaskAdapter,
  loadVcsAdapter,
  readConfiguredTaskAdapter,
  readConfiguredVcsAdapter,
} from "../src/extensions/loader.js";
import { isTaskAdapter } from "../src/extensions/task-adapter.js";
import { isVcsAdapter } from "../src/extensions/vcs-adapter.js";
import { runInit } from "../src/commands/init.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

// Post-monorepo (v0.8): we're at packages/substrate/tests/*, so the stub
// is at ../../../packages/adapter-stub/dist (up to packages/ then sideways).
const STUB_ADAPTER_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "adapter-stub",
  "dist",
  "index.js",
);

/**
 * Helper for running git in tests — uses spawnSync (not exec/execSync)
 * to avoid shell-injection patterns even though all inputs here are
 * test literals. Mirrors the integration harness's pattern.
 */
function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

describe("isTaskAdapter", () => {
  it("accepts the stub adapter shape", async () => {
    const mod = await import(STUB_ADAPTER_PATH);
    expect(isTaskAdapter(mod.default)).toBe(true);
  });

  it("rejects plain objects without required methods", () => {
    expect(isTaskAdapter({ name: "x", version: "0.0.0" })).toBe(false);
    expect(isTaskAdapter({})).toBe(false);
    expect(isTaskAdapter(null)).toBe(false);
    expect(isTaskAdapter("a-string")).toBe(false);
  });

  it("rejects objects with the right methods but wrong types on name/version", () => {
    const bad = {
      name: 123,
      version: "0.0.0",
      findTask: () => {},
      searchTasks: () => {},
      createTask: () => {},
      updateTask: () => {},
      completeTask: () => {},
    };
    expect(isTaskAdapter(bad)).toBe(false);
  });
});

describe("isVcsAdapter", () => {
  it("accepts the built-in git adapter shape", () => {
    expect(isVcsAdapter(gitAdapter)).toBe(true);
  });

  it("rejects bare objects", () => {
    expect(isVcsAdapter({})).toBe(false);
    expect(isVcsAdapter(null)).toBe(false);
    expect(isVcsAdapter({ name: "x" })).toBe(false);
  });
});

describe("readConfiguredTaskAdapter", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns null for an empty cwd (no config)", () => {
    expect(readConfiguredTaskAdapter(tmp)).toBeNull();
  });

  it("returns null when init writes the default config (taskAdapter is null)", () => {
    runInit({ cwd: tmp, projectName: "x", shortCode: "X", quiet: true });
    expect(readConfiguredTaskAdapter(tmp)).toBeNull();
  });

  it("returns the package name when extensions.taskAdapter is set", () => {
    runInit({ cwd: tmp, projectName: "x", shortCode: "X", quiet: true });
    const configPath = join(tmp, "substrate.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.extensions.taskAdapter = "@my-org/cool-adapter";
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    expect(readConfiguredTaskAdapter(tmp)).toBe("@my-org/cool-adapter");
  });
});

describe("readConfiguredVcsAdapter", () => {
  it("returns null when the field is not set (caller falls back to built-in git)", () => {
    const tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "x", shortCode: "X", quiet: true });
    expect(readConfiguredVcsAdapter(tmp)).toBeNull();
    removeTempDir(tmp);
  });
});

describe("loadTaskAdapter", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns null when no adapter is configured", async () => {
    runInit({ cwd: tmp, projectName: "x", shortCode: "X", quiet: true });
    const adapter = await loadTaskAdapter({ cwd: tmp });
    expect(adapter).toBeNull();
  });

  it("throws AdapterLoadError for an unloadable package", async () => {
    runInit({ cwd: tmp, projectName: "x", shortCode: "X", quiet: true });
    const configPath = join(tmp, "substrate.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.extensions.taskAdapter = "@does-not-exist/totally-fake";
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    await expect(loadTaskAdapter({ cwd: tmp })).rejects.toBeInstanceOf(AdapterLoadError);
  });
});

describe("importTaskAdapterModule (stub adapter end-to-end)", () => {
  it("loads the bundled stub adapter and validates the contract", async () => {
    const adapter = await importTaskAdapterModule(STUB_ADAPTER_PATH);
    expect(adapter.name).toBe("@op4z/substrate-adapter-stub");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof adapter.findTask).toBe("function");
  });

  it("findTask returns a synthetic task with the requested id", async () => {
    const adapter = await importTaskAdapterModule(STUB_ADAPTER_PATH);
    const result = await adapter.findTask({ id: "OP-42" });
    expect(result).not.toBeNull();
    expect(result?.id).toBe("OP-42");
    expect(result?.title).toContain("OP-42");
  });

  it("searchTasks respects the limit parameter", async () => {
    const adapter = await importTaskAdapterModule(STUB_ADAPTER_PATH);
    const result = await adapter.searchTasks({ query: "anything", limit: 5 });
    expect(result.length).toBe(5);
  });

  it("createTask round-trips the title and description", async () => {
    const adapter = await importTaskAdapterModule(STUB_ADAPTER_PATH);
    const result = await adapter.createTask({
      title: "Fix the thing",
      description: "Because it is broken",
      priority: "high",
    });
    expect(result.title).toBe("Fix the thing");
    expect(result.description).toBe("Because it is broken");
    expect(result.priority).toBe("high");
    expect(result.id).toMatch(/^STUB-/);
  });

  it("completeTask returns a completed task with actualHours echo", async () => {
    const adapter = await importTaskAdapterModule(STUB_ADAPTER_PATH);
    const result = await adapter.completeTask({ id: "OP-9", actualHours: 2.5 });
    expect(result.id).toBe("OP-9");
    expect(result.status).toBe("completed");
    expect(result.actualHours).toBe(2.5);
  });
});

describe("importVcsAdapterModule (bad package)", () => {
  it("throws AdapterLoadError on an unloadable package", async () => {
    await expect(
      importVcsAdapterModule("@does-not-exist/missing-vcs"),
    ).rejects.toBeInstanceOf(AdapterLoadError);
  });
});

describe("loadVcsAdapter (default fallback)", () => {
  it("falls back to the built-in git adapter when no extensions.vcsAdapter is set", async () => {
    const tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "x", shortCode: "X", quiet: true });
    const adapter = await loadVcsAdapter({ cwd: tmp });
    expect(adapter.name).toMatch(/git/);
    expect(isVcsAdapter(adapter)).toBe(true);
    removeTempDir(tmp);
  });
});

describe("built-in git adapter (against a real git repo)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    // Initialize a minimal git repo with one commit so HEAD is valid.
    git(["init", "--quiet"], tmp);
    git(["config", "user.email", "test@substrate.dev"], tmp);
    git(["config", "user.name", "Substrate Test"], tmp);
    writeFileSync(join(tmp, "README.md"), "# initial\n");
    git(["add", "README.md"], tmp);
    git(["commit", "--quiet", "-m", "initial"], tmp);
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("getBranch returns the HEAD branch name", async () => {
    const branch = await gitAdapter.getBranch(tmp);
    // git init's default branch varies (master vs main); we just assert
    // it's a non-empty string.
    expect(branch).toBeTruthy();
    expect(typeof branch).toBe("string");
  });

  it("getStatus reports clean working tree after the initial commit", async () => {
    const status = await gitAdapter.getStatus(tmp);
    expect(status.branch).toBeTruthy();
    expect(status.dirty).toBe(false);
    expect(status.staged).toBe(false);
  });

  it("getStatus flags dirty after an unstaged change", async () => {
    writeFileSync(join(tmp, "README.md"), "# changed\n");
    const status = await gitAdapter.getStatus(tmp);
    expect(status.dirty).toBe(true);
    expect(status.staged).toBe(false);
  });

  it("getStatus flags staged after `git add`", async () => {
    writeFileSync(join(tmp, "README.md"), "# changed\n");
    git(["add", "README.md"], tmp);
    const status = await gitAdapter.getStatus(tmp);
    expect(status.staged).toBe(true);
  });

  it("getRemote returns null when no remote is configured", async () => {
    const remote = await gitAdapter.getRemote("origin", tmp);
    expect(remote).toBeNull();
  });

  it("getDiff returns an empty string on a clean tree", async () => {
    const diff = await gitAdapter.getDiff({}, tmp);
    expect(diff).toBe("");
  });

  it("getDiff returns non-empty diff after an unstaged edit", async () => {
    writeFileSync(join(tmp, "README.md"), "# changed\n");
    const diff = await gitAdapter.getDiff({}, tmp);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff).toContain("README.md");
  });

  it("commit creates a new SHA on the current branch", async () => {
    writeFileSync(join(tmp, "feature.md"), "# new feature\n");
    const result = await gitAdapter.commit(
      { message: "test commit", paths: ["feature.md"] },
      tmp,
    );
    expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
    expect(result.branch).toBeTruthy();
  });
});
