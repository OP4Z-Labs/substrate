/**
 * Substrate v3 — `github:` extends source resolution (NE-11 sub-phase C).
 *
 * Resolves `github:<org>/<repo>[#ref]` sources into a filesystem path
 * by shallow-cloning into `substrate/.cache/extends/github/<org>/<repo>@<ref>/`.
 * Subsequent commands hit the cache without re-fetching; an explicit
 * `substrate extends sync` (sub-phase D) refreshes.
 *
 * Design choices:
 *
 *   - **Spec parses both colon-and-hash forms.** The JSON Schema's
 *     pattern accepts `github:org/repo`; the `ref` field is its own
 *     property. Many adopters will type `github:org/repo#v1.2.0` from
 *     muscle memory (npm semantics). We support both: an embedded `#ref`
 *     overrides a `ref` field. The schema disallows `#` in the source
 *     pattern, so this is a no-op for schema-valid configs — but we
 *     parse defensively in case future schema relaxations land.
 *
 *   - **Shell out to `git`.** The codebase already shells out for VCS
 *     ops (see `src/v2/orchestrator/*`); adding `simple-git` or
 *     `isomorphic-git` would balloon the install footprint for one
 *     primitive. `git clone --depth 1 --branch <ref>` covers tags and
 *     branches; SHA refs need a fetch-then-checkout fallback.
 *
 *   - **Cache key is the ref-resolved directory.** The cache layout is
 *     `<root>/substrate/.cache/extends/github/<org>/<repo>@<ref>/`. The
 *     resolved-SHA is stored in `manifest.json` (alongside) per plan §2.5
 *     so a subsequent `extends sync` can refresh in place.
 *
 *   - **Air-gap.** When `SUBSTRATE_OFFLINE=1`, `git clone` is refused.
 *     If a warm cache exists, the resolver returns `{ kind: "warning" }`
 *     with the cached root so workflows still function in air-gapped
 *     environments. With no cache, returns `kind: "warning"` and no
 *     root — the chain continues without this source.
 *
 *   - **Failures are non-fatal.** A network failure surfaces as a hard
 *     error on the result object; the resolver records it on
 *     `chain.errors` rather than throwing, so a config with a typo in
 *     one extends entry doesn't break the others.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtendsSource } from "../../util/types.js";
import type { SourceResolutionResult } from "./source-kinds.js";

export interface GithubResolutionContext {
  consumerRoot: string;
  offline: boolean;
  /**
   * Test seam: override the cache root (so unit tests can sandbox the
   * cache directory without writing into the consumer repo). When
   * undefined, the cache lives at `<consumerRoot>/substrate/.cache/extends/`.
   */
  cacheRoot?: string;
  /**
   * Test seam: override the git executor. When undefined, shells out
   * to `git`. The override is used by `tests/v3-extends-source-kinds.test.ts`
   * to fake the clone without touching the network.
   */
  gitRunner?: GitRunner;
}

/**
 * Pluggable git executor. The default is `execFileSync("git", ...)` —
 * tests inject a fake to avoid network operations.
 */
export type GitRunner = (args: string[], options: { cwd?: string }) => string;

const DEFAULT_GIT_RUNNER: GitRunner = (args, options) =>
  execFileSync("git", args, { ...options, encoding: "utf8" });

/**
 * Parsed `github:` source. Captures the `org/repo[#ref]` shape so the
 * caller doesn't have to re-parse downstream.
 */
interface ParsedGithubSource {
  org: string;
  repo: string;
  ref: string | null;
}

function parseGithubSource(
  source: string,
  entryRef: string | undefined,
): ParsedGithubSource | null {
  const tail = source.startsWith("github:") ? source.slice("github:".length) : source;
  // Optional embedded #ref (e.g. "github:acme/shared#v2.4.1").
  let target = tail;
  let inlineRef: string | null = null;
  const hashIdx = tail.indexOf("#");
  if (hashIdx !== -1) {
    target = tail.slice(0, hashIdx);
    inlineRef = tail.slice(hashIdx + 1) || null;
  }
  const segments = target.split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) return null;
  const ref = inlineRef ?? entryRef ?? null;
  return { org: segments[0], repo: segments[1], ref };
}

