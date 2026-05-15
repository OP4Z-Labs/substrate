import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { copyTemplate } from "../util/fs.js";
import { getTemplatesDir, resolveTargetRoot } from "../util/paths.js";

export interface CreateOptions {
  template: string;
  name: string;
  /** Target root (defaults to cwd). The template's "expected subpath" is appended. */
  cwd?: string;
  /** Override the destination path entirely (skips template-defaults logic). */
  destination?: string;
  quiet?: boolean;
}

export interface CreateResult {
  template: string;
  name: string;
  destination: string;
  filesCreated: string[];
  filesSkipped: string[];
}

/**
 * Default destination subpaths per template.
 *
 * These match common monorepo layouts (and OP4Z's specifically). Users
 * with a different layout can pass `--destination` to override.
 *
 * v0.3 will read these from a per-template `manifest.json` so the
 * mapping isn't hardcoded; v0.1 keeps it inline for simplicity.
 */
const TEMPLATE_DESTINATIONS: Record<string, string> = {
  "package-ts": "packages/typescript",
  "package-python": "packages/python",
};

/**
 * Validate a package name. Keep it boring: lowercase, kebab-case, no
 * leading dot. Mirrors npm's package-name rules without pulling in
 * `validate-npm-package-name`.
 */
function validateName(name: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Cadence: invalid name "${name}". Use lowercase kebab-case (e.g. my-package).`,
    );
  }
}

export function runCreate(options: CreateOptions): CreateResult {
  const templatesRoot = getTemplatesDir();
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);

  if (!options.template) {
    throw new Error(`Cadence: --template is required. ${availableTemplatesHint(templatesRoot)}`);
  }
  if (!options.name) {
    throw new Error("Cadence: --name is required.");
  }
  validateName(options.name);

  const templateDir = join(templatesRoot, options.template);
  if (!existsSync(templateDir) || !statSync(templateDir).isDirectory()) {
    throw new Error(
      `Cadence: template "${options.template}" not found. ${availableTemplatesHint(templatesRoot)}`,
    );
  }
  if (!isScaffoldableTemplate(options.template)) {
    throw new Error(
      `Cadence: template "${options.template}" is not a scaffold template (reserved for internal use).`,
    );
  }

  const root = resolveTargetRoot(options.cwd);
  const defaultParent = TEMPLATE_DESTINATIONS[options.template];
  const destination =
    options.destination ??
    (defaultParent ? join(root, defaultParent, options.name) : join(root, options.name));

  if (existsSync(destination)) {
    // We allow proceeding if the directory exists but is empty.
    const entries = readdirSync(destination);
    if (entries.length > 0) {
      throw new Error(
        `Cadence: destination ${destination} already exists and is non-empty. Aborting to avoid clobbering.`,
      );
    }
  }

  log(kleur.bold(`\nScaffolding ${options.template} → ${destination}\n`));

  const replacements: Record<string, string> = {
    "{{NAME}}": options.name,
    "{{NAME_PASCAL}}": toPascalCase(options.name),
    "{{NAME_SNAKE}}": options.name.replace(/-/g, "_"),
  };

  const { created, skipped } = copyTemplate(templateDir, destination, replacements);
  for (const rel of created) log(kleur.green("✓") + ` ${rel}`);
  for (const rel of skipped) log(kleur.dim(`  skipped ${rel} (exists)`));

  log(
    "\n" +
      kleur.bold("Next steps:") +
      "\n  1. " +
      kleur.cyan(`cd ${destination}`) +
      "\n  2. Install dependencies (npm install or poetry install).\n",
  );

  return {
    template: options.template,
    name: options.name,
    destination,
    filesCreated: created,
    filesSkipped: skipped,
  };
}

function availableTemplatesHint(templatesRoot: string): string {
  const candidates = listScaffoldableTemplates(templatesRoot);
  return candidates.length > 0
    ? `Available: ${candidates.join(", ")}.`
    : "No scaffold templates available.";
}

function listScaffoldableTemplates(templatesRoot: string): string[] {
  if (!existsSync(templatesRoot)) return [];
  return readdirSync(templatesRoot)
    .filter((entry) => {
      const full = join(templatesRoot, entry);
      return statSync(full).isDirectory() && isScaffoldableTemplate(entry);
    })
    .sort();
}

function isScaffoldableTemplate(name: string): boolean {
  // `audit-instructions`, `init`, `bridges` are framework-internal:
  // they're consumed by `cadence init`, not exposed to `cadence create`.
  return !["audit-instructions", "init", "bridges"].includes(name);
}

function toPascalCase(input: string): string {
  return input
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
