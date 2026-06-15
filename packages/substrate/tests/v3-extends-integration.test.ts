/**
 * Sub-phase E — comprehensive integration test for the v3 extends primitive.
 *
 * Exercises npm + github + file sources together against a single
 * consumer fixture, then asserts the merged registry matches the
 * locked semantics:
 *
 *   - Layer ordering: base → overlay → repo-local
 *   - Each source kind contributes content
 *   - Same-id collisions resolve to repo-local
 *   - github cache is populated by the run (verified via the fake git
 *     runner's call log + the on-disk manifest.json)
 *   - Air-gap (`SUBSTRATE_OFFLINE=1`) refuses cold github clones but
 *     lets npm + file sources continue
 *
 * This is the closest thing to a "real-world" run we get without
 * actually shelling out to git or installing a package — fakes
 * everywhere a network call would happen.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverRulesAcrossExtends,
  discoverStandardsAcrossExtends,
  discoverWorkflowsAcrossExtends,
} from "../src/v2/extends/index.js";
import type { GitRunner } from "../src/v2/extends/github-source.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function writeWorkflow(layerRoot: string, id: string, name = id): void {
  const dir = join(layerRoot, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  // Quote the name to avoid YAML interpreting brackets/colons in values.
  const safeName = name.replace(/"/g, '\\"');
  writeFileSync(
    join(dir, `${id}.yaml`),
    `schema_version: v2.0\nid: ${id}\nname: "${safeName}"\n`,
  );
}

function writeStandard(layerRoot: string, rel: string, body: string): void {
  const dir = join(layerRoot, "substrate", "standards", ...rel.split("/").slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(layerRoot, "substrate", "standards", rel), body);
}

function writeRules(
  layerRoot: string,
  rules: Array<{ id: string; title: string }>,
): void {
  mkdirSync(join(layerRoot, "substrate"), { recursive: true });
  const body =
    "rules:\n" +
    rules
      .map(
        (r) =>
          `  - id: ${r.id}\n    title: ${r.title}\n    severity: low\n    detector:\n      type: manual\n`,
      )
      .join("");
  writeFileSync(join(layerRoot, "substrate", "RULES.yaml"), body);
}

function writeConfig(
  repoRoot: string,
  extendsArr: Array<{ source: string; version?: string; ref?: string }>,
): void {
  const config = {
    $schema: "https://op4z.dev/substrate/schemas/config.schema.json",
    version: "v3.0",
    project: { name: "consumer-app" },
    stacks: ["typescript"],
    paths: { auto: "auto" },
    defaults: { audits: [], standards: [], scaffolds: [], workflows: [] },
    bridges: {},
    telemetry: { enabled: false },
    extends: extendsArr,
  };
  writeFileSync(
    join(repoRoot, "substrate.config.json"),
    JSON.stringify(config, null, 2),
  );
}

/**
 * Build a fake git runner that simulates clone by writing a small
 * substrate/ tree into the target directory. Records every invocation
 * so tests can assert "git was/wasn't called."
 */
function makeFakeGitRunner(orgContent: {
  workflows: string[];
  standards?: Array<{ rel: string; body: string }>;
  rules?: Array<{ id: string; title: string }>;
}): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (args) => {
    calls.push(args);
    if (args[0] === "clone") {
      const target = args[args.length - 1];
      for (const id of orgContent.workflows) {
        writeWorkflow(target, id, `[github] ${id}`);
      }
      for (const s of orgContent.standards ?? []) {
        writeStandard(target, s.rel, s.body);
      }
      if (orgContent.rules && orgContent.rules.length > 0) {
        writeRules(target, orgContent.rules);
      }
      return "";
    }
    if (args[0] === "rev-parse") return "abcdef1234567890\n";
    if (args[0] === "checkout") return "";
    return "";
  };
  return { runner, calls };
}

