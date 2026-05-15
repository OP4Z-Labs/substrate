/**
 * Substrate v2 — Proposal applicators (Phase B3, Primitive 9
 * Component E).
 *
 * Each accepted proposal lands here. The applicator does the
 * type-specific filesystem write + returns a structured result the
 * walker can render to the user.
 *
 * Why a single module instead of one file per applicator? Eight is
 * small enough that grouping them keeps the dispatch table inline
 * (`applyProposal()` is the single entry point). When applicators
 * grow individual config / template surface, this file splits.
 *
 * Standards-doc + ADR + cross-link applicators write a deterministic
 * draft and surface it to the user for review. They don't call out to
 * an AI — that's an orchestration-layer concern. The applicator's job
 * is to put the right scaffolding in the right file with the right
 * delimiters so a follow-up AI step (or the user) can finish.
 *
 * Layer: deterministic. Pure file I/O.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { resolveTargetRoot } from "../../../util/paths.js";
import {
  appendListItem,
  appendToMapKey,
  insertListItemAfter,
} from "../yaml-edit.js";
import { locateMemoryDir } from "../../memory.js";
import type {
  AddToAdrProposal,
  AddToDocCheckRegistryProposal,
  AddToMemoryProposal,
  AddToRuleProposal,
  AddToStandardsDocProposal,
  AddToWorkflowStepProposal,
  CrossLinkExistingProposal,
  Proposal,
  StrengthenContextLoadProposal,
} from "./types.js";

export interface ApplicatorOptions {
  cwd?: string;
  /** When true, return the planned write without performing it. */
  dryRun?: boolean;
  /** Override memory store path for add-to-memory applicator. */
  memoryPath?: string;
  /** Test seam — homedir() override (also for memory applicator). */
  homeDir?: string;
}

export interface ApplicatorResult {
  /** True when the apply step succeeded (or would, in dry-run). */
  ok: boolean;
  /** Files written / would-be written. */
  writes: Array<{ path: string; mode: "create" | "modify"; preview?: string }>;
  /** Human-readable message describing what happened. */
  message: string;
  /** Optional warnings (non-fatal). */
  warnings?: string[];
}

/**
 * Apply a proposal. Dispatches on `proposal.kind`. Returns a structured
 * result; the walker renders it to the user.
 */
export function applyProposal(
  proposal: Proposal,
  options: ApplicatorOptions = {},
): ApplicatorResult {
  switch (proposal.kind) {
    case "add-to-workflow-step":
      return applyAddToWorkflowStep(proposal, options);
    case "add-to-memory":
      return applyAddToMemory(proposal, options);
    case "add-to-rule":
      return applyAddToRule(proposal, options);
    case "add-to-standards-doc":
      return applyAddToStandardsDoc(proposal, options);
    case "add-to-adr":
      return applyAddToAdr(proposal, options);
    case "add-to-doc-check-registry":
      return applyAddToDocCheckRegistry(proposal, options);
    case "strengthen-context-load":
      return applyStrengthenContextLoad(proposal, options);
    case "cross-link-existing":
      return applyCrossLinkExisting(proposal, options);
  }
}

