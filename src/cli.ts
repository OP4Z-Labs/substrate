#!/usr/bin/env node
/**
 * cadence CLI entry point.
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
import { runAuditList, runAuditType } from "./commands/audit.js";
import { runCreate } from "./commands/create.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runKnowledgeRefresh, runKnowledgeShow } from "./commands/knowledge.js";
import { CADENCE_VERSION } from "./util/version.js";

function buildProgram(): Command {
  const program = new Command();
  program
    .name("cadence")
    .description(
      "Cadence — repeatable automation patterns for codebases (audits, scaffolds, standards).",
    )
    .version(CADENCE_VERSION, "-v, --version", "Print cadence version")
    .helpOption("-h, --help", "Display help for command");

  // ---------------------------------------------------------------- init
  program
    .command("init")
    .description("Scaffold auto/, cadence.config.json, and (optionally) a Claude bridge.")
    .option("--name <name>", "Project name (defaults to the directory name)")
    .option("--short-code <code>", "Short code for task tags (e.g. OP → [OP-123])")
    .option(
      "--stack <stack>",
      "Comma-separated stacks (e.g. python,typescript)",
      "python,typescript",
    )
    .option("--with-claude", "Also scaffold .claude/commands/cadence.md", false)
    .option("--quiet", "Suppress informational output", false)
    .action((options: InitCliOptions) => {
      runInit({
        projectName: options.name,
        shortCode: options.shortCode,
        stacks: options.stack ? options.stack.split(",").map((s) => s.trim()) : undefined,
        withClaude: options.withClaude,
        quiet: options.quiet,
      });
    });

  // --------------------------------------------------------------- audit
  const audit = program.command("audit").description("Run or list audits.");
  audit
    .option("--list", "List available audits")
    .option("--type <name>", "Audit type to run (e.g. pre-merge)")
    .option("--json", "Emit machine-readable JSON")
    .action((options: AuditCliOptions) => {
      if (options.list && options.type) {
        throw new Error("Cadence: pass either --list or --type, not both.");
      }
      if (options.type) {
        runAuditType(options.type, { json: options.json });
        return;
      }
      if (options.list) {
        runAuditList({ json: options.json });
        return;
      }
      audit.help();
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
    .description("Diagnose cadence installation, config sanity, and manifest drift.")
    .option("--json", "Emit machine-readable JSON", false)
    .action((options: DoctorCliOptions) => {
      runDoctor({ json: options.json });
    });

  // Provide a soft hint when a deferred command is invoked.
  for (const deferred of ["review", "standards", "workflow", "config", "upgrade"]) {
    program
      .command(deferred)
      .description(`(Not yet available — planned for a later version.)`)
      .addOption(new Option("--placeholder").hideHelp())
      .action(() => {
        console.error(
          kleur.yellow(`cadence ${deferred}: not implemented in v${CADENCE_VERSION}.`),
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
  quiet?: boolean;
}

interface AuditCliOptions {
  list?: boolean;
  type?: string;
  json?: boolean;
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

/**
 * Entry point — wraps `program.parseAsync` with a uniform error handler
 * so command modules can throw plain `Error` instances and the CLI
 * surfaces them with a non-zero exit code.
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(kleur.red("✗ ") + message);
    process.exit(1);
  }
}

// CLI bootstrap — only run when invoked as a script, not when imported
// (e.g. by tests). The fileURLToPath dance is the standard ESM pattern.
import { fileURLToPath } from "node:url";
const invokedDirectly = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}

export { buildProgram };
