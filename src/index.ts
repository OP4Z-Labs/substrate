/**
 * Cadence — programmatic entry point.
 *
 * The CLI is the primary interface (see {@link ./cli.ts}). This module
 * re-exports the building blocks for users who want to invoke Cadence
 * commands programmatically (e.g. from a custom script or test).
 */

export { runInit } from "./commands/init.js";
export { runAuditList, runAuditType } from "./commands/audit.js";
export { runCreate } from "./commands/create.js";
export type {
  CadenceConfig,
  CadenceManifest,
  ManifestEntry,
} from "./util/types.js";
export { CADENCE_VERSION } from "./util/version.js";
