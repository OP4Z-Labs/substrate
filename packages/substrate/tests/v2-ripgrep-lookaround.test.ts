/**
 * Tests for TI-4 — ripgrep look-around fixes.
 *
 * Two concerns:
 *   1. The shipped RULES.yaml has no look-around regexes anymore (the
 *      three flagged rules — BE-APIV-001, FE-TS-001, XCUT-MD-001 —
 *      now use script detectors).
 *   2. The doctor's `ripgrep-lookaround` check warns when consumer
 *      RULES.yaml contains look-around patterns.
 *   3. Each of the new script detectors detects what its rule claims.
 */

import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../src/commands/doctor.js";
import { runAuditExecute } from "../src/commands/audit.js";
import { getTemplatesDir } from "../src/util/paths.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const TEMPLATE_RULES_PATH = join(
  getTemplatesDir(),
  "standards",
  "cross-cutting",
  "RULES.yaml",
);

const TEMPLATE_DETECTORS_DIR = join(
  getTemplatesDir(),
  "standards",
  "cross-cutting",
  "detectors",
);

describe("shipped RULES.yaml — no look-around regexes", () => {
  it("contains zero ripgrep look-around patterns", () => {
    const raw = readFileSync(TEMPLATE_RULES_PATH, "utf8");
    // Match the literal regex-syntax that ripgrep silently skips
    // without --pcre2.
    const offending = raw.match(/\(\?[=!<]/g);
    expect(offending).toBeNull();
  });

  it("ships the three script detectors that replaced the look-arounds", () => {
    for (const detector of ["be-apiv-001.mjs", "fe-ts-001.mjs", "xcut-md-001.mjs"]) {
      const path = join(TEMPLATE_DETECTORS_DIR, detector);
      const body = readFileSync(path, "utf8");
      expect(body.length).toBeGreaterThan(200);
      expect(body).toContain("export default");
    }
  });
});

describe("doctor: ripgrep-lookaround check", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    removeTempDir(tmp);
    logSpy.mockRestore();
  });

  it("reports ok when RULES.yaml is missing", () => {
    const report = runDoctor({
      cwd: tmp,
      json: true,
      only: ["ripgrep-lookaround"],
    });
    const check = report.checks.find((c) => c.id === "rules.ripgrep-lookaround");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("ok");
  });

  it("reports ok when RULES.yaml has no look-around patterns", () => {
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(
      join(tmp, "substrate", "RULES.yaml"),
      `rules:
  - id: GOOD-001
    title: Clean rule
    severity: low
    detector:
      type: ripgrep
      pattern: 'TODO'
`,
    );
    const report = runDoctor({
      cwd: tmp,
      json: true,
      only: ["ripgrep-lookaround"],
    });
    const check = report.checks.find((c) => c.id === "rules.ripgrep-lookaround");
    expect(check?.severity).toBe("ok");
  });

  it("warns when a rule uses negative lookahead", () => {
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(
      join(tmp, "substrate", "RULES.yaml"),
      `rules:
  - id: BAD-LOOKAHEAD
    title: Uses negative lookahead
    severity: medium
    detector:
      type: ripgrep
      pattern: 'foo(?!bar)'
`,
    );
    const report = runDoctor({
      cwd: tmp,
      json: true,
      only: ["ripgrep-lookaround"],
    });
    const check = report.checks.find((c) => c.id === "rules.ripgrep-lookaround");
    expect(check?.severity).toBe("warn");
    expect(check?.message).toContain("BAD-LOOKAHEAD");
  });

  it("warns on multiple offenders + lists each id", () => {
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(
      join(tmp, "substrate", "RULES.yaml"),
      `rules:
  - id: BAD-1
    title: Negative lookahead
    severity: medium
    detector:
      type: ripgrep
      pattern: 'a(?!b)'
  - id: BAD-2
    title: Positive lookbehind
    severity: medium
    detector:
      type: ripgrep
      pattern: '(?<=x)y'
  - id: GOOD-3
    title: Plain pattern
    severity: low
    detector:
      type: ripgrep
      pattern: 'TODO'
`,
    );
    const report = runDoctor({
      cwd: tmp,
      json: true,
      only: ["ripgrep-lookaround"],
    });
    const check = report.checks.find((c) => c.id === "rules.ripgrep-lookaround");
    expect(check?.severity).toBe("warn");
    expect(check?.message).toContain("BAD-1");
    expect(check?.message).toContain("BAD-2");
    expect(check?.message).not.toContain("GOOD-3");
  });

  it("ignores look-around in non-ripgrep detectors", () => {
    mkdirSync(join(tmp, "substrate"), { recursive: true });
    writeFileSync(
      join(tmp, "substrate", "RULES.yaml"),
      `rules:
  - id: SCRIPT-001
    title: Uses script
    severity: low
    detector:
      type: script
      path: detectors/whatever.mjs
`,
    );
    const report = runDoctor({
      cwd: tmp,
      json: true,
      only: ["ripgrep-lookaround"],
    });
    const check = report.checks.find((c) => c.id === "rules.ripgrep-lookaround");
    expect(check?.severity).toBe("ok");
  });
});

