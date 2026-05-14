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
      const audits = runAuditList({ quiet: true });
      const types = audits.map((a) => a.type).sort();
      expect(types).toEqual(["dead-code", "dependencies", "pre-merge"]);
    });

    it("populates the description from front matter when available", () => {
      const audits = runAuditList({ quiet: true });
      const preMerge = audits.find((a) => a.type === "pre-merge");
      expect(preMerge).toBeDefined();
      expect(preMerge?.description).toContain("Diff-only");
    });

    it("returns an empty list when no audits exist", () => {
      const fresh = makeTempDir();
      try {
        process.chdir(fresh);
        const audits = runAuditList({ quiet: true });
        expect(audits).toEqual([]);
      } finally {
        removeTempDir(fresh);
      }
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
