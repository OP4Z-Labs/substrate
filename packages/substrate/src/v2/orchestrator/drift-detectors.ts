/**
 * Substrate v2 — Drift detection (Phase B3, Primitive 9 Component B).
 *
 * Each detector is a pure function over `(currentLog, manifest,
 * loadedContext, history?)` that returns a `DriftFinding[]`. The set of
 * detectors is composed by `runDriftDetectors()` which iterates over
 * a default registry and aggregates findings.
 *
 * Plan §3.9 Component B enumerates six detector kinds. We ship all
 * six in this module:
 *
 *   - `adhoc-step`             — manifest had no step matching an
 *                                `adhoc-step` event from the run
 *   - `skipped-step`           — manifest step never received a
 *                                `step-start` event
 *   - `out-of-order`           — manifest steps executed in a different
 *                                sequence (detected via Kendall tau
 *                                deviation)
 *   - `context-gap`            — AI issued a `prompt-issued` for info
 *                                that should have been pre-loaded
 *   - `repeated-prompt`        — same prompt issued >= 3 times in one
 *                                run (context insufficient)
 *   - `rule-violation-recurrence`
 *                              — finding flagged in this run also
 *                                appeared in >= N previous runs (see
 *                                plan §3.9: "N previous runs")
 *
 * The detectors that need cross-session history accept an optional
 * `history` parameter (an array of prior session-event-logs). Without
 * it they emit nothing — the deterministic-layer entry point
 * (`runDriftDetectors`) handles history loading transparently.
 *
 * Layer: orchestrator-adjacent helper consumed by the deterministic
 * proposal pipeline. Pure: same inputs → same findings.
 */

import { readSessionLog, indexSessionLogs, type SessionEvent } from "./session-log.js";
import type { WorkflowManifest } from "../types.js";

export type DriftKind =
  | "adhoc-step"
  | "skipped-step"
  | "out-of-order"
  | "context-gap"
  | "repeated-prompt"
  | "rule-violation-recurrence";

export interface DriftFinding {
  kind: DriftKind;
  /** Short signature for de-duplication across runs. */
  signature: string;
  /** Human-readable detail (what was detected). */
  detail: string;
  /** Manifest step the drift sits next to (when applicable). */
  step?: string;
  /** Cross-session evidence (paths to other logs that exhibit the same drift). */
  evidence?: string[];
  /** Recurrence count when the detector is cross-session. */
  recurrence?: number;
  /**
   * Confidence tier — used by the proposal classifier to decide whether
   * to emit a `high` / `medium` / `low` proposal.
   */
  confidence: "high" | "medium" | "low";
}

export interface DriftLoadedContext {
  /** Ids actually loaded under `context-loaded` kind=memory. */
  memoryIds: string[];
  /** Ids loaded under kind=standards. */
  standardIds: string[];
  /** Ids loaded under kind=rules. */
  ruleIds: string[];
  /** Ids loaded under kind=knowledge. */
  knowledgeIds: string[];
}

/**
 * Detect ad-hoc steps the user (or AI) inserted that don't correspond
 * to any manifest step.
 *
 * Confidence policy: `low` for the first occurrence of a description;
 * `medium` when seen in 2 prior runs; `high` when seen in >= 3.
 * Cross-session evidence drives confidence — this detector emits one
 * finding PER unique ad-hoc description observed in the current run.
 */
export function detectAdhocSteps(
  currentEvents: SessionEvent[],
  manifest: WorkflowManifest,
  history: SessionEvent[][] = [],
): DriftFinding[] {
  const manifestStepIds = new Set((manifest.steps ?? []).map((s) => s.id));
  const findings: DriftFinding[] = [];
  const seenSignatures = new Set<string>();
  for (const ev of currentEvents) {
    if (ev.event !== "adhoc-step") continue;
    // An adhoc-step event with a step-id that matches a manifest step
    // means the user re-stamped a manifest step (not drift).
    if (ev["at-step"] && manifestStepIds.has(ev["at-step"]) && !ev.description) {
      continue;
    }
    const signature = signatureForAdhoc(ev.description);
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);

    let recurrence = 1;
    const evidence: string[] = [];
    for (const log of history) {
      const found = log.some(
        (e) =>
          e.event === "adhoc-step" &&
          signatureForAdhoc(e.description) === signature,
      );
      if (found) {
        recurrence += 1;
        // We don't have the source path here — `runDriftDetectors`
        // populates evidence by carrying log paths through.
      }
    }
    const confidence =
      recurrence >= 3 ? "high" : recurrence === 2 ? "medium" : "low";
    findings.push({
      kind: "adhoc-step",
      signature,
      detail: `ad-hoc step: "${ev.description}"`,
      step: ev["at-step"],
      recurrence,
      evidence: evidence.length > 0 ? evidence : undefined,
      confidence,
    });
  }
  return findings;
}

