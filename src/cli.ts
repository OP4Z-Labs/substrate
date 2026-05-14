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
import { runAuditList, runAuditType } from "./commands/audit.js";
import { runCreate } from "./commands/create.js";
import { runInit } from "./commands/init.js";
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

  // Provide a soft hint when a deferred command is invoked.
  for (const deferred of ["add", "review", "standards", "knowledge", "workflow", "config", "upgrade", "doctor"]) {
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
