import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { localDate } from "./dates.js";
import type { DailyUsage, ReadOptions } from "./types.js";

/**
 * Read Claude Code usage straight from local session logs — no API key needed.
 * Claude Code writes one JSONL per session under ~/.claude/projects/**, and every
 * assistant message carries a `usage` block. We dedupe across resumed/forked
 * sessions by message id + request id (same approach as ccusage).
 */

interface AssistantLine {
  type?: string;
  timestamp?: string;
  requestId?: string;
  message?: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

function projectsDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
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

export async function readClaudeUsage(opts: ReadOptions): Promise<DailyUsage[]> {
  const throwIfEmpty = opts.throwIfEmpty ?? true;
  const root = projectsDir();
  const files = await findJsonl(root);
  if (files.length === 0) {
    if (throwIfEmpty) {
      throw new Error(
        `No Claude Code logs found under ${root}.\n` +
          `Set CLAUDE_PROJECTS_DIR to override.`
      );
    }
    console.error(`No Claude Code logs found under ${root} — skipping.`);
    return [];
  }

  const sinceMs = opts.since.getTime();
  const untilMs = opts.until?.getTime() ?? Infinity;
  const seen = new Set<string>();
  const byDate = new Map<string, DailyUsage>();

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let o: AssistantLine;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.type !== "assistant" || !o.message?.usage || !o.timestamp) continue;
      const ts = new Date(o.timestamp).getTime();
      if (Number.isNaN(ts) || ts < sinceMs || ts >= untilMs) continue;

      // Dedupe identical messages logged in multiple sessions (resume/fork).
      const dedupeKey = `${o.message.id ?? ""}:${o.requestId ?? ""}`;
      if (dedupeKey !== ":" && seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

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

      const u = o.message.usage;
      day.inputTokens += u.input_tokens ?? 0;
      day.outputTokens += u.output_tokens ?? 0;
      day.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      day.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;

      byDate.set(date, day);
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
