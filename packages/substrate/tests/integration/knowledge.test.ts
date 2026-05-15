/**
 * Integration coverage for `substrate knowledge`.
 *
 * Smoke steps covered (from .agent/SMOKE-2026-05-14.md):
 *
 *   - Step 8 : `substrate knowledge refresh` against a docker-compose.yml
 *              + .env.example produces auto/docs/KNOWLEDGE.md with
 *              services + redacted env vars.
 *
 *   - Step 9 : `substrate knowledge show` prints the generated doc;
 *              `--section <name>` filters to one heading.
 *
 * Fixture choice — OP4Z compose caveat:
 *
 *   The brief points to OP4Z's docker-compose.yml as the canonical
 *   test fixture. The smoke run revealed (P1, deferred to v0.5) that
 *   the v0.3 mini-YAML parser only extracts the FIRST service when a
 *   `command: >` block-scalar appears — i.e., it loses 58/59 OP4Z
 *   services. Locking the integration test against the buggy output
 *   would entrench the regression rather than catch it.
 *
 *   Instead: we ship a small inline fixture that exercises the same
 *   shapes (`services`, `image`, `ports`, `depends_on`, `volumes`) the
 *   parser DOES handle today. When v0.5 swaps `yaml-mini.ts` for the
 *   `yaml` library, a follow-up test should be added using the real
 *   OP4Z compose path to pin the fix.
 *
 *   The .env.example fixture deliberately includes both ordinary and
 *   sensitive keys so the redaction contract is verified end-to-end.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeTmpDir, runCli } from "./helpers.js";

/**
 * Where to find an OP4Z-shaped real compose file for the multi-service test.
 *
 * v0.5 swapped `yaml-mini.ts` for the eemeli `yaml` library, which means
 * `command: >` block scalars no longer truncate the service list. The brief
 * asked for a second test using OP4Z's real compose; we copy that file into
 * the tmp dir so the test never mutates the source.
 *
 * If the OP4Z repo isn't present on this machine (CI box without a clone),
 * the test self-skips via `it.skipIf` so substrate stays portable. The check
 * lives at module top so vitest's collection phase sees it.
 */
const OP4Z_COMPOSE_PATH =
  process.env.OP4Z_COMPOSE_PATH ??
  "/home/beaug/dev/TheNexusProject/docker-compose.yml";
const OP4Z_COMPOSE_AVAILABLE = existsSync(OP4Z_COMPOSE_PATH);

// Compose fixture: 3 services, shapes the v0.3 mini-parser handles.
// (No `command: >` block scalars — see note above for why.)
const COMPOSE_FIXTURE = `services:
  api:
    image: node:20
    ports:
      - "8000:8000"
    depends_on:
      - db
    volumes:
      - ./apps/api:/app
  db:
    image: postgres:15
    ports:
      - "5432:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
  cache:
    image: redis:7
    ports:
      - "6379:6379"
`;

// Env fixture: mixes a public app-name key with two sensitive keys
// that must be redacted (KEY / TOKEN substring match).
const ENV_FIXTURE = `APP_NAME=int-knowledge
DATABASE_URL=postgresql://user:pass@localhost/db
SECRET_KEY=super-secret-value
API_TOKEN=super-secret-token
DEBUG=true
`;