/**
 * Slug used for the on-disk cache directory and the manifest entry key.
 *
 * Format: `<org>-<repo>@<sanitized-ref>` (or `<org>-<repo>@HEAD` when no
 * ref was specified). Tag/branch/SHA refs are normalized via the
 * sanitization rules below; the resolved SHA is recorded separately in
 * the cache manifest so reproducibility is preserved.
 *
 * Slug sanitization rules (v3.0.0-beta.1, plan §2.5):
 *
 *   - Any character outside `[A-Za-z0-9_.-]` is replaced with `_`.
 *     This handles the two common edge cases:
 *       - Branch names with `/` (e.g. `feat/extends` → `feat_extends`)
 *       - Tag names with `+` or other special chars (e.g. `v1.0+build.5`)
 *   - The org/repo separator is normalized from `/` (in the source URL)
 *     to `-` (in the slug); the source URL itself remains canonical.
 *   - When no ref is specified, the slug ends in `@HEAD` (not the
 *     resolved default branch — that's discoverable from the manifest's
 *     `resolvedSha` field at refresh time).
 *
 * Worked examples:
 *   - `github:acme/shared`              → `acme-shared@HEAD`
 *   - `github:acme/shared` ref=`v1.0.0` → `acme-shared@v1.0.0`
 *   - `github:acme/shared` ref=`main`   → `acme-shared@main`
 *   - `github:acme/shared` ref=`feat/x` → `acme-shared@feat_x`
 *   - `github:acme/shared` ref=`v1+b.5` → `acme-shared@v1_b.5`
 *   - `github:acme/shared` ref=`abc123` → `acme-shared@abc123` (SHA)
 *
 * Decision (v3.0.0-alpha.1): the human-readable slug was chosen over a
 * hash digest (plan §2.5 suggested `sha256(source-spec)[:16]`) so the
 * cache is grep-able and `ls` output is interpretable. The cache
 * manifest still records the exact source URL + resolved SHA for
 * machine-driven workflows.
 */
function cacheSlug(parsed: ParsedGithubSource): string {
  const refPart = parsed.ref
    ? `@${parsed.ref.replace(/[^A-Za-z0-9_.-]/g, "_")}`
    : "@HEAD";
  return `${parsed.org}-${parsed.repo}${refPart}`;
}

function defaultCacheRoot(consumerRoot: string): string {
  return join(consumerRoot, "substrate", ".cache", "extends", "github");
}

/**
 * Cache manifest schema. Tracks the resolved SHA for each cached
 * github source so `substrate extends sync` can refresh in place.
 */
interface CacheManifest {
  version: 1;
  entries: Record<
    string,
    {
      source: string;
      org: string;
      repo: string;
      ref: string | null;
      resolvedSha: string | null;
      fetchedAt: string;
    }
  >;
}

function readManifest(cacheRoot: string): CacheManifest {
  const path = join(cacheRoot, "manifest.json");
  if (!existsSync(path)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheManifest;
    if (parsed.version !== 1 || typeof parsed.entries !== "object") {
      return { version: 1, entries: {} };
    }
    return parsed;
  } catch {
    return { version: 1, entries: {} };
  }
}

