#!/usr/bin/env node
/**
 * substrate CLI entry point.
 *
 * Thin command-dispatch layer over the programmatic API in
 * `./commands/*`. Every subcommand resolves to a pure function so it
 * can be tested in isolation and called from JS without spawning a
 * subprocess.
 *
 * Design call: we keep this file small and free of business logic.
 * Anything that looks like a decision lives in the command modules.
 */

import { Command, Option } from "commander";
import kleur from "kleur";
import { runAdd } from "./commands/add.js";
import {
  runAuditExecute,
  runAuditList,
  runAuditTrend,
  runAuditType,
} from "./commands/audit.js";
import { runCreate } from "./commands/create.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runKnowledgeRefresh, runKnowledgeShow } from "./commands/knowledge.js";
import { runMcpServe } from "./commands/mcp.js";
import {
  runTelemetryExport,
  runTelemetryPurge,
  runTelemetryShow,
} from "./commands/telemetry.js";
import { runUninstall } from "./commands/uninstall.js";
import {
  runTaskComplete,
  runTaskCreate,
  runTaskFind,
  runTaskSearch,
  runTaskUpdate,
} from "./commands/task.js";
import { runUpgrade } from "./commands/upgrade.js";
import {
  runWorkflowDescribe,
  runWorkflowList,
  runWorkflowStart,
} from "./commands/workflow.js";
import {
  emitTelemetryEvent,
  logPath,
  preferencePath,
  readPreference,
  setTelemetryEnabled,
} from "./util/telemetry.js";
import { SUBSTRATE_VERSION } from "./util/version.js";

