// Normalized usage shapes shared across the local-log readers and the report.

/** Which local agent a usage record came from. */
export type AgentSource = "claude" | "codex";

/** One normalized day of usage (token counts summed across all sessions). */
export interface DailyUsage {
  date: string; // YYYY-MM-DD (local timezone)
  inputTokens: number; // uncached input
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * One assistant response's usage, with the dimensions the insights report
 * slices on (project, model, session, time of day). `readXxxUsage` folds these
 * into DailyUsage; the insights report keeps them.
 */
export interface UsageRecord {
  source: AgentSource;
  timestamp: string; // ISO-8601, as written by the agent
  date: string; // YYYY-MM-DD (local timezone)
  project: string; // Claude: project dir name; Codex: session cwd
  model: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** A bucket aggregated by week or month. */
export interface PeriodUsage {
  key: string; // e.g. "2025-W23" or "2025-06"
  label: string; // human-friendly label
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Per-source daily usage, kept separate so the report can show a split. */
export interface SourceUsage {
  source: AgentSource;
  daily: DailyUsage[];
}

/** Options shared by every local-log reader. */
export interface ReadOptions {
  /** Only include entries on or after this instant. */
  since: Date;
  /** Only include entries strictly before this instant (half-open [since, until)). */
  until?: Date;
  /** Throw when the source directory is missing/empty (default true). */
  throwIfEmpty?: boolean;
}
