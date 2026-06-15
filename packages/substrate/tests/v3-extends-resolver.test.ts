/**
 * Sub-phase B — resolver + layered discovery across extends sources.
 *
 * Coverage targets (per brief + plan §2.2):
 *  - chain resolution: empty extends → single repo-local layer
 *  - file: source resolution from a fixture tree
 *  - chain ordering: base → overlay → repo-local
 *  - 5 collision scenarios (workflows, hooks, doc-checks, standards, RULES)
 *    each with repo-local winning + a warning surfaced
 *  - override behavior — repo-local always wins over any extends source
 *  - multi-source ordering — among extends entries, later wins
 *
 * The resolver and merge logic are tested with `file:` sources because
 * sub-phase B does not implement github cloning (deferred to C) and npm
 * sources need a real node_modules tree to resolve (covered in C's
 * tests).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverDocChecksAcrossExtends,
  discoverHooksAcrossExtends,
  discoverRulesAcrossExtends,
  discoverStandardsAcrossExtends,
  discoverWorkflowsAcrossExtends,
  mergeWithCollisionRecords,
  resolveExtendsChain,
} from "../src/v2/extends/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

interface FixtureWorkflow {
  id: string;
  name?: string;
}
interface FixtureHook {
  id: string;
  trigger?: string[];
  step?: { type: string; handler?: string };
  order?: number;
}
interface FixtureDocCheck {
  id: string;
  when?: { "files-changed-any"?: string[] };
  prompt?: string;
}

function writeWorkflow(layerRoot: string, w: FixtureWorkflow): void {
  const dir = join(layerRoot, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${w.id}.yaml`),
    [
      "schema_version: v2.0",
      `id: ${w.id}`,
      `name: ${w.name ?? w.id}`,
    ].join("\n"),
  );
}

function writeHook(layerRoot: string, h: FixtureHook): void {
  const dir = join(layerRoot, "substrate", "hooks");
  mkdirSync(dir, { recursive: true });
  const triggers = h.trigger ?? ["workflow-completion"];
  const step = h.step ?? { type: "noop", handler: "test-noop" };
  const lines = [
    "schema_version: v2.0",
    `id: ${h.id}`,
    `trigger: [${triggers.map((t) => `"${t}"`).join(", ")}]`,
    h.order !== undefined ? `order: ${h.order}` : "",
    "step:",
    `  type: ${step.type}`,
    step.handler ? `  handler: ${step.handler}` : "",
  ].filter(Boolean);
  writeFileSync(join(dir, `${h.id}.yaml`), lines.join("\n"));
}

function writeDocCheck(layerRoot: string, d: FixtureDocCheck): void {
  const dir = join(layerRoot, "substrate", "doc-checks");
  mkdirSync(dir, { recursive: true });
  const lines = [
    "schema_version: v2.0",
    `id: ${d.id}`,
    "when:",
    "  files-changed-any:",
    ...(d.when?.["files-changed-any"] ?? ["apps/**"]).map((g) => `    - "${g}"`),
    `prompt: ${d.prompt ?? "Update the relevant doc."}`,
  ];
  writeFileSync(join(dir, `${d.id}.yaml`), lines.join("\n"));
}

function writeStandard(layerRoot: string, rel: string, body: string): void {
  const abs = join(layerRoot, "substrate", "standards", rel);
  mkdirSync(join(layerRoot, "substrate", "standards", ...rel.split("/").slice(0, -1)), {
    recursive: true,
  });
  writeFileSync(abs, body);
}

function writeRules(layerRoot: string, rules: Array<{ id: string; title: string }>): void {
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
  extendsArr: Array<{ source: string }> = [],
): void {
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

describe("resolveExtendsChain — hot path (no extends declared)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns just the repo-local layer when no config exists", () => {
    const chain = resolveExtendsChain({ cwd: tmp });
    expect(chain.layers.length).toBe(1);
    expect(chain.layers[0].source).toBe("repo-local");
    expect(chain.layers[0].kind).toBe("local");
    expect(chain.layers[0].root).toBe(tmp);
    expect(chain.errors).toEqual([]);
  });

  it("returns just the repo-local layer when extends is empty", () => {
    writeConfig(tmp, []);
    const chain = resolveExtendsChain({ cwd: tmp });
    expect(chain.layers.length).toBe(1);
    expect(chain.layers[0].source).toBe("repo-local");
  });
});

describe("resolveExtendsChain — file: source", () => {
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

  it("resolves a file: source against the consumer root", () => {
    writeWorkflow(org, { id: "org-workflow" });
    writeConfig(consumer, [{ source: `file:${org}` }]);
    const chain = resolveExtendsChain({ cwd: consumer });
    // Order: org first (base), repo-local last
    expect(chain.layers.map((l) => l.source)).toEqual([`file:${org}`, "repo-local"]);
    expect(chain.layers[0].root).toBe(org);
    expect(chain.errors).toEqual([]);
  });

  it("surfaces an error when a file: source path does not exist", () => {
    writeConfig(consumer, [{ source: "file:/path/does/not/exist/here" }]);
    const chain = resolveExtendsChain({ cwd: consumer });
    // Only the repo-local layer survives.
    expect(chain.layers.length).toBe(1);
    expect(chain.layers[0].source).toBe("repo-local");
    expect(chain.errors.length).toBe(1);
    expect(chain.errors[0].message).toMatch(/does not exist/);
  });

  it("preserves base → overlay → repo-local ordering with multiple file: sources", () => {
    const overlay = makeTempDir("substrate-overlay-");
    try {
      writeConfig(consumer, [{ source: `file:${org}` }, { source: `file:${overlay}` }]);
      const chain = resolveExtendsChain({ cwd: consumer });
      expect(chain.layers.map((l) => l.source)).toEqual([
        `file:${org}`,
        `file:${overlay}`,
        "repo-local",
      ]);
    } finally {
      removeTempDir(overlay);
    }
  });
});

describe("discoverWorkflowsAcrossExtends — collision policy", () => {
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

  it("same-id workflow: repo-local wins, collision recorded", () => {
    writeWorkflow(org, { id: "tackle-task", name: "Org tackle-task" });
    writeWorkflow(consumer, { id: "tackle-task", name: "Repo tackle-task" });
    writeConfig(consumer, [{ source: `file:${org}` }]);

    const result = discoverWorkflowsAcrossExtends({ cwd: consumer });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].descriptor.manifest.name).toBe("Repo tackle-task");
    expect(result.entries[0].provenance.source).toBe("repo-local");
    expect(result.collisions.length).toBe(1);
    expect(result.collisions[0].class).toBe("workflow");
    expect(result.collisions[0].key).toBe("tackle-task");
    expect(result.collisions[0].winner).toBe("repo-local");
    expect(result.collisions[0].overridden).toEqual([`file:${org}`]);
  });

  it("merges non-colliding workflows from org + repo into a single registry", () => {
    writeWorkflow(org, { id: "audit-pre-merge", name: "Org audit-pre-merge" });
    writeWorkflow(consumer, { id: "repo-only", name: "Repo-only workflow" });
    writeConfig(consumer, [{ source: `file:${org}` }]);

    const result = discoverWorkflowsAcrossExtends({ cwd: consumer });
    expect(result.entries.map((e) => e.descriptor.manifest.id).sort()).toEqual([
      "audit-pre-merge",
      "repo-only",
    ]);
    expect(result.collisions).toEqual([]);
  });

  it("multi-source ordering: later extends overrides earlier extends", () => {
    const overlay = makeTempDir("substrate-overlay-");
    try {
      writeWorkflow(org, { id: "common", name: "From org" });
      writeWorkflow(overlay, { id: "common", name: "From overlay" });
      writeConfig(consumer, [
        { source: `file:${org}` },
        { source: `file:${overlay}` },
      ]);

      const result = discoverWorkflowsAcrossExtends({ cwd: consumer });
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].descriptor.manifest.name).toBe("From overlay");
      expect(result.entries[0].provenance.source).toBe(`file:${overlay}`);
      expect(result.collisions[0].winner).toBe(`file:${overlay}`);
      expect(result.collisions[0].overridden).toEqual([`file:${org}`]);
    } finally {
      removeTempDir(overlay);
    }
  });

  it("repo-local always wins, even against multiple extends sources", () => {
    const overlay = makeTempDir("substrate-overlay-");
    try {
      writeWorkflow(org, { id: "common", name: "From org" });
      writeWorkflow(overlay, { id: "common", name: "From overlay" });
      writeWorkflow(consumer, { id: "common", name: "From repo" });
      writeConfig(consumer, [
        { source: `file:${org}` },
        { source: `file:${overlay}` },
      ]);

      const result = discoverWorkflowsAcrossExtends({ cwd: consumer });
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].descriptor.manifest.name).toBe("From repo");
      expect(result.entries[0].provenance.source).toBe("repo-local");
      expect(result.collisions[0].winner).toBe("repo-local");
      expect(result.collisions[0].overridden).toEqual([
        `file:${org}`,
        `file:${overlay}`,
      ]);
    } finally {
      removeTempDir(overlay);
    }
  });

  it("hot path: no extends configured behaves like v2.0 discovery", () => {
    writeWorkflow(consumer, { id: "x", name: "X" });
    const result = discoverWorkflowsAcrossExtends({ cwd: consumer });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].provenance.source).toBe("repo-local");
    expect(result.chain.layers.length).toBe(1);
  });
});

describe("discoverHooksAcrossExtends — collision policy", () => {
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

  it("same-id hook: repo-local wins, collision recorded", () => {
    writeHook(org, { id: "auto-emit-sidecar", order: 50 });
    writeHook(consumer, { id: "auto-emit-sidecar", order: 10 });
    writeConfig(consumer, [{ source: `file:${org}` }]);

    const result = discoverHooksAcrossExtends({ cwd: consumer });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].descriptor.manifest.order).toBe(10);
    expect(result.entries[0].provenance.source).toBe("repo-local");
    expect(result.collisions[0].class).toBe("hook");
    expect(result.collisions[0].key).toBe("auto-emit-sidecar");
  });
});

describe("discoverDocChecksAcrossExtends — collision policy", () => {
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

  it("same-id doc-check: repo-local wins, collision recorded", () => {
    writeDocCheck(org, {
      id: "changelog-on-feat-or-fix",
      prompt: "Org variant",
    });
    writeDocCheck(consumer, {
      id: "changelog-on-feat-or-fix",
      prompt: "Repo override",
    });
    writeConfig(consumer, [{ source: `file:${org}` }]);

    const result = discoverDocChecksAcrossExtends({ cwd: consumer });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].descriptor.manifest.prompt).toBe("Repo override");
    expect(result.collisions[0].class).toBe("doc-check");
    expect(result.collisions[0].winner).toBe("repo-local");
  });
});

describe("discoverStandardsAcrossExtends — collision policy", () => {
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

  it("same-relpath standard: repo-local wins, collision recorded", () => {
    writeStandard(org, "backend/python.md", "# Org Python standard");
    writeStandard(consumer, "backend/python.md", "# Repo Python override");
    writeConfig(consumer, [{ source: `file:${org}` }]);

    const result = discoverStandardsAcrossExtends({ cwd: consumer });
    expect(result.standards.length).toBe(1);
    expect(result.standards[0].body).toBe("# Repo Python override");
    expect(result.collisions[0].class).toBe("standard");
    expect(result.collisions[0].key).toBe("backend/python.md");
    expect(result.collisions[0].winner).toBe("repo-local");
    expect(result.provenance.get("backend/python.md")).toBe("repo-local");
  });

  it("merges non-colliding standards from org + repo", () => {
    writeStandard(org, "security/secrets.md", "# Org secrets policy");
    writeStandard(consumer, "code-style/typescript.md", "# Repo TS style");
    writeConfig(consumer, [{ source: `file:${org}` }]);

    const result = discoverStandardsAcrossExtends({ cwd: consumer });
    expect(result.standards.map((s) => s.relativePath).sort()).toEqual([
      "code-style/typescript.md",
      "security/secrets.md",
    ]);
    expect(result.collisions).toEqual([]);
  });
});

describe("discoverRulesAcrossExtends — collision policy", () => {
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

  it("same rule-id: repo-local wins, collision recorded", () => {
    writeRules(org, [
      { id: "BE-PY-001", title: "Org python rule" },
      { id: "BE-PY-002", title: "Org-only rule" },
    ]);
    writeRules(consumer, [
      { id: "BE-PY-001", title: "Repo override" },
      { id: "REPO-001", title: "Repo-only rule" },
    ]);
    writeConfig(consumer, [{ source: `file:${org}` }]);

    const result = discoverRulesAcrossExtends({ cwd: consumer });
    const idMap = new Map(result.rules.map((r) => [r.id, r.title] as const));
    expect(idMap.get("BE-PY-001")).toBe("Repo override");
    expect(idMap.get("BE-PY-002")).toBe("Org-only rule");
    expect(idMap.get("REPO-001")).toBe("Repo-only rule");

    expect(result.collisions.length).toBe(1);
    expect(result.collisions[0].class).toBe("rule");
    expect(result.collisions[0].key).toBe("BE-PY-001");
    expect(result.collisions[0].winner).toBe("repo-local");
    expect(result.provenance.get("BE-PY-001")).toBe("repo-local");
    expect(result.provenance.get("BE-PY-002")).toBe(`file:${org}`);
  });
});

describe("mergeWithCollisionRecords — pure merge helper", () => {
  it("later-wins semantics, with collision records for duplicates only", () => {
    const groups = [
      { source: "base", entries: [{ id: "a" }, { id: "b" }] },
      { source: "overlay", entries: [{ id: "b" }, { id: "c" }] },
      { source: "repo-local", entries: [{ id: "c" }] },
    ];
    const result = mergeWithCollisionRecords(
      groups,
      (e) => e.id,
      "workflow",
    );
    expect(result.merged.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
    expect(result.collisions.length).toBe(2);
    const byKey = new Map(result.collisions.map((c) => [c.key, c]));
    expect(byKey.get("b")?.winner).toBe("overlay");
    expect(byKey.get("c")?.winner).toBe("repo-local");
  });
});

describe("hot path: chain collapses to repo-local for v2.0 consumers", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("workflow discovery without extends has provenance = repo-local", () => {
    writeWorkflow(tmp, { id: "x" });
    const result = discoverWorkflowsAcrossExtends({ cwd: tmp });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].provenance.source).toBe("repo-local");
    expect(result.collisions).toEqual([]);
  });
});
