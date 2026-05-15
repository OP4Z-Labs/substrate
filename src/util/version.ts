/**
 * Canonical version string for the cadence CLI.
 *
 * Kept in sync with package.json by convention. We don't auto-load
 * package.json at runtime because (a) it complicates the bundle, and
 * (b) ESM JSON imports require either an assertion or fs read, both
 * of which create unnecessary surface for v0.1.
 *
 * If you bump package.json, bump this string. A pre-publish hook in
 * a later version should enforce parity.
 */
export const CADENCE_VERSION = "0.5.0";
