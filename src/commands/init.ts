import { readFileSync } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import {
  ALL_STACKS,
  type Stack,
  defaultAuditsFor,
  defaultStandardsFor,
  detectStacks,
} from "../util/detect.js";
import { copyTemplate, ensureDir, writeFileIfMissing } from "../util/fs.js";
import { AUTO_SUBDIRS, getTemplatesDir, resolveTargetRoot } from "../util/paths.js";
import type { CadenceConfig, CadenceManifest } from "../util/types.js";
import { CADENCE_VERSION } from "../util/version.js";

export interface InitOptions {
  /** Override the target directory (defaults to cwd). */
  cwd?: string;
  /** Project name for cadence.config.json. Defaults to the directory name. */
  projectName?: string;
  /** Short code used for task tags in commits (e.g. `OP` → `[OP-123]`). */
  shortCode?: string;
  /** Stacks listed in config. Defaults to ["python", "typescript"] per v0.1 plan. */
  stacks?: string[];
  /** Also scaffold `.claude/commands/cadence.md` bridge. */
  withClaude?: boolean;
  /** Don't print to console (useful for tests). */
  quiet?: boolean;
}

export interface InitResult {
  /** Repo-absolute path of the auto/ directory. */
  autoDir: string;
  /** Whether cadence.config.json was newly created. */
  configCreated: boolean;
  /** Whether the manifest stub was newly created. */
  manifestCreated: boolean;
  /** Whether the Claude bridge was scaffolded. */
  claudeBridgeCreated: boolean;
  /** Files created from the init template (relative paths). */
  filesCreated: string[];
  /** Files that already existed and were skipped. */
  filesSkipped: string[];
}

/**
 * Programmatic entry point for `cadence init`.
 *
 * Behavioural contract (the v0.1 acceptance criterion):
 *
 *   1. Create `<auto>/` and the seven canonical subdirectories.
 *   2. Copy the bundled `templates/init/` tree (default audit
 *      instructions, README placeholders, etc.) into the user's repo.
 *   3. Write `cadence.config.json` at the repo root if missing.
 *   4. Write an empty `auto/.cadence-manifest.json` stub if missing.
 *   5. If `withClaude`, scaffold `.claude/commands/cadence.md`.
 *
 * The function is idempotent: re-running on a populated repo skips
 * existing files rather than overwriting (matches shadcn's add-only
 * ergonomic).
 */
