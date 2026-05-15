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
import { readPreference, setTelemetryEnabled } from "../util/telemetry.js";
import type { CadenceConfig, CadenceManifest } from "../util/types.js";
import { CADENCE_VERSION } from "../util/version.js";

export type BridgeName = "claude" | "cursor" | "mcp";

export interface InitOptions {
  /** Override the target directory (defaults to cwd). */
  cwd?: string;
  /** Project name for cadence.config.json. Defaults to the directory name. */
  projectName?: string;
  /** Short code used for task tags in commits (e.g. `OP` → `[OP-123]`). */
  shortCode?: string;
  /** Stacks listed in config. Defaults to ["python", "typescript"] per v0.1 plan. */
  stacks?: string[];
  /** Legacy v0.1 flag — equivalent to `bridges: ["claude"]`. */
  withClaude?: boolean;
  /**
   * Which bridge directories to scaffold. v0.5 supports `claude` and
   * `cursor`. Empty array (or unset) skips bridge scaffolding entirely
   * (use the raw CLI). Multiple bridges can coexist — pass both names
   * to scaffold both.
   */
  bridges?: BridgeName[];
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
  /** Whether the Cursor bridge was scaffolded. */
  cursorBridgeCreated: boolean;
  /** Whether the MCP bridge was scaffolded (v0.8). */
  mcpBridgeCreated: boolean;
  /** Bridges scaffolded by this invocation, by canonical name. */
  bridgesScaffolded: BridgeName[];
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

  // Resolve which bridges to scaffold. v0.5: --bridges wins over the
  // legacy --with-claude alias. Empty arrays mean "no bridges" (raw CLI
  // path); both can coexist in the resulting repo.
  const bridges: BridgeName[] = resolveBridges(options);

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
    bridges,
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

