import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { localDate } from "./dates.js";
import type { DailyUsage, ReadOptions } from "./types.js";

/**
 * Read OpenAI Codex CLI usage from local session logs — no API key needed.
 * Codex writes one JSONL per session under ~/.codex/sessions/YYYY/MM/DD/, and
 * emits `token_count` events whose `total_token_usage` is CUMULATIVE within the
 * session. We attribute usage per event as the delta of that cumulative total,
 * which is exact (repeated events yield 0), splits sessions across midnight
 * correctly, and lets `since` filtering work at event granularity — unlike
 * summing `last_token_usage`, which measurably overcounts on real logs.
 */

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

interface EventLine {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    info?: {
      total_token_usage?: TokenUsage;
      last_token_usage?: TokenUsage;
    } | null;
  };
}

/** Cumulative token components we track per session. */
interface Triple {
  input: number;
  cached: number;
  output: number;
}

function triple(u: TokenUsage | undefined): Triple {
  return {
    input: u?.input_tokens ?? 0,
    cached: u?.cached_input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
  };
}

/** Componentwise a - b, clamped to >= 0 (deltas are never negative in practice). */
function sub(a: Triple, b: Triple): Triple {
  return {
    input: Math.max(0, a.input - b.input),
    cached: Math.max(0, a.cached - b.cached),
    output: Math.max(0, a.output - b.output),
  };
}

function sessionsDir(): string {
  return process.env.CODEX_SESSIONS_DIR ?? join(homedir(), ".codex", "sessions");
}

async function findJsonl(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await findJsonl(full)));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

export async function readCodexUsage(opts: ReadOptions): Promise<DailyUsage[]> {
  const throwIfEmpty = opts.throwIfEmpty ?? true;
  const root = sessionsDir();
  const files = await findJsonl(root);
  if (files.length === 0) {
    if (throwIfEmpty) {
      throw new Error(
        `No Codex CLI logs found under ${root}.\n` +
          `Set CODEX_SESSIONS_DIR to override.`
      );
    }
    console.error(`No Codex CLI logs found under ${root} — skipping.`);
    return [];
  }

  const sinceMs = opts.since.getTime();
  const untilMs = opts.until?.getTime() ?? Infinity;
  const byDate = new Map<string, DailyUsage>();

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    // Per session: walk token_count events in order, attributing the delta of
    // the cumulative total to the local date of each event.
    let prev: Triple | null = null;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let o: EventLine;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.type !== "event_msg" || o.payload?.type !== "token_count") continue;
      const info = o.payload.info;
      if (!info || !info.total_token_usage || !o.timestamp) continue; // null info = rate-limit ping

      const total = triple(info.total_token_usage);
      if (prev === null) {
        // Baseline = total - last, so a resumed session that carries a prior
        // cumulative total forward does not re-count the carried-forward part.
        prev = sub(total, triple(info.last_token_usage));
      }
      const delta = sub(total, prev);
      prev = total;

      const ts = new Date(o.timestamp).getTime();
      if (Number.isNaN(ts) || ts < sinceMs || ts >= untilMs) continue;

      const date = localDate(o.timestamp);
      const day =
        byDate.get(date) ??
        {
          date,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        };

      // Codex "cached_input_tokens" is a subset of input_tokens (prompt-cache
      // read); the rest is uncached input. Codex has no cache-write concept.
      day.inputTokens += Math.max(0, delta.input - delta.cached);
      day.cacheReadTokens += delta.cached;
      day.outputTokens += delta.output;
      // cacheCreationTokens stays 0

      byDate.set(date, day);
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