describe("v3 extends — integration: npm + github + file together", () => {
  let consumer: string;
  let npmPkg: string; // simulated node_modules/<pkg>/
  let fileOverlay: string;
  let githubCache: string;

  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
    // Simulate an npm-installed shared package living under node_modules.
    npmPkg = join(consumer, "node_modules", "@acme", "substrate-shared");
    mkdirSync(npmPkg, { recursive: true });
    fileOverlay = makeTempDir("substrate-overlay-");
    githubCache = join(consumer, "substrate", ".cache", "extends", "github");
  });

  afterEach(() => {
    removeTempDir(consumer);
    removeTempDir(fileOverlay);
  });

  it("merges content from all three source kinds + repo-local", () => {
    // Layer 1: npm package contributes 2 workflows + 1 standard + 1 rule
    writeWorkflow(npmPkg, "audit-pre-merge");
    writeWorkflow(npmPkg, "tackle-task", "Org tackle-task");
    writeStandard(npmPkg, "security/secrets.md", "# Org secrets policy");
    writeRules(npmPkg, [{ id: "ORG-SEC-001", title: "Org security rule" }]);

    // Layer 2: github source (will be "cloned" via the fake runner) contributes
    // 1 workflow + 1 standard
    const { runner, calls } = makeFakeGitRunner({
      workflows: ["audit-payments"],
      standards: [{ rel: "compliance/pci.md", body: "# Payments PCI" }],
      rules: [{ id: "PAY-001", title: "Payments rule" }],
    });

    // Layer 3: file overlay contributes 1 workflow override + a rule override
    writeWorkflow(fileOverlay, "tackle-task", "Overlay tackle-task");
    writeRules(fileOverlay, [
      { id: "ORG-SEC-001", title: "Overlay security rule (overrides org)" },
    ]);

    // Layer 4: repo-local contributes 1 workflow + 1 standard override
    writeWorkflow(consumer, "repo-local-workflow", "Repo-only");
    writeStandard(consumer, "security/secrets.md", "# Repo override of secrets");

    writeConfig(consumer, [
      { source: "npm:@acme/substrate-shared" },
      { source: "github:acme-corp/substrate-payments", ref: "v1.0.0" },
      { source: `file:${fileOverlay}` },
    ]);

    // Workflows ------------------------------------------------------------
    const workflowsRes = discoverWorkflowsAcrossExtends({
      cwd: consumer,
      githubCacheRoot: githubCache,
      gitRunner: runner,
    });

    const wByName = new Map(
      workflowsRes.entries.map((w) => [w.descriptor.manifest.id, w]),
    );

    // 4 unique workflow ids should be present
    expect([...wByName.keys()].sort()).toEqual([
      "audit-payments",
      "audit-pre-merge",
      "repo-local-workflow",
      "tackle-task",
    ]);

    // Provenance + collision: tackle-task should resolve to the overlay
    // (the overlay is the latest non-repo-local layer; repo-local does
    // not declare tackle-task, so the overlay wins).
    const tackle = wByName.get("tackle-task")!;
    expect(tackle.provenance.source).toBe(`file:${fileOverlay}`);
    expect(tackle.descriptor.manifest.name).toBe("Overlay tackle-task");

    // Repo-local workflow comes from repo-local
    expect(wByName.get("repo-local-workflow")!.provenance.source).toBe(
      "repo-local",
    );

    // npm-provided audit-pre-merge keeps its npm provenance (no collision)
    expect(wByName.get("audit-pre-merge")!.provenance.source).toBe(
      "npm:@acme/substrate-shared",
    );

    // github-provided audit-payments was clone-fetched
    expect(wByName.get("audit-payments")!.provenance.source).toBe(
      "github:acme-corp/substrate-payments",
    );

    // Standards ------------------------------------------------------------
    const standardsRes = discoverStandardsAcrossExtends({
      cwd: consumer,
      githubCacheRoot: githubCache,
      gitRunner: runner,
    });
    const stByRel = new Map(
      standardsRes.standards.map((s) => [s.relativePath, s]),
    );
    // Both standards present
    expect([...stByRel.keys()].sort()).toEqual([
      "compliance/pci.md",
      "security/secrets.md",
    ]);
    // security/secrets.md is overridden by repo-local
    expect(stByRel.get("security/secrets.md")!.body).toBe(
      "# Repo override of secrets",
    );
    expect(standardsRes.provenance.get("security/secrets.md")).toBe(
      "repo-local",
    );

    // Rules ----------------------------------------------------------------
    const rulesRes = discoverRulesAcrossExtends({
      cwd: consumer,
      githubCacheRoot: githubCache,
      gitRunner: runner,
    });
    const rByid = new Map(rulesRes.rules.map((r) => [r.id, r] as const));
    expect([...rByid.keys()].sort()).toEqual(["ORG-SEC-001", "PAY-001"]);
    // ORG-SEC-001 overridden by overlay (not repo-local, which doesn't
    // declare it)
    expect(rByid.get("ORG-SEC-001")!.title).toBe(
      "Overlay security rule (overrides org)",
    );
    expect(rulesRes.provenance.get("ORG-SEC-001")).toBe(`file:${fileOverlay}`);

    // Cache contents: github clone happened, manifest written
    expect(calls.some((c) => c[0] === "clone")).toBe(true);
    const manifestPath = join(githubCache, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.version).toBe(1);
    const entries = Object.values(manifest.entries) as Array<{
      source: string;
      ref: string;
      resolvedSha: string | null;
    }>;
    expect(entries[0].source).toBe("github:acme-corp/substrate-payments");
    expect(entries[0].ref).toBe("v1.0.0");
    expect(entries[0].resolvedSha).toBe("abcdef1234567890");
  });

  it("SUBSTRATE_OFFLINE: github source is skipped but npm + file still work", () => {
    // npm contributes
    writeWorkflow(npmPkg, "from-npm");
    // file contributes
    writeWorkflow(fileOverlay, "from-file");
    // github would contribute but we'll never reach it (offline)
    const { runner, calls } = makeFakeGitRunner({
      workflows: ["from-github"],
    });

    writeConfig(consumer, [
      { source: "npm:@acme/substrate-shared" },
      { source: "github:acme-corp/substrate-payments", ref: "v1.0.0" },
      { source: `file:${fileOverlay}` },
    ]);

    const result = discoverWorkflowsAcrossExtends({
      cwd: consumer,
      githubCacheRoot: githubCache,
      gitRunner: runner,
      offline: true,
    });

    const ids = result.entries.map((w) => w.descriptor.manifest.id).sort();
    expect(ids).toEqual(["from-file", "from-npm"]);
    // The chain should record the offline warning for github.
    expect(result.chain.warnings.length).toBe(1);
    expect(result.chain.warnings[0].source).toBe(
      "github:acme-corp/substrate-payments",
    );
    expect(result.chain.warnings[0].message).toMatch(/SUBSTRATE_OFFLINE/);
    // git was never invoked.
    expect(calls.length).toBe(0);
  });

  it("warm github cache + offline = source still contributes", () => {
    // Warm the cache.
    const { runner: firstRunner } = makeFakeGitRunner({
      workflows: ["from-github"],
    });
    writeWorkflow(npmPkg, "from-npm");
    writeConfig(consumer, [
      { source: "npm:@acme/substrate-shared" },
      { source: "github:acme-corp/substrate-payments", ref: "v1.0.0" },
    ]);
    const warm = discoverWorkflowsAcrossExtends({
      cwd: consumer,
      githubCacheRoot: githubCache,
      gitRunner: firstRunner,
    });
    expect(warm.entries.map((w) => w.descriptor.manifest.id).sort()).toEqual([
      "from-github",
      "from-npm",
    ]);

    // Now go offline; warm cache should still serve.
    const { runner: offlineRunner, calls: offlineCalls } = makeFakeGitRunner({
      workflows: [],
    });
    const offlineRes = discoverWorkflowsAcrossExtends({
      cwd: consumer,
      githubCacheRoot: githubCache,
      gitRunner: offlineRunner,
      offline: true,
    });
    expect(
      offlineRes.entries.map((w) => w.descriptor.manifest.id).sort(),
    ).toEqual(["from-github", "from-npm"]);
    expect(offlineCalls.length).toBe(0);
  });
});
