/**
 * v3.0.0-beta.1 — Tests for extends-aware consumer commands (NE-11
 * smoke-bug fixes).
 *
 * Coverage:
 *
 *   - `runV2Workflow` (substrate run) resolves a workflow declared
 *     only in a file: extends source — exit 0 — bug #3.
 *   - `runAuditExecute` (substrate audit) walks RULES.yaml from a
 *     file: extends source when no repo-local RULES.yaml exists —
 *     bug #4.
 *   - `runQueryRules` returns merged rules from a file: extends source
 *     — bug #1.
 *   - `runQueryStandards` returns merged standards from a file: extends
 *     source — bug #1.
 *   - `runQueryDocChecks` registry returns merged doc-checks from a
 *     file: extends source — bug #1.
 *   - `runHooksList` returns merged hooks from a file: extends source —
 *     bug #2.
 *   - `extends-opt-out` suppresses matching sources from the resolved
 *     chain; `--include-opt-out` bypasses the filter.
 *
 * Each test stands up an org-shared directory in a tempdir and a
 * consumer directory whose `substrate.config.json` declares a
 * `file:<org-dir>` extends entry. Tests assert merged behavior against
 * the merge wrapper-driven consumer commands.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExtendsChain } from "../src/v2/extends/resolver.js";
import { runV2Workflow } from "../src/v2/orchestrator/run-command.js";
import { runAuditExecute } from "../src/commands/audit.js";
import {
  runQueryDocChecks,
  runQueryRules,
  runQueryStandards,
} from "../src/v2/deterministic/query-command.js";
import { runHooksList } from "../src/v2/deterministic/hooks-command.js";
import { runExtendsList } from "../src/v2/deterministic/extends-command.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

interface ConsumerSetup {
  org: string;
  consumer: string;
}

function writeConsumerConfig(
  consumer: string,
  org: string,
  extras: Record<string, unknown> = {},
): void {
  const config = {
    $schema: "https://op4z.dev/substrate/schemas/config.schema.json",
    version: "v3.0",
    project: { name: "consumer" },
    stacks: ["typescript"],
    paths: { auto: "auto" },
    defaults: { audits: [], standards: [], scaffolds: [], workflows: [] },
    bridges: {},
    telemetry: { enabled: false },
    extends: [{ source: `file:${org}` }],
    ...extras,
  };
  writeFileSync(
    join(consumer, "substrate.config.json"),
    JSON.stringify(config, null, 2),
  );
}

function seedWorkflow(layerRoot: string, id: string, runCmd: string): void {
  const dir = join(layerRoot, "substrate", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.yaml`),
    [
      `schema_version: v2.0`,
      `id: ${id}`,
      `name: ${id}`,
      `kind: review`,
      `trigger: [manual-command]`,
      `steps:`,
      `  - id: marker`,
      `    name: marker`,
      `    type: invoke-deterministic`,
      `    run: '${runCmd}'`,
      ``,
    ].join("\n"),
  );
}

function seedHook(layerRoot: string, id: string): void {
  const dir = join(layerRoot, "substrate", "hooks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.yaml`),
    [
      `schema_version: v2.0`,
      `id: ${id}`,
      `description: from org source`,
      `trigger: [workflow-completion]`,
      `matches:`,
      `  exit-code: any`,
      `enabled: true`,
      `order: 50`,
      `step:`,
      `  type: run-deterministic`,
      `  command: 'echo ok'`,
      `  pass-result: false`,
      `  fail-on-error: false`,
      ``,
    ].join("\n"),
  );
}

function seedDocCheck(layerRoot: string, id: string): void {
  const dir = join(layerRoot, "substrate", "doc-checks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.yaml`),
    [
      `schema_version: v2.0`,
      `id: ${id}`,
      `description: from org`,
      `when:`,
      `  commit-message-pattern: "^(feat|fix):"`,
      `require:`,
      `  one-of:`,
      `    - CHANGELOG.md`,
      `prompt: Update CHANGELOG.`,
      `severity: high`,
      ``,
    ].join("\n"),
  );
}

function seedStandard(
  layerRoot: string,
  relPath: string,
  body: string,
): void {
  const abs = join(layerRoot, "substrate", "standards", relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
}

function seedRules(layerRoot: string, ruleIds: string[]): void {
  const dir = join(layerRoot, "substrate");
  mkdirSync(dir, { recursive: true });
  const rules = ruleIds
    .map(
      (id) =>
        `  - id: ${id}\n    title: ${id} title\n    severity: low\n    description: org rule\n    category: backend\n    detector:\n      type: manual\n`,
    )
    .join("");
  writeFileSync(
    join(dir, "RULES.yaml"),
    `meta:\n  version: 1.0.0\nrules:\n${rules}`,
  );
}

function setup(): ConsumerSetup {
  const work = makeTempDir("substrate-consumers-");
  const org = join(work, "org");
  const consumer = join(work, "consumer");
  mkdirSync(org, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  writeConsumerConfig(consumer, org);
  return { org, consumer };
}

function cleanup(setupOut: ConsumerSetup): void {
  // Both dirs share the same parent tempdir; remove the parent.
  const parent = join(setupOut.org, "..");
  removeTempDir(parent);
}

describe("v3 beta.1 — substrate run is extends-aware", () => {
  let setupOut: ConsumerSetup;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupOut = setup();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup(setupOut);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("resolves a workflow declared only in a file: extends source (bug #3)", async () => {
    seedWorkflow(setupOut.org, "org-only-workflow", "echo org-only-OK");

    const result = await runV2Workflow({
      workflowId: "org-only-workflow",
      cwd: setupOut.consumer,
      quiet: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.workflowId).toBe("org-only-workflow");
  });

  it("returns exit 2 with a useful 'across extends chain' message when missing everywhere", async () => {
    const result = await runV2Workflow({
      workflowId: "no-such-workflow",
      cwd: setupOut.consumer,
      quiet: true,
    });
    expect(result.exitCode).toBe(2);
    expect(result.ok).toBe(false);
  });
});

describe("v3 beta.1 — substrate audit is extends-aware", () => {
  let setupOut: ConsumerSetup;

  beforeEach(() => {
    setupOut = setup();
  });
  afterEach(() => {
    cleanup(setupOut);
  });

  it("loads RULES.yaml from a file: extends source when no repo-local RULES.yaml (bug #4)", async () => {
    seedRules(setupOut.org, ["ORG-RULE-001", "ORG-RULE-002", "ORG-RULE-003"]);

    const result = await runAuditExecute({
      cwd: setupOut.consumer,
      quiet: true,
      noReport: true,
    });
    expect(result.report.executedRules).toBe(3);
    expect(result.report.rules.map((r) => r.ruleId).sort()).toEqual([
      "ORG-RULE-001",
      "ORG-RULE-002",
      "ORG-RULE-003",
    ]);
  });

  it("repo-local RULES.yaml overrides org-shared rule by id", async () => {
    seedRules(setupOut.org, ["ORG-RULE-001", "ORG-RULE-002"]);
    // Repo-local override: same id ORG-RULE-001 with a different title.
    const rulesPath = join(setupOut.consumer, "substrate", "RULES.yaml");
    mkdirSync(join(setupOut.consumer, "substrate"), { recursive: true });
    writeFileSync(
      rulesPath,
      `meta:\n  version: 1.0.0\nrules:\n  - id: ORG-RULE-001\n    title: REPO OVERRIDE\n    severity: low\n    description: repo-local override\n    category: backend\n    detector:\n      type: manual\n`,
    );

    const result = await runAuditExecute({
      cwd: setupOut.consumer,
      quiet: true,
      noReport: true,
    });
    // Both rules still execute (org+repo-local merged); the
    // ORG-RULE-001 row reflects the repo-local title (winner).
    expect(result.report.executedRules).toBe(2);
    const overridden = result.report.rules.find(
      (r) => r.ruleId === "ORG-RULE-001",
    );
    expect(overridden?.ruleTitle).toBe("REPO OVERRIDE");
  });
});

describe("v3 beta.1 — substrate query is extends-aware", () => {
  let setupOut: ConsumerSetup;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupOut = setup();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup(setupOut);
    writeSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("query rules returns merged rules from a file: extends source (bug #1)", () => {
    seedRules(setupOut.org, ["ORG-RULE-001", "ORG-RULE-002"]);
    const result = runQueryRules({ cwd: setupOut.consumer, quiet: true });
    expect(result.rules.map((r) => r.id).sort()).toEqual([
      "ORG-RULE-001",
      "ORG-RULE-002",
    ]);
  });

  it("query standards returns merged standards from a file: extends source (bug #1)", () => {
    seedStandard(setupOut.org, "backend/python.md", "# org python");
    seedStandard(setupOut.org, "frontend/react.md", "# org react");
    const result = runQueryStandards({ cwd: setupOut.consumer, quiet: true });
    const paths = result.standards.map((s) => s.relativePath).sort();
    expect(paths).toEqual(["backend/python.md", "frontend/react.md"]);
  });

  it("query doc-checks returns merged registry from a file: extends source (bug #1)", () => {
    seedDocCheck(setupOut.org, "changelog-on-feat");
    seedDocCheck(setupOut.org, "tests-on-py");
    const result = runQueryDocChecks({ cwd: setupOut.consumer, quiet: true });
    const ids = result.registry.map((r) => r.id).sort();
    expect(ids).toEqual(["changelog-on-feat", "tests-on-py"]);
  });
});

describe("v3 beta.1 — substrate hooks list is extends-aware", () => {
  let setupOut: ConsumerSetup;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupOut = setup();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup(setupOut);
    writeSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("hooks list returns merged hooks from a file: extends source (bug #2)", () => {
    seedHook(setupOut.org, "auto-emit-sidecar");
    seedHook(setupOut.org, "log-completion");
    const result = runHooksList({ cwd: setupOut.consumer, quiet: true });
    const ids = result.hooks.map((h) => h.id).sort();
    expect(ids).toEqual(["auto-emit-sidecar", "log-completion"]);
  });
});

describe("v3 beta.1 — extends-opt-out", () => {
  let setupOut: ConsumerSetup;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupOut = setup();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    cleanup(setupOut);
    writeSpy.mockRestore();
  });

  it("suppresses matching sources from the resolved chain", () => {
    seedWorkflow(setupOut.org, "org-workflow", "echo ok");
    // Re-write the consumer config with extends-opt-out matching the
    // file: source.
    writeConsumerConfig(setupOut.consumer, setupOut.org, {
      "extends-opt-out": [`file:${setupOut.org}`],
    });

    const chain = resolveExtendsChain({ cwd: setupOut.consumer });
    // Only the repo-local layer should remain.
    expect(chain.layers).toHaveLength(1);
    expect(chain.layers[0].kind).toBe("local");

    // An opt-out warning is emitted so the suppression is visible.
    expect(
      chain.warnings.some((w) =>
        w.message.includes("extends-opt-out: source suppressed"),
      ),
    ).toBe(true);
  });

  it("--include-opt-out bypasses the filter", () => {
    seedWorkflow(setupOut.org, "org-workflow", "echo ok");
    writeConsumerConfig(setupOut.consumer, setupOut.org, {
      "extends-opt-out": [`file:${setupOut.org}`],
    });

    const result = runExtendsList({
      cwd: setupOut.consumer,
      quiet: true,
      includeOptOut: true,
    });
    expect(result.layers).toHaveLength(2);
    const file = result.layers.find((l) => l.kind === "file");
    expect(file).toBeTruthy();
  });

  it("warns on opt-out entries that don't match any extends source", () => {
    writeConsumerConfig(setupOut.consumer, setupOut.org, {
      "extends-opt-out": ["file:/nonexistent-source-not-in-extends"],
    });

    const chain = resolveExtendsChain({ cwd: setupOut.consumer });
    // The actual file: source is still in the chain (the opt-out
    // doesn't match it). And a warning is emitted about the no-op.
    expect(
      chain.warnings.some((w) =>
        w.message.includes("does not match any entry in extends"),
      ),
    ).toBe(true);
  });
});
