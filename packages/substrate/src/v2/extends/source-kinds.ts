/**
 * Substrate v3 — `extends` source-kind resolution.
 *
 * Translates one `ExtendsSource` entry into an absolute filesystem path
 * whose `substrate/` subtree the resolver can walk. Three kinds:
 *
 *   - `file:<relative-path>` — resolved relative to the consumer root.
 *     Live filesystem; no cache; no fetch.
 *   - `npm:<pkg>`            — resolved via the consumer's `node_modules`.
 *     The native npm install IS the cache; we never write here.
 *   - `github:<org>/<repo>`  — cloned (sub-phase C) into
 *     `substrate/.cache/extends/github/<org>/<repo>@<ref>/`.
 *
 * Sub-phase B (this file's first cut) implements `file:` and `npm:` in
 * full; `github:` is delegated to `github-source.ts` which ships in
 * sub-phase C. The resolver layer is agnostic — it consumes a uniform
 * `SourceResolutionResult` shape.
 *
 * Air-gap: when `SUBSTRATE_OFFLINE=1` (env or options override), a
 * `github:` source that has no warm cache surfaces a `warning` result
 * rather than erroring. Adopters in locked-down networks can mirror via
 * `file:` sources without seeing hard failures during opt-in.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtendsSource } from "../../util/types.js";
import {
  classifyExtendsSource,
  type ExtendsKind,
} from "./config-validator.js";
import { resolveGithubSource, type GithubResolutionContext } from "./github-source.js";

/** Successful resolution — the `root` directory contains a `substrate/` subdir. */
export interface SourceResolutionOk {
  kind: "ok";
  root: string;
  /** Diagnostic origin (e.g. "node_modules/@acme/substrate-shared/"). */
  origin: string;
  /** Resolution kind (mirrors `ExtendsKind`). */
  sourceKind: ExtendsKind;
}

/** Hard failure (missing source, unparseable spec, etc.). */
export interface SourceResolutionError {
  kind: "error";
  message: string;
}

/**
 * Soft failure — the resolver continues without this source. Used for
 * air-gap-blocked github fetches and other "tolerate gracefully" paths.
 */
export interface SourceResolutionWarning {
  kind: "warning";
  message: string;
  /** Optional cached root that can still be walked despite the warning. */
  root?: string;
}

export type SourceResolutionResult =
  | SourceResolutionOk
  | SourceResolutionError
  | SourceResolutionWarning;

export interface ResolveSourceRootOptions {
  /** Absolute path to the consumer repo root. */
  consumerRoot: string;
  /**
   * Air-gap override. When undefined, reads `SUBSTRATE_OFFLINE` from the
   * current environment.
   */
  offline?: boolean;
}

/**
 * Resolve a single `ExtendsSource` into a filesystem root.
 *
 * Returns `{ kind: "ok", root, origin, sourceKind }` for success.
 * Returns `{ kind: "error", message }` for missing/invalid sources.
 * Returns `{ kind: "warning", message }` for soft failures
 * (air-gap blocked, etc.).
 *
 * The resolver layer treats this as a black box; it does not need to
 * know how a github source ended up on disk.
 */
export function resolveSourceRoot(
  entry: ExtendsSource,
  options: ResolveSourceRootOptions,
): SourceResolutionResult {
  const kind = classifyExtendsSource(entry.source);
  if (!kind) {
    return {
      kind: "error",
      message: `Unknown extends source kind: '${entry.source}'.`,
    };
  }
  switch (kind) {
    case "file":
      return resolveFileSource(entry, options);
    case "npm":
      return resolveNpmSource(entry, options);
    case "github":
      return resolveGithubSourceWrapper(entry, options);
  }
}

/**
 * `file:<relative-path>` — resolved against `consumerRoot`. Absolute
 * paths are honored (for advanced configs that point at a mounted
 * mirror directory).
 */
function resolveFileSource(
  entry: ExtendsSource,
  options: ResolveSourceRootOptions,
): SourceResolutionResult {
  const raw = entry.source.slice("file:".length).trim();
  if (raw.length === 0) {
    return {
      kind: "error",
      message: `extends entry '${entry.source}': missing path after 'file:'.`,
    };
  }
  const resolved = isAbsolute(raw) ? raw : resolve(options.consumerRoot, raw);
  if (!existsSync(resolved)) {
    return {
      kind: "error",
      message: `extends entry '${entry.source}': path does not exist: ${resolved}`,
    };
  }
  let st;
  try {
    st = statSync(resolved);
  } catch (err) {
    return {
      kind: "error",
      message: `extends entry '${entry.source}': cannot stat path ${resolved}: ${(err as Error).message}`,
    };
  }
  if (!st.isDirectory()) {
    return {
      kind: "error",
      message: `extends entry '${entry.source}': path is not a directory: ${resolved}`,
    };
  }
  return {
    kind: "ok",
    root: resolved,
    origin: resolved,
    sourceKind: "file",
  };
}

/**
 * `npm:<pkg>` — resolve via the consumer's `node_modules`. Walks up the
 * directory tree looking for the first `node_modules/<pkg>/` that exists
 * (so workspaces with hoisted dependencies also work).
 *
 * v3.0 does NOT honor `entry.version` at resolution time — npm already
 * resolved the version when the consumer ran `npm install`. We trust
 * what's on disk. (`substrate doctor` will gain a v3.x check that warns
 * when the on-disk version doesn't satisfy `entry.version`.)
 */
function resolveNpmSource(
  entry: ExtendsSource,
  options: ResolveSourceRootOptions,
): SourceResolutionResult {
  const pkg = entry.source.slice("npm:".length).trim();
  if (pkg.length === 0) {
    return {
      kind: "error",
      message: `extends entry '${entry.source}': missing package name after 'npm:'.`,
    };
  }

  // Walk up node_modules chain. We mirror Node's module-resolution
  // algorithm in spirit (not letter): from consumerRoot, check
  // `consumerRoot/node_modules/<pkg>`, then `../node_modules/<pkg>`, etc.
  let cursor = options.consumerRoot;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = join(cursor, "node_modules", pkg);
    if (existsSync(candidate)) {
      let st;
      try {
        st = statSync(candidate);
      } catch {
        // Permissions or race; keep walking.
        const parent = dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
        continue;
      }
      if (st.isDirectory()) {
        return {
          kind: "ok",
          root: candidate,
          origin: candidate,
          sourceKind: "npm",
        };
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return {
    kind: "error",
    message:
      `extends entry '${entry.source}': package '${pkg}' not found in node_modules. ` +
      `Run 'npm install ${pkg}${entry.version ? "@" + entry.version : ""}' first.`,
  };
}

/**
 * Thin wrapper around `github-source.ts`'s `resolveGithubSource`. The
 * github source-kind has enough surface (clone, cache, ref resolution,
 * air-gap behavior) to warrant its own module — kept separate so this
 * file stays lean.
 */
function resolveGithubSourceWrapper(
  entry: ExtendsSource,
  options: ResolveSourceRootOptions,
): SourceResolutionResult {
  const ctx: GithubResolutionContext = {
    consumerRoot: options.consumerRoot,
    offline: resolveOffline(options.offline),
  };
  return resolveGithubSource(entry, ctx);
}

/** Centralized offline-mode resolution so all sources agree. */
export function resolveOffline(override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  const env = process.env.SUBSTRATE_OFFLINE;
  if (!env) return false;
  return env === "1" || env.toLowerCase() === "true";
}
