/**
 * Sub-phase C — source kinds (file: + npm: + github:) and caching.
 *
 * Coverage targets:
 *  - file: source resolves a directory; rejects nonexistent paths and
 *    non-directory targets
 *  - npm: source resolves through `<consumer>/node_modules/<pkg>/`;
 *    walks up to a parent's `node_modules/` for workspaces
 *  - github: source uses a cache directory; second call is a cache hit
 *    (no clone); offline mode skips cold cache with a warning; offline
 *    mode honors warm cache
 *  - cache integrity: manifest.json tracks the resolved SHA + ref
 *  - `clearExtendsCache` wipes the tree
 *  - `refreshGithubSource` wipes + re-clones a single source
 *
 * We never hit the network: a fake `gitRunner` simulates clone by
 * mkdir'ing the target and dropping a `substrate/` subdir into it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearExtendsCache,
  refreshGithubSource,
  resolveSourceRoot,
} from "../src/v2/extends/index.js";
import type { GitRunner } from "../src/v2/extends/github-source.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

function makeFakeGitRunner(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  // The fake clone:
  //   - records every git invocation
  //   - on a `clone ... <target>` call, creates the target dir + drops a
  //     substrate/ subdir with one workflow inside so the resolver can
  //     find it.
  //   - on a `rev-parse HEAD` call, returns a fixed fake SHA
  const runner: GitRunner = (args) => {
    calls.push(args);
    if (args[0] === "clone") {
      const target = args[args.length - 1];
      mkdirSync(join(target, "substrate", "workflows"), { recursive: true });
      writeFileSync(
        join(target, "substrate", "workflows", "from-github.yaml"),
        "schema_version: v2.0\nid: from-github\nname: From github\n",
      );
      return "";
    }
    if (args[0] === "rev-parse") {
      return "abc123def456fakesha\n";
    }
    if (args[0] === "checkout") {
      return "";
    }
    return "";
  };
  return { runner, calls };
}

describe("file: source kind", () => {
  let consumer: string;
  let target: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
    target = makeTempDir("substrate-target-");
  });
  afterEach(() => {
    removeTempDir(consumer);
    removeTempDir(target);
  });

  it("resolves an absolute file: path", () => {
    const result = resolveSourceRoot(
      { source: `file:${target}` },
      { consumerRoot: consumer },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.root).toBe(target);
      expect(result.sourceKind).toBe("file");
    }
  });

  it("resolves a relative file: path against consumerRoot", () => {
    const subdir = join(consumer, "shared");
    mkdirSync(subdir, { recursive: true });
    const result = resolveSourceRoot(
      { source: "file:shared" },
      { consumerRoot: consumer },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.root).toBe(subdir);
    }
  });

  it("returns an error when the path does not exist", () => {
    const result = resolveSourceRoot(
      { source: "file:/no/such/path/exists/here" },
      { consumerRoot: consumer },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/does not exist/);
    }
  });

  it("returns an error when the path is a file (not a directory)", () => {
    const filePath = join(consumer, "not-a-dir.txt");
    writeFileSync(filePath, "hello");
    const result = resolveSourceRoot(
      { source: `file:${filePath}` },
      { consumerRoot: consumer },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/not a directory/);
    }
  });

  it("returns an error when the source is just 'file:' (empty path)", () => {
    const result = resolveSourceRoot(
      { source: "file:" },
      { consumerRoot: consumer },
    );
    expect(result.kind).toBe("error");
  });
});

describe("npm: source kind", () => {
  let consumer: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
  });
  afterEach(() => {
    removeTempDir(consumer);
  });

  it("resolves a package living in consumer/node_modules/<pkg>/", () => {
    const pkgDir = join(consumer, "node_modules", "@acme", "substrate-shared");
    mkdirSync(pkgDir, { recursive: true });
    const result = resolveSourceRoot(
      { source: "npm:@acme/substrate-shared", version: "^2.0.0" },
      { consumerRoot: consumer },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.root).toBe(pkgDir);
      expect(result.sourceKind).toBe("npm");
    }
  });

  it("walks up to a parent's node_modules (workspace hoist)", () => {
    // Set up: consumer is a workspace at <parent>/packages/app/; the
    // hoisted pkg lives at <parent>/node_modules/<pkg>/.
    const workspaceRoot = makeTempDir("substrate-workspace-");
    try {
      const app = join(workspaceRoot, "packages", "app");
      mkdirSync(app, { recursive: true });
      const pkgDir = join(workspaceRoot, "node_modules", "@acme", "shared");
      mkdirSync(pkgDir, { recursive: true });

      const result = resolveSourceRoot(
        { source: "npm:@acme/shared" },
        { consumerRoot: app },
      );
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.root).toBe(pkgDir);
      }
    } finally {
      removeTempDir(workspaceRoot);
    }
  });

  it("returns an error when the package isn't installed", () => {
    const result = resolveSourceRoot(
      { source: "npm:@acme/never-installed" },
      { consumerRoot: consumer },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/not found in node_modules/);
      // Helpful hint includes the package + version
      expect(result.message).toMatch(/npm install/);
    }
  });

  it("returns an error when the source is just 'npm:' (empty pkg)", () => {
    const result = resolveSourceRoot(
      { source: "npm:" },
      { consumerRoot: consumer },
    );
    expect(result.kind).toBe("error");
  });
});

describe("github: source kind — caching", () => {
  let consumer: string;
  let cacheRoot: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
    cacheRoot = makeTempDir("substrate-cache-");
  });
  afterEach(() => {
    removeTempDir(consumer);
    removeTempDir(cacheRoot);
  });

  it("clones into the cache dir on first resolve, returns ok", () => {
    const { runner, calls } = makeFakeGitRunner();
    const result = resolveSourceRoot(
      { source: "github:acme/substrate-shared", ref: "v1.0.0" },
      {
        consumerRoot: consumer,
        githubCacheRoot: cacheRoot,
        gitRunner: runner,
      },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.sourceKind).toBe("github");
      // Cache dir was created with a deterministic slug.
      expect(result.root).toMatch(/acme-substrate-shared@v1\.0\.0/);
      expect(existsSync(join(result.root, "substrate", "workflows"))).toBe(true);
    }
    // First call should have shelled out to git clone.
    expect(calls[0][0]).toBe("clone");
  });

  it("sanitizes filesystem-hostile chars in branch names (v3.0.0-beta.1 slug rules)", () => {
    const { runner } = makeFakeGitRunner();
    // Branch name with `/` (common: `feat/extends`) and other special
    // chars (`+`) should be sanitized into `_`.
    const result = resolveSourceRoot(
      { source: "github:acme/shared", ref: "feat/extends+v2" },
      {
        consumerRoot: consumer,
        githubCacheRoot: cacheRoot,
        gitRunner: runner,
      },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      // No raw `/` or `+` should land in the slug; they become `_`.
      expect(result.root).toMatch(/acme-shared@feat_extends_v2$/);
      // And the resulting path is a real, walkable directory (no
      // leftover separators broke into subdirs).
      expect(existsSync(result.root)).toBe(true);
    }
  });

  it("uses @HEAD in the slug when no ref is specified", () => {
    const { runner } = makeFakeGitRunner();
    const result = resolveSourceRoot(
      { source: "github:acme/shared" },
      {
        consumerRoot: consumer,
        githubCacheRoot: cacheRoot,
        gitRunner: runner,
      },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.root).toMatch(/acme-shared@HEAD$/);
    }
  });

  it("writes a manifest.json with the resolved SHA and ref", () => {
    const { runner } = makeFakeGitRunner();
    resolveSourceRoot(
      { source: "github:acme/shared", ref: "v2.4.1" },
      { consumerRoot: consumer, githubCacheRoot: cacheRoot, gitRunner: runner },
    );
    const manifestPath = join(cacheRoot, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.version).toBe(1);
    const key = Object.keys(manifest.entries)[0];
    expect(manifest.entries[key].source).toBe("github:acme/shared");
    expect(manifest.entries[key].org).toBe("acme");
    expect(manifest.entries[key].repo).toBe("shared");
    expect(manifest.entries[key].ref).toBe("v2.4.1");
    expect(manifest.entries[key].resolvedSha).toBe("abc123def456fakesha");
  });

  it("cache hit: second resolve does not invoke git", () => {
    const { runner, calls } = makeFakeGitRunner();
    const ctx = {
      consumerRoot: consumer,
      githubCacheRoot: cacheRoot,
      gitRunner: runner,
    };
    resolveSourceRoot({ source: "github:acme/shared", ref: "v1.0.0" }, ctx);
    const callsAfterFirst = calls.length;

    resolveSourceRoot({ source: "github:acme/shared", ref: "v1.0.0" }, ctx);
    expect(calls.length).toBe(callsAfterFirst); // no new git calls
  });

  it("uses different cache slugs for different refs", () => {
    const { runner } = makeFakeGitRunner();
    const ctx = {
      consumerRoot: consumer,
      githubCacheRoot: cacheRoot,
      gitRunner: runner,
    };
    const r1 = resolveSourceRoot({ source: "github:acme/shared", ref: "v1.0.0" }, ctx);
    const r2 = resolveSourceRoot({ source: "github:acme/shared", ref: "v2.0.0" }, ctx);
    expect(r1.kind).toBe("ok");
    expect(r2.kind).toBe("ok");
    if (r1.kind === "ok" && r2.kind === "ok") {
      expect(r1.root).not.toBe(r2.root);
    }
  });

  it("inline #ref form: github:org/repo#ref overrides entry.ref", () => {
    const { runner } = makeFakeGitRunner();
    const result = resolveSourceRoot(
      { source: "github:acme/shared#v3.0.0" },
      { consumerRoot: consumer, githubCacheRoot: cacheRoot, gitRunner: runner },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.root).toMatch(/acme-shared@v3\.0\.0/);
    }
  });

  it("falls back to full clone + checkout when --branch fails (SHA refs)", () => {
    let cloneAttempt = 0;
    const runner: GitRunner = (args) => {
      if (args[0] === "clone") {
        cloneAttempt += 1;
        if (cloneAttempt === 1) {
          // First clone (--branch <sha>) fails: shallow clone of a SHA
          // isn't supported on GitHub.
          throw new Error("fatal: Remote branch abc123 not found");
        }
        // Second clone (no --branch) succeeds.
        const target = args[args.length - 1];
        mkdirSync(join(target, "substrate"), { recursive: true });
        return "";
      }
      if (args[0] === "checkout") return "";
      if (args[0] === "rev-parse") return "abc123\n";
      return "";
    };
    const result = resolveSourceRoot(
      { source: "github:acme/shared", ref: "abc123" },
      { consumerRoot: consumer, githubCacheRoot: cacheRoot, gitRunner: runner },
    );
    expect(result.kind).toBe("ok");
    expect(cloneAttempt).toBe(2);
  });

  it("returns error and tidies partial clone on hard failure", () => {
    const runner: GitRunner = (args) => {
      if (args[0] === "clone") {
        // Simulate partial clone tree being created before failure.
        const target = args[args.length - 1];
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, "partial.txt"), "junk");
        throw new Error("fatal: cannot reach host");
      }
      return "";
    };
    const result = resolveSourceRoot(
      { source: "github:acme/shared" },
      { consumerRoot: consumer, githubCacheRoot: cacheRoot, gitRunner: runner },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/git clone failed/);
    }
    // Partial tree should have been cleaned.
    const targetSlug = "acme-shared@HEAD";
    expect(existsSync(join(cacheRoot, targetSlug))).toBe(false);
  });
});

describe("github: source kind — offline mode", () => {
  let consumer: string;
  let cacheRoot: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
    cacheRoot = makeTempDir("substrate-cache-");
  });
  afterEach(() => {
    removeTempDir(consumer);
    removeTempDir(cacheRoot);
  });

  it("cold cache + offline = warning (chain continues without source)", () => {
    const { runner, calls } = makeFakeGitRunner();
    const result = resolveSourceRoot(
      { source: "github:acme/shared", ref: "v1.0.0" },
      {
        consumerRoot: consumer,
        githubCacheRoot: cacheRoot,
        gitRunner: runner,
        offline: true,
      },
    );
    expect(result.kind).toBe("warning");
    if (result.kind === "warning") {
      expect(result.message).toMatch(/SUBSTRATE_OFFLINE/);
      expect(result.root).toBeUndefined();
    }
    // git was never called.
    expect(calls.length).toBe(0);
  });

  it("warm cache + offline = ok (warmed-up resolution)", () => {
    const { runner } = makeFakeGitRunner();
    // Warm the cache (offline=false).
    resolveSourceRoot(
      { source: "github:acme/shared", ref: "v1.0.0" },
      { consumerRoot: consumer, githubCacheRoot: cacheRoot, gitRunner: runner },
    );
    // Now go offline.
    const { runner: r2, calls: c2 } = makeFakeGitRunner();
    const result = resolveSourceRoot(
      { source: "github:acme/shared", ref: "v1.0.0" },
      {
        consumerRoot: consumer,
        githubCacheRoot: cacheRoot,
        gitRunner: r2,
        offline: true,
      },
    );
    expect(result.kind).toBe("ok");
    // Offline call should NOT invoke git (cache hit served).
    expect(c2.length).toBe(0);
  });
});

describe("clearExtendsCache + refreshGithubSource", () => {
  let consumer: string;
  let cacheRoot: string;
  beforeEach(() => {
    consumer = makeTempDir("substrate-consumer-");
    cacheRoot = join(consumer, "substrate", ".cache", "extends");
  });
  afterEach(() => {
    removeTempDir(consumer);
  });

  it("clearExtendsCache: no-op when cache doesn't exist", () => {
    const result = clearExtendsCache(consumer);
    expect(result.removed).toBe(false);
    expect(result.path).toBe(cacheRoot);
  });

  it("clearExtendsCache: wipes the directory when it exists", () => {
    mkdirSync(join(cacheRoot, "github"), { recursive: true });
    writeFileSync(join(cacheRoot, "github", "anything.txt"), "hi");
    const result = clearExtendsCache(consumer);
    expect(result.removed).toBe(true);
    expect(existsSync(cacheRoot)).toBe(false);
  });

  it("refreshGithubSource: wipes the entry and re-clones", () => {
    const githubCacheRoot = join(cacheRoot, "github");
    const { runner, calls } = makeFakeGitRunner();
    // First resolve warms the cache.
    resolveSourceRoot(
      { source: "github:acme/shared", ref: "v1.0.0" },
      { consumerRoot: consumer, githubCacheRoot, gitRunner: runner },
    );
    const initialCallCount = calls.length;

    // refresh triggers a fresh clone.
    const result = refreshGithubSource(
      { source: "github:acme/shared", ref: "v1.0.0" },
      { consumerRoot: consumer, offline: false, cacheRoot: githubCacheRoot, gitRunner: runner },
    );
    expect(result.kind).toBe("ok");
    expect(calls.length).toBeGreaterThan(initialCallCount);
  });
});
