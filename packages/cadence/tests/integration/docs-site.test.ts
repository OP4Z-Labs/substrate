/**
 * Integration coverage for the Astro docs site (`docs-site/`).
 *
 * Verifies:
 *   - The Astro project builds (npm run docs:build produces a static dist/)
 *   - Every documented page produces an HTML output
 *   - The home page contains the cadence brand string
 *   - No broken cross-page links (every <a href="/foo/"> has a matching
 *     dist/foo/index.html)
 *
 * The build is real — we run `npm run docs:build` against the working
 * tree. This is slow (~2s on a warm install) but the only way to catch
 * astro-side regressions (broken layout, missing component, etc.).
 *
 * To skip on CI runs where docs don't matter, gate via env:
 *   CADENCE_SKIP_DOCS_BUILD=1 npm test
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = packages/cadence/tests/integration → up 4 to monorepo root.
const MONOREPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const DOCS_SITE = join(MONOREPO_ROOT, "docs-site");
const DIST = join(DOCS_SITE, "dist");

const SKIP = process.env.CADENCE_SKIP_DOCS_BUILD === "1";

describe.skipIf(SKIP)("docs-site (Astro static build)", () => {
  it(
    "npm run docs:build produces a static dist/ with all required pages",
    () => {
      const build = spawnSync("npm", ["run", "docs:build"], {
        cwd: MONOREPO_ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(
        build.status,
        `docs:build failed.\nstdout:\n${build.stdout}\n\nstderr:\n${build.stderr}`,
      ).toBe(0);

      expect(existsSync(DIST), `dist/ must exist after docs:build`).toBe(true);

      // Required pages per the v0.8 brief:
      // home, quick-start, commands, audits, standards, plugin-authoring, faq.
      const required = [
        "index.html",
        "quick-start/index.html",
        "commands/index.html",
        "audits/index.html",
        "standards/index.html",
        "plugin-authoring/index.html",
        "faq/index.html",
      ];
      for (const rel of required) {
        const p = join(DIST, rel);
        expect(existsSync(p), `expected built page at ${rel}`).toBe(true);
      }

      // Home contains the cadence brand line.
      const home = readFileSync(join(DIST, "index.html"), "utf8");
      expect(home).toContain("Cadence");
      expect(home).toMatch(/Repeatable automation patterns/i);
    },
    60000,
  );

  it.skipIf(SKIP)(
    "every internal href in the built pages resolves to a real page",
    () => {
      // This test only runs if the previous build produced dist/.
      if (!existsSync(DIST)) {
        throw new Error(
          "dist/ missing — run the prior build test first. (skipping should not happen here.)",
        );
      }
      const builtPages = collectHtmlPages(DIST);
      const internalHrefPattern = /href="(\/[^"#]*?)"/g;
      const errors: string[] = [];
      for (const page of builtPages) {
        const html = readFileSync(page, "utf8");
        for (const match of html.matchAll(internalHrefPattern)) {
          const href = match[1];
          // Normalize to a dist-relative path (e.g. "/quick-start/" →
          // "quick-start/index.html").
          const stripped = href.replace(/^\//, "").replace(/\/$/, "");
          const targetIndex = stripped
            ? join(DIST, stripped, "index.html")
            : join(DIST, "index.html");
          if (!existsSync(targetIndex)) {
            errors.push(`${page}: broken link ${href} → ${targetIndex}`);
          }
        }
      }
      expect(errors, errors.join("\n")).toEqual([]);
    },
    60000,
  );

  it.skipIf(SKIP)(
    "docs-site is dogfood-scaffolded with cadence (cadence.config.json present)",
    () => {
      const configPath = join(DOCS_SITE, "cadence.config.json");
      expect(existsSync(configPath), "docs-site must be cadence-init'd").toBe(true);
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      expect(config.project.name).toBe("cadence-docs-site");
    },
  );
});

function collectHtmlPages(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
    }
  }
  walk(root);
  return out;
}
