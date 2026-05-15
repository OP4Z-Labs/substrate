/**
 * Tests for plural knowledge sources (Phase B4, Primitive 11):
 *   - manifest loading from substrate/knowledge-sources.yaml
 *   - built-in plugins: docker-compose / kubernetes / env-registry
 *   - glob expansion (single + `**` recursion)
 *   - custom plugin registration
 *   - knowledge refresh: v2 manifest takes precedence over v1 config sources
 *   - knowledge refresh: v1 fallback when no manifest exists
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _clearRegistryForTests,
  discoverKnowledge,
  listRegisteredKinds,
  loadKnowledgeSourcesManifest,
  registerKnowledgePlugin,
  type KnowledgeBlock,
} from "../src/v2/knowledge/sources.js";
import { runKnowledgeRefresh } from "../src/commands/knowledge.js";
import { runInit } from "../src/commands/init.js";

let tmpRoot: string;
let previousCwd: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "substrate-knowledge-sources-"));
  previousCwd = process.cwd();
  process.chdir(tmpRoot);
  runInit({ projectName: "kn-test", shortCode: "KN", quiet: true });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  _clearRegistryForTests();
});

afterEach(() => {
  logSpy.mockRestore();
  _clearRegistryForTests();
  process.chdir(previousCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  process.exitCode = 0;
});

function writeFile(relPath: string, content: string): void {
  const parts = relPath.split("/");
  parts.pop();
  if (parts.length > 0) mkdirSync(join(tmpRoot, ...parts), { recursive: true });
  writeFileSync(join(tmpRoot, relPath), content, "utf8");
}

describe("loadKnowledgeSourcesManifest", () => {
  it("returns null when no manifest exists", () => {
    const result = loadKnowledgeSourcesManifest({ cwd: tmpRoot });
    expect(result.manifest).toBeNull();
    expect(result.manifestPath).toBeNull();
  });

  it("parses a simple manifest with one source", () => {
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:\n  - kind: docker-compose\n    path: ./docker-compose.yml\n`,
    );
    const result = loadKnowledgeSourcesManifest({ cwd: tmpRoot });
    expect(result.manifest?.sources).toHaveLength(1);
    expect(result.manifest?.sources[0]?.kind).toBe("docker-compose");
    expect(result.manifest?.sources[0]?.path).toBe("./docker-compose.yml");
  });

  it("warns on entries missing kind, path, or paths", () => {
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:
  - path: ./compose.yml
  - kind: kubernetes
  - kind: env-registry
    paths: [".env.production.template"]
`,
    );
    const result = loadKnowledgeSourcesManifest({ cwd: tmpRoot });
    // Only the last entry survives (missing kind, missing paths get warned out).
    expect(result.manifest?.sources).toHaveLength(1);
    expect(result.manifest?.sources[0]?.kind).toBe("env-registry");
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("emits a warning when the manifest YAML is malformed", () => {
    writeFile("substrate/knowledge-sources.yaml", "::: not yaml [");
    const result = loadKnowledgeSourcesManifest({ cwd: tmpRoot });
    expect(result.manifest).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("discoverKnowledge — built-in plugins", () => {
  it("docker-compose: extracts services + ports + volumes", () => {
    writeFile(
      "docker-compose.yml",
      `services:
  api:
    image: ghcr.io/example/api:latest
    ports:
      - "8080:80"
    depends_on:
      - db
    volumes:
      - data:/var/data
  db:
    image: postgres:16
`,
    );
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:\n  - kind: docker-compose\n    path: ./docker-compose.yml\n`,
    );
    const result = discoverKnowledge({ cwd: tmpRoot });
    expect(result.blocks).toHaveLength(2);
    const api = result.blocks.find((b) => b.payload.name === "api");
    expect(api?.payload.image).toBe("ghcr.io/example/api:latest");
    expect(api?.payload.ports).toEqual(["8080:80"]);
    expect(api?.payload.dependsOn).toEqual(["db"]);
  });

  it("kubernetes: extracts Service + Deployment + Secret blocks across docs", () => {
    writeFile(
      "k8s/api.yaml",
      `apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: production
spec:
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: production
spec:
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/example/api:1.2.3
---
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
  namespace: production
data:
  DB_PASSWORD: cGFzc3dvcmQ=
  STRIPE_KEY: c2tfdGVzdA==
`,
    );
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:\n  - kind: kubernetes\n    paths: ["k8s/*.yaml"]\n`,
    );
    const result = discoverKnowledge({ cwd: tmpRoot });
    expect(result.blocks).toHaveLength(3);
    const svc = result.blocks.find((b) => b.payload.kind === "Service");
    expect(svc?.payload.name).toBe("api");
    expect(svc?.payload.ports).toEqual(["80:8080"]);
    const dep = result.blocks.find((b) => b.payload.kind === "Deployment");
    expect(dep?.payload.images).toEqual(["ghcr.io/example/api:1.2.3"]);
    const sec = result.blocks.find((b) => b.payload.kind === "Secret");
    expect(sec?.payload.keys).toEqual(["DB_PASSWORD", "STRIPE_KEY"]);
    // Critically: no values leak through.
    expect(JSON.stringify(sec)).not.toContain("cGFzc3dvcmQ");
  });

  it("env-registry: emits one block per key, values always redacted", () => {
    writeFile(
      ".env.production.template",
      `# Header comment

DATABASE_URL=<set-in-vault>
STRIPE_API_KEY=<set-in-vault>
LOG_LEVEL=info
`,
    );
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:\n  - kind: env-registry\n    paths: [".env.production.template"]\n`,
    );
    const result = discoverKnowledge({ cwd: tmpRoot });
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks.every((b) => b.payload.redacted === true)).toBe(true);
    const keys = result.blocks.map((b) => b.payload.key).sort();
    expect(keys).toEqual(["DATABASE_URL", "LOG_LEVEL", "STRIPE_API_KEY"]);
  });
});

describe("discoverKnowledge — glob expansion", () => {
  it("expands `**/*` recursion across nested directories", () => {
    writeFile(
      "k8s/api/service.yaml",
      `apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  ports:
    - port: 80