function applyAddToWorkflowStep(
  proposal: AddToWorkflowStepProposal,
  options: ApplicatorOptions,
): ApplicatorResult {
  const root = resolveTargetRoot(options.cwd);
  const path = join(root, "substrate", "workflows", `${proposal.workflowId}.yaml`);
  if (!existsSync(path)) {
    return {
      ok: false,
      writes: [],
      message: `workflow manifest not found at ${path}`,
    };
  }
  const current = readFileSync(path, "utf8");
  const newStep: Record<string, unknown> = {
    id: proposal.payload.stepId,
    type: proposal.payload.stepType,
  };
  if (proposal.payload.stepName) newStep.name = proposal.payload.stepName;
  if (proposal.payload.prompt) newStep.prompt = proposal.payload.prompt;
  if (proposal.payload.run) newStep.run = proposal.payload.run;
  if (proposal.payload.mustConfirm) newStep["must-confirm"] = true;

  let updated: string;
  try {
    if (proposal.payload.afterStep) {
      updated = insertListItemAfter(current, "steps", proposal.payload.afterStep, newStep);
    } else {
      updated = appendListItem(current, "steps", newStep);
    }
  } catch (err) {
    return {
      ok: false,
      writes: [],
      message: `failed to edit workflow YAML: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!options.dryRun) {
    writeFileSync(path, updated, "utf8");
  }
  return {
    ok: true,
    writes: [{ path, mode: "modify", preview: updated }],
    message: `step "${proposal.payload.stepId}" added to ${proposal.workflowId}.yaml`,
  };
}

function applyAddToMemory(
  proposal: AddToMemoryProposal,
  options: ApplicatorOptions,
): ApplicatorResult {
  const loc = locateMemoryDir({
    memoryPath: options.memoryPath,
    cwd: options.cwd,
    homeDir: options.homeDir,
  });
  if (!loc.path) {
    return {
      ok: false,
      writes: [],
      message:
        "no memory store discovered (set --memory-path, SUBSTRATE_MEMORY_PATH, or substrate.config.json memory.path)",
    };
  }
  const path = join(loc.path, `${proposal.payload.name}.md`);
  const fm: Record<string, unknown> = {
    name: proposal.payload.name,
    description:
      proposal.payload.description ?? `Auto-captured by substrate v2 proposal pipeline.`,
    metadata: {
      type: proposal.payload.type,
      ...(proposal.payload.scope ? { scope: proposal.payload.scope } : {}),
      ...(proposal.payload.tags && proposal.payload.tags.length > 0
        ? { tags: proposal.payload.tags }
        : {}),
    },
  };
  const body = [
    "---",
    stringifyYaml(fm).trim(),
    "---",
    "",
    proposal.payload.body,
    "",
  ].join("\n");
  const mode = existsSync(path) ? "modify" : "create";
  if (!options.dryRun) {
    if (mode === "create") mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf8");
  }
  return {
    ok: true,
    writes: [{ path, mode, preview: body }],
    message:
      mode === "create"
        ? `memory created at ${path}`
        : `memory overwritten at ${path}`,
  };
}

function applyAddToRule(
  proposal: AddToRuleProposal,
  options: ApplicatorOptions,
): ApplicatorResult {
  const root = resolveTargetRoot(options.cwd);
  // Discover RULES.yaml — prefer substrate/, fall back to auto/.
  const candidates = [
    join(root, "substrate", "RULES.yaml"),
    join(root, "auto", "RULES.yaml"),
  ];
  const rulesPath = candidates.find((p) => existsSync(p));
  if (!rulesPath) {
    return {
      ok: false,
      writes: [],
      message: `RULES.yaml not found (looked in substrate/ and auto/)`,
    };
  }
  const current = readFileSync(rulesPath, "utf8");
  const newRule: Record<string, unknown> = {
    id: proposal.payload.ruleId,
    title: proposal.payload.title,
    description: proposal.payload.description,
    severity: proposal.payload.severity,
  };
  if (proposal.payload.manualReview) {
    newRule["manual-review"] = true;
  }
  let updated: string;
  try {
    updated = appendListItem(current, "rules", newRule);
  } catch (err) {
    return {
      ok: false,
      writes: [],
      message: `failed to edit RULES.yaml: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!options.dryRun) writeFileSync(rulesPath, updated, "utf8");
  return {
    ok: true,
    writes: [{ path: rulesPath, mode: "modify", preview: updated }],
    message: `rule ${proposal.payload.ruleId} appended (manual-review: ${proposal.payload.manualReview})`,
  };
}

function applyAddToStandardsDoc(
  proposal: AddToStandardsDocProposal,
  options: ApplicatorOptions,
): ApplicatorResult {
  const root = resolveTargetRoot(options.cwd);
  const candidates = [
    join(root, "substrate", "standards"),
    join(root, "standards"),
    join(root, "auto", "standards"),
  ];
  const standardsRoot = candidates.find((p) => existsSync(p));
  if (!standardsRoot) {
    return {
      ok: false,
      writes: [],
      message: `standards root not found (looked in substrate/standards, standards, auto/standards)`,
    };
  }
  const path = join(standardsRoot, proposal.payload.docPath);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const heading = proposal.payload.sectionHeading;
  const addition = proposal.payload.addition.trim();

  let updated: string;
  if (heading && existing.includes(`## ${heading}`)) {
    // Append after the section heading's first paragraph.
    updated = existing.replace(
      new RegExp(`(## ${escapeRegex(heading)}\\n)`),
      `$1\n${addition}\n\n`,
    );
  } else {
    const headingLine = heading ? `\n## ${heading}\n\n` : "\n";
    const footer =
      `\n<!-- substrate-proposal: ${proposal.id} (${proposal.linkedDrift}, confidence: ${proposal.confidence}) -->\n`;
    updated = existing + headingLine + addition + "\n" + footer;
  }
  const mode = existing === "" ? "create" : "modify";
  if (!options.dryRun) {
    if (mode === "create") mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, updated, "utf8");
  }
  return {
    ok: true,
    writes: [{ path, mode, preview: updated }],
    message: `standards doc ${proposal.payload.docPath} ${mode === "create" ? "created" : "appended-to"} (review the draft before relying on it)`,
  };
}

