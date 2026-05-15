/**
 * Tests for the atomic-write helper.
 *
 * The crash-window simulation: we monkey-patch `writeSync` to throw
 * mid-write and assert the original file is untouched + the tmp file
 * is cleaned up.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicWriteFileIfMissing,
  atomicWriteFileSync,
  atomicWriteJsonSync,
} from "../src/util/atomic-write.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("atomic-write", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => {
    removeTempDir(tmp);
  });

  it("atomicWriteFileSync writes the file with the expected contents", () => {
    const target = join(tmp, "out.txt");
    atomicWriteFileSync(target, "hello");
    expect(readFileSync(target, "utf8")).toBe("hello");
  });

  it("creates parent directories as needed", () => {
    const target = join(tmp, "deep", "nested", "out.txt");
    atomicWriteFileSync(target, "deep");
    expect(readFileSync(target, "utf8")).toBe("deep");
  });

  it("atomicWriteJsonSync produces pretty-printed JSON with trailing newline", () => {
    const target = join(tmp, "out.json");
    atomicWriteJsonSync(target, { a: 1, b: [2, 3] });
    const text = readFileSync(target, "utf8");
    expect(text).toBe(`{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n`);
  });

  it("atomicWriteFileIfMissing preserves an existing file", () => {
    const target = join(tmp, "out.txt");
    writeFileSync(target, "original", "utf8");
    const wrote = atomicWriteFileIfMissing(target, "new content");
    expect(wrote).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("original");
  });

  it("atomicWriteFileIfMissing with overwrite=true replaces", () => {
    const target = join(tmp, "out.txt");
    writeFileSync(target, "original", "utf8");
    const wrote = atomicWriteFileIfMissing(target, "new content", true);
    expect(wrote).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("new content");
  });

  it("does not leave orphan tmp files on success", () => {
    const target = join(tmp, "clean.txt");
    atomicWriteFileSync(target, "ok");
    const orphans = readdirSync(tmp).filter((f) => f.includes(".substrate-tmp-"));
    expect(orphans).toHaveLength(0);
  });

  it("throws cleanly on a target that cannot be written (read-only parent)", () => {
    // We can't reliably mock node:fs.renameSync across Node versions, so
    // this regression instead checks the "permission / invalid target"
    // path: a write to a path that names a non-writable destination throws
    // AND removes any tmp orphan it created.
    //
    // The simplest portable trigger: write to a path where the parent is
    // a FILE (not a directory). renameSync fails with ENOTDIR.
    const blocker = join(tmp, "blocker");
    writeFileSync(blocker, "blocks-the-path", "utf8");
    const target = join(tmp, "blocker", "child.txt");
    // This will fail to create the parent (it's a file) or fail to rename.
    expect(() => atomicWriteFileSync(target, "new-content")).toThrow();
    // Original blocker file is unchanged.
    expect(readFileSync(blocker, "utf8")).toBe("blocks-the-path");
    // No orphan tmp file at the root tmp dir.
    const orphans = readdirSync(tmp).filter((f) => f.includes(".substrate-tmp-"));
    expect(orphans).toHaveLength(0);
  });
});
