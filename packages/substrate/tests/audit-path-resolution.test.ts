/**
 * Detector path resolution — the fixture battery.
 *
 * Every case here corresponds to a way `detector.paths` used to be resolved
 * wrongly. They run against a real temp tree rather than a mocked fs, because
 * three of the bugs (symlinks, `..` escapes, `node_modules` descent) are only
 * observable against a real one.
 *
 * The companion battery in `audit-ripgrep-parity.test.ts` replays the same
 * inputs through both execution paths (rg and the Node fallback) and asserts
 * they agree.
 */

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveDetectorPaths } from "../src/audit/paths.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

/**
 * A miniature of the shape that broke in the wild: a monorepo whose rules are
 * scoped with `apps/backend/<star>/app/services`-style globs (a star segment).
 */
function buildTree(root: string): void {
  const files = [
    "apps/backend/auth-service/app/services/user.py",
    "apps/backend/auth-service/app/api/endpoints/login.py",
    "apps/backend/task-service/app/services/task.py",
    "apps/backend/task-service/Dockerfile",
    "packages/python/commons/tests/test_commons.py",
    "node_modules/evil-pkg/app/services/pwn.py",
    "docs/readme.md",
  ];
  for (const f of files) {
    const abs = join(root, f);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "content\n", "utf8");
  }
}

describe("resolveDetectorPaths: glob expansion", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    buildTree(tmp);
  });
  afterEach(() => removeTempDir(tmp));

  it("expands a `*` segment to every matching directory", () => {
    const r = resolveDetectorPaths(tmp, ["apps/backend/*/app/services"], undefined);
    expect(r.targets).toEqual([
      "apps/backend/auth-service/app/services",
      "apps/backend/task-service/app/services",
    ]);
    expect(r.unmatched).toEqual([]);
  });

  it("expands a `*` segment onto files, not just directories", () => {
    const r = resolveDetectorPaths(tmp, ["apps/backend/*/Dockerfile"], undefined);
    expect(r.targets).toEqual(["apps/backend/task-service/Dockerfile"]);
    expect(r.unmatched).toEqual([]);
  });

  it("reports a glob that matches nothing rather than silently scanning zero files", () => {
    const r = resolveDetectorPaths(tmp, ["apps/backend/*/migrations"], undefined);
    expect(r.targets).toEqual([]);
    expect(r.expanded).toEqual([]);
    expect(r.unmatched).toEqual(["apps/backend/*/migrations"]);
  });

  it("keeps the valid paths when one declared path is missing", () => {
    const r = resolveDetectorPaths(tmp, ["docs", "no/such/dir"], undefined);
    expect(r.targets).toEqual(["docs"]);
    expect(r.unmatched).toEqual(["no/such/dir"]);
  });

  it("never descends into node_modules to satisfy a glob", () => {
    const r = resolveDetectorPaths(tmp, ["*/*/app/services"], undefined);
    expect(r.targets.some((p) => p.startsWith("node_modules"))).toBe(false);
  });

  it("tolerates a trailing slash", () => {
    const r = resolveDetectorPaths(tmp, ["packages/python/*/"], undefined);
    expect(r.targets).toEqual(["packages/python/commons"]);
  });

  it("treats an absent `paths` as the whole repo", () => {
    const r = resolveDetectorPaths(tmp, undefined, undefined);
    expect(r.targets).toEqual(["."]);
    expect(r.unmatched).toEqual([]);
  });

  it("expands `**` across zero or more directory levels", () => {
    const r = resolveDetectorPaths(tmp, ["apps/**/services"], undefined);
    expect(r.targets).toEqual([
      "apps/backend/auth-service/app/services",
      "apps/backend/task-service/app/services",
    ]);
  });

  it("deduplicates overlapping declared paths", () => {
    const r = resolveDetectorPaths(tmp, ["docs", "docs", "./docs"], undefined);
    expect(r.targets).toEqual(["docs"]);
  });
});

describe("resolveDetectorPaths: containment", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    buildTree(tmp);
  });
  afterEach(() => removeTempDir(tmp));

  it("refuses a declared path that climbs out of the repo", () => {
    const r = resolveDetectorPaths(tmp, ["../outside.env"], undefined);
    expect(r.targets).toEqual([]);
    expect(r.unmatched).toEqual(["../outside.env"]);
  });

  it("refuses a `..` hidden mid-path even when it lands back inside the repo", () => {
    const r = resolveDetectorPaths(tmp, ["docs/../docs"], undefined);
    expect(r.unmatched).toEqual(["docs/../docs"]);
  });

  it("refuses an absolute path", () => {
    const r = resolveDetectorPaths(tmp, ["/etc"], undefined);
    expect(r.targets).toEqual([]);
    expect(r.unmatched).toEqual(["/etc"]);
  });

  it("does not expand a glob onto a symlink", () => {
    symlinkSync(join(tmp, "docs"), join(tmp, "docs-link"), "dir");
    const r = resolveDetectorPaths(tmp, ["docs*"], undefined);
    expect(r.targets).toEqual(["docs"]);
  });

  it("refuses a symlink that escapes the repo, even when named literally", () => {
    const outside = makeTempDir();
    try {
      symlinkSync(outside, join(tmp, "escape"), "dir");
      const r = resolveDetectorPaths(tmp, ["escape"], undefined);
      expect(r.targets).toEqual([]);
      expect(r.unmatched).toEqual(["escape"]);
    } finally {
      removeTempDir(outside);
    }
  });
});

describe("resolveDetectorPaths: pathFilter intersects, never overrides", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir();
    buildTree(tmp);
  });
  afterEach(() => removeTempDir(tmp));

  const CHANGED = [
    "apps/backend/auth-service/app/services/user.py",
    "apps/backend/task-service/Dockerfile",
    "docs/readme.md",
  ];

  it("keeps only the changed files that fall under the declared scope", () => {
    const r = resolveDetectorPaths(tmp, ["apps/backend/*/app/services"], CHANGED);
    expect(r.targets).toEqual(["apps/backend/auth-service/app/services/user.py"]);
  });

  it("yields no targets when the diff touches nothing in scope, and says the scope exists", () => {
    const r = resolveDetectorPaths(tmp, ["packages/python/*/tests"], CHANGED);
    expect(r.targets).toEqual([]);
    // `expanded` non-empty distinguishes "diff missed this rule" from
    // "this rule's paths are gone".
    expect(r.expanded).toEqual(["packages/python/commons/tests"]);
    expect(r.unmatched).toEqual([]);
  });

  it("falls back to the whole filter when the rule declares no paths", () => {
    const r = resolveDetectorPaths(tmp, undefined, CHANGED);
    expect(r.targets).toEqual([...CHANGED].sort());
  });

  it("drops filter entries that no longer exist on disk", () => {
    const r = resolveDetectorPaths(tmp, undefined, [...CHANGED, "deleted/file.py"]);
    expect(r.targets).not.toContain("deleted/file.py");
  });

  it("drops filter entries that escape the repo root", () => {
    const r = resolveDetectorPaths(tmp, undefined, ["../../../etc/passwd"]);
    expect(r.targets).toEqual([]);
  });
});
