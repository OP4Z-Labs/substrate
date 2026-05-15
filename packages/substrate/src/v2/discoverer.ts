/**
 * Substrate v2 — Discoverer.
 *
 * Walks the consumer repo's substrate/ directory, reads workflow
 * manifests + their prose bodies, validates each against the schema,
 * and returns an in-memory registry.
 *
 * Layer: deterministic. Pure: no AI, no IO beyond reads, no mutation.
 *
 * The Discoverer is intentionally narrow. Hooks (B2), doc-checks
 * (B2), and RULES.yaml (already handled by v1.0's audit subsystem)
 * are listed as concepts in §5 of the plan; they will be added here
 * as their primitives ship. B1 ships workflow discovery only.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveTargetRoot } from "../util/paths.js";
import {
  validateManifest,
  type ValidationError,
} from "./validate.js";
import type { WorkflowDescriptor, WorkflowManifest } from "./types.js";

const WORKFLOWS_RELPATH = join("substrate", "workflows");

export interface DiscoveryOptions {
  /** Override the consumer repo root (test seam). */
  cwd?: string;
  /**
   * If true, include manifests that failed validation in
   * `invalidWorkflows`. Default: false (errors are still surfaced via
   * the `invalidWorkflows` array, but valid + invalid don't mix in the
   * primary `workflows` list).
   */
  includeInvalid?: boolean;
}

export interface InvalidManifest {
  manifestPath: string;
  errors: ValidationError[];
}

export interface DiscoveryResult {
  /** All validated workflow manifests, sorted by id. */
  workflows: WorkflowDescriptor[];
  /** Manifests that exist on disk but failed validation. */
  invalidWorkflows: InvalidManifest[];
  /** Absolute path of the substrate/workflows/ directory walked (may not exist). */
  workflowsDir: string;
}

/**
 * Discover all v2 workflow manifests under
 * `<consumer-repo>/substrate/workflows/`. Returns an empty result if
 * the directory doesn't exist (this is a normal pre-init state).
 */
export function discoverWorkflows(options: DiscoveryOptions = {}): DiscoveryResult {
  const root = resolveTargetRoot(options.cwd);
  const workflowsDir = join(root, WORKFLOWS_RELPATH);
  const result: DiscoveryResult = {
    workflows: [],
    invalidWorkflows: [],
    workflowsDir,
  };
  if (!existsSync(workflowsDir)) {
    return result;
  }

  const manifestFiles = listYamlFilesShallow(workflowsDir);
  for (const file of manifestFiles) {
    const raw = readFileSync(file, "utf8");
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      result.invalidWorkflows.push({
        manifestPath: file,
        errors: [
          {
            path: "",
            keyword: "parse-error",
            message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      });
      continue;
    }
    const validation = validateManifest(parsed);
    if (!validation.ok) {
      result.invalidWorkflows.push({
        manifestPath: file,
        errors: validation.errors,
      });
      continue;
    }
    const manifest = parsed as WorkflowManifest;
    const bodyPath = file.replace(/\.ya?ml$/, ".body.md");
    const body = existsSync(bodyPath) ? readFileSync(bodyPath, "utf8") : null;
    result.workflows.push({
      manifest,
      body,
      manifestPath: file,
      bodyPath: existsSync(bodyPath) ? bodyPath : null,
    });
  }

  // Stable order — id-sorted — so callers get deterministic output.
  result.workflows.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  result.invalidWorkflows.sort((a, b) =>
    a.manifestPath.localeCompare(b.manifestPath),
  );
  return result;
}

/**
 * Locate a single workflow by id without walking the full directory.
 * Convenience wrapper around `discoverWorkflows`; the cost difference
 * is negligible because manifest counts are typically <100.
 */
export function findWorkflowById(
  id: string,
  options: DiscoveryOptions = {},
): WorkflowDescriptor | null {
  const discovery = discoverWorkflows(options);
  return discovery.workflows.find((w) => w.manifest.id === id) ?? null;
}

/**
 * Filter workflows whose `kind` matches one of the given values.
 * Workflows without a `kind` field are excluded.
 */
export function findWorkflowsByKind(
  kind: string,
  options: DiscoveryOptions = {},
): WorkflowDescriptor[] {
  const discovery = discoverWorkflows(options);
  return discovery.workflows.filter((w) => w.manifest.kind === kind);
}

function listYamlFilesShallow(dir: string): string[] {
  // Workflows live at the top level of substrate/workflows/. We
  // intentionally don't recurse — nested subdirectories are reserved
  // for future use (e.g. workflows/templates/).
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    if (name.endsWith(".body.md")) continue;
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile()) {
      out.push(full);
    }
  }
  out.sort();
  return out;
}
