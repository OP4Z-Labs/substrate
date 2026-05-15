/**
 * Trend journal reader.
 *
 * Reads the append-only `cadence/audits/_trend.jsonl` and returns the
 * history of audit runs grouped by scope. Used by `cadence audit --trend`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Severity } from "./types.js";

export interface TrendEntry {
  ts: string;
  scope: string;
  cadenceVersion: string;
  executedRules: number;
  totalFindings: number;
  findingsBySeverity: Record<Severity, number>;
  durationMs: number;
}

export interface TrendSummary {
  entries: TrendEntry[];
  byScope: Record<string, TrendEntry[]>;
  count: number;
}

export function readTrend(repoRoot: string): TrendSummary {
  const path = join(repoRoot, "cadence", "audits", "_trend.jsonl");
  if (!existsSync(path)) {
    return { entries: [], byScope: {}, count: 0 };
  }
  const text = readFileSync(path, "utf8");
  const entries: TrendEntry[] = [];
  const byScope: Record<string, TrendEntry[]> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as TrendEntry;
      entries.push(e);
      if (!byScope[e.scope]) byScope[e.scope] = [];
      byScope[e.scope]!.push(e);
    } catch {
      // Skip malformed lines silently — the journal is best-effort.
    }
  }
  return { entries, byScope, count: entries.length };
}
