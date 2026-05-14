/**
 * `cadence add <item>` — shadcn-parallel single-item scaffolding.
 *
 * Categories supported in v0.3:
 *
 *   audit     — copy templates/audits/audit-<name>.md → auto/instructions/main/
 *   standard  — copy templates/standards/<scope>/<area>.md → auto/standards/<scope>/
 *   scaffold  — register a scaffold template in auto/config/scaffolds.yaml. The
 *               scaffold template files themselves live in node_modules and are
 *               consumed by `cadence create`.
 *   command   — write a stub command doc into auto/commands/<name>.md
 *   workflow  — register a workflow manifest in auto/config/workflows.yaml and
 *               drop a stub doc in auto/instructions/workflows/<id>.md
 *
 * Every successful add updates `auto/.cadence-manifest.json` so v0.5's
 * upgrade flow has a record of what was scaffolded from what template
 * version.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import kleur from "kleur";
import { ensureDir, listFiles, readText, writeFileIfMissing } from "../util/fs.js";
import { buildEntry, recordEntry } from "../util/manifest.js";
import { getTemplatesDir, resolveTargetRoot } from "../util/paths.js";

export type AddCategory = "audit" | "standard" | "scaffold" | "command" | "workflow";

export interface AddOptions {
  category: AddCategory;
  /**
   * Item identifier. For audits / commands it's the bare name
   * (`backend`, `audit`). For standards it's the `<scope>/<area>` pair
   * (`backend/architecture`). For scaffolds / workflows it's a registry
   * key.
   */
  item: string;
  cwd?: string;
  quiet?: boolean;
  /**
   * If true, overwrite the target file when it already exists. Default
   * false (preserves the user's edits — shadcn-style).
   */
  overwrite?: boolean;
}

export interface AddResult {
  category: AddCategory;
  item: string;
  /** Absolute paths of files written. */
  filesCreated: string[];
  /** Absolute paths of files that already existed and were preserved. */
  filesSkipped: string[];
  /** Manifest entries recorded (one per file created). */
  manifestEntries: string[];
}

export function runAdd(options: AddOptions): AddResult {
  const root = resolveTargetRoot(options.cwd);
  const autoDir = join(root, "auto");

  if (!existsSync(autoDir)) {
    throw new Error(
      `Cadence: auto/ directory not found at ${autoDir}. Run \`cadence init\` first.`,
    );
  }

  switch (options.category) {
    case "audit":
      return addAudit(root, autoDir, options);
    case "standard":
      return addStandard(root, autoDir, options);
    case "scaffold":
      return addScaffold(root, autoDir, options);
    case "command":
      return addCommand(root, autoDir, options);
    case "workflow":
      return addWorkflow(root, autoDir, options);
    default: {
      const exhaustive: never = options.category;
      throw new Error(`Cadence: unknown add category "${exhaustive as string}"`);
    }
  }
}

// ---------------------------------------------------------------- audit
function addAudit(root: string, autoDir: string, opts: AddOptions): AddResult {
  const templatesDir = getTemplatesDir();
  const sourcePath = join(templatesDir, "audits", `audit-${opts.item}.md`);
  if (!existsSync(sourcePath)) {
    const available = listAvailableAudits(templatesDir);
    throw new Error(
      `Cadence: audit template "${opts.item}" not found. ` +
        `Available: ${available.join(", ")}`,
    );
  }

  const targetDir = join(autoDir, "instructions", "main");
  ensureDir(targetDir);
  const targetPath = join(targetDir, `audit-${opts.item}.md`);
  return finalizeSingleFile(root, autoDir, sourcePath, targetPath, opts);
}

export function listAvailableAudits(templatesDir: string): string[] {
  const dir = join(templatesDir, "audits");
  return listFiles(dir)
    .map((p) => basename(p))
    .filter((n) => n.startsWith("audit-") && n.endsWith(".md"))
    .map((n) => n.slice("audit-".length, -".md".length))
    .sort();
}