export function runInit(options: InitOptions = {}): InitResult {
  const root = resolveTargetRoot(options.cwd);
  const projectName = options.projectName ?? root.split("/").pop() ?? "project";
  const shortCode = options.shortCode ?? deriveShortCode(projectName);

  // v0.3: stacks come from auto-detection unless explicitly overridden.
  // We keep the v0.1 fallback (python + typescript) for the "detected
  // nothing" branch so existing tests and bare init flows behave the same.
  let stacks: string[];
  let detectionSource: "override" | "detected" | "fallback";
  if (options.stacks && options.stacks.length > 0) {
    stacks = options.stacks;
    detectionSource = "override";
  } else {
    const detection = detectStacks(root);
    if (detection.stacks.length > 0) {
      stacks = detection.stacks;
      detectionSource = "detected";
    } else {
      stacks = ["python", "typescript"];
      detectionSource = "fallback";
    }
  }
  const stackTyped = stacks.filter((s): s is Stack => (ALL_STACKS as readonly string[]).includes(s));
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const templatesDir = getTemplatesDir();

  log(kleur.bold(`\nInitializing cadence in ${root}`));
  log(kleur.dim(`  project: ${projectName} (${shortCode})`));
  log(
    kleur.dim(
      `  stacks:  ${stacks.join(", ")} ` +
        `(${detectionSource === "override" ? "from --stack" : detectionSource === "detected" ? "auto-detected" : "fallback default"})\n`,
    ),
  );

  const autoDir = join(root, "auto");
  ensureDir(autoDir);
  for (const sub of AUTO_SUBDIRS) {
    ensureDir(join(autoDir, sub));
  }
  log(kleur.green("✓") + ` auto/ skeleton (${AUTO_SUBDIRS.length} subdirs)`);

  // Copy the default content tree (audit instructions, README placeholders).
  const initTemplate = join(templatesDir, "init");
  const { created, skipped } = copyTemplate(initTemplate, autoDir, {
    "{{PROJECT_NAME}}": projectName,
    "{{SHORT_CODE}}": shortCode,
    "{{CADENCE_VERSION}}": CADENCE_VERSION,
  });
  for (const rel of created) log(kleur.green("✓") + ` auto/${rel}`);
  for (const rel of skipped) log(kleur.dim(`  skipped auto/${rel} (exists)`));

  // cadence.config.json
  const configPath = join(root, "cadence.config.json");
  const config = buildDefaultConfig(
    projectName,
    shortCode,
    stacks,
    stackTyped,
    options.withClaude ?? false,
  );
  const configCreated = writeFileIfMissing(configPath, JSON.stringify(config, null, 2) + "\n");
  log(
    configCreated
      ? kleur.green("✓") + " cadence.config.json"
      : kleur.dim("  skipped cadence.config.json (exists)"),
  );

  // auto/.cadence-manifest.json
  const manifestPath = join(autoDir, ".cadence-manifest.json");
  const manifest: CadenceManifest = {
    schemaVersion: 1,
    cadenceVersion: CADENCE_VERSION,
    entries: [],
  };
  const manifestCreated = writeFileIfMissing(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  log(
    manifestCreated
      ? kleur.green("✓") + " auto/.cadence-manifest.json (stub)"
      : kleur.dim("  skipped auto/.cadence-manifest.json (exists)"),
  );

  // .claude/commands/cadence.md (optional bridge)
  let claudeBridgeCreated = false;
  if (options.withClaude) {
    const bridgeSource = join(templatesDir, "bridges", "claude", "cadence.md");
    const bridgeTarget = join(root, ".claude", "commands", "cadence.md");
    const bridgeContent = applyBridgeReplacements(
      readBridgeTemplate(bridgeSource),
      projectName,
      shortCode,
    );
    claudeBridgeCreated = writeFileIfMissing(bridgeTarget, bridgeContent);
    log(
      claudeBridgeCreated
        ? kleur.green("✓") + " .claude/commands/cadence.md"
        : kleur.dim("  skipped .claude/commands/cadence.md (exists)"),
    );
  }

  log(
    "\n" +
      kleur.bold("Next steps:") +
      "\n  1. Review " +
      kleur.cyan("cadence.config.json") +
      " and adjust paths/stacks for your repo." +
      "\n  2. Run " +
      kleur.cyan("cadence audit --list") +
      " to see the scaffolded audits." +
      "\n  3. Edit " +
      kleur.cyan("auto/instructions/main/audit-*.md") +
      " — these are yours now; the framework reads from your copy.\n",
  );

  return {
    autoDir,
    configCreated,
    manifestCreated,
    claudeBridgeCreated,
    filesCreated: created,
    filesSkipped: skipped,
  };
}

function buildDefaultConfig(
  name: string,
  shortCode: string,
  stacks: string[],
  stackTyped: Stack[],
  withClaude: boolean,
): CadenceConfig {
  // v0.3: defaults are derived from detected stacks. The full audit catalog
  // is always *available* via `cadence add audit <name>`; the `defaults`
  // entries are the ones init pre-enables (and that future tooling like
  // `cadence audit --all` will iterate over).
  const audits = stackTyped.length > 0
    ? defaultAuditsFor(stackTyped)
    : ["pre-merge", "dependencies", "dead-code"]; // v0.1 fallback
  const standards = stackTyped.length > 0
    ? defaultStandardsFor(stackTyped)
    : [];
  const scaffolds: string[] = [];
  if (stackTyped.includes("typescript")) scaffolds.push("package-ts");
  if (stackTyped.includes("python")) scaffolds.push("package-python");
  // If we couldn't classify the stack (empty stackTyped), fall back to the
  // v0.1 default so existing init smoke flows still produce something usable.
  if (scaffolds.length === 0) {
    scaffolds.push("package-ts", "package-python");
  }

  return {
    $schema: "https://cadence.dev/schema.json",
    version: CADENCE_VERSION,
    project: {
      name,
      shortCode,
      description: "",
    },
    stacks,
    paths: {
      backend: "apps/backend",
      frontend: "apps/frontend",
      packagesTs: "packages/typescript",
      packagesPython: "packages/python",
      docs: "docs",
      auto: "auto",
    },
    defaults: {
      audits,
      standards,
      scaffolds,
      workflows: [],
    },
    bridges: {
      claude: withClaude
        ? { enabled: true, commandsDir: ".claude/commands" }
        : { enabled: false },
      cursor: { enabled: false },
    },
    knowledge: {
      // v0.3: knowledge auto-discovery reads these sources by default.
      // Override in your cadence.config.json if your repo uses other names.
      sources: ["docker-compose.yml", ".env.example"],
      redactPatterns: ["PASSWORD", "TOKEN", "SECRET", "KEY"],
    },
    telemetry: {
      // Opt-in only per locked decision (plan §0).
      // v0.8 will add a first-run prompt; v0.3 stays silent.
      enabled: false,
    },
  };
}

function deriveShortCode(name: string): string {
  // Strip non-alphanumerics, uppercase the first 2-3 letters.
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return "CAD";
  return cleaned.slice(0, Math.min(3, cleaned.length)).toUpperCase();
}

function readBridgeTemplate(path: string): string {
  // Read lazily at call time so init without --with-claude never touches
  // the bridge file (handy for tests that don't include the bridge template).
  return readFileSync(path, "utf8");
}

function applyBridgeReplacements(input: string, projectName: string, shortCode: string): string {
  return input
    .split("{{PROJECT_NAME}}")
    .join(projectName)
    .split("{{SHORT_CODE}}")
    .join(shortCode)
    .split("{{CADENCE_VERSION}}")
    .join(CADENCE_VERSION);
}
