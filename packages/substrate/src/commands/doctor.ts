/**
 * `substrate doctor` — diagnose a substrate-using repo.
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

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { detectStacks } from "../util/detect.js";
import { readManifest } from "../util/manifest.js";
import { AUTO_SUBDIRS, resolveTargetRoot } from "../util/paths.js";
import { queryMemory } from "../v2/memory.js";
import { discoverWorkflows } from "../v2/discoverer.js";
import { locateRulesFile, loadRules } from "../audit/index.js";
import { listPending } from "../v2/deterministic/proposals/queue.js";
import type { SubstrateConfig } from "../util/types.js";

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
  /**
   * When set, run only the named check(s). Names are the suffix after
   * `--check` in the v2 surface: `rules-doc-coverage`,
   * `workflow-coverage`, `memory-frontmatter`, `stale-proposals`,
   * `escalation-debt`, `ripgrep-lookaround`. Unknown names produce a
   * warning-severity "unknown check" entry but do not abort.
   */
  only?: string[];
  /**
   * Override the staleness threshold (in days) for the stale-proposals
   * check. Default 90 (plan §3.10).
   */
  staleProposalsDays?: number;
  /**
   * Override the escalation-debt threshold (in days). Findings whose
   * post-escalation severity has been `critical` for at least this many
   * days surface as warn. Default 30.
   */
  escalationDebtDays?: number;
}

export interface DoctorReport {
  checks: Check[];
  summary: { ok: number; warn: number; error: number };
  exitCode: 0 | 1;
}

/**
 * Registry of v2 named-check IDs (those addressable via `--check <id>`).
 * Each entry pairs the public name with the closure that runs it. Order
 * here is the order they appear in aggregate output.
 *
 * v1.0 baseline checks (tooling / config / auto-dir / manifest / stack
 * alignment / bridges) are always run; they're foundational and have
 * no `--check` filter analogue.
 */
const V2_CHECKS: Array<{ id: string; run: (root: string, options: DoctorOptions) => Check[] }> = [
  { id: "memory-frontmatter", run: (root) => checkMemoryFrontmatter(root) },
  { id: "rules-doc-coverage", run: (root) => checkRulesDocCoverage(root) },
  { id: "workflow-coverage", run: (root) => checkWorkflowCoverage(root) },
  { id: "stale-proposals", run: (root, opt) => checkStaleProposals(root, opt.staleProposalsDays ?? 90) },
  { id: "escalation-debt", run: (root, opt) => checkEscalationDebt(root, opt.escalationDebtDays ?? 30) },
  { id: "ripgrep-lookaround", run: (root) => checkRipgrepLookaround(root) },
];

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const root = resolveTargetRoot(options.cwd);
  const baseline: Check[] = [
    ...checkTooling(),
    ...checkConfig(root),
    ...checkAutoDir(root),
    ...checkManifest(root),
    ...checkStackAlignment(root),
    ...checkBridge(root),
  ];

  // v2 named checks. When `only` is passed, only run the listed ones
  // and surface a warn entry for any unknown name. When unset, all v2
  // checks run.
  const v2Checks: Check[] = [];
  const scoped = options.only !== undefined && options.only.length > 0;
  if (scoped) {
    for (const name of options.only!) {
      const entry = V2_CHECKS.find((c) => c.id === name);
      if (!entry) {
        v2Checks.push({
          id: `check.unknown.${name}`,
          title: `unknown --check name: ${name}`,
          severity: "warn",
          message: `No v2 check registered as "${name}".`,
          fix: `Use one of: ${V2_CHECKS.map((c) => c.id).join(", ")}.`,
        });
        continue;
      }
      v2Checks.push(...entry.run(root, options));
    }
  } else {
    for (const c of V2_CHECKS) v2Checks.push(...c.run(root, options));
  }

  // When the caller scoped to `--check` we suppress the baseline so the
  // output matches "this one slice only". Otherwise baseline + v2.
  const checks: Check[] = scoped ? v2Checks : [...baseline, ...v2Checks];

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
  const checks: Check[] = [];

  // Node version: substrate requires >= 20.
  const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);
  if (nodeMajor < 20) {
    checks.push({
      id: "tooling.node",
      title: "Node.js runtime",
      severity: "error",
      message: `Node ${process.version} is below the substrate minimum (20+).`,
      fix: "Upgrade Node to 20.x or later (see docs/compatibility.md).",
    });
  } else if (nodeMajor < 22) {
    // Node 20 is supported; 22+ is preferred for newer Astro / docs-site
    // work. Surface as a soft warn so users on LTS-stable Node 20 still
    // pass.
    checks.push({
      id: "tooling.node",
      title: "Node.js runtime",
      severity: "ok",
      message: `Running on ${process.version} (${process.platform}/${process.arch}). Node 22+ is the recommended target.`,
    });
  } else {
    checks.push({
      id: "tooling.node",
      title: "Node.js runtime",
      severity: "ok",
      message: `Running on ${process.version} (${process.platform}/${process.arch}).`,
    });
  }

  // Ripgrep: optional but recommended for the audit runtime.
  const rg = spawnSync("rg", ["--version"], { stdio: "ignore" });
  if (rg.status === 0) {
    checks.push({
      id: "tooling.ripgrep",
      title: "ripgrep",
      severity: "ok",
      message: "Available on PATH — audit ripgrep detectors will use the fast path.",
    });
  } else {
    checks.push({
      id: "tooling.ripgrep",
      title: "ripgrep",
      severity: "warn",
      message: "Not found on PATH. Substrate will fall back to a Node-only regex scan (slower).",
      fix: "Install ripgrep: https://github.com/BurntSushi/ripgrep#installation",
    });
  }

  // Git: needed for `audit --diff` and the VCS adapter.
  const git = spawnSync("git", ["--version"], { stdio: "ignore" });
  if (git.status === 0) {
    checks.push({
      id: "tooling.git",
      title: "git",
      severity: "ok",
      message: "Available on PATH.",
    });
  } else {
    checks.push({
      id: "tooling.git",
      title: "git",
      severity: "warn",
      message: "Not found on PATH. `substrate audit --diff` and the VCS adapter will be unavailable.",
      fix: "Install git: https://git-scm.com/downloads",
    });
  }

  return checks;
}

