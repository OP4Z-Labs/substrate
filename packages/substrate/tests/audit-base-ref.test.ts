/**
 * U14 — `--base-ref` scopes to what the branch introduced.
 *
 * `--diff` compares the working tree to HEAD, which is empty after a CI
 * checkout, so a server-side `substrate audit --diff` audits nothing and exits
 * 0 (RC9). `--base-ref <ref>` diffs `<ref>...HEAD` instead — the primitive a
 * CI gate needs. A bad ref fails loud rather than silently scanning everything.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listChangedPathsSince } from "../src/audit/index.js";
import { runAuditExecute } from "../src/commands/audit.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const RULES = [
  "rules:",
  "  - id: NEEDLE-1",
  "    title: finds NEEDLE",
  "    severity: high",
  "    detector:",
  "      type: ripgrep",
  "      pattern: NEEDLE",
].join("\n");

describe("audit --base-ref (U14)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    git(["init", "-q"], tmp);
    git(["config", "user.email", "t@e.com"], tmp);
    git(["config", "user.name", "T"], tmp);
    writeFileSync(join(tmp, "RULES.yaml"), RULES, "utf8");
    writeFileSync(join(tmp, "base.txt"), "NEEDLE in base\n", "utf8");
    git(["add", "-A"], tmp);
    git(["commit", "-qm", "base"], tmp);
  });
  afterEach(() => removeTempDir(tmp));

  it("lists only the files the branch introduced vs the base ref", () => {
    const base = git(["rev-parse", "HEAD"], tmp).trim();
    writeFileSync(join(tmp, "added.txt"), "NEEDLE in added\n", "utf8");
    git(["add", "-A"], tmp);
    git(["commit", "-qm", "add a file"], tmp);

    const changed = listChangedPathsSince(tmp, base);
    expect(changed.kind).toBe("files");
    if (changed.kind === "files") {
      expect(changed.files).toEqual(["added.txt"]);
    }
  });

  it("scopes findings to the introduced files, not the whole repo", async () => {
    const base = git(["rev-parse", "HEAD"], tmp).trim();
    writeFileSync(join(tmp, "added.txt"), "NEEDLE in added\n", "utf8");
    git(["add", "-A"], tmp);
    git(["commit", "-qm", "add"], tmp);

    const { report } = await runAuditExecute({
      cwd: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      baseRef: base,
      quiet: true,
      noReport: true,
    });
    // base.txt also contains NEEDLE, but it is out of scope: only added.txt.
    const paths = report.rules.flatMap((r) => r.findings.map((f) => f.path));
    expect(paths).toEqual(["added.txt"]);
    expect(report.scope).toBe(`base:${base}`);
  });

  it("fails loud on a ref that does not exist", async () => {
    let threw = false;
    try {
      await runAuditExecute({
        cwd: tmp,
        rulesPath: join(tmp, "RULES.yaml"),
        baseRef: "no-such-ref-abcdef",
        quiet: true,
        noReport: true,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("empties the rule set when the branch introduced nothing", async () => {
    const base = git(["rev-parse", "HEAD"], tmp).trim();
    const { report } = await runAuditExecute({
      cwd: tmp,
      rulesPath: join(tmp, "RULES.yaml"),
      baseRef: base, // HEAD === base: nothing introduced
      quiet: true,
      noReport: true,
    });
    expect(report.totalFindings).toBe(0);
    expect(report.executedRules).toBe(0);
  });
});