function writeManifest(cacheRoot: string, manifest: CacheManifest): void {
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(join(cacheRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
}

/**
 * Resolve a `github:` source to a filesystem path. Per plan §2.5:
 *   - If a warm cache exists, reuse it without fetching.
 *   - Otherwise, `git clone --depth 1` into the cache directory.
 *   - In offline mode, skip cloning (warm cache OK; cold cache warns).
 */
export function resolveGithubSource(
  entry: ExtendsSource,
  ctx: GithubResolutionContext,
): SourceResolutionResult {
  const parsed = parseGithubSource(entry.source, entry.ref);
  if (!parsed) {
    return {
      kind: "error",
      message: `extends entry '${entry.source}': could not parse 'github:<org>/<repo>'.`,
    };
  }
  const cacheRoot = ctx.cacheRoot ?? defaultCacheRoot(ctx.consumerRoot);
  const slug = cacheSlug(parsed);
  const target = join(cacheRoot, slug);
  const warmCache = existsSync(target);

  if (warmCache) {
    // Cache hit. Return without re-fetching; `extends sync` will refresh.
    return {
      kind: "ok",
      root: target,
      origin: target,
      sourceKind: "github",
    };
  }

  if (ctx.offline) {
    return {
      kind: "warning",
      message:
        `extends entry '${entry.source}': SUBSTRATE_OFFLINE=1 is set and no warm cache ` +
        `exists at ${target}. The source is skipped; mirror via 'file:' or warm the cache ` +
        `on a connected machine and ship the .cache/extends/ directory.`,
    };
  }

  return performGithubClone(entry, parsed, ctx, cacheRoot, target);
}

/**
 * Actually clone the source repo into the cache. Resolves the
 * commit SHA via `git rev-parse HEAD` after clone (so the manifest
 * tracks reproducibility).
 *
 * Two-stage strategy:
 *
 *   1. `git clone --depth 1 --branch <ref> <url> <target>` when ref is
 *      provided. This works for tags and branches.
 *   2. If `--branch` fails (e.g. ref is a commit SHA), fall back to a
 *      full-history clone + checkout. Slower but covers every case.
 *
 * Both stages can be intercepted via `ctx.gitRunner` in tests.
 */
function performGithubClone(
  entry: ExtendsSource,
  parsed: ParsedGithubSource,
  ctx: GithubResolutionContext,
  cacheRoot: string,
  target: string,
): SourceResolutionResult {
  const runner = ctx.gitRunner ?? DEFAULT_GIT_RUNNER;
  const url = `https://github.com/${parsed.org}/${parsed.repo}.git`;
  mkdirSync(cacheRoot, { recursive: true });

  let cloneErr: Error | null = null;
  const usedRef = parsed.ref;
  try {
    if (parsed.ref) {
      runner(
        ["clone", "--depth", "1", "--branch", parsed.ref, url, target],
        {},
      );
    } else {
      runner(["clone", "--depth", "1", url, target], {});
    }
  } catch (err) {
    cloneErr = err as Error;
    // If --branch failed (likely a SHA ref), try a full clone + checkout.
    if (parsed.ref) {
      try {
        // Clean any partial clone tree before retry.
        if (existsSync(target)) {
          rmSync(target, { recursive: true, force: true });
        }
        runner(["clone", url, target], {});
        runner(["checkout", parsed.ref], { cwd: target });
        cloneErr = null;
      } catch (err2) {
        cloneErr = err2 as Error;
      }
    }
  }

  if (cloneErr) {
    // Tidy any partial clone tree.
    if (existsSync(target)) {
      try {
        rmSync(target, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors; user can clear-cache manually.
      }
    }
    return {
      kind: "error",
      message:
        `extends entry '${entry.source}': git clone failed: ${cloneErr.message}. ` +
        `Verify the source URL and your git credentials. If your network blocks ` +
        `outbound clones, set SUBSTRATE_OFFLINE=1 and mirror via a 'file:' source.`,
    };
  }

  // Capture the resolved SHA for the manifest. Best-effort; failure here
  // is non-fatal (the cache still works).
  let resolvedSha: string | null = null;
  try {
    resolvedSha = runner(["rev-parse", "HEAD"], { cwd: target }).trim() || null;
  } catch {
    // Best-effort; leave null.
  }

  const manifest = readManifest(cacheRoot);
  manifest.entries[cacheSlug(parsed)] = {
    source: entry.source,
    org: parsed.org,
    repo: parsed.repo,
    ref: usedRef,
    resolvedSha,
    fetchedAt: new Date().toISOString(),
  };
  writeManifest(cacheRoot, manifest);

  return {
    kind: "ok",
    root: target,
    origin: target,
    sourceKind: "github",
  };
}

/**
 * Public helper exposed for sub-phase D's `substrate extends sync`.
 * Force-refreshes a github source by clearing the cache directory + the
 * manifest entry, then calling `resolveGithubSource` again.
 */
export function refreshGithubSource(
  entry: ExtendsSource,
  ctx: GithubResolutionContext,
): SourceResolutionResult {
  const parsed = parseGithubSource(entry.source, entry.ref);
  if (!parsed) {
    return {
      kind: "error",
      message: `extends entry '${entry.source}': could not parse 'github:<org>/<repo>'.`,
    };
  }
  const cacheRoot = ctx.cacheRoot ?? defaultCacheRoot(ctx.consumerRoot);
  const target = join(cacheRoot, cacheSlug(parsed));
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  // Drop the manifest entry so the re-clone repopulates it.
  if (existsSync(join(cacheRoot, "manifest.json"))) {
    const manifest = readManifest(cacheRoot);
    delete manifest.entries[cacheSlug(parsed)];
    writeManifest(cacheRoot, manifest);
  }
  return resolveGithubSource(entry, ctx);
}

/**
 * Public helper exposed for sub-phase D's `substrate extends clear-cache`.
 * Removes the entire `substrate/.cache/extends/` tree under the consumer
 * root.
 */
export function clearExtendsCache(consumerRoot: string): {
  removed: boolean;
  path: string;
} {
  const path = join(consumerRoot, "substrate", ".cache", "extends");
  if (!existsSync(path)) {
    return { removed: false, path };
  }
  rmSync(path, { recursive: true, force: true });
  return { removed: true, path };
}
