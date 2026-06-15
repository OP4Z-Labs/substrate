/**
 * Substrate v3 — `github:` extends source resolution.
 *
 * Sub-phase B placeholder. Full `git clone` + cache-manifest logic lands
 * in sub-phase C. For B, the resolver knows how to dispatch to github
 * sources and the tests can rely on the deterministic-error shape; once
 * C ships, the implementation does the actual fetch.
 *
 * See plan §2.5 (caching contract) and §2.4(c) (collision policy) for
 * the contract this module fulfils.
 */

import type { ExtendsSource } from "../../util/types.js";
import type { SourceResolutionResult } from "./source-kinds.js";

export interface GithubResolutionContext {
  consumerRoot: string;
  offline: boolean;
}

/**
 * Sub-phase B stub. Returns a warning (not a hard error) so that:
 *   - configs declaring `github:` entries still surface useful diagnostics
 *   - existing test fixtures can use `file:` overlays and have the chain
 *     resolve without `github:` blocking anything
 *
 * The full implementation lands in sub-phase C — see CHANGELOG entry
 * `[3.0.0-alpha.1]`.
 */
export function resolveGithubSource(
  entry: ExtendsSource,
  ctx: GithubResolutionContext,
): SourceResolutionResult {
  if (ctx.offline) {
    return {
      kind: "warning",
      message:
        `extends entry '${entry.source}': SUBSTRATE_OFFLINE=1 is set; github sources are ` +
        `not fetched. Mirror via a file: source or a private npm registry.`,
    };
  }
  return {
    kind: "error",
    message:
      `extends entry '${entry.source}': github: source resolution is not yet implemented ` +
      `(lands in substrate v3.0.0-alpha.1 sub-phase C). Use a file: source or npm: source ` +
      `for now.`,
  };
}