  // Bridge files. v0.5: every bridge name in `bridges[]` is scaffolded
  // from `templates/bridges/<name>/<file>` into
  // `<bridgeTargetDir>/<file>` where the target dir is canonical per bridge:
  //   - claude → .claude/commands/cadence.md      (slash-command markdown)
  //   - cursor → .cursor/commands/cadence.md      (slash-command markdown)
  //   - mcp    → .cadence/mcp/cadence-server.json (MCP host registration JSON)
  //              + .cadence/mcp/README.md         (how to wire it up)
  // Multiple bridges coexist freely — they read the same dispatch table.
  let claudeBridgeCreated = false;
  let cursorBridgeCreated = false;
  let mcpBridgeCreated = false;
  const bridgesScaffolded: BridgeName[] = [];
  for (const bridge of bridges) {
    const files = bridgeFiles(bridge);
    let anyCreated = false;
    for (const filename of files) {
      const sourcePath = join(templatesDir, "bridges", bridge, filename);
      const targetPath = join(root, bridgeTargetDir(bridge), filename);
      const content = applyBridgeReplacements(
        readBridgeTemplate(sourcePath),
        projectName,
        shortCode,
      );
      const created = writeFileIfMissing(targetPath, content);
      if (created) anyCreated = true;
      const relPath = bridgeTargetDir(bridge) + "/" + filename;
      log(
        created
          ? kleur.green("✓") + ` ${relPath}`
          : kleur.dim(`  skipped ${relPath} (exists)`),
      );
    }
    if (bridge === "claude") claudeBridgeCreated = anyCreated;
    if (bridge === "cursor") cursorBridgeCreated = anyCreated;
    if (bridge === "mcp") mcpBridgeCreated = anyCreated;
    if (anyCreated) bridgesScaffolded.push(bridge);
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

  // v0.8: surface the telemetry opt-in to a user who's just scaffolded
  // their first cadence project. We don't prompt interactively here —
  // init is synchronous and prompt UX in non-TTY contexts (CI, scripts)
  // would either hang or get suppressed silently. Surfacing the flag
  // names is a transparent compromise. The user runs
  // `cadence config --telemetry on|off` to record their preference.
  surfaceTelemetryOptIn(options.quiet === true);

  return {
    autoDir,
    configCreated,
    manifestCreated,
    claudeBridgeCreated,
    cursorBridgeCreated,
    mcpBridgeCreated,
    bridgesScaffolded,
    filesCreated: created,
    filesSkipped: skipped,
  };
}

/**
 * Resolve which bridges to scaffold. v0.5 accepts:
 *   - explicit `bridges: ["claude", "cursor"]`
 *   - legacy `withClaude: true` (preserved for backwards compat — equivalent
 *     to `bridges: ["claude"]`). When both are passed, `bridges` wins.
 *   - neither set → no bridges (the raw-CLI path)
 *
 * Unknown bridge names throw so a typo doesn't silently scaffold nothing.
 */
function resolveBridges(options: InitOptions): BridgeName[] {
  if (options.bridges && options.bridges.length > 0) {
    const validNames: BridgeName[] = ["claude", "cursor", "mcp"];
    for (const name of options.bridges) {
      if (!validNames.includes(name)) {
        throw new Error(
          `Cadence: unknown bridge "${name}". ` +
            `Available: ${validNames.join(", ")} (or none).`,
        );
      }
    }
    // Deduplicate while preserving order.
    return Array.from(new Set(options.bridges));
  }
  if (options.withClaude) return ["claude"];
  return [];
}

/**
 * Map a bridge name to its canonical target directory inside the user's
 * repo. The convention mirrors each editor's slash-command lookup path.
 *
 * For Cursor specifically, see the comment block in
 * `templates/bridges/cursor/cadence.md` — the location is an explicit
 * v0.5 assumption that can be corrected by regenerating the bridge
 * without breaking the dispatch contract.
 *
 * For MCP (v0.8): the "bridge file" is a JSON server-registration snippet
 * the user copies into their MCP host's config (e.g. Claude Desktop's
 * `claude_desktop_config.json`). We scaffold it to `.cadence/mcp/` rather
 * than `.claude/...` because (a) MCP isn't Claude-specific (Continue,
 * Cline, others consume the same registration shape), and (b) Claude
 * Desktop's actual config file lives outside the repo (in the user's app
 * support dir), so we never write to that path directly.
 */
function bridgeTargetDir(bridge: BridgeName): string {
  switch (bridge) {
    case "claude":
      return ".claude/commands";
    case "cursor":
      return ".cursor/commands";
    case "mcp":
      return ".cadence/mcp";
  }
}

/**
 * The file(s) scaffolded for a given bridge. Most bridges ship a single
 * `cadence.md` slash-command file; MCP (v0.8) ships both a JSON server
 * registration snippet AND a README explaining how to wire it into the
 * host config (which lives outside the repo).
 */
function bridgeFiles(bridge: BridgeName): string[] {
  switch (bridge) {
    case "claude":
    case "cursor":
      return ["cadence.md"];
    case "mcp":
      return ["cadence-server.json", "README.md"];
  }
}

function buildDefaultConfig(
  name: string,
  shortCode: string,
  stacks: string[],
  stackTyped: Stack[],
  bridges: BridgeName[],
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
      claude: bridges.includes("claude")
        ? { enabled: true, commandsDir: ".claude/commands" }
        : { enabled: false },
      cursor: bridges.includes("cursor")
        ? { enabled: true, commandsDir: ".cursor/commands" }
        : { enabled: false },
      mcp: bridges.includes("mcp")
        ? { enabled: true, commandsDir: ".cadence/mcp" }
        : { enabled: false },
    },
    knowledge: {
      // v0.3: knowledge auto-discovery reads these sources by default.
      // Override in your cadence.config.json if your repo uses other names.
      sources: ["docker-compose.yml", ".env.example"],
      redactPatterns: ["PASSWORD", "TOKEN", "SECRET", "KEY"],
    },
    extensions: {
      // v0.5: plugin contracts. taskAdapter=null means `cadence task` exits
      // with an install hint; vcsAdapter=null falls back to the built-in
      // git adapter (recommended default for most teams). Point at npm
      // package names like "@cadence/adapter-linear" once those exist.
      taskAdapter: null,
      vcsAdapter: null,
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

/**
 * Surface the opt-in telemetry notice on first run.
 *
 * v0.8 ships an explicit "we have telemetry, it's off by default, here's
 * how to enable it" notice rather than an interactive prompt. Rationale:
 *
 *   - `init` is synchronous. An async inquirer call inside the run path
 *     would require making `runInit` Promise-returning, breaking
 *     callers like the tests + scripted callers that depend on the
 *     sync shape.
 *   - In CI / non-TTY contexts an interactive prompt either hangs or
 *     gets suppressed silently — neither is a great experience.
 *
 * The notice flips `prompted=true` so it's shown exactly once. The user
 * sets the preference with `cadence config --telemetry on|off`.
 *
 * v1.0 may revisit by making `runInit` async + adding a real prompt
 * gated on `process.stdin.isTTY`.
 */
function surfaceTelemetryOptIn(quiet: boolean): void {
  const pref = readPreference();
  if (pref.prompted) return;
  // Flip the "asked once" flag so re-running init doesn't keep
  // surfacing the same banner. Default to opt-out (the locked v0.8
  // policy — telemetry is off until the user explicitly toggles it on).
  setTelemetryEnabled(false);
  if (quiet) return;
  console.log(
    "\n" +
      kleur.dim("─".repeat(60)) +
      "\n" +
      kleur.bold("Telemetry (off by default)") +
      "\n" +
      kleur.dim(
        "Cadence collects no usage data unless you opt in. To enable\n" +
          "anonymous event capture (command name, audit type, error type,\n" +
          "cadence version, OS family) run:",
      ) +
      "\n  " +
      kleur.cyan("cadence config --telemetry on") +
      "\n" +
      kleur.dim("Toggle off anytime with `cadence config --telemetry off`.") +
      "\n" +
      kleur.dim("─".repeat(60)) +
      "\n",
  );
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
