/**
 * Substrate v3 — `extends` primitive (NE-11).
 *
 * Public surface for the extends layer:
 *   - resolver       : `resolveExtendsChain`, `mergeWithCollisionRecords`
 *   - validator      : `validateConfig`, `validateExtendsSource`,
 *                      `classifyExtendsSource`
 *   - discovery      : `discover{Workflows,Hooks,DocChecks}AcrossExtends`
 *   - context-merge  : `discover{Standards,Rules}AcrossExtends`
 *   - source-kinds   : `resolveSourceRoot`, `resolveOffline`
 *
 * Consumers (CLI commands, programmatic API) opt into the merged
 * variants when the consumer config declares `extends`. v2.0 callers
 * that import the v2 discoverers directly continue to see the
 * single-root behavior unchanged.
 */

export {
  classifyExtendsSource,
  validateConfig,
  validateConfigFile,
  validateExtendsSource,
  type ConfigValidationError,
  type ConfigValidationResult,
  type ExtendsKind,
} from "./config-validator.js";

export {
  mergeWithCollisionRecords,
  resolveExtendsChain,
  type CollisionClass,
  type CollisionRecord,
  type ResolvedExtendsChain,
  type ResolvedSource,
  type ResolveExtendsOptions,
  type ResolverWarning,
} from "./resolver.js";

export {
  discoverWorkflowsAcrossExtends,
  discoverHooksAcrossExtends,
  discoverDocChecksAcrossExtends,
  type MergedDiscoveryResult,
  type MergedDocCheck,
  type MergedHook,
  type MergedWorkflow,
  type Provenance,
} from "./discovery.js";

export {
  discoverStandardsAcrossExtends,
  discoverRulesAcrossExtends,
  type MergedRulesResult,
  type MergedStandardsResult,
} from "./context-merge.js";

export {
  resolveSourceRoot,
  resolveOffline,
  type ResolveSourceRootOptions,
  type SourceResolutionError,
  type SourceResolutionOk,
  type SourceResolutionResult,
  type SourceResolutionWarning,
} from "./source-kinds.js";

export {
  clearExtendsCache,
  refreshGithubSource,
  resolveGithubSource,
  type GithubResolutionContext,
  type GitRunner,
} from "./github-source.js";
