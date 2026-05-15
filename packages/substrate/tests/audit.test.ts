import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAuditList, runAuditType } from "../src/commands/audit.js";
import { runInit } from "../src/commands/init.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("audit commands", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    process.chdir(tmp);
    runInit({ projectName: "audit-test", shortCode: "AUD", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  describe("runAuditList", () => {
    it("enumerates the three default audits scaffolded by init", () => {
      const { enabled } = runAuditList({ quiet: true });
      const types = enabled.map((a) => a.type).sort();
      expect(types).toEqual(["dead-code", "dependencies", "pre-merge"]);
    });

    it("populates the description from front matter when available", () => {
      const { enabled } = runAuditList({ quiet: true });
      const preMerge = enabled.find((a) => a.type === "pre-merge");
      expect(preMerge).toBeDefined();
      expect(preMerge?.description).toContain("Diff-only");
    });

    it("returns an empty enabled list when no audits exist", () => {
      const fresh = makeTempDir();
      try {
        process.chdir(fresh);
        const { enabled } = runAuditList({ quiet: true });
        expect(enabled).toEqual([]);
      } finally {
        removeTempDir(fresh);
      }
    });

    it("surfaces the bundled catalog so users can discover what to scaffold", () => {
      // Discovery contract: every audit-*.md under templates/audits/ should
      // appear in the catalog, and the audits already scaffolded by init
      // (pre-merge, dependencies, dead-code) should be flagged scaffolded.
      const { enabled, catalog } = runAuditList({ quiet: true });
      expect(catalog.length).toBeGreaterThan(enabled.length);

      const catalogTypes = catalog.map((c) => c.type);
      // Spot-check a handful of templates known to ship with substrate.
      expect(catalogTypes).toContain("backend");
      expect(catalogTypes).toContain("frontend");
      expect(catalogTypes).toContain("security");

      const preMergeEntry = catalog.find((c) => c.type === "pre-merge");
      expect(preMergeEntry?.scaffolded).toBe(true);

      const backendEntry = catalog.find((c) => c.type === "backend");
      expect(backendEntry?.scaffolded).toBe(false);
    });
  });

  describe("runAuditType", () => {
    it("loads an instruction and returns a stub report", () => {
      const report = runAuditType("pre-merge", { quiet: true });
      expect(report.type).toBe("pre-merge");
      expect(report.status).toBe("stub");
      expect(report.findings).toBe(0);
      expect(report.instructionPath).toContain("audit-pre-merge.md");
    });

    it("throws with a helpful hint when the audit doesn't exist", () => {
      expect(() => runAuditType("not-a-real-audit", { quiet: true })).toThrow(
        /not found/i,
      );
    });
  });
});
