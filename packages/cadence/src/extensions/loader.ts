/**
 * Adapter loader — resolves the configured task/vcs adapter from
 * `cadence.config.json` and dynamically imports it at runtime.
 *
 * Design call: `extensions.taskAdapter` is a string OR null.
 *
 *   - string (npm package name): `import(packageName)` resolves
 *     the adapter. The package's default export must satisfy
 *     `isTaskAdapter()`. Errors here are surfaced as actionable
 *     install hints ("did you `npm install <pkg>`?").
 *
 *   - null: no adapter; `cadence task` commands print a "no task
 *     adapter configured" error with the install hint. This is the
 *     v0.5 default — public cadence ships with no opinion on which
 *     tracker you use.
 *
 * For vcsAdapter, null means "use the built-in git adapter". A
 * non-null value works the same way as taskAdapter — a package name
 * to dynamically import.
 *
 * Why dynamic import (vs static deps): adapters are user-chosen. Hard-
 * coding `import linearAdapter from "@cadence/adapter-linear"` would
 * force every user to install Linear's SDK regardless of which tracker
 * they use. Dynamic import keeps cadence's runtime install footprint
 * narrow (commander + kleur + inquirer + yaml).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTargetRoot } from "../util/paths.js";
import type { CadenceConfig } from "../util/types.js";
import { isTaskAdapter, type TaskAdapter } from "./task-adapter.js";
import { isVcsAdapter, type VcsAdapter } from "./vcs-adapter.js";

export interface AdapterLoadOptions {
  cwd?: string;
}

export class AdapterLoadError extends Error {
  constructor(
    message: string,
    public readonly packageName: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AdapterLoadError";
  }
}

function readConfig(root: string): CadenceConfig | null {
  const path = join(root, "cadence.config.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CadenceConfig;
  } catch {
    return null;
  }
}

/**
 * Read the configured task adapter package name from cadence.config.json.
 * Returns null when:
 *   - config is missing
 *   - `extensions.taskAdapter` is null / undefined / empty string
 */
export function readConfiguredTaskAdapter(cwd?: string): string | null {
  const root = resolveTargetRoot(cwd);
  const config = readConfig(root);
  if (!config) return null;
  const extensions = (config as { extensions?: { taskAdapter?: string | null } })
    .extensions;
  const value = extensions?.taskAdapter ?? null;
  if (!value || typeof value !== "string") return null;
  return value.trim() || null;
}

/**
 * Read the configured VCS adapter package name. A null return signals
 * "use the built-in git adapter" — the caller is expected to fall back
 * to that default.
 */
export function readConfiguredVcsAdapter(cwd?: string): string | null {
  const root = resolveTargetRoot(cwd);
  const config = readConfig(root);
  if (!config) return null;
  const extensions = (config as { extensions?: { vcsAdapter?: string | null } })
    .extensions;
  const value = extensions?.vcsAdapter ?? null;
  if (!value || typeof value !== "string") return null;
  return value.trim() || null;
}

/**
 * Load a task adapter from the configured package name. Returns null when
 * no adapter is configured (caller decides whether that's a usable state).
 *
 * Throws `AdapterLoadError` when the package is configured but unloadable
 * or doesn't satisfy the interface — that's a misconfiguration that
 * should surface loudly.
 */
export async function loadTaskAdapter(
  options: AdapterLoadOptions = {},
): Promise<TaskAdapter | null> {
  const packageName = readConfiguredTaskAdapter(options.cwd);
  if (!packageName) return null;
  return importTaskAdapterModule(packageName);
}

/**
 * Variant for tests / programmatic callers that want to bypass the config
 * lookup. Useful when the adapter ships in-repo (monorepo packages can
 * pass an absolute path).
 */
export async function importTaskAdapterModule(packageSpec: string): Promise<TaskAdapter> {
  let mod: { default?: unknown } & Record<string, unknown>;
  try {
    mod = (await import(packageSpec)) as { default?: unknown } & Record<string, unknown>;
  } catch (cause) {
    throw new AdapterLoadError(
      `Cadence: could not load task adapter "${packageSpec}". ` +
        `Hint: \`npm install ${packageSpec}\` and check the package's main export.`,
      packageSpec,
      cause,
    );
  }
  const candidate = mod.default ?? mod;
  if (!isTaskAdapter(candidate)) {
    throw new AdapterLoadError(
      `Cadence: package "${packageSpec}" does not export a valid TaskAdapter. ` +
        `Default export must implement findTask/searchTasks/createTask/updateTask/completeTask.`,
      packageSpec,
    );
  }
  return candidate;
}

/**
 * Load the VCS adapter. When no `extensions.vcsAdapter` is set, falls back
 * to the built-in git adapter. Failure to load a *configured* override is
 * surfaced as AdapterLoadError (we don't silently fall through to git when
 * the user has asked for something else).
 */
export async function loadVcsAdapter(
  options: AdapterLoadOptions = {},
): Promise<VcsAdapter> {
  const packageName = readConfiguredVcsAdapter(options.cwd);
  if (!packageName) {
    const { gitAdapter } = await import("../adapters/git.js");
    return gitAdapter;
  }
  return importVcsAdapterModule(packageName);
}

export async function importVcsAdapterModule(packageSpec: string): Promise<VcsAdapter> {
  let mod: { default?: unknown } & Record<string, unknown>;
  try {
    mod = (await import(packageSpec)) as { default?: unknown } & Record<string, unknown>;
  } catch (cause) {
    throw new AdapterLoadError(
      `Cadence: could not load vcs adapter "${packageSpec}". ` +
        `Hint: \`npm install ${packageSpec}\` and check the package's main export.`,
      packageSpec,
      cause,
    );
  }
  const candidate = mod.default ?? mod;
  if (!isVcsAdapter(candidate)) {
    throw new AdapterLoadError(
      `Cadence: package "${packageSpec}" does not export a valid VcsAdapter. ` +
        `Default export must implement getStatus/getBranch/getRemote/getDiff/commit.`,
      packageSpec,
    );
  }
  return candidate;
}
