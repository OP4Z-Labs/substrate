/**
 * `cadence doctor` — diagnose a cadence-using repo.
 *
 * Each check is a small named function that returns a `Check` result.
 * The runner aggregates them, prints a triage report, and sets exit
 * code based on the worst severity encountered.
 *
 * Severity → exit code:
 *   ok       → 0
 *   warn     → 0 (informational; doesn't fail)
 *   error    → non-zero
 *
 * `--json` swaps the rendering for machine-readable output.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { detectStacks } from "../util/detect.js";
import { readManifest } from "../util/manifest.js";
import { AUTO_SUBDIRS, resolveTargetRoot } from "../util/paths.js";
import type { CadenceConfig } from "../util/types.js";

type Severity = "ok" | "warn" | "error";

interface Check {
  id: string;
  title: string;
  severity: Severity;
  message: string;
  fix?: string;
}

export interface DoctorOptions {
  cwd?: string;
  json?: boolean;
}

export interface DoctorReport {
  checks: Check[];
  summary: { ok: number; warn: number; error: number };
  exitCode: 0 | 1;
}

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const root = resolveTargetRoot(options.cwd);
  const checks: Check[] = [
    ...checkTooling(),
    ...checkConfig(root),
    ...checkAutoDir(root),
    ...checkManifest(root),
    ...checkStackAlignment(root),
    ...checkBridge(root),
  ];

  const summary = { ok: 0, warn: 0, error: 0 };
  for (const c of checks) summary[c.severity] += 1;
  const exitCode: 0 | 1 = summary.error > 0 ? 1 : 0;
  const report: DoctorReport = { checks, summary, exitCode };

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exitCode = exitCode;
    return report;
  }
  renderHumanReport(report);
  process.exitCode = exitCode;
  return report;
}

// ----------------------------------------------------------- checks
function checkTooling(): Check[] {
  // We don't shell out to the tooling — that adds platform complexity
  // (Windows vs POSIX, exec lookup, etc.). Instead we record what node
  // gives us about itself: `node` is available (we're running), and we
  // expose the version for human inspection.
  return [
    {
      id: "tooling.node",
      title: "Node.js runtime",
      severity: "ok",
      message: `Running on ${process.version} (${process.platform}/${process.arch}).`,
    },
  ];
}

function checkConfig(root: string): Check[] {
  const path = join(root, "cadence.config.json");
  if (!existsSync(path)) {
    return [
      {
        id: "config.missing",
        title: "cadence.config.json",
        severity: "error",
        message: `Missing at ${path}.`,
        fix: "Run `cadence init` to scaffold it.",
      },
    ];
  }
  let parsed: CadenceConfig;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as CadenceConfig;
  } catch (err) {
    return [
      {
        id: "config.parse",
        title: "cadence.config.json",
        severity: "error",
        message: `Could not parse: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Repair the JSON syntax or restore from git history.",
      },
    ];
  }
  const out: Check[] = [
    {
      id: "config.present",
      title: "cadence.config.json",
      severity: "ok",
      message: `Loaded (project: ${parsed.project?.name ?? "?"}, stacks: ${(parsed.stacks ?? []).join(", ") || "?"}).`,
    },
  ];
  if (!parsed.project?.name) {
    out.push({
      id: "config.project.name",
      title: "cadence.config.json → project.name",
      severity: "warn",
      message: "Empty or missing.",
      fix: "Set `project.name` to a meaningful identifier.",
    });
  }
  if (!parsed.stacks || parsed.stacks.length === 0) {
    out.push({
      id: "config.stacks",
      title: "cadence.config.json → stacks",
      severity: "warn",
      message: "No stacks declared.",
      fix: "Add at least one entry (e.g. \"python\", \"typescript\").",
    });
  }
  return out;
}

function checkAutoDir(root: string): Check[] {
  const autoDir = join(root, "auto");
  if (!existsSync(autoDir)) {
    return [
      {
        id: "auto.missing",
        title: "auto/ directory",
        severity: "error",
        message: `Missing at ${autoDir}.`,
        fix: "Run `cadence init` to scaffold it.",
      },
    ];
  }
  const missing: string[] = [];
  for (const sub of AUTO_SUBDIRS) {
    if (!existsSync(join(autoDir, sub))) missing.push(sub);
  }
  if (missing.length > 0) {
    return [
      {
        id: "auto.subdirs",
        title: "auto/ subdirectories",
        severity: "warn",
        message: `Missing subdirs: ${missing.join(", ")}.`,
        fix: "Re-run `cadence init` (idempotent) to recreate them.",
      },
    ];
  }
  return [
    {
      id: "auto.subdirs",
      title: "auto/ subdirectories",
      severity: "ok",
      message: `All ${AUTO_SUBDIRS.length} canonical subdirs present.`,
    },
  ];
}

function checkManifest(root: string): Check[] {
  const autoDir = join(root, "auto");
  const manifestPath = join(autoDir, ".cadence-manifest.json");
  if (!existsSync(manifestPath)) {
    return [
      {
        id: "manifest.missing",
        title: "auto/.cadence-manifest.json",
        severity: "warn",
        message: "Missing.",
        fix: "Run `cadence init` to scaffold an empty manifest stub.",
      },
    ];
  }
  let manifest;
  try {
    manifest = readManifest(autoDir);
  } catch (err) {
    return [
      {
        id: "manifest.parse",
        title: "auto/.cadence-manifest.json",
        severity: "error",
        message: `Could not load: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  // Walk the manifest entries and verify each referenced file exists.
  const dangling = manifest.entries.filter((e) => !existsSync(join(root, e.path)));
  if (dangling.length > 0) {
    return [
      {
        id: "manifest.dangling",
        title: "auto/.cadence-manifest.json entries",
        severity: "warn",
        message:
          `${dangling.length} manifest entries point at missing files: ` +
          dangling
            .slice(0, 5)
            .map((d) => d.path)
            .join(", ") +
          (dangling.length > 5 ? `, … (${dangling.length - 5} more)` : ""),
        fix: "Re-scaffold via `cadence add` or remove the stale entries.",
      },
      {
        id: "manifest.size",
        title: "auto/.cadence-manifest.json",
        severity: "ok",
        message: `${manifest.entries.length} entries tracked (cadence ${manifest.cadenceVersion}).`,
      },
    ];
  }
  return [
    {
      id: "manifest.size",
      title: "auto/.cadence-manifest.json",
      severity: "ok",
      message: `${manifest.entries.length} entries tracked (cadence ${manifest.cadenceVersion}).`,
    },
  ];
}

function checkStackAlignment(root: string): Check[] {
  const configPath = join(root, "cadence.config.json");
  if (!existsSync(configPath)) return [];
  let config: CadenceConfig;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as CadenceConfig;
  } catch {
    return [];
  }
  const detected = detectStacks(root);
  const declared: Set<string> = new Set(config.stacks ?? []);
  const detectedSet: Set<string> = new Set(detected.stacks);

  const declaredButNotDetected = [...declared].filter((s) => !detectedSet.has(s));
  const detectedButNotDeclared = [...detectedSet].filter((s) => !declared.has(s));

  const out: Check[] = [];
  if (detectedButNotDeclared.length > 0) {
    out.push({
      id: "stack.detected-missing",
      title: "Stack detection",
      severity: "warn",
      message: `Detected ${detectedButNotDeclared.join(", ")} but not declared in cadence.config.`,
      fix: `Edit cadence.config.json stacks: ${[...declared, ...detectedButNotDeclared].join(", ")}.`,
    });
  }
  if (declaredButNotDetected.length > 0) {
    out.push({
      id: "stack.declared-missing",
      title: "Stack detection",
      severity: "warn",
      message: `Declared ${declaredButNotDetected.join(", ")} but no marker files found.`,
      fix: "Either remove from cadence.config or add the project's manifest files.",
    });
  }
  if (out.length === 0) {
    out.push({
      id: "stack.aligned",
      title: "Stack detection",
      severity: "ok",
      message: `Detected ${detected.stacks.join(", ") || "(none)"} matches declared.`,
    });
  }
  return out;
}

function checkBridge(root: string): Check[] {
  const configPath = join(root, "cadence.config.json");
  if (!existsSync(configPath)) return [];
  let config: CadenceConfig;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as CadenceConfig;
  } catch {
    return [];
  }
  // v0.5: claude + cursor; v0.8 adds mcp. Each bridge declares its
  // canonical file (slash-command markdown or MCP JSON registration).
  const out: Check[] = [];
  const bridgeMeta: Array<{
    name: "claude" | "cursor" | "mcp";
    enabled: boolean;
    defaultDir: string;
    file: string;
    flagHint: string;
  }> = [
    {
      name: "claude",
      enabled: config.bridges?.claude?.enabled ?? false,
      defaultDir: config.bridges?.claude?.commandsDir ?? ".claude/commands",
      file: "cadence.md",
      flagHint: "--bridge claude",
    },
    {
      name: "cursor",
      enabled: config.bridges?.cursor?.enabled ?? false,
      defaultDir: config.bridges?.cursor?.commandsDir ?? ".cursor/commands",
      file: "cadence.md",
      flagHint: "--bridge cursor",
    },
    {
      name: "mcp",
      enabled: config.bridges?.mcp?.enabled ?? false,
      defaultDir: config.bridges?.mcp?.commandsDir ?? ".cadence/mcp",
      file: "cadence-server.json",
      flagHint: "--bridge mcp",
    },
  ];
  for (const bridge of bridgeMeta) {
    if (!bridge.enabled) continue;
    const bridgePath = join(root, bridge.defaultDir, bridge.file);
    if (!existsSync(bridgePath)) {
      out.push({
        id: `bridge.${bridge.name}.missing`,
        title: `${bridge.defaultDir}/${bridge.file}`,
        severity: "error",
        message: `${bridge.name} bridge enabled in config but the file is missing.`,
        fix: `Run \`cadence init ${bridge.flagHint}\` to scaffold it.`,
      });
    } else {
      out.push({
        id: `bridge.${bridge.name}`,
        title: `${bridge.defaultDir}/${bridge.file}`,
        severity: "ok",
        message: `${bridge.name} bridge present.`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------- rendering
function renderHumanReport(report: DoctorReport): void {
  console.log(kleur.bold("\nCadence doctor\n"));
  for (const c of report.checks) {
    const icon =
      c.severity === "ok"
        ? kleur.green("✓")
        : c.severity === "warn"
          ? kleur.yellow("!")
          : kleur.red("✗");
    console.log(`${icon} ${kleur.cyan(c.title)}`);
    console.log(`  ${c.message}`);
    if (c.fix && c.severity !== "ok") {
      console.log(`  ${kleur.dim("fix:")} ${c.fix}`);
    }
  }
  console.log(
    "\n" +
      kleur.bold("Summary: ") +
      `${kleur.green(String(report.summary.ok))} ok, ` +
      `${kleur.yellow(String(report.summary.warn))} warn, ` +
      `${kleur.red(String(report.summary.error))} error\n`,
  );
}

// Re-export for tests
export const _internals = {
  checkConfig,
  checkAutoDir,
  checkManifest,
  checkStackAlignment,
  checkBridge,
  // Use a wrapper rather than mutating readdirSync for tests
  readdir: (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((e) => statSync(join(dir, e))) : []),
};