function applyAddToAdr(
  proposal: AddToAdrProposal,
  options: ApplicatorOptions,
): ApplicatorResult {
  const root = resolveTargetRoot(options.cwd);
  // ADR discovery: prefer substrate.config.json#decisions.dir if set;
  // else look for auto/docs/decisions/, then docs/decisions/.
  const candidates = [
    join(root, "auto", "docs", "decisions"),
    join(root, "docs", "decisions"),
    join(root, "substrate", "decisions"),
  ];
  let dir = candidates.find((p) => existsSync(p));
  if (!dir) {
    // First-time consumer — scaffold under auto/docs/decisions.
    dir = candidates[0];
    if (!options.dryRun) mkdirSync(dir, { recursive: true });
  }
  // Next DEC-XXX number: scan existing files for the highest.
  let nextNum = 1;
  if (existsSync(dir)) {
    const entries = readdirSync(dir);
    for (const e of entries) {
      const m = e.match(/^DEC-(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= nextNum) nextNum = n + 1;
      }
    }
  }
  const num = String(nextNum).padStart(3, "0");
  const filename = `DEC-${num}-${proposal.payload.slug}.md`;
  const path = join(dir, filename);
  const body = renderAdrBody(num, proposal);
  if (!options.dryRun) writeFileSync(path, body, "utf8");
  return {
    ok: true,
    writes: [{ path, mode: "create", preview: body }],
    message: `ADR ${filename} drafted (status: proposed; review + edit before linking)`,
  };
}

function renderAdrBody(num: string, proposal: AddToAdrProposal): string {
  return `# DEC-${num}: ${proposal.payload.title}

- **Status:** proposed
- **Date:** ${proposal.generatedAt.slice(0, 10)}
- **Source:** substrate proposal ${proposal.id} (drift: ${proposal.linkedDrift}, confidence: ${proposal.confidence})

## Context

${proposal.suggestedAction}

## Decision

${proposal.payload.body}

## Consequences

_Document the trade-offs before promoting status to accepted._

<!-- substrate-proposal: ${proposal.id} -->
`;
}

function applyAddToDocCheckRegistry(
  proposal: AddToDocCheckRegistryProposal,
  options: ApplicatorOptions,
): ApplicatorResult {
  const root = resolveTargetRoot(options.cwd);
  const dir = join(root, "substrate", "doc-checks");
  const path = join(dir, `${proposal.payload.docCheckId}.yaml`);
  const body = stringifyYaml({
    schema_version: "v2.0",
    id: proposal.payload.docCheckId,
    description: proposal.payload.description,
    severity: proposal.payload.severity,
    when: {
      "files-changed-any": [proposal.payload.triggerGlob],
    },
    require: {
      "files-changed-any": [proposal.payload.requireDoc],
    },
  });
  if (!options.dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, body, "utf8");
  }
  return {
    ok: true,
    writes: [{ path, mode: "create", preview: body }],
    message: `doc-check ${proposal.payload.docCheckId}.yaml created`,
  };
}

function applyStrengthenContextLoad(
  proposal: StrengthenContextLoadProposal,
  options: ApplicatorOptions,
): ApplicatorResult {
  const root = resolveTargetRoot(options.cwd);
  const path = join(root, "substrate", "workflows", `${proposal.workflowId}.yaml`);
  if (!existsSync(path)) {
    return {
      ok: false,
      writes: [],
      message: `workflow manifest not found at ${path}`,
    };
  }
  const current = readFileSync(path, "utf8");
  let updated = current;
  const warnings: string[] = [];
  for (const addition of proposal.payload.additions) {
    try {
      // Map context-kind to its dotted path.
      const keyPath =
        proposal.payload.contextKind === "memory"
          ? "context.memory.tags"
          : proposal.payload.contextKind === "rules"
            ? "context.rules"
            : proposal.payload.contextKind === "standards"
              ? "context.standards"
              : "context.knowledge-sections";
      updated = appendToMapKey(updated, keyPath, addition);
    } catch (err) {
      warnings.push(
        `failed to append "${addition}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (!options.dryRun) writeFileSync(path, updated, "utf8");
  return {
    ok: warnings.length === 0,
    writes: [{ path, mode: "modify", preview: updated }],
    message: `context-load for ${proposal.workflowId} extended (kind: ${proposal.payload.contextKind})`,
    warnings,
  };
}

function applyCrossLinkExisting(
  proposal: CrossLinkExistingProposal,
  options: ApplicatorOptions,
): ApplicatorResult {
  const root = resolveTargetRoot(options.cwd);
  const sourceAbs = join(root, proposal.payload.sourcePath);
  if (!existsSync(sourceAbs)) {
    return {
      ok: false,
      writes: [],
      message: `source file not found: ${proposal.payload.sourcePath}`,
    };
  }
  const linkLine = `\n<!-- substrate-cross-link: ${proposal.id} -->\nSee also: [${proposal.payload.anchor}](${proposal.payload.targetPath})\n`;
  if (!options.dryRun) appendFileSync(sourceAbs, linkLine, "utf8");
  const updatedPreview = readFileSync(sourceAbs, "utf8") + (options.dryRun ? linkLine : "");
  return {
    ok: true,
    writes: [{ path: sourceAbs, mode: "modify", preview: updatedPreview }],
    message: `cross-link appended to ${proposal.payload.sourcePath} → ${proposal.payload.targetPath}`,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
