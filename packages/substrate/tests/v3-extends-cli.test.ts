/**
 * Sub-phase D — CLI surface tests.
 *
 * Coverage targets per the brief:
 *  - `substrate extends list` (text + JSON shape)
 *  - `substrate extends sync` (npm/file skipped, github refreshed via
 *    the injected runner)
 *  - `substrate extends clear-cache` (no-op vs hit)
 *
 * We call the run* functions directly (not the CLI binary), per the
 * existing v2 test pattern. JSON output is captured by replacing
 * `process.stdout.write` for the duration of the call.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runExtendsClearCache,
  runExtendsList,
  runExtendsSync,
} from "../src/v2/deterministic/extends-command.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function writeConfig(repoRoot: string, extendsArr: Array<{ source: string; ref?: string; version?: string }> = []): void {
  const config = {
    $schema: "https://op4z.dev/substrate/schemas/config.schema.json",
    version: "v3.0",
    project: { name: "test" },
    stacks: ["typescript"],
    paths: { auto: "auto" },
    defaults: { audits: [], standards: [], scaffolds: [], workflows: [] },
    bridges: {},
    telemetry: { enabled: false },
    extends: extendsArr,
  };
  writeFileSync(join(repoRoot, "substrate.config.json"), JSON.stringify(config, null, 2));
}

function writeWorkflow(layerRoot: string, id: string): void {
  const dir = join(layerRoot, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.yaml`),
    `schema_version: v2.0\nid: ${id}\nname: ${id}\n`,
  );
}

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

describe("runExtendsList — text output", () => {
  let consumer: string;
  let org: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
    org = makeTempDir("substrate-org-");
  });
  afterEach(() => {
    removeTempDir(consumer);
    removeTempDir(org);
  });

  it("prints the chain with per-layer counts", () => {
    writeWorkflow(org, "org-w");
    writeWorkflow(org, "common");
    writeWorkflow(consumer, "repo-w");
    writeWorkflow(consumer, "common");
    writeConfig(consumer, [{ source: `file:${org}` }]);

    const out = captureStdout(() => runExtendsList({ cwd: consumer }));
    expect(out).toMatch(/Resolved extends sources/);
    expect(out).toMatch(/repo-local/);
    expect(out).toMatch(new RegExp(`file:${org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect(out).toMatch(/Effective registry: 3 workflows/);
    expect(out).toMatch(/Conflicts/);
    expect(out).toMatch(/common/);
  });

  it("works with no extends configured (just repo-local layer)", () => {
    writeWorkflow(consumer, "w1");
    const out = captureStdout(() => runExtendsList({ cwd: consumer }));
    expect(out).toMatch(/repo-local/);
    expect(out).toMatch(/Effective registry: 1 workflows/);
    expect(out).not.toMatch(/Conflicts/);
  });
});

describe("runExtendsList --json — machine-readable output", () => {
  let consumer: string;
  let org: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
    org = makeTempDir("substrate-org-");
  });
  afterEach(() => {
    removeTempDir(consumer);
    removeTempDir(org);
  });

  it("emits the documented JSON shape", () => {
    writeWorkflow(org, "audit-pre-merge");
    writeWorkflow(consumer, "repo-only");
    writeConfig(consumer, [{ source: `file:${org}` }]);

    let result: ReturnType<typeof runExtendsList> | undefined;
    const out = captureStdout(() => {
      result = runExtendsList({ cwd: consumer, json: true });
    });
    expect(result).toBeDefined();
    const parsed = JSON.parse(out);
    // Shape gates
    expect(Array.isArray(parsed.layers)).toBe(true);
    expect(parsed.layers.length).toBe(2);
    expect(parsed.layers[0].source).toBe(`file:${org}`);
    expect(parsed.layers[0].kind).toBe("file");
    expect(parsed.layers[1].source).toBe("repo-local");
    expect(parsed.effective).toBeDefined();
    expect(typeof parsed.effective.workflows).toBe("number");
    expect(Array.isArray(parsed.collisions)).toBe(true);
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(Array.isArray(parsed.warnings)).toBe(true);
    expect(typeof parsed.exitCode).toBe("number");
  });

  it("layer counts are correct for non-colliding entries", () => {
    writeWorkflow(org, "from-org");
    writeWorkflow(consumer, "from-repo");
    writeConfig(consumer, [{ source: `file:${org}` }]);

    let result: ReturnType<typeof runExtendsList> | undefined;
    const out = captureStdout(() => {
      result = runExtendsList({ cwd: consumer, json: true });
    });
    const parsed = JSON.parse(out);
    expect(parsed.layers[0].counts.workflows).toBe(1);
    expect(parsed.layers[1].counts.workflows).toBe(1);
    expect(parsed.effective.workflows).toBe(2);
    expect(result?.exitCode).toBe(0);
  });

  it("returns exit code 1 when extends source resolution errored", () => {
    writeConfig(consumer, [{ source: "file:/nonexistent/path/here" }]);
    let result: ReturnType<typeof runExtendsList> | undefined;
    captureStdout(() => {
      result = runExtendsList({ cwd: consumer, json: true });
    });
    expect(result?.exitCode).toBe(1);
    expect(result?.errors.length).toBe(1);
  });
});

describe("runExtendsSync", () => {
  let consumer: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
  });
  afterEach(() => {
    removeTempDir(consumer);
  });

  it("no-op when no extends configured", () => {
    const out = captureStdout(() => runExtendsSync({ cwd: consumer }));
    expect(out).toMatch(/No extends sources/);
  });

  it("skips npm: + file: sources with documented reasons (json)", () => {
    const local = makeTempDir("substrate-shared-");
    try {
      writeConfig(consumer, [
        { source: "npm:@acme/shared" },
        { source: `file:${local}` },
      ]);
      let result: ReturnType<typeof runExtendsSync> | undefined;
      const out = captureStdout(() => {
        result = runExtendsSync({ cwd: consumer, json: true });
      });
      const parsed = JSON.parse(out);
      expect(parsed.refreshed).toEqual([]);
      expect(parsed.skipped.length).toBe(2);
      expect(parsed.skipped[0].source).toBe("npm:@acme/shared");
      expect(parsed.skipped[0].reason).toMatch(/npm install/);
      expect(parsed.skipped[1].source).toBe(`file:${local}`);
      expect(parsed.skipped[1].reason).toMatch(/live from disk/);
      expect(result?.exitCode).toBe(0);
    } finally {
      removeTempDir(local);
    }
  });

  it("filters by --source", () => {
    const local = makeTempDir("substrate-shared-");
    try {
      writeConfig(consumer, [
        { source: "npm:@acme/shared" },
        { source: `file:${local}` },
      ]);
      const out = captureStdout(() => {
        runExtendsSync({
          cwd: consumer,
          source: "npm:@acme/shared",
          json: true,
        });
      });
      const parsed = JSON.parse(out);
      // Both sources show up in skipped; one filtered, one because it's npm.
      const reasons = new Map(parsed.skipped.map((s: { source: string; reason: string }) => [s.source, s.reason]));
      expect(reasons.get("npm:@acme/shared")).toMatch(/npm install/);
      expect(reasons.get(`file:${local}`)).toMatch(/filtered out/);
    } finally {
      removeTempDir(local);
    }
  });
});

describe("runExtendsClearCache", () => {
  let consumer: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
  });
  afterEach(() => {
    removeTempDir(consumer);
  });

  it("no-op when cache dir doesn't exist (exit 0)", () => {
    let result: ReturnType<typeof runExtendsClearCache> | undefined;
    const out = captureStdout(() => {
      result = runExtendsClearCache({ cwd: consumer });
    });
    expect(result?.removed).toBe(false);
    expect(result?.exitCode).toBe(0);
    expect(out).toMatch(/nothing to remove/);
  });

  it("wipes the cache dir when it exists", () => {
    const cacheDir = join(consumer, "substrate", ".cache", "extends");
    mkdirSync(join(cacheDir, "github"), { recursive: true });
    writeFileSync(join(cacheDir, "manifest.json"), "{}");

    let result: ReturnType<typeof runExtendsClearCache> | undefined;
    const out = captureStdout(() => {
      result = runExtendsClearCache({ cwd: consumer });
    });
    expect(result?.removed).toBe(true);
    expect(out).toMatch(/Removed/);
  });

  it("emits JSON when --json", () => {
    let result: ReturnType<typeof runExtendsClearCache> | undefined;
    const out = captureStdout(() => {
      result = runExtendsClearCache({ cwd: consumer, json: true });
    });
    const parsed = JSON.parse(out);
    expect(parsed.removed).toBe(false);
    expect(typeof parsed.path).toBe("string");
    expect(parsed.exitCode).toBe(0);
    expect(result).toBeDefined();
  });
});