function buildProgram(): Command {
  const program = new Command();
  program
    .name("substrate")
    .description(
      "Substrate — repeatable automation patterns for codebases (audits, scaffolds, standards).",
    )
    .version(SUBSTRATE_VERSION, "-v, --version", "Print substrate version")
    .helpOption("-h, --help", "Display help for command")
    .option(
      "--telemetry-endpoint <url>",
      "Forward telemetry events to a user-configured collector URL (opt-in).",
    );

  // ---------------------------------------------------------------- init
  program
    .command("init")
    .description("Scaffold auto/, substrate.config.json, and (optionally) AI-bridge files.")
    .option("--name <name>", "Project name (defaults to the directory name)")
    .option("--short-code <code>", "Short code for task tags (e.g. OP → [OP-123])")
    .option(
      "--stack <stack>",
      "Comma-separated stacks (e.g. python,typescript). Omit to auto-detect from marker files.",
    )
    .option("--with-claude", "[deprecated] alias for --bridge claude", false)
    .option(
      "--bridge <names>",
      "Comma-separated bridge names to scaffold (claude, cursor, mcp). Multiple allowed.",
    )
    .option("--quiet", "Suppress informational output", false)
    .action((options: InitCliOptions) => {
      const bridgeNames = options.bridge
        ? options.bridge
            .split(",")
            .map((b) => b.trim())
            .filter((b) => b.length > 0)
        : undefined;
      runInit({
        projectName: options.name,
        shortCode: options.shortCode,
        stacks: options.stack ? options.stack.split(",").map((s) => s.trim()) : undefined,
        withClaude: options.withClaude,
        bridges: bridgeNames as ("claude" | "cursor" | "mcp")[] | undefined,
        quiet: options.quiet,
      });
    });

  // --------------------------------------------------------------- audit
  // v1.0: `substrate audit` runs the detector runtime against RULES.yaml.
  // Legacy flags `--list` and `--type` remain (instruction-file surface).
  const audit = program.command("audit").description("Run substrate audits (RULES.yaml detector engine).");
  audit
    .option("--list", "List scaffolded + catalog audit instruction files")
    .option("--type <name>", "[legacy] load an audit-<name>.md instruction stub")
    .option("--rule <id>", "Run a single rule by id")
    .option("--diff", "Restrict ripgrep detectors to files in the staged diff", false)
    .option("--trend", "Print the trend journal (substrate/audits/_trend.jsonl)", false)
    .option("--rules-path <path>", "Override the RULES.yaml location")
    .option("--strict", "Treat unknown RULES.yaml fields as errors", false)
    .option("--no-report", "Skip writing report files (stdout only)")
    .option("--json", "Emit machine-readable JSON")
    .option("--quiet", "Suppress informational output", false)
    .action(async (options: AuditCliOptions) => {
      if (options.list && options.type) {
        throw new Error("Substrate: pass either --list or --type, not both.");
      }
      if (options.trend) {
        runAuditTrend({ json: options.json, quiet: options.quiet });
        return;
      }
      if (options.type) {
        runAuditType(options.type, { json: options.json, quiet: options.quiet });
        return;
      }
      if (options.list) {
        runAuditList({ json: options.json, quiet: options.quiet });
        return;
      }
      // Default: run the detector runtime.
      await runAuditExecute({
        ruleId: options.rule,
        diff: options.diff,
        rulesPath: options.rulesPath,
        strict: options.strict,
        noReport: options.report === false,
        json: options.json,
        quiet: options.quiet,
      });
    });

  // -------------------------------------------------------------- create
  program
    .command("create")
    .description("Scaffold a new package or service from a template.")
    .requiredOption("--template <name>", "Template name (e.g. package-ts, package-python)")
    .requiredOption("--name <name>", "Name of the new package")
    .option("--destination <path>", "Override the destination directory")
    .option("--quiet", "Suppress informational output", false)
    .action((options: CreateCliOptions) => {
      runCreate({
        template: options.template,
        name: options.name,
        destination: options.destination,
        quiet: options.quiet,
      });
    });

  // ------------------------------------------------------------------ add
  const add = program.command("add").description("Scaffold a single audit, standard, scaffold, command, or workflow.");
  add
    .command("audit <name>")
    .description("Scaffold audit-<name>.md into auto/instructions/main/.")
    .option("--overwrite", "Replace an existing file in the target", false)
    .option("--quiet", "Suppress informational output", false)
    .action((name: string, options: AddCliOptions) => {
      runAdd({ category: "audit", item: name, overwrite: options.overwrite, quiet: options.quiet });
    });
  add
    .command("standard <category>")
    .description("Scaffold a standards doc (e.g. backend/architecture) into auto/standards/.")
    .option("--overwrite", "Replace an existing file in the target", false)
    .option("--quiet", "Suppress informational output", false)
    .action((category: string, options: AddCliOptions) => {
      runAdd({ category: "standard", item: category, overwrite: options.overwrite, quiet: options.quiet });
    });
  add
    .command("scaffold <template>")
    .description("Register a scaffold template in auto/config/scaffolds.yaml.")
    .option("--quiet", "Suppress informational output", false)
    .action((template: string, options: AddCliOptions) => {
      runAdd({ category: "scaffold", item: template, quiet: options.quiet });
    });
  add
    .command("command <name>")
    .description("Scaffold a command doc stub in auto/commands/.")
    .option("--overwrite", "Replace an existing file in the target", false)
    .option("--quiet", "Suppress informational output", false)
    .action((name: string, options: AddCliOptions) => {
      runAdd({ category: "command", item: name, overwrite: options.overwrite, quiet: options.quiet });
    });
  add
    .command("workflow <id>")
    .description("Register a workflow in auto/config/workflows.yaml and scaffold a stub doc.")
    .option("--quiet", "Suppress informational output", false)
    .action((id: string, options: AddCliOptions) => {
      runAdd({ category: "workflow", item: id, quiet: options.quiet });
    });

  // -------------------------------------------------------- knowledge
  const knowledge = program.command("knowledge").description("Auto-discovered local-stack reference (docker compose + .env).");
  knowledge
    .command("refresh")
    .description("Regenerate auto/docs/KNOWLEDGE.md from docker-compose.yml and .env.example.")
    .option("--quiet", "Suppress informational output", false)
    .action((options: KnowledgeCliOptions) => {
      runKnowledgeRefresh({ quiet: options.quiet });
    });
  knowledge
    .command("show")
    .description("Print the generated KNOWLEDGE.md.")
    .option("--section <name>", "Print only one section (e.g. services, env)")
    .action((options: KnowledgeCliOptions) => {
      runKnowledgeShow({ section: options.section });
    });

  // ----------------------------------------------------------- doctor
  program
    .command("doctor")
    .description("Diagnose substrate installation, config sanity, and manifest drift.")
    .option("--json", "Emit machine-readable JSON", false)
    .action((options: DoctorCliOptions) => {
      runDoctor({ json: options.json });
    });

  // -------------------------------------------------------------- task
  const task = program
    .command("task")
    .description("Adapter-driven task verbs (find / search / create / update / complete).");
  task
    .command("find <id>")
    .description("Look up a task by its tracker-defined display ID.")
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action(async (id: string, options: TaskCliCommonOptions) => {
      await runTaskFind({ id, json: options.json, quiet: options.quiet });
    });
  task
    .command("search <query>")
    .description("Search tasks by free-text query.")
    .option("--limit <n>", "Maximum results to return", (v) => parseInt(v, 10))
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action(async (query: string, options: TaskSearchCliOptions) => {
      await runTaskSearch({
        query,
        limit: options.limit,
        json: options.json,
        quiet: options.quiet,
      });
    });
  task
    .command("create")
    .description("Create a task. Requires --title and --description.")
    .requiredOption("--title <title>", "Task title")
    .requiredOption("--description <text>", "Task description (one sentence minimum)")
    .option("--type <type>", "Task type (e.g. task, bug, story)")
    .option("--priority <priority>", "Priority label (e.g. critical, high, medium, low)")
    .option("--category <category>", "Category label (adapter-defined)")
    .option("--complexity <complexity>", "Complexity (e.g. simple, standard, complex)")
    .option("--hours <n>", "Estimated hours", (v) => parseFloat(v))
    .option("--actual-hours <n>", "Actual hours (for retrospective entries)", (v) => parseFloat(v))
    .option("--status <status>", "Status override (use 'completed' for retrospective entries)")
    .option("--project <project>", "Project / area key")
    .option("--assignee <assignee>", "Assignee identifier")
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action(async (options: TaskCreateCliOptions) => {
      await runTaskCreate({
        title: options.title,
        description: options.description,
        type: options.type,
        priority: options.priority,
        category: options.category,
        complexity: options.complexity,
        estimatedHours: options.hours,
        actualHours: options.actualHours,
        status: options.status,
        project: options.project,
        assignee: options.assignee,
        json: options.json,
        quiet: options.quiet,
      });
    });
  task
    .command("update <id>")
    .description("Update an existing task.")
    .option("--status <status>", "New status")
    .option("--priority <priority>", "New priority")
    .option("--hours <n>", "Estimated hours", (v) => parseFloat(v))
    .option("--actual-hours <n>", "Actual hours recorded", (v) => parseFloat(v))
    .option("--assignee <assignee>", "Reassign")
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action(async (id: string, options: TaskUpdateCliOptions) => {
      await runTaskUpdate({
        id,
        status: options.status,
        priority: options.priority,
        estimatedHours: options.hours,
        actualHours: options.actualHours,
        assignee: options.assignee,
        json: options.json,
        quiet: options.quiet,
      });
    });
  task
    .command("complete <id>")
    .description("Mark a task complete, optionally recording actual hours.")
    .option("--actual-hours <n>", "Wall-clock effort to record", (v) => parseFloat(v))
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action(async (id: string, options: TaskCompleteCliOptions) => {
      await runTaskComplete({
        id,
        actualHours: options.actualHours,
        json: options.json,
        quiet: options.quiet,
      });
    });

  // ---------------------------------------------------------- workflow
  const workflow = program
    .command("workflow")
    .description("List, describe, or run multi-step workflows from auto/config/workflows.yaml.");
  workflow
    .command("list")
    .description("Enumerate registered workflows.")
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action((options: WorkflowCliCommonOptions) => {
      runWorkflowList({ json: options.json, quiet: options.quiet });
    });
  workflow
    .command("describe <id>")
    .description("Print one workflow's definition (name, description, steps).")
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action((id: string, options: WorkflowCliCommonOptions) => {
      runWorkflowDescribe({ id, json: options.json, quiet: options.quiet });
    });
  workflow
    .command("start <id>")
    .description("Execute a workflow's steps in sequence.")
    .option(
      "--var <key=value>",
      "Pre-fill a workflow variable (repeatable).",
      (val: string, prev: Record<string, string>) => {
        const eq = val.indexOf("=");
        if (eq === -1) {
          throw new Error(`Substrate: --var expects key=value, got "${val}"`);
        }
        return { ...prev, [val.slice(0, eq)]: val.slice(eq + 1) };
      },
      {} as Record<string, string>,
    )
    .option("--quiet", "Suppress informational output", false)
    .action(async (id: string, options: WorkflowStartCliOptions) => {
      await runWorkflowStart({
        id,
        vars: options.var,
        quiet: options.quiet,
      });
    });

  // ----------------------------------------------------------- upgrade
  program
    .command("upgrade")
    .description("Diff scaffolded files against current templates; merge or eject drift.")
    .option("--check", "Report drift without writing anything", false)
    .option("--apply", "Walk the modified entries interactively", false)
    .option("--dry-run", "Alias for --check (no writes)", false)
    .option("--quiet", "Suppress informational output", false)
    .action(async (options: UpgradeCliOptions) => {
      await runUpgrade({
        check: options.check,
        apply: options.apply,
        dryRun: options.dryRun,
        quiet: options.quiet,
      });
    });

  // ---------------------------------------------------------------- mcp
  const mcp = program
    .command("mcp")
    .description(
      "Model Context Protocol bridge. `mcp serve` runs an MCP server (stdio transport) exposing read-only substrate tools.",
    );
  mcp
    .command("serve")
    .description("Start the substrate MCP server over stdio. Blocks until the host disconnects.")
    .action(async () => {
      await runMcpServe();
    });

  // ------------------------------------------------------- config (v0.8 telemetry slice)
  program
    .command("config")
    .description(
      "Read or update substrate settings. v0.8 ships only --telemetry on|off; --enable / --disable / --eject are v1.0.",
    )
    .option(
      "--telemetry <state>",
      "Set telemetry preference (on or off). Omit to print the current preference.",
    )
    .action((options: ConfigCliOptions) => {
      if (options.telemetry !== undefined) {
        const lc = options.telemetry.toLowerCase();
        if (lc !== "on" && lc !== "off") {
          console.error(
            kleur.red("✗ ") +
              `--telemetry expects "on" or "off" (got "${options.telemetry}").`,
          );
          process.exit(2);
          return;
        }
        const enabled = lc === "on";
        setTelemetryEnabled(enabled);
        console.log(
          enabled
            ? kleur.green("✓ telemetry enabled. ") +
                kleur.dim(`Events will be written to ~/.config/substrate/telemetry.log`)
            : kleur.green("✓ telemetry disabled."),
        );
        return;
      }
      // No flag — print current preference.
      const pref = readPreference();
      console.log(kleur.bold("Substrate telemetry"));
      console.log(
        `  state    : ${
          pref.enabled === true
            ? kleur.green("enabled")
            : pref.enabled === false
              ? kleur.dim("disabled")
              : kleur.yellow("not yet asked")
        }`,
      );
      console.log(`  prompted : ${pref.prompted ? "yes" : "no"}`);
      console.log(kleur.dim(`  pref file: ${preferencePath()}`));
      console.log(kleur.dim(`  log file : ${logPath()}`));
    });

  // -------------------------------------------------------- uninstall (v1.0)
  program
    .command("uninstall")
    .description(
      "Remove substrate-scaffolded files from this repo. Preserves user-modified files by default.",
    )
    .option("--dry-run", "Print the plan without writing anything", false)
    .option("--yes", "Skip the confirmation prompt", false)
    .option("--force", "Remove user-modified files too (skips hash check)", false)
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action(
      (options: {
        dryRun?: boolean;
        yes?: boolean;
        force?: boolean;
        json?: boolean;
        quiet?: boolean;
      }) => {
        runUninstall({
          dryRun: options.dryRun,
          yes: options.yes,
          force: options.force,
          json: options.json,
          quiet: options.quiet,
        });
      },
    );

  // -------------------------------------------------------- telemetry (v1.0)
  const telemetry = program
    .command("telemetry")
    .description("Inspect, purge, or export substrate's local telemetry log.");
  telemetry
    .command("show")
    .description("Print the current preference and the last N events.")
    .option("--tail <n>", "Number of recent events to display", (v) => parseInt(v, 10), 10)
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action((options: { tail?: number; json?: boolean; quiet?: boolean }) => {
      runTelemetryShow({ tail: options.tail, json: options.json, quiet: options.quiet });
    });
  telemetry
    .command("purge")
    .description("Delete the telemetry preference file and event log.")
    .option("--yes", "Skip confirmation", false)
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action((options: { yes?: boolean; json?: boolean; quiet?: boolean }) => {
      runTelemetryPurge({ yes: options.yes, json: options.json, quiet: options.quiet });
    });
  telemetry
    .command("export <outPath>")
    .description("Copy the telemetry log to a file in JSONL or CSV format.")
    .option("--format <format>", "Output format: jsonl (default) or csv", "jsonl")
    .option("--json", "Emit machine-readable JSON", false)
    .option("--quiet", "Suppress informational output", false)
    .action(
      (
        outPath: string,
        options: { format?: "jsonl" | "csv"; json?: boolean; quiet?: boolean },
      ) => {
        runTelemetryExport({
          outPath,
          format: options.format,
          json: options.json,
          quiet: options.quiet,
        });
      },
    );

  // Provide a soft hint when a deferred command is invoked.
  for (const deferred of ["review", "standards"]) {
    program
      .command(deferred)
      .description(`(Not yet available — planned for a later version.)`)
      .addOption(new Option("--placeholder").hideHelp())
      .action(() => {
        console.error(
          kleur.yellow(`substrate ${deferred}: not implemented in v${SUBSTRATE_VERSION}.`),
        );
        console.error(kleur.dim("  See the roadmap in README.md for the planned version."));
        process.exitCode = 2;
      });
  }

  return program;
}