// ------------------------------------------------------------- standard
function addStandard(root: string, autoDir: string, opts: AddOptions): AddResult {
  // Item is `<scope>/<area>` (e.g. "backend/architecture").
  const parts = opts.item.split("/");
  if (parts.length !== 2) {
    throw new Error(
      `Cadence: standard item must be "<scope>/<area>" (e.g. "backend/architecture"). Got "${opts.item}".`,
    );
  }
  const [scope, area] = parts;
  const templatesDir = getTemplatesDir();
  // The cross-cutting RULES.yaml is a special case — it's a .yaml not .md.
  const sourceCandidates = [
    join(templatesDir, "standards", scope, `${area}.md`),
    join(templatesDir, "standards", scope, `${area}.yaml`),
  ];
  const sourcePath = sourceCandidates.find(existsSync);
  if (!sourcePath) {
    const available = listAvailableStandards(templatesDir);
    throw new Error(
      `Cadence: standard "${opts.item}" not found. Available:\n  ${available.join("\n  ")}`,
    );
  }
  const ext = sourcePath.endsWith(".yaml") ? ".yaml" : ".md";
  const targetDir = join(autoDir, "standards", scope);
  ensureDir(targetDir);
  const targetPath = join(targetDir, `${area}${ext}`);
  return finalizeSingleFile(root, autoDir, sourcePath, targetPath, opts);
}

export function listAvailableStandards(templatesDir: string): string[] {
  const standardsDir = join(templatesDir, "standards");
  if (!existsSync(standardsDir)) return [];
  const entries: string[] = [];
  for (const scope of readdirSync(standardsDir)) {
    const scopeDir = join(standardsDir, scope);
    if (!statSync(scopeDir).isDirectory()) continue;
    for (const file of readdirSync(scopeDir)) {
      if (file.endsWith(".md") || file.endsWith(".yaml")) {
        const area = file.replace(/\.(md|yaml)$/, "");
        entries.push(`${scope}/${area}`);
      }
    }
  }
  return entries.sort();
}

// ------------------------------------------------------------- scaffold
function addScaffold(root: string, autoDir: string, opts: AddOptions): AddResult {
  // Scaffolds are registered, not copied — the template lives in the
  // framework package and is consumed by `cadence create`. We just record
  // it in auto/config/scaffolds.yaml so `cadence doctor` can verify the
  // registration is consistent.
  const templatesDir = getTemplatesDir();
  const templateDir = join(templatesDir, opts.item);
  if (!existsSync(templateDir)) {
    const available = listAvailableScaffolds(templatesDir);
    throw new Error(
      `Cadence: scaffold template "${opts.item}" not found. ` +
        `Available: ${available.join(", ")}`,
    );
  }

  const configDir = join(autoDir, "config");
  ensureDir(configDir);
  const registryPath = join(configDir, "scaffolds.yaml");
  const created: string[] = [];
  const skipped: string[] = [];

  const registry = readScaffoldsRegistry(registryPath);
  if (!registry.scaffolds.includes(opts.item)) {
    registry.scaffolds.push(opts.item);
    registry.scaffolds.sort();
    writeScaffoldsRegistry(registryPath, registry);
    created.push(registryPath);
    recordEntry(autoDir, buildEntry(root, registryPath, readText(registryPath)));
  } else {
    skipped.push(registryPath);
  }

  if (!opts.quiet) {
    if (created.length > 0) {
      console.log(kleur.green("✓") + ` registered scaffold "${opts.item}" in scaffolds.yaml`);
    } else {
      console.log(kleur.dim(`  scaffold "${opts.item}" was already registered`));
    }
  }

  return {
    category: "scaffold",
    item: opts.item,
    filesCreated: created,
    filesSkipped: skipped,
    manifestEntries: created.map((c) => relativeToRoot(root, c)),
  };
}

export function listAvailableScaffolds(templatesDir: string): string[] {
  if (!existsSync(templatesDir)) return [];
  const reserved = ["init", "bridges", "audits", "standards", "commands", "workflows"];
  return readdirSync(templatesDir)
    .filter((entry: string) => {
      const full = join(templatesDir, entry);
      return statSync(full).isDirectory() && !reserved.includes(entry);
    })
    .sort();
}

interface ScaffoldsRegistry {
  scaffolds: string[];
}

