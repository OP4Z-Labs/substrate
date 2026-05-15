# Licenses

Substrate ships under two licenses, applied to different parts of the
project per the v0.8 brief decision (locked alongside the public docs
site rollout).

## Code: MIT

All source code in this repo — the substrate CLI, the adapter packages,
the docs site infrastructure, the GitHub Action — is licensed under
the MIT License. The full text lives in [`LICENSE`](./LICENSE).

In short: do anything with the code, attribution is appreciated but
not required for use or distribution.

## Content: CC-BY 4.0

The following CONTENT files are licensed under the Creative Commons
Attribution 4.0 International License
(<https://creativecommons.org/licenses/by/4.0/>):

- The 21 standards docs under `packages/substrate/templates/standards/`
  (and their `templates-history/` snapshots)
- The 15 audit instruction playbooks under
  `packages/substrate/templates/audits/`
- The bridge command markdown files under
  `packages/substrate/templates/bridges/<name>/substrate.md`
- The default workflow YAML under
  `packages/substrate/templates/workflows/`
- All documentation pages under `docs-site/src/pages/*.astro`
- The README files distributed with each adapter package

**Attribution requirement.** When you reuse substrate's content
(standards body text, audit playbook structure, etc.) in your own
project, give credit. A short note like "Standards adapted from
Substrate (CC-BY 4.0)" plus a link to the substrate repo satisfies
the license.

## Trademark + governance

v0.8 does NOT pursue trademark on "Substrate" or require a CLA from
contributors. v1.0 will revisit both questions.

## Why two licenses

Code and content have different reuse stories. Code carries no
opinion; you take it, you ship it. Content (especially the
standards docs and audit playbooks) carries opinionated guidance —
crediting where it came from helps the ecosystem evolve. CC-BY 4.0
is the standard pick for technical content that wants attribution
without copyleft.