interface InitCliOptions {
  name?: string;
  shortCode?: string;
  stack?: string;
  withClaude?: boolean;
  bridge?: string;
  quiet?: boolean;
}

interface AuditCliOptions {
  list?: boolean;
  type?: string;
  rule?: string;
  diff?: boolean;
  trend?: boolean;
  rulesPath?: string;
  strict?: boolean;
  /** Commander adds .report:false when --no-report is passed. */
  report?: boolean;
  json?: boolean;
  quiet?: boolean;
}

interface CreateCliOptions {
  template: string;
  name: string;
  destination?: string;
  quiet?: boolean;
}

interface AddCliOptions {
  overwrite?: boolean;
  quiet?: boolean;
}

interface KnowledgeCliOptions {
  section?: string;
  quiet?: boolean;
}

interface DoctorCliOptions {
  json?: boolean;
}

interface UpgradeCliOptions {
  check?: boolean;
  apply?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
}

interface ConfigCliOptions {
  telemetry?: string;
}

interface TaskCliCommonOptions {
  json?: boolean;
  quiet?: boolean;
}

interface TaskSearchCliOptions extends TaskCliCommonOptions {
  limit?: number;
}

interface TaskCreateCliOptions extends TaskCliCommonOptions {
  title: string;
  description: string;
  type?: string;
  priority?: string;
  category?: string;
  complexity?: string;
  hours?: number;
  actualHours?: number;
  status?: string;
  project?: string;
  assignee?: string;
}

