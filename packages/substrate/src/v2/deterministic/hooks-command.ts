/**
 * `substrate hooks list|describe` — deterministic hook inspection.
 *
 * Layer: deterministic. Read-only walk of `substrate/hooks/*.yaml`,
 * surfacing the discovered registry. Useful for:
 *   - debugging "why didn't my hook fire?"
 *   - CI scripts that enforce a known-hook set
 *   - workflow authors checking what cross-cutting hooks exist before
 *     wiring a new one
 *
 * Both subcommands accept `--json` for machine-readable output.
 */

import { join } from "node:path";
import kleur from "kleur";
import type { HookDescriptor } from "../hooks.js";
import { discoverHooksAcrossExtends } from "../extends/index.js";
import { resolveTargetRoot } from "../../util/paths.js";

export interface HooksListOptions {
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
  /** Filter to hooks matching one of these trigger kinds. */
  trigger?: string[];
}

export interface HooksListResult {
  hooks: Array<{
    id: string;
    description?: string;
    trigger: string[];
    matches?: Record<string, unknown>;
    enabled: boolean;
    order: number;
    stepType: string;
    manifestPath: string;
  }>;
  invalidHooks: Array<{ manifestPath: string; errors: unknown[] }>;
  hooksDir: string;
}

export function runHooksList(options: HooksListOptions = {}): HooksListResult {
  // v3 extends-aware hook discovery (NE-11 beta.1, bug #2). Walks the
  // resolved extends chain and merges by hook id with repo-local-wins.
  // Collapses to single-root behavior on v2-shaped consumers.
  const merged = discoverHooksAcrossExtends({ cwd: options.cwd });
  let hooks = merged.entries.map((e) => e.descriptor);
  if (options.trigger && options.trigger.length > 0) {
    hooks = hooks.filter((h) =>
      h.manifest.trigger.some((t) => options.trigger!.includes(t)),
    );
  }
  const repoLocalHooksDir = join(
    resolveTargetRoot(options.cwd),
    "substrate",
    "hooks",
  );
  const result: HooksListResult = {
    hooks: hooks.map(summarize),
    invalidHooks: merged.invalid.map((i) => {
      const problem = i.problem as {
        manifestPath: string;
        errors: unknown[];
      };
      return {
        manifestPath: problem.manifestPath,
        errors: problem.errors,
      };
    }),
    hooksDir: repoLocalHooksDir,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (options.quiet) return result;

  if (result.hooks.length === 0 && result.invalidHooks.length === 0) {
    console.log(kleur.yellow("No hooks discovered."));
    console.log(kleur.dim(`  Looked under: ${result.hooksDir}`));
    return result;
  }
  for (const hook of result.hooks) {
    const enabledTag = hook.enabled ? "" : kleur.dim(" (disabled)");
    console.log(
      `  ${kleur.cyan(hook.id)} ${kleur.dim(`[${hook.trigger.join(",")}]`)} ${hook.description ?? ""}${enabledTag}`,
    );
  }
  for (const bad of result.invalidHooks) {
    console.log(kleur.red(`  ✗ ${bad.manifestPath} — invalid manifest`));
  }
  return result;
}

export interface HooksDescribeOptions {
  id: string;
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface HooksDescribeResult {
  found: boolean;
  hook?: HooksListResult["hooks"][number] & { step?: Record<string, unknown> };
  manifestPath?: string;
  warning?: string;
}

export function runHooksDescribe(
  options: HooksDescribeOptions,
): HooksDescribeResult {
  // v3 extends-aware: resolves hooks across the extends chain so
  // `substrate hooks describe <id>` finds org-shared hooks too.
  const merged = discoverHooksAcrossExtends({ cwd: options.cwd });
  const hooks = merged.entries.map((e) => e.descriptor);
  const match = hooks.find((h) => h.manifest.id === options.id);
  if (!match) {
    const result: HooksDescribeResult = {
      found: false,
      warning: `Hook "${options.id}" not found. Discovered: ${hooks.map((h) => h.manifest.id).join(", ") || "(none)"}`,
    };
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else if (!options.quiet) {
      console.log(kleur.yellow(result.warning ?? ""));
    }
    return result;
  }
  const summary = summarize(match);
  const result: HooksDescribeResult = {
    found: true,
    hook: {
      ...summary,
      step: match.manifest.step as unknown as Record<string, unknown>,
    },
    manifestPath: match.manifestPath,
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (!options.quiet) {
    console.log(kleur.bold(`Hook: ${summary.id}`));
    if (summary.description) console.log(`  ${summary.description}`);
    console.log(`  trigger:  ${summary.trigger.join(", ")}`);
    console.log(`  enabled:  ${summary.enabled}`);
    console.log(`  order:    ${summary.order}`);
    console.log(`  step:     ${summary.stepType}`);
    if (match.manifest.step.command) {
      console.log(`  command:  ${match.manifest.step.command}`);
    }
    if (match.manifest.step.handler) {
      console.log(`  handler:  ${match.manifest.step.handler}`);
    }
    if (summary.matches) {
      console.log(`  matches:  ${JSON.stringify(summary.matches)}`);
    }
    console.log(kleur.dim(`  source:   ${match.manifestPath}`));
  }
  return result;
}

function summarize(descriptor: HookDescriptor) {
  const m = descriptor.manifest;
  return {
    id: m.id,
    description: m.description,
    trigger: m.trigger,
    matches: m.matches as Record<string, unknown> | undefined,
    enabled: m.enabled !== false,
    order: m.order ?? 100,
    stepType: m.step.type,
    manifestPath: descriptor.manifestPath,
  };
}
