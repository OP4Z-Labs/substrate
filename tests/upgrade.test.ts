/**
 * Unit tests for `cadence upgrade` — programmatic API.
 *
 * The interactive `--apply` path is exercised via `resolveChoice`
 * injection (no inquirer prompts surface during tests). Integration
 * tests in `tests/integration/upgrade.test.ts` cover the spawned-CLI
 * surface separately.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdd } from "../src/commands/add.js";
import { runInit } from "../src/commands/init.js";
import { planUpgrade, runUpgrade } from "../src/commands/upgrade.js";
import { readManifest } from "../src/util/manifest.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("planUpgrade", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "upg-test", shortCode: "UT", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("classifies unmodified files when the user hasn't touched them", () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const plan = planUpgrade(tmp);
    const audit = plan.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(audit, "audit entry must exist after add").toBeDefined();
    expect(audit?.state).toBe("unmodified");
    expect(audit?.hashMatches).toBe(true);
    expect(audit?.templateExists).toBe(true);
  });

  it("classifies modified files when the user edits the scaffold", () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    writeFileSync(filePath, "# heavily customized audit\n\nMy edits.\n");
    const plan = planUpgrade(tmp);
    const audit = plan.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(audit?.state).toBe("modified");
    expect(audit?.hashMatches).toBe(false);
    expect(audit?.diff, "modified entries must carry a diff").toBeDefined();
    // The user's content should show up as -lines (it differs from new template).
    expect(audit?.diff).toContain("-# heavily customized audit");
  });

  it("classifies missing files when the user deletes them", () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    // Simulate `rm <file>` by a developer who lost interest.
    unlinkSync(filePath);
    const plan = planUpgrade(tmp);
    const audit = plan.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(audit?.state).toBe("missing");
  });

  it("classifies ejected files when the manifest flag is true", () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    // Manually set ejected=true to simulate `cadence config --eject`.
    const autoDir = join(tmp, "auto");
    const manifest = readManifest(autoDir);
    const target = manifest.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(target).toBeDefined();
    target!.ejected = true;
    writeFileSync(
      join(autoDir, ".cadence-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    const plan = planUpgrade(tmp);
    const audit = plan.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(audit?.state).toBe("ejected");
  });
});

describe("runUpgrade --check", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "upg-check", shortCode: "UC", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("returns a plan but never writes when --check is set", async () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    const before = readFileSync(filePath, "utf8");
    writeFileSync(filePath, "# edited\n");

    const result = await runUpgrade({ cwd: tmp, check: true, quiet: true });
    expect(result.plan.entries.length).toBeGreaterThan(0);
    expect(result.applied.length).toBe(0);

    // File and manifest both untouched.
    const after = readFileSync(filePath, "utf8");
    expect(after).toBe("# edited\n");
    expect(after).not.toBe(before);
  });

  it("treats --dry-run as an alias of --check (no writes)", async () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    writeFileSync(filePath, "# edited\n");

    const result = await runUpgrade({ cwd: tmp, dryRun: true, quiet: true });
    expect(result.applied.length).toBe(0);
    expect(readFileSync(filePath, "utf8")).toBe("# edited\n");
  });

  it("rejects when neither --check nor --apply are passed", async () => {
    await expect(runUpgrade({ cwd: tmp, quiet: true })).rejects.toThrow(
      /--check.*--apply/,
    );
  });

  it("rejects when both --check and --apply are passed", async () => {
    await expect(
      runUpgrade({ cwd: tmp, check: true, apply: true, quiet: true }),
    ).rejects.toThrow(/mutually exclusive/);
  });
});

describe("runUpgrade --apply", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    runInit({ cwd: tmp, projectName: "upg-apply", shortCode: "UA", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("keeps the user's copy when choice is `keep`", async () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    const userContent = "# my custom audit\n\nDo not touch.\n";
    writeFileSync(filePath, userContent);

    const result = await runUpgrade({
      cwd: tmp,
      apply: true,
      quiet: true,
      resolveChoice: () => "keep",
    });

    expect(result.applied.find((a) => a.path.endsWith("audit-backend.md"))?.choice).toBe(
      "keep",
    );
    expect(readFileSync(filePath, "utf8")).toBe(userContent);

    // Manifest's hash is refreshed to the user's content so the next
    // upgrade run doesn't re-prompt them.
    const manifest = readManifest(join(tmp, "auto"));
    const entry = manifest.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    // Re-run plan: should now classify as unmodified (no drift).
    const plan = planUpgrade(tmp);
    const planEntry = plan.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(planEntry?.state).toBe("unmodified");
    expect(entry).toBeDefined();
  });

  it("overwrites with the template when choice is `take-new`", async () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    writeFileSync(filePath, "# edited content\n");

    await runUpgrade({
      cwd: tmp,
      apply: true,
      quiet: true,
      resolveChoice: () => "take-new",
    });

    const after = readFileSync(filePath, "utf8");
    // Template content for audit-backend starts with a YAML front matter.
    expect(after).toMatch(/^---/);
    expect(after).not.toBe("# edited content\n");
  });

  it("writes a .cadence-merge sidecar when choice is `merge`", async () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    const userContent = "# my custom audit\n";
    writeFileSync(filePath, userContent);

    const result = await runUpgrade({
      cwd: tmp,
      apply: true,
      quiet: true,
      resolveChoice: () => "merge",
    });

    expect(readFileSync(filePath, "utf8")).toBe(userContent);
    const mergePath = filePath + ".cadence-merge";
    expect(existsSync(mergePath)).toBe(true);
    expect(readFileSync(mergePath, "utf8")).toMatch(/^---/);

    const applied = result.applied.find((a) =>
      a.path.endsWith("audit-backend.md"),
    );
    expect(applied?.choice).toBe("merge");
    expect(applied?.mergePath).toBeDefined();
    expect(applied?.mergePath).toContain(".cadence-merge");
  });

  it("flags the manifest entry as ejected when choice is `eject`", async () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    writeFileSync(filePath, "# edited\n");

    await runUpgrade({
      cwd: tmp,
      apply: true,
      quiet: true,
      resolveChoice: () => "eject",
    });

    const manifest = readManifest(join(tmp, "auto"));
    const entry = manifest.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(entry?.ejected).toBe(true);

    // Re-running the plan must now treat this as ejected, not modified.
    const plan = planUpgrade(tmp);
    const planEntry = plan.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    expect(planEntry?.state).toBe("ejected");
  });

  it("skips ejected files even when they have drift", async () => {
    runAdd({ category: "audit", item: "backend", cwd: tmp, quiet: true });
    // Eject first, then drift.
    const autoDir = join(tmp, "auto");
    const manifest = readManifest(autoDir);
    const entry = manifest.entries.find((e) =>
      e.path.endsWith("audit-backend.md"),
    );
    entry!.ejected = true;
    writeFileSync(
      join(autoDir, ".cadence-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    const filePath = join(tmp, "auto", "instructions", "main", "audit-backend.md");
    writeFileSync(filePath, "# user owns this now\n");

    let prompted = false;
    const result = await runUpgrade({
      cwd: tmp,
      apply: true,
      quiet: true,
      resolveChoice: () => {
        prompted = true;
        return "take-new";
      },
    });

    // resolveChoice should NEVER have been called for an ejected entry.
    expect(prompted).toBe(false);
    expect(readFileSync(filePath, "utf8")).toBe("# user owns this now\n");
    expect(result.applied.find((a) => a.path.endsWith("audit-backend.md"))?.choice).toBe(
      "skip",
    );
  });
});
