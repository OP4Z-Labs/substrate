/**
 * Report writers + trend journal.
 *
 * Substrate produces three artefacts per audit run:
 *
 *   1. A human-readable Markdown report at
 *      `substrate/audits/<scope>-YYYY-MM-DD.md`.
 *   2. A `-latest.json` sidecar next to it for tooling consumption
 *      (`/run audit --trend` reads these).
 *   3. An append-only JSONL trend journal at `substrate/audits/_trend.jsonl`.
 *
 * Path conventions mirror OP4Z's `auto/audits/` layout so the
 * dogfood-into-OP4Z migration is straightforward.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync, atomicWriteJsonSync } from "../util/atomic-write.js";
import type { AuditReport, Severity } from "./types.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export interface WriteReportOptions {
  /** Absolute repo root. The reports land under `<repoRoot>/substrate/audits/`. */
  repoRoot: string;
  /** Stable scope name used in filenames (audit-friendly slug). */
  scope: string;
  /** Override the timestamp used in filenames. Defaults to current date. */
  date?: Date;
}

export interface WriteReportResult {
  /** Absolute path to the Markdown report. */
  markdownPath: string;
  /** Absolute path to the JSON sidecar. */
  jsonPath: string;
  /** Absolute path to the trend journal. */
  trendPath: string;
}

export function writeAuditReport(
  report: AuditReport,
  options: WriteReportOptions,
): WriteReportResult {
  const date = options.date ?? new Date();
  const dateLabel = isoDate(date);
  const scopeSlug = slugify(options.scope);
  const dir = join(options.repoRoot, "substrate", "audits");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const markdownPath = join(dir, `${scopeSlug}-${dateLabel}.md`);
  const jsonPath = join(dir, `${scopeSlug}-latest.json`);
  const trendPath = join(dir, "_trend.jsonl");

  atomicWriteFileSync(markdownPath, renderMarkdownReport(report));
  atomicWriteJsonSync(jsonPath, report);
  // The trend journal is append-only — atomic-write would replace it.
  appendTrendEntry(trendPath, report);

  return { markdownPath, jsonPath, trendPath };
}

/**
 * Render a single audit report to Markdown. Public so the CLI can render
 * without writing.
 */
export function renderMarkdownReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# Substrate Audit Report — ${report.scope}`);
  lines.push("");
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(`- **Substrate version:** ${report.substrateVersion}`);
  lines.push(`- **Repo:** ${report.repoRoot}`);
  lines.push(`- **Rules file:** ${report.rulesPath}`);
  lines.push(`- **Rules executed:** ${report.executedRules} of ${report.totalRules}`);
  lines.push(`- **Duration:** ${report.durationMs}ms`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`Total findings: **${report.totalFindings}**`);
  lines.push("");
  for (const sev of SEVERITY_ORDER) {
    const n = report.findingsBySeverity[sev];
    lines.push(`- ${sevBadge(sev)} ${sev}: ${n}`);
  }
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  if (report.rules.length === 0) {
    lines.push("_(no rules executed)_");
    lines.push("");
    return lines.join("\n");
  }
  for (const r of report.rules) {
    const statusEmoji = r.skipped ? "○" : r.findings.length > 0 ? sevBadge(r.severity) : "✓";
    lines.push(`### ${statusEmoji} ${r.ruleId} — ${r.ruleTitle}`);
    lines.push("");
    lines.push(
      `**Severity:** ${r.severity}  |  **Detector:** ${r.detectorType}  |  **Findings:** ${r.findings.length}  |  **Duration:** ${r.durationMs}ms`,
    );
    if (r.note) {
      lines.push("");
      lines.push(`> ${r.note}`);
    }
    if (r.findings.length > 0) {
      lines.push("");
      for (const f of r.findings) {
        const loc = f.path
          ? `\`${f.path}${f.line ? `:${f.line}` : ""}\``
          : "_(no location)_";
        lines.push(`- ${loc} — ${f.snippet ?? f.message}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function appendTrendEntry(path: string, report: AuditReport): void {
  if (!existsSync(path)) {
    // Append works even on missing files, but we want a parent-dir check.
    mkdirSync(join(path, ".."), { recursive: true });
  }
  const entry = {
    ts: report.generatedAt,
    scope: report.scope,
    substrateVersion: report.substrateVersion,
    executedRules: report.executedRules,
    totalFindings: report.totalFindings,
    findingsBySeverity: report.findingsBySeverity,
    durationMs: report.durationMs,
  };
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64) || "audit";
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sevBadge(sev: Severity): string {
  switch (sev) {
    case "critical":
      return "🚨";
    case "high":
      return "⚠";
    case "medium":
      return "·";
    case "low":
      return "·";
  }
}
