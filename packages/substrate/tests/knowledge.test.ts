import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runKnowledgeRefresh, runKnowledgeShow } from "../src/commands/knowledge.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const PROJECT_NAME = "knowledge-test";

const SAMPLE_COMPOSE = `version: "3.8"
services:
  web:
    image: node:20
    ports:
      - "3000:3000"
    depends_on:
      - db
    volumes:
      - ./app:/app
  db:
    image: postgres:15
    ports:
      - "5432:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
`;

const SAMPLE_ENV = `APP_NAME=knowledge-test
DATABASE_URL=postgresql://user:pass@localhost/db
SECRET_KEY=replace-me
API_TOKEN=replace-me
DEBUG=true
`;

describe("runKnowledgeRefresh", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    process.chdir(tmp);
    runInit({ projectName: PROJECT_NAME, shortCode: "KT", quiet: true });
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("writes KNOWLEDGE.md when no sources are present", () => {
    const result = runKnowledgeRefresh({ quiet: true });
    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.serviceCount).toBe(0);
    expect(result.envVarCount).toBe(0);
    const content = readFileSync(result.outputPath, "utf8");
    expect(content).toContain("# KNOWLEDGE.md");
    expect(content).toContain("_No services discovered._");
  });

  it("parses services from docker-compose.yml", () => {
    writeFileSync(join(tmp, "docker-compose.yml"), SAMPLE_COMPOSE);
    const result = runKnowledgeRefresh({ quiet: true });
    expect(result.serviceCount).toBe(2);
    expect(result.sourcesUsed).toContain("docker-compose.yml");
    const content = readFileSync(result.outputPath, "utf8");
    expect(content).toContain("`web`");
    expect(content).toContain("`db`");
    expect(content).toContain("node:20");
    expect(content).toContain("postgres:15");
  });

  it("redacts env-var values matching the redact patterns", () => {
    writeFileSync(join(tmp, ".env.example"), SAMPLE_ENV);
    const result = runKnowledgeRefresh({ quiet: true });
    expect(result.envVarCount).toBe(5);
    const content = readFileSync(result.outputPath, "utf8");
    expect(content).toContain("`APP_NAME`");
    expect(content).toContain("`knowledge-test`");
    // SECRET_KEY and API_TOKEN must be redacted
    expect(content).toContain("`SECRET_KEY`");
    expect(content).toContain("`API_TOKEN`");
    expect(content).toContain("***REDACTED***");
    expect(content).not.toContain("replace-me");
  });

  it("captures volume mounts in the report", () => {
    writeFileSync(join(tmp, "docker-compose.yml"), SAMPLE_COMPOSE);
    runKnowledgeRefresh({ quiet: true });
    const content = readFileSync(join(tmp, "auto", "docs", "KNOWLEDGE.md"), "utf8");
    expect(content).toContain("./app:/app");
    expect(content).toContain("db-data:/var/lib/postgresql/data");
  });

  it("regenerates the doc each refresh (idempotent)", () => {
    writeFileSync(join(tmp, "docker-compose.yml"), SAMPLE_COMPOSE);
    runKnowledgeRefresh({ quiet: true });
    const first = readFileSync(join(tmp, "auto", "docs", "KNOWLEDGE.md"), "utf8");
    runKnowledgeRefresh({ quiet: true });
    const second = readFileSync(join(tmp, "auto", "docs", "KNOWLEDGE.md"), "utf8");
    expect(second).toBe(first);
  });
});

describe("runKnowledgeShow", () => {
  let tmp: string;
  // Silence stdout writes so the test runner output stays clean.
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempDir();
    process.chdir(tmp);
    runInit({ projectName: PROJECT_NAME, shortCode: "KT", quiet: true });
    writeFileSync(join(tmp, "docker-compose.yml"), SAMPLE_COMPOSE);
    writeFileSync(join(tmp, ".env.example"), SAMPLE_ENV);
    runKnowledgeRefresh({ quiet: true });
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    removeTempDir(tmp);
  });

  it("returns the full KNOWLEDGE.md when no section is requested", () => {
    const out = runKnowledgeShow();
    expect(out).toContain("# KNOWLEDGE.md");
    expect(out).toContain("## Services");
    expect(out).toContain("## Environment variables");
  });

  it("returns only the requested section", () => {
    const out = runKnowledgeShow({ section: "Services" });
    expect(out).toContain("## Services");
    expect(out).toContain("`web`");
    expect(out).not.toContain("## Environment variables");
  });

  it("throws when the requested section is missing", () => {
    expect(() => runKnowledgeShow({ section: "Bogus" })).toThrow(/not found/);
  });

  it("throws when KNOWLEDGE.md hasn't been generated", () => {
    const fresh = makeTempDir();
    try {
      process.chdir(fresh);
      expect(() => runKnowledgeShow()).toThrow(/Run `substrate knowledge refresh`/);
    } finally {
      removeTempDir(fresh);
    }
  });
});
