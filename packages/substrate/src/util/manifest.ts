/**
 * Manifest helpers for tracked scaffolds.
 *
 * Every `substrate add` invocation appends to `auto/.substrate-manifest.json`
 * so the v0.5 upgrade flow (three-way merge) has the data it needs to
 * compare the user's current copy against the template that produced it.
 *
 * Schema:
 *
 *   {
 *     "schemaVersion": 1,
 *     "substrateVersion": "0.3.0",
 *     "entries": [
 *       {
 *         "path": "auto/instructions/main/audit-backend.md",
 *         "templateVersion": "0.3.0",
 *         "contentHash": "sha256:...",
 *         "ejected": false
 *       }
 *     ]
 *   }
 *
 * v0.3 just appends. v0.5 will rewrite entries on upgrade. Hash format
 * is `sha256:<hex>` so future formats can be discriminated without a
 * migration.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "./atomic-write.js";
import { hashContent } from "./fs.js";
import type { SubstrateManifest, ManifestEntry } from "./types.js";
import { SUBSTRATE_VERSION } from "./version.js";

const MANIFEST_FILENAME = ".substrate-manifest.json";

export function manifestPath(autoDir: string): string {
  return join(autoDir, MANIFEST_FILENAME);
}

/**
 * Load the manifest from disk. If missing or malformed, returns a fresh
 * empty manifest — the caller is responsible for writing it back.
 *
 * We don't fail-hard on malformed JSON because a corrupted manifest
 * shouldn't block the user from running `add` — they'd just lose
 * tracking for that entry, not the ability to scaffold.
 */
export function readManifest(autoDir: string): SubstrateManifest {
  const path = manifestPath(autoDir);
  if (!existsSync(path)) {
    return { schemaVersion: 1, substrateVersion: SUBSTRATE_VERSION, entries: [] };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SubstrateManifest>;
    if (typeof parsed.schemaVersion !== "number" || !Array.isArray(parsed.entries)) {
      return { schemaVersion: 1, substrateVersion: SUBSTRATE_VERSION, entries: [] };
    }
    return {
      schemaVersion: parsed.schemaVersion,
      substrateVersion: parsed.substrateVersion ?? SUBSTRATE_VERSION,
      entries: parsed.entries as ManifestEntry[],
    };
  } catch {
    return { schemaVersion: 1, substrateVersion: SUBSTRATE_VERSION, entries: [] };
  }
}

export function writeManifest(autoDir: string, manifest: SubstrateManifest): void {
  // Atomic write — manifest is crash-critical for the upgrade flow. A
  // half-written manifest mid-`add` would orphan the just-scaffolded
  // file from its tracking entry.
  atomicWriteJsonSync(manifestPath(autoDir), manifest);
}

/**
 * Add (or update) an entry. Idempotent: if the path is already tracked,
 * its hash and template version are refreshed.
 *
 * `ejected` is preserved across updates — if the user explicitly opted
 * out of upgrades via `substrate config --eject`, a later `add` won't
 * re-enroll them.
 */
export function recordEntry(autoDir: string, entry: Omit<ManifestEntry, "ejected">): void {
  const manifest = readManifest(autoDir);
  const existing = manifest.entries.find((e) => e.path === entry.path);
  if (existing) {
    existing.templateVersion = entry.templateVersion;
    existing.contentHash = entry.contentHash;
    // existing.ejected preserved
  } else {
    manifest.entries.push({ ...entry, ejected: false });
  }
  manifest.substrateVersion = SUBSTRATE_VERSION;
  writeManifest(autoDir, manifest);
}

/**
 * Build a manifest entry from a scaffolded file's path and contents.
 *
 * `repoRoot` is the repo-root (the cwd in which auto/ lives); the
 * resulting `path` is relative to that root so the manifest stays
 * portable across machines.
 */
export function buildEntry(
  repoRoot: string,
  absolutePath: string,
  contents: string,
): Omit<ManifestEntry, "ejected"> {
  let rel = absolutePath;
  if (rel.startsWith(repoRoot)) {
    rel = rel.slice(repoRoot.length).replace(/^[/\\]+/, "");
  }
  return {
    path: rel,
    templateVersion: SUBSTRATE_VERSION,
    contentHash: `sha256:${hashContent(contents)}`,
  };
}
