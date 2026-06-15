#!/usr/bin/env node
/**
 * copy-changelog.mjs — `prepack` hook for `packages/substrate/`.
 *
 * The workspace's canonical CHANGELOG.md lives at the repo root. The
 * substrate package's `files` whitelist (per its package.json) includes
 * `CHANGELOG.md`, so `npm pack` would skip it unless we drop a copy
 * inside the package directory first.
 *
 * Per v3.0.0-beta.1 (NE-11 beta.1, bug #5), the published tarball must
 * include the CHANGELOG so `npm install @op4z/substrate` users find it
 * inside node_modules without having to visit the GitHub release page.
 *
 * This script runs automatically via `npm pack` (lifecycle: `prepack`),
 * so no manual step is required. It's idempotent — re-running just
 * overwrites the staged copy with the latest workspace-root content.
 *
 * Why a copy (not a symlink): `npm pack` follows symlinks on some
 * platforms but not others. Copying produces a deterministic tarball
 * across Node 20/22/24 + macOS/Linux/Windows. The copy is gitignored
 * (added in v3.0.0-beta.1) so it never lands in commits.
 */

import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootChangelog = resolve(__dirname, "..", "CHANGELOG.md");
const pkgChangelog = resolve(__dirname, "..", "packages", "substrate", "CHANGELOG.md");

if (!existsSync(rootChangelog)) {
  // The workspace-root CHANGELOG is required for the substrate
  // package; failing the prepack is the safer call than shipping a
  // tarball that quietly omits it.
  console.error(
    `prepack: workspace-root CHANGELOG.md missing at ${rootChangelog}. ` +
      `Cannot stage CHANGELOG into the substrate package.`,
  );
  process.exit(1);
}

copyFileSync(rootChangelog, pkgChangelog);
console.log(`prepack: staged CHANGELOG.md → packages/substrate/`);
