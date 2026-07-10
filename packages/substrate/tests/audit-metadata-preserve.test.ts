/**
 * U11 — rule `metadata.*` is preserved through loadRules into the review
 * context.
 *
 * RC7: `loadRules` used to drop every annotation, so the AI-review arm received
 * 108 indistinguishable id+severity pairs stripped of their review instruction.
 * The runtime must never DISPATCH on metadata (D7), but it must CARRY it, so the
 * reviewer receives each rule's intent and known-FP notes.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRules } from "../src/audit/index.js";
import { loadContext } from "../src/v2/context-loader.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const RULES = [
  "rules:",
  "  - id: BE-PY-777",
  "    title: a rule with rich metadata",
  "    severity: high",
  "    detector:",
  "      type: ripgrep",
  "      pattern: TODO",
  "    metadata:",
  "      intent: keep TODOs out of shipped code",
  "      review: reviewer confirms no TODO in a merged endpoint",
  "      confidence: high",
  "      known_fp:",
  "        - test fixtures naming a TODO literal",
].join("\n");

describe("U11: metadata preservation", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => removeTempDir(tmp));

  it("preserves rule metadata through loadRules", () => {
    const p = join(tmp, "RULES.yaml");
    writeFileSync(p, RULES, "utf8");
    const { document } = loadRules(p);
    const rule = document.rules.find((r) => r.id === "BE-PY-777")!;
    expect(rule.metadata).toBeDefined();
    expect(rule.metadata!.intent).toBe("keep TODOs out of shipped code");
    expect(rule.metadata!.confidence).toBe("high");
    expect(rule.metadata!.known_fp).toEqual(["test fixtures naming a TODO literal"]);
  });

  it("carries metadata through the review context loader", () => {
    // context-loader resolves context.rules from substrate/RULES.yaml.
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(join(tmp, "substrate", "RULES.yaml"), RULES, "utf8");

    const ctx = loadContext({
      cwd: tmp,
      workflow: {
        schema_version: "v2.0",
        id: "wf",
        name: "wf",
        context: { rules: ["BE-PY-*"] },
      } as never,
    });

    const rule = ctx.rules.find((r) => r.id === "BE-PY-777");
    expect(rule).toBeDefined();
    expect(rule!.metadata?.review).toBe("reviewer confirms no TODO in a merged endpoint");
  });
});
