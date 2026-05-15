/**
 * Unit tests for the v0.5 line-diff helper.
 *
 * The diff format is human-facing (it lives in `cadence upgrade`'s drift
 * report), so these tests assert on the unified-diff shape rather than
 * exact byte-for-byte output. The `git diff --unified=3` mental model
 * applies.
 */

import { describe, expect, it } from "vitest";
import { diffLines, formatUnifiedDiff } from "../src/util/diff.js";

describe("diffLines", () => {
  it("returns identical for character-equal inputs", () => {
    const a = "alpha\nbeta\ngamma";
    const result = diffLines(a, a);
    expect(result.identical).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it("flags a single inserted line as one hunk", () => {
    const a = "alpha\nbeta\ngamma";
    const b = "alpha\nbeta\nDELTA\ngamma";
    const result = diffLines(a, b);
    expect(result.identical).toBe(false);
    expect(result.hunks.length).toBeGreaterThan(0);
    const formatted = formatUnifiedDiff(result);
    expect(formatted).toContain("+DELTA");
    expect(formatted).toContain("@@");
  });

  it("flags a single deleted line", () => {
    const a = "alpha\nbeta\ngamma";
    const b = "alpha\ngamma";
    const result = diffLines(a, b);
    expect(result.identical).toBe(false);
    const formatted = formatUnifiedDiff(result);
    expect(formatted).toContain("-beta");
  });

  it("flags a replacement as remove + add", () => {
    const a = "alpha\nbeta\ngamma";
    const b = "alpha\nBETA\ngamma";
    const result = diffLines(a, b);
    const formatted = formatUnifiedDiff(result);
    expect(formatted).toContain("-beta");
    expect(formatted).toContain("+BETA");
  });

  it("includes leading context lines in the hunk", () => {
    // Lines 1-5 unchanged, line 6 replaced. The diff should show
    // context BEFORE the change too.
    const a = ["one", "two", "three", "four", "five", "six"].join("\n");
    const b = ["one", "two", "three", "four", "five", "SIX"].join("\n");
    const result = diffLines(a, b);
    const formatted = formatUnifiedDiff(result);
    // Context lines start with a space.
    expect(formatted).toMatch(/ three/);
    expect(formatted).toContain("-six");
    expect(formatted).toContain("+SIX");
  });

  it("handles entire-file replacement", () => {
    const a = "old line 1\nold line 2";
    const b = "new line 1\nnew line 2";
    const result = diffLines(a, b);
    expect(result.identical).toBe(false);
    const formatted = formatUnifiedDiff(result);
    expect(formatted).toContain("-old line 1");
    expect(formatted).toContain("+new line 1");
  });

  it("handles empty-to-content transition", () => {
    const result = diffLines("", "added line");
    expect(result.identical).toBe(false);
    const formatted = formatUnifiedDiff(result);
    expect(formatted).toContain("+added line");
  });

  it("formats an identical result as the empty string", () => {
    const result = diffLines("same\nsame", "same\nsame");
    expect(formatUnifiedDiff(result)).toBe("");
  });
});
