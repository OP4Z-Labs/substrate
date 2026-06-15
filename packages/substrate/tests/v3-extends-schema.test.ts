/**
 * Sub-phase A — schema additions for the v3 `extends` field.
 *
 * Coverage targets per the brief + plan §2.1:
 *  - existing v2.0 configs (no `extends` field) continue to validate
 *  - `extends: []` (empty array) is accepted
 *  - all three source forms (`npm:`, `github:`, `file:`) validate
 *  - malformed source URLs are rejected with a pattern error
 *  - `version` / `ref` are forward-compatible string fields
 *  - top-level `extends` must be an array (not a string / object)
 *  - extra (unknown) properties on an extends entry are rejected
 *    (we use `additionalProperties: false` on entries to catch typos)
 *  - the source-classifier + per-entry warning surface behave as documented
 */

import { describe, expect, it } from "vitest";
import {
  classifyExtendsSource,
  validateConfig,
  validateExtendsSource,
} from "../src/v2/extends/config-validator.js";

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: "https://op4z.dev/substrate/schemas/config.schema.json",
    version: "v3.0",
    project: { name: "test-project" },
    stacks: ["typescript"],
    paths: { auto: "auto" },
    defaults: { audits: [], standards: [], scaffolds: [], workflows: [] },
    bridges: {},
    telemetry: { enabled: false },
    ...overrides,
  };
}

describe("config schema — backward compat with v2.0 configs", () => {
  it("accepts a config with no extends field (the v2.0 baseline shape)", () => {
    const result = validateConfig(baseConfig());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a config with extends: [] (opt-in but empty)", () => {
    const result = validateConfig(baseConfig({ extends: [] }));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("config schema — extends source forms", () => {
  it("accepts an npm: source", () => {
    const result = validateConfig(
      baseConfig({
        extends: [{ source: "npm:@acme/substrate-shared", version: "^2.0.0" }],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts an npm: source without a version (resolves whatever's installed)", () => {
    const result = validateConfig(
      baseConfig({ extends: [{ source: "npm:@acme/substrate-shared" }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a github: source with a ref (tag/branch/SHA all string-shaped)", () => {
    const refs = ["v2.4.1", "main", "a1b2c3d4e5f6", "release/2026-06"];
    for (const ref of refs) {
      const result = validateConfig(
        baseConfig({
          extends: [{ source: "github:acme-corp/substrate-shared", ref }],
        }),
      );
      expect(result.ok, `ref ${ref} should validate`).toBe(true);
    }
  });

  it("accepts a github: source without a ref (resolver picks default branch)", () => {
    const result = validateConfig(
      baseConfig({
        extends: [{ source: "github:acme-corp/substrate-shared" }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a file: source with a relative path", () => {
    const result = validateConfig(
      baseConfig({ extends: [{ source: "file:../substrate-shared" }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a file: source with a nested path", () => {
    const result = validateConfig(
      baseConfig({ extends: [{ source: "file:./local/substrate-content" }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts multiple extends entries in order (base → overlays → repo-local)", () => {
    const result = validateConfig(
      baseConfig({
        extends: [
          { source: "npm:@acme/substrate-shared", version: "^2.0.0" },
          { source: "github:acme-corp/substrate-payments", ref: "v1.2.0" },
          { source: "file:../substrate-local-overrides" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("config schema — malformed extends entries are rejected", () => {
  it("rejects a source string with no kind prefix", () => {
    const result = validateConfig(
      baseConfig({ extends: [{ source: "@acme/substrate-shared" }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "pattern")).toBe(true);
  });

  it("rejects a source string with an unknown kind prefix", () => {
    const result = validateConfig(
      baseConfig({ extends: [{ source: "git:acme/repo" }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "pattern")).toBe(true);
  });

  it("rejects a github: source missing the org/repo segment", () => {
    const result = validateConfig(
      baseConfig({ extends: [{ source: "github:acme-corp" }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "pattern")).toBe(true);
  });

  it("rejects an empty source string", () => {
    const result = validateConfig(
      baseConfig({ extends: [{ source: "" }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an entry with no source field", () => {
    const result = validateConfig(
      baseConfig({ extends: [{ version: "^2.0.0" }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "required")).toBe(true);
  });

  it("rejects an entry with unknown extra properties (typo catcher)", () => {
    const result = validateConfig(
      baseConfig({
        extends: [
          {
            source: "npm:@acme/substrate-shared",
            verison: "^2.0.0", // typo
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.keyword === "additionalProperties"),
    ).toBe(true);
  });

  it("rejects extends as a non-array (string instead of array)", () => {
    const result = validateConfig(
      baseConfig({ extends: "npm:@acme/substrate-shared" }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "type")).toBe(true);
  });

  it("rejects extends as a non-array (object instead of array)", () => {
    const result = validateConfig(
      baseConfig({ extends: { source: "npm:foo" } }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("classifyExtendsSource", () => {
  it("classifies the three known kinds", () => {
    expect(classifyExtendsSource("npm:@acme/x")).toBe("npm");
    expect(classifyExtendsSource("github:acme/x")).toBe("github");
    expect(classifyExtendsSource("file:./x")).toBe("file");
  });

  it("returns null for unknown kinds (resolver treats as hard error)", () => {
    expect(classifyExtendsSource("git:acme/x")).toBeNull();
    expect(classifyExtendsSource("https://example.com/x")).toBeNull();
    expect(classifyExtendsSource("@acme/x")).toBeNull();
    expect(classifyExtendsSource("")).toBeNull();
  });
});

describe("validateExtendsSource — per-entry warnings", () => {
  it("does not warn when version is paired with an npm: source", () => {
    const result = validateExtendsSource({
      source: "npm:@acme/shared",
      version: "^2.0.0",
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("npm");
    expect(result.warnings).toEqual([]);
  });

  it("warns when version is paired with a non-npm source", () => {
    const result = validateExtendsSource({
      source: "github:acme/shared",
      version: "^2.0.0",
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("github");
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/version/);
  });

  it("warns when ref is paired with a non-github source", () => {
    const result = validateExtendsSource({
      source: "npm:@acme/shared",
      ref: "main",
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("npm");
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/ref/);
  });

  it("returns kind=null for an unknown source URL", () => {
    const result = validateExtendsSource({ source: "git:acme/x" });
    expect(result.ok).toBe(false);
    expect(result.kind).toBeNull();
  });
});