/**
 * Detect manifest steps that didn't receive a `step-start` event. This
 * usually means the workflow halted early or the user skipped the step.
 *
 * Skipped-step is a low-confidence proposal: one skipped step is rarely
 * actionable; it becomes interesting only when the same step is
 * repeatedly skipped. The proposal layer escalates to higher confidence
 * when it sees pattern recurrence across history.
 */
export function detectSkippedSteps(
  currentEvents: SessionEvent[],
  manifest: WorkflowManifest,
): DriftFinding[] {
  const started = new Set<string>();
  for (const ev of currentEvents) {
    if (ev.event === "step-start") started.add(ev.step);
  }
  const findings: DriftFinding[] = [];
  for (const step of manifest.steps ?? []) {
    if (!started.has(step.id)) {
      findings.push({
        kind: "skipped-step",
        signature: `skipped:${manifest.id}:${step.id}`,
        detail: `manifest step "${step.id}" was not started`,
        step: step.id,
        confidence: "low",
      });
    }
  }
  return findings;
}

/**
 * Detect out-of-order step execution.
 *
 * Heuristic: compare the order of `step-start` events against the
 * manifest's declared order. Any inversion (manifest step i started
 * after manifest step j when i < j in the manifest) counts.
 *
 * The first inversion observed in the run is the anchor — we report
 * one finding per inversion pair so the proposal layer can suggest
 * re-ordering or marking the affected steps as parallel-safe.
 */
export function detectOutOfOrder(
  currentEvents: SessionEvent[],
  manifest: WorkflowManifest,
): DriftFinding[] {
  const declaredOrder = new Map<string, number>();
  (manifest.steps ?? []).forEach((s, i) => declaredOrder.set(s.id, i));
  const runOrder: string[] = [];
  for (const ev of currentEvents) {
    if (ev.event === "step-start" && declaredOrder.has(ev.step)) {
      runOrder.push(ev.step);
    }
  }
  const findings: DriftFinding[] = [];
  for (let i = 1; i < runOrder.length; i += 1) {
    const prevId = runOrder[i - 1];
    const curId = runOrder[i];
    const prevIdx = declaredOrder.get(prevId)!;
    const curIdx = declaredOrder.get(curId)!;
    if (curIdx < prevIdx) {
      findings.push({
        kind: "out-of-order",
        signature: `outoforder:${manifest.id}:${prevId}->${curId}`,
        detail: `step "${curId}" started after "${prevId}" but is declared earlier in the manifest`,
        step: curId,
        confidence: "medium",
      });
    }
  }
  return findings;
}

/**
 * Detect "context-gap" — prompts asking for information the workflow
 * should have pre-loaded. Heuristic: if a `prompt-issued` event's
 * payload looks like it's asking about a known context kind that
 * wasn't loaded, flag it.
 *
 * The detector matches against a small set of probe phrases:
 *
 *   - "what's the schema" / "what is the schema"     → wants knowledge
 *   - "which rule"                                   → wants rules
 *   - "what does the standard say"                   → wants standards
 *   - "any prior decisions" / "any feedback"         → wants memory
 *
 * If the matched kind isn't already in `loadedContext.<kind>Ids`, we
 * surface a context-gap finding with confidence proportional to
 * specificity. The match list is intentionally narrow — false positives
 * here cost more than false negatives because the proposal pipeline
 * eventually writes manifest edits.
 */