interface TaskUpdateCliOptions extends TaskCliCommonOptions {
  status?: string;
  priority?: string;
  hours?: number;
  actualHours?: number;
  assignee?: string;
}

interface TaskCompleteCliOptions extends TaskCliCommonOptions {
  actualHours?: number;
}

interface WorkflowCliCommonOptions {
  json?: boolean;
  quiet?: boolean;
}

interface WorkflowStartCliOptions {
  var?: Record<string, string>;
  quiet?: boolean;
}

/**
 * Entry point — wraps `program.parseAsync` with a uniform error handler
 * so command modules can throw plain `Error` instances and the CLI
 * surfaces them with a non-zero exit code.
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  // Top-level command (argv[2] when invoked normally) is the first
  // signal we record for opt-in telemetry. Subcommands (e.g. `task
  // create`) collapse to their family name (`task`) so the surface
  // stays narrow.
  const commandName = (argv[2] ?? "").replace(/^-/, "") || "(none)";
  try {
    await program.parseAsync(argv);
    const opts = program.opts<{ telemetryEndpoint?: string }>();
    emitTelemetryEvent(commandName, { endpoint: opts.telemetryEndpoint });
  } catch (err) {
    const errorType = err instanceof Error ? err.constructor.name : "Unknown";
    const opts = program.opts<{ telemetryEndpoint?: string }>();
    emitTelemetryEvent(commandName, { errorType, endpoint: opts.telemetryEndpoint });
    const message = err instanceof Error ? err.message : String(err);
    console.error(kleur.red("✗ ") + message);
    process.exit(1);
  }
}

// CLI bootstrap — only run when invoked as a script, not when imported
// (e.g. by tests). The fileURLToPath dance is the standard ESM pattern.
// When installed via `npm link` or `npm install -g`, process.argv[1] is the
// symlink (e.g. `/usr/local/bin/substrate`) while `import.meta.url` resolves
// to the link target. `realpathSync` normalizes both sides so the equality
// check still fires.
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
function resolveRealPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
const invokedDirectly =
  !!process.argv[1] &&
  resolveRealPath(process.argv[1]) === resolveRealPath(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main();
}

export { buildProgram };
