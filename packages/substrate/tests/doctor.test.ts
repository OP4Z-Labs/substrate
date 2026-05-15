import { rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../src/commands/doctor.js";
import { runInit } from "../src/commands/init.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("runDoctor", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    process.chdir(tmp);
  });

  afterEach(() => {
    removeTempDir(tmp);
    // Reset exit code that doctor sets
    process.exitCode = 0;
  });

  it("reports an error when substrate.config.json is missing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = runDoctor();
      expect(report.exitCode).toBe(1);
      expect(report.summary.error).toBeGreaterThanOrEqual(1);
      const configCheck = report.checks.find((c) => c.id === "config.missing");
      expect(configCheck).toBeDefined();
      expect(configCheck?.severity).toBe("error");
    } finally {
      log.mockRestore();
    }
  });

  it("passes all checks on a freshly-initialized repo", () => {
    runInit({ projectName: "doctor-test", shortCode: "DR", quiet: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = runDoctor();
      expect(report.exitCode).toBe(0);
      expect(report.summary.error).toBe(0);
      expect(report.checks.find((c) => c.id === "config.present")?.severity).toBe("ok");
      expect(report.checks.find((c) => c.id === "auto.subdirs")?.severity).toBe("ok");
    } finally {
      log.mockRestore();
    }
  });

  it("warns when manifest references a missing file", () => {
    runInit({ projectName: "doctor-test", shortCode: "DR", quiet: true });
    // Inject a dangling manifest entry.
    const manifestPath = join(tmp, "auto", ".substrate-manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          substrateVersion: "0.3.0",
          entries: [
            {
              path: "auto/instructions/main/audit-ghost.md",
              templateVersion: "0.3.0",
              contentHash: "sha256:deadbeef",
              ejected: false,
            },
          ],
        },
        null,
        2,
      ),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = runDoctor();
      expect(report.summary.warn).toBeGreaterThanOrEqual(1);
      expect(report.checks.find((c) => c.id === "manifest.dangling")?.severity).toBe("warn");
    } finally {
      log.mockRestore();
    }
  });

  it("flags stack drift when substrate.config has a stack not detected", () => {
    runInit({ projectName: "doctor-test", shortCode: "DR", stacks: ["python", "go"], quiet: true });
    // No marker files exist for go (or python). Doctor should warn about
    // declared-but-not-detected.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = runDoctor();
      const drift = report.checks.find((c) => c.id === "stack.declared-missing");
      expect(drift).toBeDefined();
      expect(drift?.severity).toBe("warn");
    } finally {
      log.mockRestore();
    }
  });

  it("flags missing Claude bridge file when config enables it", () => {
    runInit({ projectName: "doctor-test", shortCode: "DR", withClaude: true, quiet: true });
    // Delete the bridge file we just scaffolded.
    unlinkSync(join(tmp, ".claude", "commands", "substrate.md"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = runDoctor();
      const bridgeCheck = report.checks.find((c) => c.id === "bridge.claude.missing");
      expect(bridgeCheck).toBeDefined();
      expect(bridgeCheck?.severity).toBe("error");
      expect(report.exitCode).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  it("reports auto/ subdir gaps as a warn (not error)", () => {
    runInit({ projectName: "doctor-test", shortCode: "DR", quiet: true });
    rmSync(join(tmp, "auto", "commands"), { recursive: true, force: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = runDoctor();
      const sub = report.checks.find((c) => c.id === "auto.subdirs");
      expect(sub?.severity).toBe("warn");
      expect(sub?.message).toContain("commands");
    } finally {
      log.mockRestore();
    }
  });

  it("emits JSON when --json is set", () => {
    runInit({ projectName: "doctor-test", shortCode: "DR", quiet: true });
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    try {
      const report = runDoctor({ json: true });
      const parsed = JSON.parse(writes.join("")) as { exitCode: number };
      expect(parsed.exitCode).toBe(report.exitCode);
    } finally {
      (process.stdout.write as unknown) = orig;
    }
  });
});
