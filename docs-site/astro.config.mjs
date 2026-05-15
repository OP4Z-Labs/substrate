/**
 * Astro config for the substrate docs site.
 *
 * Deploy target: Cloudflare Pages (consistent with the Substrate / Blaze /
 * Chorus auxiliary-site family). `npm run docs:build` produces a static
 * `dist/` directory ready to upload.
 *
 * Site URL is pinned for canonical-URL generation; update when the
 * production hostname is finalized.
 */
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://substrate.dev",
  output: "static",
  build: {
    format: "directory",
  },
  trailingSlash: "always",
});