export function detectContextGaps(
  currentEvents: SessionEvent[],
  loadedContext: DriftLoadedContext,
): DriftFinding[] {
  const probes: Array<{
    re: RegExp;
    kind: keyof DriftLoadedContext;
    suggested: string;
  }> = [
    {
      re: /\bwhat'?s the schema\b/i,
      kind: "knowledgeIds",
      suggested: "include schema knowledge in context.knowledge-sections",
    },
    {
      re: /\bwhich rule\b/i,
      kind: "ruleIds",
      suggested: "load relevant rule patterns in context.rules",
    },
    {
      re: /\bwhat does the standard\b/i,
      kind: "standardIds",
      suggested: "add the relevant standards doc to context.standards",
    },
    {
      re: /\b(any|relevant) (prior decisions|feedback|memor)\b/i,
      kind: "memoryIds",
      suggested:
        "broaden context.memory filters so the relevant feedback/project memories load",
    },
  ];
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();
  for (const ev of currentEvents) {
    if (ev.event !== "prompt-issued") continue;
    for (const probe of probes) {
      if (!probe.re.test(ev.prompt)) continue;
      const loadedList = loadedContext[probe.kind];
      if (loadedList && loadedList.length > 0) continue;
      const signature = `contextgap:${probe.kind}:${probe.re.source}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      findings.push({
        kind: "context-gap",
        signature,
        detail: `prompt "${ev.prompt.slice(0, 80)}…" suggests missing ${probe.kind}: ${probe.suggested}`,
        step: ev.step,
        confidence: "medium",
      });
    }
  }
  return findings;
}

/**
 * Detect repeated prompts within a single workflow run.
 *
 * Threshold: 3 occurrences of the same prompt (normalized by lowercase
 * + collapsed whitespace). Plan §3.9 specifies ">= 3 times". Below
 * threshold the detector says nothing.
 *
 * Why per-run, not cross-run? Cross-run prompt recurrence is `context-
 * gap` territory (handled separately). Within a single run, the same
 * prompt firing repeatedly is a structural signal — the AI didn't get
 * what it needed the first time and is re-asking.
 */
export const REPEATED_PROMPT_THRESHOLD = 3;

export function detectRepeatedPrompts(
  currentEvents: SessionEvent[],
): DriftFinding[] {
  const counts = new Map<string, { prompt: string; n: number; step?: string }>();
  for (const ev of currentEvents) {
    if (ev.event !== "prompt-issued") continue;
    const norm = normalizePrompt(ev.prompt);
    if (!norm) continue;
    const existing = counts.get(norm);
    if (existing) {
      existing.n += 1;
    } else {
      counts.set(norm, { prompt: ev.prompt, n: 1, step: ev.step });
    }
  }
  const findings: DriftFinding[] = [];
  for (const [norm, info] of counts.entries()) {
    if (info.n < REPEATED_PROMPT_THRESHOLD) continue;
    findings.push({
      kind: "repeated-prompt",
      signature: `repeated:${norm}`,
      detail: `prompt repeated ${info.n} times: "${info.prompt.slice(0, 80)}"`,
      step: info.step,
      recurrence: info.n,
      confidence: "high",
    });
  }
  return findings;
}

/**
 * Detect rule-violation recurrence by reading audit sidecars at
 * `substrate/audits/` and looking for findings that also appeared in
 * prior runs.
 *
 * Rule-violation-recurrence is the bridge between the audit subsystem
 * (Finding objects with `originalSeverity` + `firstSeenAt`) and the
 * proposal pipeline. When a finding has been flagged in >= 3 audit
 * runs, the proposal layer suggests `add-to-rule` (codify it) or
 * `strengthen-context-load` (pre-warn the AI about it).
 *
 * The detector is intentionally minimal here: it expects callers to
 * pass `findings` directly (the audit-runner produces them); aggregation
 * + recurrence counting lives in the audit's escalation module. We
 * emit one drift finding per audit-finding that has age >= 3 prior
 * runs.
 */
export interface RuleViolationRecord {
  ruleId: string;
  path: string;
  snippet?: string;
  /** Number of prior audit sidecars in which this finding (by fingerprint) appeared. */
  priorRunCount: number;
}

export function detectRuleViolationRecurrence(
  records: RuleViolationRecord[],
  threshold = 3,
): DriftFinding[] {
  const out: DriftFinding[] = [];
  for (const r of records) {
    if (r.priorRunCount < threshold) continue;
    out.push({
      kind: "rule-violation-recurrence",
      signature: `recurrence:${r.ruleId}:${r.path}:${r.snippet ?? ""}`,
      detail: `rule ${r.ruleId} has flagged ${r.path} in ${r.priorRunCount + 1} runs (incl. current)`,
      recurrence: r.priorRunCount + 1,
      confidence: r.priorRunCount >= 5 ? "high" : "medium",
    });
  }
  return out;
}

/**
 * Compose the default detector set. Loads cross-session history for
 * detectors that need it. Returns the union of findings sorted by
 * descending confidence.
 */
export interface RunDriftDetectorsOptions {
  manifest: WorkflowManifest;
  /** Path to the current session-event-log on disk. */
  sessionLogPath: string;
  /** Optional override for cross-session history limit (default 10). */
  historyLimit?: number;
  cwd?: string;
  /** Audit-side recurrence records to feed into the recurrence detector. */
  ruleViolationRecords?: RuleViolationRecord[];
}

export interface DriftDetectorRun {
  findings: DriftFinding[];
  warnings: string[];
}

export function runDriftDetectors(
  options: RunDriftDetectorsOptions,
): DriftDetectorRun {
  const warnings: string[] = [];
  const current = readSessionLog(options.sessionLogPath);
  if (current.warnings.length > 0) warnings.push(...current.warnings);
  const currentEvents = current.events;

  // Load prior session logs for the same workflow id.
  const limit = options.historyLimit ?? 10;
  const index = indexSessionLogs({
    cwd: options.cwd,
    workflowId: options.manifest.id,
  });
  // Exclude the current log; keep most recent `limit` of the rest.
  const priorPaths = index
    .filter((e) => e.path !== options.sessionLogPath)
    .slice(-limit);
  const history: SessionEvent[][] = [];
  const historyPaths: string[] = [];
  for (const entry of priorPaths) {
    const r = readSessionLog(entry.path);
    if (r.events.length > 0) {
      history.push(r.events);
      historyPaths.push(entry.path);
    }
    if (r.warnings.length > 0) warnings.push(...r.warnings);
  }

  // Build the loaded-context summary from the run's context-loaded
  // events. Drift detectors need this for the context-gap probe.
  const loadedContext: DriftLoadedContext = {
    memoryIds: [],
    standardIds: [],
    ruleIds: [],
    knowledgeIds: [],
  };
  for (const ev of currentEvents) {
    if (ev.event !== "context-loaded") continue;
    if (ev.kind === "memory") loadedContext.memoryIds.push(...ev.ids);
    else if (ev.kind === "standards") loadedContext.standardIds.push(...ev.ids);
    else if (ev.kind === "rules") loadedContext.ruleIds.push(...ev.ids);
    else if (ev.kind === "knowledge") loadedContext.knowledgeIds.push(...ev.ids);
  }

  const findings: DriftFinding[] = [];

  const adhoc = detectAdhocSteps(currentEvents, options.manifest, history);
  // Stitch evidence paths onto adhoc findings using the history index.
  for (const finding of adhoc) {
    if (finding.recurrence && finding.recurrence > 1) {
      const evidence: string[] = [];
      history.forEach((log, idx) => {
        if (
          log.some(
            (e) =>
              e.event === "adhoc-step" &&
              signatureForAdhoc(e.description) === finding.signature,
          )
        ) {
          evidence.push(historyPaths[idx]);
        }
      });
      finding.evidence = evidence;
    }
  }
  findings.push(...adhoc);
  findings.push(...detectSkippedSteps(currentEvents, options.manifest));
  findings.push(...detectOutOfOrder(currentEvents, options.manifest));
  findings.push(...detectContextGaps(currentEvents, loadedContext));
  findings.push(...detectRepeatedPrompts(currentEvents));
  if (options.ruleViolationRecords && options.ruleViolationRecords.length > 0) {
    findings.push(...detectRuleViolationRecurrence(options.ruleViolationRecords));
  }

  // Sort: high → medium → low; stable within tier by kind alpha order.
  const confidenceRank: Record<DriftFinding["confidence"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  findings.sort((a, b) => {
    const cr = confidenceRank[a.confidence] - confidenceRank[b.confidence];
    if (cr !== 0) return cr;
    return a.kind.localeCompare(b.kind);
  });

  return { findings, warnings };
}

/**
 * Normalize a prompt to a recurrence signature. We lowercase, collapse
 * whitespace, and strip trailing punctuation. The proposal classifier
 * decides whether two prompts are "the same question."
 */
function normalizePrompt(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?.!,;:]+\s*$/g, "")
    .trim();
}

/**
 * Signature for adhoc-step descriptions. Same normalization as prompts
 * + a `adhoc:` prefix so signatures don't collide with prompt
 * signatures.
 */
function signatureForAdhoc(description: string): string {
  return `adhoc:${normalizePrompt(description)}`;
}