function readScaffoldsRegistry(path: string): ScaffoldsRegistry {
  if (!existsSync(path)) return { scaffolds: [] };
  const raw = readFileSync(path, "utf8");
  const scaffolds: string[] = [];
  let inList = false;
  for (const line of raw.split("\n")) {
    if (line.startsWith("scaffolds:")) {
      inList = true;
      continue;
    }
    if (inList) {
      const m = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (m) scaffolds.push(m[1].replace(/^["']|["']$/g, ""));
      else if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t")) {
        inList = false;
      }
    }
  }
  return { scaffolds };
}

function writeScaffoldsRegistry(path: string, registry: ScaffoldsRegistry): void {
  const lines = [
    "# Scaffold registry — managed by `cadence add scaffold <name>`.",
    "# Entries here are templates available to `cadence create --template <name>`.",
    "",
    "scaffolds:",
    ...registry.scaffolds.map((s) => `  - ${s}`),
    "",
  ];
  writeFileSync(path, lines.join("\n"), "utf8");
}

// -------------------------------------------------------------- command
function addCommand(root: string, autoDir: string, opts: AddOptions): AddResult {
  // Commands are markdown documentation files for slash-command surfaces.
  // v0.3 ships no built-in command templates beyond what init scaffolds;
  // this command currently only writes a stub the user can extend.
  const targetDir = join(autoDir, "commands");
  ensureDir(targetDir);
  const targetPath = join(targetDir, `${opts.item}.md`);

  if (existsSync(targetPath) && !opts.overwrite) {
    if (!opts.quiet) {
      console.log(kleur.dim(`  command "${opts.item}" already exists, preserving (use --overwrite to replace)`));
    }
    return {
      category: "command",
      item: opts.item,
      filesCreated: [],
      filesSkipped: [targetPath],
      manifestEntries: [],
    };
  }

  const stub = renderCommandStub(opts.item);
  writeFileSync(targetPath, stub, "utf8");
  recordEntry(autoDir, buildEntry(root, targetPath, stub));

  if (!opts.quiet) {
    console.log(kleur.green("✓") + ` auto/commands/${opts.item}.md`);
    console.log(kleur.dim(`  Edit the stub and document your command's surface.`));
  }

  return {
    category: "command",
    item: opts.item,
    filesCreated: [targetPath],
    filesSkipped: [],
    manifestEntries: [relativeToRoot(root, targetPath)],
  };
}

function renderCommandStub(name: string): string {
  return `---
command: ${name}
description: TODO — one-line summary of this command's purpose
schema_version: 1
---

# Command: \`${name}\`

> Cadence scaffold — fill in the TODOs.

## Overview

TODO: What this command does, when to use it, what it returns.

## Inputs

TODO: Required and optional arguments.

## Output

TODO: Files written, console output, exit codes.

## Steps

1. TODO
2. TODO
3. TODO

## Followups

TODO: What to do after the command finishes.

## Rules

**Do:** TODO.
**Don't:** TODO.
`;
}

// ------------------------------------------------------------- workflow
function addWorkflow(root: string, autoDir: string, opts: AddOptions): AddResult {
  // Workflows are multi-step automation manifests. v0.3 registers them
  // in auto/config/workflows.yaml and scaffolds a stub manifest doc.
  const configDir = join(autoDir, "config");
  ensureDir(configDir);
  const workflowsPath = join(configDir, "workflows.yaml");

  const manifest = readWorkflowsRegistry(workflowsPath);
  if (manifest.workflows.includes(opts.item)) {
    if (!opts.quiet) {
      console.log(kleur.dim(`  workflow "${opts.item}" already registered`));
    }
    return {
      category: "workflow",
      item: opts.item,
      filesCreated: [],
      filesSkipped: [workflowsPath],
      manifestEntries: [],
    };
  }
  manifest.workflows.push(opts.item);
  manifest.workflows.sort();
  writeWorkflowsRegistry(workflowsPath, manifest);

  // Also drop a stub workflow doc in auto/instructions/workflows/.
  const instructionsDir = join(autoDir, "instructions", "workflows");
  ensureDir(instructionsDir);
  const docPath = join(instructionsDir, `${opts.item}.md`);
  const created: string[] = [workflowsPath];
  const skipped: string[] = [];
  const stub = renderWorkflowStub(opts.item);
  if (writeFileIfMissing(docPath, stub)) {
    created.push(docPath);
    recordEntry(autoDir, buildEntry(root, docPath, stub));
  } else {
    skipped.push(docPath);
  }
  recordEntry(autoDir, buildEntry(root, workflowsPath, readText(workflowsPath)));

  if (!opts.quiet) {
    console.log(kleur.green("✓") + ` registered workflow "${opts.item}" in workflows.yaml`);
    if (created.includes(docPath)) {
      console.log(kleur.green("✓") + ` auto/instructions/workflows/${opts.item}.md`);
    }
  }

  return {
    category: "workflow",
    item: opts.item,
    filesCreated: created,
    filesSkipped: skipped,
    manifestEntries: created.map((c) => relativeToRoot(root, c)),
  };
}

interface WorkflowsRegistry {
  workflows: string[];
}

function readWorkflowsRegistry(path: string): WorkflowsRegistry {
  if (!existsSync(path)) return { workflows: [] };
  const raw = readFileSync(path, "utf8");
  const workflows: string[] = [];
  let inList = false;
  for (const line of raw.split("\n")) {
    if (line.startsWith("workflows:")) {
      inList = true;
      continue;
    }
    if (inList) {
      const m = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (m) workflows.push(m[1].replace(/^["']|["']$/g, ""));
      else if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t")) {
        inList = false;
      }
    }
  }
  return { workflows };
}

function writeWorkflowsRegistry(path: string, registry: WorkflowsRegistry): void {
  const lines = [
    "# Workflow registry — managed by `cadence add workflow <id>`.",
    "# The runtime executor for workflows ships in v0.5; v0.3 just tracks them.",
    "",
    "workflows:",
    ...registry.workflows.map((w) => `  - ${w}`),
    "",
  ];
  writeFileSync(path, lines.join("\n"), "utf8");
}

function renderWorkflowStub(id: string): string {
  return `---
workflow: ${id}
description: TODO — one-line summary of this workflow's outcome
schema_version: 1
---

# Workflow: \`${id}\`

> Cadence scaffold — fill in the TODOs.

## Outcome

TODO: What is true at the end of this workflow that wasn't true before.

## Prerequisites

TODO: What must hold before this workflow can start.

## Variables

TODO: Inputs the user passes (\`--var key=value\`).

## Steps

1. **TODO** — first step
   - Detail
   - Detail
2. **TODO** — second step
3. **TODO** — third step

## Outputs

TODO: Files / state changes the workflow produces.

## Rollback

TODO: How to undo if a step fails partway through.
`;
}

// ---------------------------------------------------------------- core
function finalizeSingleFile(
  root: string,
  autoDir: string,
  sourcePath: string,
  targetPath: string,
  opts: AddOptions,
): AddResult {
  const contents = readText(sourcePath);
  let wrote = false;
  if (opts.overwrite || !existsSync(targetPath)) {
    writeFileSync(targetPath, contents, "utf8");
    wrote = true;
  }

  if (wrote) {
    recordEntry(autoDir, buildEntry(root, targetPath, contents));
    if (!opts.quiet) {
      console.log(kleur.green("✓") + ` ${relativeToRoot(root, targetPath)}`);
    }
  } else if (!opts.quiet) {
    console.log(
      kleur.dim(
        `  ${relativeToRoot(root, targetPath)} already exists, preserving (use --overwrite to replace)`,
      ),
    );
  }

  return {
    category: opts.category,
    item: opts.item,
    filesCreated: wrote ? [targetPath] : [],
    filesSkipped: wrote ? [] : [targetPath],
    manifestEntries: wrote ? [relativeToRoot(root, targetPath)] : [],
  };
}

function relativeToRoot(root: string, abs: string): string {
  if (abs.startsWith(root)) {
    return abs.slice(root.length).replace(/^[/\\]+/, "");
  }
  return abs;
}