function checkConfig(root: string): Check[] {
  const path = join(root, "substrate.config.json");
  if (!existsSync(path)) {
    return [
      {
        id: "config.missing",
        title: "substrate.config.json",
        severity: "error",
        message: `Missing at ${path}.`,
        fix: "Run `substrate init` to scaffold it.",
      },
    ];
  }
  let parsed: SubstrateConfig;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as SubstrateConfig;
  } catch (err) {
    return [
      {
        id: "config.parse",
        title: "substrate.config.json",
        severity: "error",
        message: `Could not parse: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Repair the JSON syntax or restore from git history.",
      },
    ];
  }
  const out: Check[] = [
    {
      id: "config.present",
      title: "substrate.config.json",
      severity: "ok",
      message: `Loaded (project: ${parsed.project?.name ?? "?"}, stacks: ${(parsed.stacks ?? []).join(", ") || "?"}).`,
    },
  ];
  if (!parsed.project?.name) {
    out.push({
      id: "config.project.name",
      title: "substrate.config.json → project.name",
      severity: "warn",
      message: "Empty or missing.",
      fix: "Set `project.name` to a meaningful identifier.",
    });
  }
  if (!parsed.stacks || parsed.stacks.length === 0) {
    out.push({
      id: "config.stacks",
      title: "substrate.config.json → stacks",
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
        fix: "Run `substrate init` to scaffold it.",
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
        fix: "Re-run `substrate init` (idempotent) to recreate them.",
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
  const manifestPath = join(autoDir, ".substrate-manifest.json");
  if (!existsSync(manifestPath)) {
    return [
      {
        id: "manifest.missing",
        title: "auto/.substrate-manifest.json",
        severity: "warn",
        message: "Missing.",
        fix: "Run `substrate init` to scaffold an empty manifest stub.",
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
        title: "auto/.substrate-manifest.json",
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
        title: "auto/.substrate-manifest.json entries",
        severity: "warn",
        message:
          `${dangling.length} manifest entries point at missing files: ` +
          dangling
            .slice(0, 5)
            .map((d) => d.path)
            .join(", ") +
          (dangling.length > 5 ? `, … (${dangling.length - 5} more)` : ""),
        fix: "Re-scaffold via `substrate add` or remove the stale entries.",
      },
      {
        id: "manifest.size",
        title: "auto/.substrate-manifest.json",
        severity: "ok",
        message: `${manifest.entries.length} entries tracked (substrate ${manifest.substrateVersion}).`,
      },
    ];
  }
  return [
    {
      id: "manifest.size",
      title: "auto/.substrate-manifest.json",
      severity: "ok",
      message: `${manifest.entries.length} entries tracked (substrate ${manifest.substrateVersion}).`,
    },
  ];
}

function checkStackAlignment(root: string): Check[] {
  const configPath = join(root, "substrate.config.json");
  if (!existsSync(configPath)) return [];
  let config: SubstrateConfig;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as SubstrateConfig;
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
      message: `Detected ${detectedButNotDeclared.join(", ")} but not declared in substrate.config.`,
      fix: `Edit substrate.config.json stacks: ${[...declared, ...detectedButNotDeclared].join(", ")}.`,
    });
  }
  if (declaredButNotDetected.length > 0) {
    out.push({
      id: "stack.declared-missing",
      title: "Stack detection",
      severity: "warn",
      message: `Declared ${declaredButNotDetected.join(", ")} but no marker files found.`,
      fix: "Either remove from substrate.config or add the project's manifest files.",
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
  const configPath = join(root, "substrate.config.json");
  if (!existsSync(configPath)) return [];
  let config: SubstrateConfig;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as SubstrateConfig;
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
      file: "substrate.md",
      flagHint: "--bridge claude",
    },
    {
      name: "cursor",
      enabled: config.bridges?.cursor?.enabled ?? false,
      defaultDir: config.bridges?.cursor?.commandsDir ?? ".cursor/commands",
      file: "substrate.md",
      flagHint: "--bridge cursor",
    },
    {
      name: "mcp",
      enabled: config.bridges?.mcp?.enabled ?? false,
      defaultDir: config.bridges?.mcp?.commandsDir ?? ".substrate/mcp",
      file: "substrate-server.json",
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
        fix: `Run \`substrate init ${bridge.flagHint}\` to scaffold it.`,
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

/**
 * Aggregate per-memory frontmatter warnings emitted by the v2 memory
 * subsystem. The memory module flags each memory entry whose
 * frontmatter lacks recommended fields (type/scope/tags) or whose
 * expiry has passed. The doctor surfaces these as a single check.
 *
 * Semantics:
 *   - No memory store discovered  → severity=ok with informational
 *     message (memory is optional; absence is fine).
 *   - All memories have recommended frontmatter → ok.
 *   - >= 1 memory missing fields  → severity=warn with the count and
 *     a per-memory bullet list (capped at 5 examples).
 */
function checkMemoryFrontmatter(root: string): Check[] {
  // `queryMemory` returns expired memories as filtered-out by default,
  // so warnings on expiry don't surface here. The per-memory
  // recommended-fields warning is the load-bearing signal for adoption.
  const result = queryMemory({ cwd: root });
  if (!result.memoryPath) {
    return [
      {
        id: "memory.store",
        title: "memory store",
        severity: "ok",
        message:
          "no memory store discovered (set --memory-path, SUBSTRATE_MEMORY_PATH, or substrate.config.json memory.path).",
      },
    ];
  }
  const flagged = result.memories.filter((m) => (m.warnings ?? []).length > 0);
  if (flagged.length === 0) {
    return [
      {
        id: "memory.frontmatter",
        title: "memory frontmatter",
        severity: "ok",
        message: `${result.memories.length} memories at ${result.memoryPath} all carry recommended substrate frontmatter.`,
      },
    ];
  }
  const examples = flagged
    .slice(0, 5)
    .map((m) => `${m.name} — ${m.warnings[0]}`)
    .join("; ");
  const remainder =
    flagged.length > 5 ? `; …${flagged.length - 5} more` : "";
  return [
    {
      id: "memory.frontmatter",
      title: "memory frontmatter",
      severity: "warn",
      message: `${flagged.length} of ${result.memories.length} memories at ${result.memoryPath} lack recommended substrate fields. ${examples}${remainder}`,
      fix:
        "Add `metadata.type` / `metadata.scope` / `metadata.tags` to each memory's frontmatter so workflow context filters pick them up.",
    },
  ];
}

/**
 * `--check rules-doc-coverage`: every RULES.yaml entry should reference
 * a standards doc via the `doc:` field. Rules without one are an
 * accountability gap — a reviewer who runs the audit can't follow the
 * chain back to the standards prose. Surfaces as `warn` (count + first
 * five rule ids). Missing RULES.yaml file is `ok` (no rules, no gaps).
 */
function checkRulesDocCoverage(root: string): Check[] {
  const rulesPath = locateRulesFile(root);
  if (!rulesPath) {
    return [
      {
        id: "rules.doc-coverage",
        title: "RULES.yaml doc coverage",
        severity: "ok",
        message: "no RULES.yaml found (substrate/RULES.yaml or auto/RULES.yaml).",
      },
    ];
  }
  let rules;
  try {
    rules = loadRules(rulesPath).document.rules ?? [];
  } catch (err) {
    return [
      {
        id: "rules.doc-coverage",
        title: "RULES.yaml doc coverage",
        severity: "error",
        message: `Could not load ${rulesPath}: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Repair the YAML or remove the malformed entries.",
      },
    ];
  }
  const undocumented = rules.filter((r) => !r.doc || r.doc.trim().length === 0);
  if (undocumented.length === 0) {
    return [
      {
        id: "rules.doc-coverage",
        title: "RULES.yaml doc coverage",
        severity: "ok",
        message: `${rules.length} rules; all carry a doc reference.`,
      },
    ];
  }
  const examples = undocumented.slice(0, 5).map((r) => r.id).join(", ");
  const remainder = undocumented.length > 5 ? `, …${undocumented.length - 5} more` : "";
  return [
    {
      id: "rules.doc-coverage",
      title: "RULES.yaml doc coverage",
      severity: "warn",
      message: `${undocumented.length} of ${rules.length} rules lack a doc: reference (${examples}${remainder}).`,
      fix:
        "Add `doc: substrate/standards/<scope>/<doc>.md#anchor` to each rule so audit reports can link back to the prose.",
    },
  ];
}

/**
 * `--check workflow-coverage`: every workflow manifest discovered under
 * `substrate/workflows/` should have a sibling `.body.md` (the v2
 * convention). Manifests missing a body surface as warn — workflow
 * authors who omit the body lose the cross-cutting prose followups +
 * documentation surface. Also surfaces invalid manifests as `error`
 * (those don't run at all).
 */
function checkWorkflowCoverage(root: string): Check[] {
  const discovery = discoverWorkflows({ cwd: root });
  if (discovery.workflows.length === 0 && discovery.invalidWorkflows.length === 0) {
    return [
      {
        id: "workflow.coverage",
        title: "v2 workflow coverage",
        severity: "ok",
        message: `no workflows discovered under ${discovery.workflowsDir} (pre-v2 install or empty).`,
      },
    ];
  }
  const out: Check[] = [];
  if (discovery.invalidWorkflows.length > 0) {
    const examples = discovery.invalidWorkflows
      .slice(0, 3)
      .map((iw) => `${iw.manifestPath.split(/[\\/]/).pop()}: ${iw.errors[0]?.message ?? "validation error"}`)
      .join("; ");
    out.push({
      id: "workflow.coverage.invalid",
      title: "v2 workflow manifests",
      severity: "error",
      message: `${discovery.invalidWorkflows.length} workflow manifest(s) failed validation: ${examples}.`,
      fix: "Run `substrate validate <path>` for each broken manifest and apply the suggested fix.",
    });
  }
  const bodyMissing = discovery.workflows.filter((w) => !w.bodyPath);
  if (bodyMissing.length === 0) {
    out.push({
      id: "workflow.coverage",
      title: "v2 workflow coverage",
      severity: "ok",
      message: `${discovery.workflows.length} workflows; all paired with a .body.md.`,
    });
  } else {
    const examples = bodyMissing.slice(0, 5).map((w) => w.manifest.id).join(", ");
    const remainder = bodyMissing.length > 5 ? `, …${bodyMissing.length - 5} more` : "";
    out.push({
      id: "workflow.coverage",
      title: "v2 workflow coverage",
      severity: "warn",
      message: `${bodyMissing.length} of ${discovery.workflows.length} workflows lack a .body.md (${examples}${remainder}).`,
      fix:
        "Author a prose body next to each manifest (e.g. `substrate/workflows/<id>.body.md`). The orchestrator renders it into the AI prompt at workflow-start.",
    });
  }
  return out;
}

/**
 * `--check stale-proposals`: pending proposals older than `staleDays`
 * (default 90 per plan §3.10) accumulate as queue debt. Surface as warn
 * with the count + the five oldest filenames.
 */
function checkStaleProposals(root: string, staleDays: number): Check[] {
  const pending = listPending(root);
  if (pending.length === 0) {
    return [
      {
        id: "proposals.stale",
        title: "proposal queue",
        severity: "ok",
        message: "no pending proposals.",
      },
    ];
  }
  const now = Date.now();
  const cutoffMs = staleDays * 24 * 60 * 60 * 1000;
  // Filename date carries the age signal — file-mtime would conflate
  // "moved between filesystems" with "still around" so we use the
  // declared date.
  const stale = pending.filter((p) => {
    if (!p.date) return false;
    const declared = Date.parse(p.date);
    return Number.isFinite(declared) && now - declared >= cutoffMs;
  });
  if (stale.length === 0) {
    return [
      {
        id: "proposals.stale",
        title: "proposal queue",
        severity: "ok",
        message: `${pending.length} pending proposal file(s); none older than ${staleDays}d.`,
      },
    ];
  }
  const examples = stale
    .slice(0, 5)
    .map((p) => p.path.split(/[\\/]/).pop())
    .join(", ");
  const remainder = stale.length > 5 ? `, …${stale.length - 5} more` : "";
  return [
    {
      id: "proposals.stale",
      title: "proposal queue",
      severity: "warn",
      message: `${stale.length} of ${pending.length} pending proposal file(s) are older than ${staleDays}d (${examples}${remainder}).`,
      fix:
        "Run `substrate review --proposals` to walk the queue. Accept, reject, or defer each — letting them age erodes signal trust.",
    },
  ];
}

/**
 * `--check escalation-debt`: critical-severity findings that have been
 * stuck at critical for >= `debtDays` (default 30) are debt the team
 * keeps shipping past. We read `substrate/audits/*-latest.json`
 * sidecars (the latest run per scope) and look at findings whose
 * effective severity is `critical` AND whose `firstSeenAt` is
 * old enough. Missing sidecars or sidecars without escalation metadata
 * surface as `ok` (no escalation configured → no debt to report).
 */
function checkEscalationDebt(root: string, debtDays: number): Check[] {
  const auditsDir = join(root, "substrate", "audits");
  if (!existsSync(auditsDir)) {
    return [
      {
        id: "escalation.debt",
        title: "escalation debt",
        severity: "ok",
        message: "no substrate/audits/ directory (no audits have been run yet).",
      },
    ];
  }
  let entries: string[];
  try {
    entries = readdirSync(auditsDir);
  } catch {
    return [
      {
        id: "escalation.debt",
        title: "escalation debt",
        severity: "ok",
        message: "substrate/audits/ is unreadable.",
      },
    ];
  }
  const sidecars = entries.filter((n) => n.endsWith("-latest.json"));
  if (sidecars.length === 0) {
    return [
      {
        id: "escalation.debt",
        title: "escalation debt",
        severity: "ok",
        message: "no `-latest.json` sidecars under substrate/audits/.",
      },
    ];
  }
  const now = Date.now();
  const cutoffMs = debtDays * 24 * 60 * 60 * 1000;
  let totalStuck = 0;
  const stuckExamples: string[] = [];
  for (const name of sidecars) {
    const path = join(auditsDir, name);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    let report: { scope?: string; results?: Array<{ ruleId?: string; findings?: Array<unknown> }> };
    try {
      report = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!report.results) continue;
    for (const res of report.results) {
      if (!res.findings) continue;
      for (const f of res.findings as Array<{
        ruleId?: string;
        severity?: string;
        firstSeenAt?: string;
        originalSeverity?: string;
      }>) {
        if (f.severity !== "critical") continue;
        if (!f.firstSeenAt) continue;
        const firstSeen = Date.parse(f.firstSeenAt);
        if (!Number.isFinite(firstSeen)) continue;
        if (now - firstSeen < cutoffMs) continue;
        totalStuck += 1;
        if (stuckExamples.length < 5) {
          const days = Math.floor((now - firstSeen) / (24 * 60 * 60 * 1000));
          stuckExamples.push(`${f.ruleId ?? "?"} (${days}d, scope ${report.scope ?? name})`);
        }
      }
    }
  }
  if (totalStuck === 0) {
    return [
      {
        id: "escalation.debt",
        title: "escalation debt",
        severity: "ok",
        message: `${sidecars.length} audit sidecar(s) scanned; no findings stuck at critical for ${debtDays}d+.`,
      },
    ];
  }
  const remainder = totalStuck > stuckExamples.length ? `, …${totalStuck - stuckExamples.length} more` : "";
  return [
    {
      id: "escalation.debt",
      title: "escalation debt",
      severity: "warn",
      message: `${totalStuck} finding(s) have been at critical severity for ${debtDays}d+ (${stuckExamples.join("; ")}${remainder}).`,
      fix:
        "Resolve the underlying issues, or downgrade severity via `escalate_after` if the rule's escalation curve is too aggressive.",
    },
  ];
}

/**
 * `--check ripgrep-lookaround`: scans the consumer's RULES.yaml for
 * ripgrep detector patterns that use look-around (?=, ?!, ?<=, ?<!).
 * Ripgrep without `--pcre2` silently skips these, so the rule looks
 * configured but detects nothing. Surfaces each offender as a warn so
 * the author can rewrite as either a `script` detector or split into
 * positive-match form.
 */
function checkRipgrepLookaround(root: string): Check[] {
  const rulesPath = locateRulesFile(root);
  if (!rulesPath) {
    return [
      {
        id: "rules.ripgrep-lookaround",
        title: "ripgrep look-around patterns",
        severity: "ok",
        message: "no RULES.yaml found; nothing to scan.",
      },
    ];
  }
  let rules;
  try {
    rules = loadRules(rulesPath).document.rules ?? [];
  } catch (err) {
    return [
      {
        id: "rules.ripgrep-lookaround",
        title: "ripgrep look-around patterns",
        severity: "error",
        message: `Could not load ${rulesPath}: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  const offenders: string[] = [];
  for (const rule of rules) {
    const det = (rule as { detector?: unknown }).detector as
      | { type?: string; pattern?: string }
      | undefined;
    if (!det || det.type !== "ripgrep") continue;
    if (typeof det.pattern !== "string") continue;
    if (/\(\?[=!<]/.test(det.pattern)) {
      offenders.push(rule.id);
    }
  }
  if (offenders.length === 0) {
    return [
      {
        id: "rules.ripgrep-lookaround",
        title: "ripgrep look-around patterns",
        severity: "ok",
        message: `${rules.length} rule(s) scanned; no look-around regexes in ripgrep detectors.`,
      },
    ];
  }
  return [
    {
      id: "rules.ripgrep-lookaround",
      title: "ripgrep look-around patterns",
      severity: "warn",
      message: `${offenders.length} rule(s) use look-around regexes that ripgrep silently drops without --pcre2: ${offenders.join(", ")}.`,
      fix: "Rewrite the pattern without look-around, or switch the detector to `type: script` and implement the look-around in a small Node script. See substrate/standards/cross-cutting/detectors/ for examples.",
    },
  ];
}

// ---------------------------------------------------------- rendering
function renderHumanReport(report: DoctorReport): void {
  console.log(kleur.bold("\nSubstrate doctor\n"));
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
  checkMemoryFrontmatter,
  checkRulesDocCoverage,
  checkWorkflowCoverage,
  checkStaleProposals,
  checkEscalationDebt,
  checkRipgrepLookaround,
  // Use a wrapper rather than mutating readdirSync for tests
  readdir: (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((e) => statSync(join(dir, e))) : []),
};