describe("substrate knowledge (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    const init = runCli(
      ["init", "--name", "knowledge-int", "--short-code", "KN", "--quiet"],
      { cwd: tmp },
    );
    if (init.status !== 0) {
      throw new Error(
        `Test setup failed: substrate init returned ${init.status}\n${init.stderr}`,
      );
    }
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it("smoke 8: knowledge refresh parses docker-compose + .env.example with redaction", () => {
    writeFileSync(join(tmp, "docker-compose.yml"), COMPOSE_FIXTURE);
    writeFileSync(join(tmp, ".env.example"), ENV_FIXTURE);

    const result = runCli(["knowledge", "refresh"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // The generated doc exists and identifies its sources.
    const outputPath = join(tmp, "auto", "docs", "KNOWLEDGE.md");
    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf8");

    // Service-level assertions: every fixture service must round-trip.
    expect(content).toContain("`api`");
    expect(content).toContain("`db`");
    expect(content).toContain("`cache`");
    expect(content).toContain("node:20");
    expect(content).toContain("postgres:15");
    expect(content).toContain("redis:7");

    // Volume mounts must be surfaced.
    expect(content).toContain("./apps/api:/app");
    expect(content).toContain("db-data:/var/lib/postgresql/data");

    // Redaction contract: SECRET_KEY and API_TOKEN match the default
    // redact patterns (KEY, TOKEN) and must be masked. The literal
    // sensitive values must NOT appear anywhere in the output.
    expect(content).toContain("`SECRET_KEY`");
    expect(content).toContain("`API_TOKEN`");
    expect(content).toContain("***REDACTED***");
    expect(content).not.toContain("super-secret-value");
    expect(content).not.toContain("super-secret-token");

    // Non-sensitive values should still appear with real values.
    expect(content).toContain("`APP_NAME`");
    expect(content).toContain("int-knowledge");
  });

  it("smoke 8: knowledge refresh writes the doc even when no sources are present", () => {
    // Empty repo (just init, no docker-compose, no .env.example). The
    // refresh should still succeed and produce a placeholder doc — this
    // is what the smoke report saw on an empty tmp dir.
    const result = runCli(["knowledge", "refresh"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const outputPath = join(tmp, "auto", "docs", "KNOWLEDGE.md");
    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf8");
    expect(content).toContain("# KNOWLEDGE.md");
    expect(content).toContain("_No services discovered._");
  });

  it("smoke 9: knowledge show prints the generated doc", () => {
    writeFileSync(join(tmp, "docker-compose.yml"), COMPOSE_FIXTURE);
    writeFileSync(join(tmp, ".env.example"), ENV_FIXTURE);
    runCli(["knowledge", "refresh"], { cwd: tmp });

    const result = runCli(["knowledge", "show"], { cwd: tmp });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // The full doc must be on stdout (not stderr). Sections present.
    expect(result.stdout).toContain("# KNOWLEDGE.md");
    expect(result.stdout).toContain("## Services");
    expect(result.stdout).toContain("## Environment variables");
    expect(result.stdout).toContain("`api`");
  });

  it("smoke 9: knowledge show --section filters to one heading", () => {
    writeFileSync(join(tmp, "docker-compose.yml"), COMPOSE_FIXTURE);
    writeFileSync(join(tmp, ".env.example"), ENV_FIXTURE);
    runCli(["knowledge", "refresh"], { cwd: tmp });

    const result = runCli(["knowledge", "show", "--section", "Services"], {
      cwd: tmp,
    });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // Services section content present.
    expect(result.stdout).toContain("## Services");
    expect(result.stdout).toContain("`api`");
    // Other top-level sections must NOT appear — that's the whole
    // point of --section. Filtering matters most for AI tools that
    // can't afford to load the full doc when they only need one part.
    expect(result.stdout).not.toContain("## Environment variables");
  });

  // v0.5 — real OP4Z compose. Pins the yaml-library swap by asserting
  // that the parser handles `command: >` block scalars, anchors, and the
  // full ~59-service spread that the prior mini-parser truncated to 1.
  //
  // Test is gated on the OP4Z compose file actually being present (it
  // lives outside the substrate repo). On a CI box without the OP4Z clone,
  // the test self-skips rather than fails.
  it.skipIf(!OP4Z_COMPOSE_AVAILABLE)(
    "v0.5: knowledge refresh extracts all services from OP4Z's real docker-compose.yml",
    () => {
      // Copy the real compose into the tmp repo. Never mutate the source.
      copyFileSync(OP4Z_COMPOSE_PATH, join(tmp, "docker-compose.yml"));

      const result = runCli(["knowledge", "refresh"], { cwd: tmp });
      expect(result.status, `stderr: ${result.stderr}`).toBe(0);

      const outputPath = join(tmp, "auto", "docs", "KNOWLEDGE.md");
      expect(existsSync(outputPath)).toBe(true);
      const content = readFileSync(outputPath, "utf8");

      // OP4Z has ~59 top-level services. The prior mini-parser stopped at
      // the first `command: >` and returned 1; the eemeli `yaml` library
      // returns the full set. We assert a generous floor (≥40) rather than
      // pinning the exact count — OP4Z's compose grows and shrinks as the
      // platform evolves, and the test should age well across those edits.
      //
      // Count occurrences of "| `<name>` |" rows in the services table.
      const serviceRows = (content.match(/\n\| `[a-z][a-z0-9_-]*` \|/g) ?? []).length;
      expect(serviceRows).toBeGreaterThanOrEqual(40);

      // Spot-check a handful of well-known OP4Z service names so a
      // regression that drops them (e.g. parser bails on a specific
      // shape) fails loudly.
      const SPOT_CHECK_SERVICES = [
        "authentication-service",
        "task-management-service",
        "gateway",
      ];
      for (const svc of SPOT_CHECK_SERVICES) {
        expect(content, `expected service "${svc}" in KNOWLEDGE.md`).toContain(`\`${svc}\``);
      }
    },
  );
});
