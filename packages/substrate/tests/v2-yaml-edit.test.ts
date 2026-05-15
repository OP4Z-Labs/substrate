/**
 * Tests for the comment-preserving YAML edit helpers (Phase B3).
 *
 * These tests are the load-bearing piece for the applicators: if the
 * helpers vandalise user comments or indentation, every applicator
 * that writes back to user YAML inherits the bug. The fixtures
 * deliberately include leading + inline comments, varied indent, and
 * empty-list edge cases.
 */

import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  YamlEditError,
  appendListItem,
  appendToMapKey,
  insertListItemAfter,
} from "../src/v2/deterministic/yaml-edit.js";

describe("appendListItem", () => {
  it("preserves leading + inline comments on existing entries", () => {
    const yaml = `# Top of file comment.
id: tackle-task
steps:
  # comment before first step
  - id: research        # inline comment
    type: prompt
  - id: implement
    type: prompt
`;
    const result = appendListItem(yaml, "steps", {
      id: "verify-changelog",
      type: "prompt",
      prompt: "verify CHANGELOG.md",
    });
    expect(result).toContain("# Top of file comment.");
    expect(result).toContain("# comment before first step");
    expect(result).toContain("inline comment");
    expect(result).toContain("verify-changelog");
    const parsed = parse(result) as { steps: Array<{ id: string }> };
    expect(parsed.steps.map((s) => s.id)).toEqual([
      "research",
      "implement",
      "verify-changelog",
    ]);
  });

  it("uses the first existing entry's indent for the new entry", () => {
    const yaml = `id: x
steps:
    - id: a
      type: prompt
`;
    const out = appendListItem(yaml, "steps", { id: "b", type: "prompt" });
    expect(out).toContain("    - id: b");
  });

  it("handles inline `steps: []`", () => {
    const yaml = `id: x
steps: []
`;
    const out = appendListItem(yaml, "steps", { id: "a", type: "prompt" });
    expect(out).not.toMatch(/\[\s*\]/);
    const parsed = parse(out) as { steps: Array<{ id: string }> };
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0].id).toBe("a");
  });

  it("throws YamlEditError when the list key is absent", () => {
    expect(() =>
      appendListItem(`id: x\nname: foo`, "steps", { id: "a", type: "prompt" }),
    ).toThrowError(YamlEditError);
  });

  it("inserts at the end of the list, not the file (preserves trailing keys)", () => {
    const yaml = `id: x
steps:
  - id: a
    type: prompt
acceptance:
  exit_codes:
    pass: 0
`;
    const out = appendListItem(yaml, "steps", { id: "b", type: "prompt" });
    const parsed = parse(out) as { steps: Array<{ id: string }>; acceptance: unknown };
    expect(parsed.steps.map((s) => s.id)).toEqual(["a", "b"]);
    expect(parsed.acceptance).toBeDefined();
  });
});

describe("insertListItemAfter", () => {
  it("inserts after the anchor entry by id", () => {
    const yaml = `id: tackle
steps:
  - id: research
    type: prompt
  - id: implement
    type: prompt
  - id: tests
    type: prompt
`;
    const out = insertListItemAfter(yaml, "steps", "implement", {
      id: "verify",
      type: "prompt",
    });
    const parsed = parse(out) as { steps: Array<{ id: string }> };
    expect(parsed.steps.map((s) => s.id)).toEqual([
      "research",
      "implement",
      "verify",
      "tests",
    ]);
  });

  it("falls back to append when the anchor is missing", () => {
    const yaml = `id: t
steps:
  - id: research
    type: prompt
`;
    const out = insertListItemAfter(yaml, "steps", "no-such-step", {
      id: "z",
      type: "prompt",
    });
    const parsed = parse(out) as { steps: Array<{ id: string }> };
    expect(parsed.steps.map((s) => s.id)).toEqual(["research", "z"]);
  });

  it("preserves user comments between entries", () => {
    const yaml = `id: t
steps:
  - id: research
    type: prompt
  # ad-hoc: was added on 2026-05-12 — keep an eye on this
  - id: implement
    type: prompt
`;
    const out = insertListItemAfter(yaml, "steps", "implement", {
      id: "verify",
      type: "prompt",
    });
    expect(out).toContain(
      "# ad-hoc: was added on 2026-05-12 — keep an eye on this",
    );
  });
});

describe("appendToMapKey", () => {
  it("appends to a nested list (context.standards)", () => {
    const yaml = `id: t
context:
  standards:
    - backend/architecture.md
  rules:
    - BE-PY-*
`;
    const out = appendToMapKey(yaml, "context.standards", "backend/python.md");
    const parsed = parse(out) as {
      context: { standards: string[]; rules: string[] };
    };
    expect(parsed.context.standards).toEqual([
      "backend/architecture.md",
      "backend/python.md",
    ]);
    expect(parsed.context.rules).toEqual(["BE-PY-*"]);
  });

  it("expands an inline `[]` form to block style", () => {
    const yaml = `id: t
context:
  standards: []
`;
    const out = appendToMapKey(yaml, "context.standards", "x.md");
    const parsed = parse(out) as {
      context: { standards: string[] };
    };
    expect(parsed.context.standards).toEqual(["x.md"]);
  });

  it("throws when the path is missing", () => {
    expect(() =>
      appendToMapKey(`id: t\ncontext:\n  rules: []`, "context.standards", "x"),
    ).toThrowError(YamlEditError);
  });

  it("preserves comments in surrounding YAML", () => {
    const yaml = `id: t
# Pinned at task-tackle for now.
context:
  # standards loaded for this workflow
  standards:
    - foo.md
`;
    const out = appendToMapKey(yaml, "context.standards", "bar.md");
    expect(out).toContain("# Pinned at task-tackle for now.");
    expect(out).toContain("# standards loaded for this workflow");
  });
});