describe("shipped script detectors actually detect", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    removeTempDir(tmp);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  function seedScriptDetector(
    cwd: string,
    name: string,
  ): void {
    const destDir = join(cwd, "substrate", "standards", "cross-cutting", "detectors");
    mkdirSync(destDir, { recursive: true });
    copyFileSync(
      join(TEMPLATE_DETECTORS_DIR, name),
      join(destDir, name),
    );
  }

  function seedRule(cwd: string, content: string): void {
    mkdirSync(join(cwd, "substrate"), { recursive: true });
    writeFileSync(join(cwd, "substrate", "RULES.yaml"), content);
  }

  it("BE-APIV-001 detects route URLs not under /api/vN", async () => {
    seedScriptDetector(tmp, "be-apiv-001.mjs");
    seedRule(
      tmp,
      `rules:
  - id: BE-APIV-001
    title: API versioning
    severity: medium
    detector:
      type: script
      path: substrate/standards/cross-cutting/detectors/be-apiv-001.mjs
`,
    );
    // Seed a Python file with a non-versioned route.
    const appDir = join(tmp, "app");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, "routes.py"),
      `from fastapi import APIRouter
router = APIRouter()

@router.get("/legacy/list")
def list_legacy():
    return []

@router.post("/api/v1/items")
def create_item():
    return {}
`,
    );
    const result = await runAuditExecute({
      cwd: tmp,
      quiet: true,
      json: true,
    });
    const findings =
      result.report.rules.find((r) => r.ruleId === "BE-APIV-001")?.findings ?? [];
    expect(findings.length).toBe(1);
    expect(findings[0].path).toMatch(/routes\.py$/);
  });

  it("FE-TS-001 detects `: any` without justification, passes annotated", async () => {
    seedScriptDetector(tmp, "fe-ts-001.mjs");
    seedRule(
      tmp,
      `rules:
  - id: FE-TS-001
    title: Any without justification
    severity: medium
    detector:
      type: script
      path: substrate/standards/cross-cutting/detectors/fe-ts-001.mjs
`,
    );
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "bad.ts"),
      `function f(x: any) { return x; }\n`,
    );
    writeFileSync(
      join(srcDir, "good.ts"),
      `function g(x: any) { // eslint-disable-line: third-party
  return x;
}\n`,
    );
    const result = await runAuditExecute({ cwd: tmp, quiet: true, json: true });
    const findings =
      result.report.rules.find((r) => r.ruleId === "FE-TS-001")?.findings ?? [];
    expect(findings.length).toBe(1);
    expect(findings[0].path).toContain("bad.ts");
  });

  it("XCUT-MD-001 detects standards docs missing scope/area frontmatter", async () => {
    seedScriptDetector(tmp, "xcut-md-001.mjs");
    seedRule(
      tmp,
      `rules:
  - id: XCUT-MD-001
    title: Standards frontmatter
    severity: low
    detector:
      type: script
      path: substrate/standards/cross-cutting/detectors/xcut-md-001.mjs
`,
    );
    const stdDir = join(tmp, "substrate", "standards", "backend");
    mkdirSync(stdDir, { recursive: true });
    // Missing frontmatter entirely.
    writeFileSync(join(stdDir, "no-front-matter.md"), `# Hello\n`);
    // Has scope + area.
    writeFileSync(
      join(stdDir, "good.md"),
      `---
scope: backend
area: api
---

# Good doc
`,
    );
    const result = await runAuditExecute({ cwd: tmp, quiet: true, json: true });
    const findings =
      result.report.rules.find((r) => r.ruleId === "XCUT-MD-001")?.findings ?? [];
    expect(findings.length).toBe(1);
    expect(findings[0].path).toMatch(/no-front-matter\.md$/);
  });
});