`,
    );
    writeFile(
      "k8s/worker/deployment.yaml",
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
spec:
  template:
    spec:
      containers:
        - name: worker
          image: example/worker:1.0
`,
    );
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:\n  - kind: kubernetes\n    paths: ["k8s/**/*.yaml"]\n`,
    );
    const result = discoverKnowledge({ cwd: tmpRoot });
    expect(result.blocks).toHaveLength(2);
    expect(result.sourcesUsed.length).toBe(2);
  });

  it("non-matching glob produces no blocks but does not crash", () => {
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:\n  - kind: kubernetes\n    paths: ["does-not-exist/**/*.yaml"]\n`,
    );
    const result = discoverKnowledge({ cwd: tmpRoot });
    expect(result.blocks).toHaveLength(0);
    expect(result.kindsWithoutResults).toContain("kubernetes");
  });
});

describe("discoverKnowledge — registry + warnings", () => {
  it("surfaces unknown kinds in `unknownKinds` and warnings", () => {
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:\n  - kind: my-custom-source\n    path: ./foo.txt\n`,
    );
    const result = discoverKnowledge({ cwd: tmpRoot });
    expect(result.unknownKinds).toEqual(["my-custom-source"]);
    expect(result.warnings.some((w) => w.includes("my-custom-source"))).toBe(true);
  });

  it("custom plugin registration enables a new kind", () => {
    writeFile("custom.txt", "hello world");
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:\n  - kind: text-counter\n    path: ./custom.txt\n`,
    );
    registerKnowledgePlugin("text-counter", (absolutePath, repoRoot) => {
      const content = readFileSync(absolutePath, "utf8");
      const block: KnowledgeBlock = {
        sourceKind: "text-counter",
        sourcePath: absolutePath.replace(repoRoot + "/", ""),
        category: "custom",
        payload: { length: content.length },
      };
      return [block];
    });
    expect(listRegisteredKinds()).toContain("text-counter");
    const result = discoverKnowledge({ cwd: tmpRoot });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.payload.length).toBe(11);
  });
});

describe("runKnowledgeRefresh — v2 manifest path", () => {
  it("uses the v2 manifest when present and renders kubernetes section", () => {
    writeFile(
      "docker-compose.yml",
      `services:\n  api:\n    image: foo\n`,
    );
    writeFile(
      "k8s/api.yaml",
      `apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  ports:
    - port: 80
`,
    );
    writeFile(
      ".env.production.template",
      `DATABASE_URL=<set-in-vault>\n`,
    );
    writeFile(
      "substrate/knowledge-sources.yaml",
      `sources:
  - kind: docker-compose
    path: ./docker-compose.yml
  - kind: kubernetes
    paths: ["k8s/*.yaml"]
  - kind: env-registry
    paths: [".env.production.template"]
`,
    );
    const result = runKnowledgeRefresh({ cwd: tmpRoot, quiet: true });
    expect(result.sourcesUsed.length).toBe(3);
    expect(result.serviceCount).toBe(1);
    expect(result.envVarCount).toBe(1);
    const written = readFileSync(join(tmpRoot, "auto/docs/KNOWLEDGE.md"), "utf8");
    expect(written).toContain("## Kubernetes resources");
    expect(written).toContain("`api`");
    expect(written).toContain("DATABASE_URL");
    // Never leak placeholder values.
    expect(written).toContain("`***REDACTED***`");
  });

  it("falls back to v1 config-driven sources when no manifest exists", () => {
    // Default v1 substrate.config.json declared "docker-compose.yml" and
    // ".env.example" — write those + verify the rendered output still
    // looks like v1 (no kubernetes section).
    writeFile(
      "docker-compose.yml",
      `services:\n  api:\n    image: foo\n`,
    );
    writeFile(".env.example", "DATABASE_URL=postgres://localhost/test\n");
    const result = runKnowledgeRefresh({ cwd: tmpRoot, quiet: true });
    expect(result.serviceCount).toBe(1);
    expect(result.envVarCount).toBe(1);
    const written = readFileSync(join(tmpRoot, "auto/docs/KNOWLEDGE.md"), "utf8");
    expect(written).not.toContain("## Kubernetes resources");
    // v1 path: no Discovery summary footer (that's v2-only).
    expect(written).not.toContain("### Discovery summary");
  });
});
