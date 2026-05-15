/**
 * Script detector unit tests.
 *
 * Live in a dedicated file because they need a built `dist/` (the script
 * worker harness only exists after `tsc -b`). The integration global
 * setup builds the package once before the suite runs, so this file
 * can rely on dist/audit/detectors/script-worker.js being present.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("audit-runtime: script detector", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("invokes a script's default export and collects its findings", async () => {
    writeFileSync(join(tmp, "target.txt"), "alpha\nbeta\ngamma\n", "utf8");
    const scriptPath = join(tmp, "detect.mjs");
    writeFileSync(
      scriptPath,
      [
        "export default function detect(ctx) {",
        "  const text = ctx.readFile('target.txt');",
        "  const lines = text.split('\\n');",
        "  const out = [];",
        "  lines.forEach((l, i) => {",
        "    if (l.startsWith('b')) {",
        "      out.push(ctx.finding({ message: 'starts-with-b', path: 'target.txt', line: i + 1, snippet: l }));",
        "    }",
        "  });",
        "  return out;",
        "}",
      ].join("\n"),
      "utf8",
    );
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [
        {
          id: "SCR-1",
          title: "Find lines starting with b",
          severity: "medium",
          detector: { type: "script", path: "detect.mjs" },
        },
      ],
      scope: "script",
    });
    const result = report.rules.find((r) => r.ruleId === "SCR-1");
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]!.line).toBe(2);
  });

  it("rejects reads outside the repo root with EPERM", async () => {
    const scriptPath = join(tmp, "escape.mjs");
    writeFileSync(
      scriptPath,
      [
        "export default function detect(ctx) {",
        "  try {",
        "    ctx.readFile('../../../etc/passwd');",
        "    return [];",
        "  } catch (err) {",
        "    return [ctx.finding({ message: 'blocked: ' + err.code })];",
        "  }",
        "}",
      ].join("\n"),
      "utf8",
    );
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [
        {
          id: "SCR-ESC",
          title: "Escape attempt",
          severity: "high",
          detector: { type: "script", path: "escape.mjs" },
        },
      ],
      scope: "script-escape",
    });
    const r = report.rules.find((r) => r.ruleId === "SCR-ESC");
    expect(r?.findings).toHaveLength(1);
    expect(r?.findings[0]!.message).toContain("EPERM");
  });

  it("kills a runaway script after the configured timeout", async () => {
    const scriptPath = join(tmp, "spin.mjs");
    // Use an interval timer to actually keep the worker's event loop alive,
    // simulating a real long-running detector. A bare `new Promise(() => {})`
    // doesn't keep the event loop scheduled so Node would exit on its own.
    writeFileSync(
      scriptPath,
      [
        "export default async function detect() {",
        "  // Park indefinitely — the runtime should terminate this worker.",
        "  await new Promise(() => { setInterval(() => {}, 10000); });",
        "  return [];",
        "}",
      ].join("\n"),
      "utf8",
    );
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [
        {
          id: "SCR-SPIN",
          title: "Runaway",
          severity: "high",
          detector: { type: "script", path: "spin.mjs", timeoutMs: 200 },
        },
      ],
      scope: "script-spin",
    });
    const r = report.rules.find((r) => r.ruleId === "SCR-SPIN");
    expect(r?.skipped).toBe(true);
    expect(r?.note).toMatch(/timeout/);
  });

  it("propagates a script error as a skip with note", async () => {
    const scriptPath = join(tmp, "boom.mjs");
    writeFileSync(
      scriptPath,
      "export default function detect() { throw new Error('boom'); }",
      "utf8",
    );
    const report = await runAudit({
      repoRoot: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      rules: [
        {
          id: "SCR-BOOM",
          title: "Throws",
          severity: "high",
          detector: { type: "script", path: "boom.mjs" },
        },
      ],
      scope: "script-boom",
    });
    const r = report.rules.find((r) => r.ruleId === "SCR-BOOM");
    expect(r?.skipped).toBe(true);
    expect(r?.note).toContain("boom");
  });
});
