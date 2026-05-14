import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import kleur from "kleur";
import { listFiles, readText } from "../util/fs.js";
import { parseFrontMatter } from "../util/frontmatter.js";
import { resolveTargetRoot } from "../util/paths.js";

const INSTRUCTIONS_SUBPATH = join("auto", "instructions", "main");
const AUDIT_PREFIX = "audit-";
const MD_EXT = ".md";

export interface AuditDescriptor {
  /** Audit type, e.g. "pre-merge", "dependencies". */
  type: string;
  /** Absolute path to the instruction file. */
  path: string;
  /** Short description, pulled from the front matter or the first heading. */
  description: string;
}

export interface AuditListOptions {
  cwd?: string;
  json?: boolean;
  /** Suppress all stdout (used by tests). Ignored if `json` is set. */
  quiet?: boolean;
}

export interface AuditTypeOptions {
  cwd?: string;
  json?: boolean;
  /** Suppress all stdout (used by tests). Ignored if `json` is set. */
  quiet?: boolean;
}

/**
 * Enumerate audit instruction files under `auto/instructions/main/`.
 *
 * In v0.1 these are static markdown files scaffolded by `cadence init`.
 * In v0.3 they'll grow into the live detector inputs (RULES.yaml +
 * per-audit playbooks). The discovery contract — "anything matching
 * `audit-*.md` in this directory is an audit" — stays stable across
 * versions, so cadence-aware tooling can rely on it now.
 */
export function runAuditList(options: AuditListOptions = {}): AuditDescriptor[] {
  const root = resolveTargetRoot(options.cwd);
  const dir = join(root, INSTRUCTIONS_SUBPATH);
  const audits = discoverAudits(dir);

  if (options.json) {
    process.stdout.write(JSON.stringify(audits, null, 2) + "\n");
    return audits;
  }
  if (options.quiet) return audits;

  if (audits.length === 0) {
    console.log(kleur.yellow("No audits found."));
    console.log(
      kleur.dim(`  Expected: ${join(INSTRUCTIONS_SUBPATH, "audit-<type>.md")} in ${root}`),
    );
    console.log(kleur.dim("  Tip: run `cadence init` to scaffold the defaults."));
    return audits;
  }

  console.log(kleur.bold(`\nAudits available (${audits.length})\n`));
  const widest = Math.max(...audits.map((a) => a.type.length));
  for (const audit of audits) {
    console.log(
      `  ${kleur.cyan(audit.type.padEnd(widest))}  ${kleur.dim(audit.description)}`,
    );
  }
  console.log("\n" + kleur.dim(`  Run: cadence audit --type <name>\n`));
  return audits;
}

export interface AuditRunReport {
  type: string;
  status: "stub" | "would-run";
  instructionPath: string;
  description: string;
  /** v0.1: always 0. The detector layer (v0.3) will populate this. */
  findings: number;
}

/**
 * Load an audit instruction file and emit a stub report.
 *
 * Per the brief, v0.1 prints "would run audit X" rather than executing
 * detectors. The real runtime lives in v0.3. This stub still does the
 * useful early work: validates the instruction file exists, parses its
 * front matter, and prints a structured summary so users can verify
 * their scaffold before the runtime ships.
 */
export function runAuditType(type: string, options: AuditTypeOptions = {}): AuditRunReport {
  const root = resolveTargetRoot(options.cwd);
  const dir = join(root, INSTRUCTIONS_SUBPATH);
  const filename = `${AUDIT_PREFIX}${type}${MD_EXT}`;
  const path = join(dir, filename);

  if (!existsSync(path)) {
    const available = discoverAudits(dir).map((a) => a.type);
    const hint =
      available.length > 0
        ? `Available: ${available.join(", ")}`
        : "No audits scaffolded yet — run `cadence init`.";
    throw new Error(`Cadence: audit "${type}" not found at ${path}\n  ${hint}`);
  }

  const source = readText(path);
  const { data } = parseFrontMatter(source);
  const description = describeAudit(source, data);

  const report: AuditRunReport = {
    type,
    status: "stub",
    instructionPath: path,
    description,
    findings: 0,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report;
  }
  if (options.quiet) return report;

  console.log(kleur.bold(`\nAudit: ${type}`));
  console.log(kleur.dim(`  instruction: ${path}`));
  console.log(kleur.dim(`  description: ${description}`));
  console.log(
    "\n" +
      kleur.yellow("⚠ v0.1 stub:") +
      " no detectors executed.\n" +
      kleur.dim(
        "  In v0.1, cadence reads the instruction file and confirms it is\n" +
          "  well-formed. The detector runtime (RULES.yaml + ripgrep / vulture /\n" +
          "  pip-audit / knip wrappers) ships in v0.3.\n",
      ),
  );
  console.log(kleur.bold("Findings: ") + "0 (stub)\n");

  return report;
}

function discoverAudits(dir: string): AuditDescriptor[] {
  const files = listFiles(dir)
    .filter((f) => basename(f).startsWith(AUDIT_PREFIX) && f.endsWith(MD_EXT))
    .sort();
  return files.map((path) => {
    const type = basename(path).slice(AUDIT_PREFIX.length, -MD_EXT.length);
    const source = readText(path);
    const { data } = parseFrontMatter(source);
    return {
      type,
      path,
      description: describeAudit(source, data),
    };
  });
}

function describeAudit(
  source: string,
  data: { description?: string; title?: string },
): string {
  if (data.description) return data.description;
  // Fall back to the first non-empty line after the front matter that
  // looks like a heading or paragraph.
  const body = stripFrontMatterAndCode(source);
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue; // Skip the H1 title itself
    if (line.startsWith(">")) continue;
    return line.length > 120 ? line.slice(0, 117) + "..." : line;
  }
  return data.title ?? "(no description)";
}

function stripFrontMatterAndCode(source: string): string {
  let body = source;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  // Remove fenced code blocks so we don't surface ```bash` as the description.
  return body.replace(/```[\s\S]*?```/g, "");
}
