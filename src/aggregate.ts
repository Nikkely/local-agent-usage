import type { DailyUsage, PeriodUsage, SourceUsage } from "./types.js";

/** Merge multiple sources' daily usage into one series, summed by date. */
export function mergeDaily(sources: SourceUsage[]): DailyUsage[] {
  const byDate = new Map<string, DailyUsage>();
  for (const { daily } of sources) {
    for (const d of daily) {
      const day =
        byDate.get(d.date) ??
        {
          date: d.date,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        };
      day.inputTokens += d.inputTokens;
      day.outputTokens += d.outputTokens;
      day.cacheReadTokens += d.cacheReadTokens;
      day.cacheCreationTokens += d.cacheCreationTokens;
      byDate.set(d.date, day);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Estimated pricing (USD per million tokens), based on Sonnet 4.6 rates.
 * Cache write = 1.25x input, cache read = 0.1x input (standard Anthropic ratios).
 */
export const RATES = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
} as const;

export function estimateCost(u: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return (
    (u.inputTokens * RATES.input +
      u.outputTokens * RATES.output +
      u.cacheCreationTokens * RATES.cacheWrite +
      u.cacheReadTokens * RATES.cacheRead) /
    1_000_000
  );
}

function emptyPeriod(key: string, label: string): PeriodUsage {
  return {
    key,
    label,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

function add(p: PeriodUsage, d: DailyUsage): void {
  p.inputTokens += d.inputTokens;
  p.outputTokens += d.outputTokens;
  p.cacheReadTokens += d.cacheReadTokens;
  p.cacheCreationTokens += d.cacheCreationTokens;
}

/** ISO-8601 week number + year for a YYYY-MM-DD date string (UTC). */
function isoWeek(dateStr: string): { year: number; week: number } {
  const d = new Date(dateStr + "T00:00:00Z");
  // Shift to Thursday of the current week (ISO weeks belong to the year of their Thursday).
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week =
    1 +
    Math.round(
      (d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
  return { year: d.getUTCFullYear(), week };
}

export function aggregateWeekly(days: DailyUsage[]): PeriodUsage[] {
  const map = new Map<string, PeriodUsage>();
  for (const d of days) {
    const { year, week } = isoWeek(d.date);
    const key = `${year}-W${String(week).padStart(2, "0")}`;
    const p = map.get(key) ?? emptyPeriod(key, key);
    add(p, d);
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function aggregateMonthly(days: DailyUsage[]): PeriodUsage[] {
  const map = new Map<string, PeriodUsage>();
  for (const d of days) {
    const key = d.date.slice(0, 7); // YYYY-MM
    const p = map.get(key) ?? emptyPeriod(key, key);
    add(p, d);
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface Summary {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreation: number;
  totalTokens: number;
  totalCost: number;
  peakDay: DailyUsage | null;
  rangeStart: string;
  rangeEnd: string;
}

export function summarize(days: DailyUsage[]): Summary {
  const totals = days.reduce(
    (acc, d) => {
      acc.totalInput += d.inputTokens;
      acc.totalOutput += d.outputTokens;
      acc.totalCacheRead += d.cacheReadTokens;
      acc.totalCacheCreation += d.cacheCreationTokens;
      return acc;
    },
    {
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheCreation: 0,
    }
  );

  const peakDay =
    days.length === 0
      ? null
      : days.reduce((max, d) =>
          dayTokens(d) > dayTokens(max) ? d : max
        );

  const totalTokens =
    totals.totalInput +
    totals.totalOutput +
    totals.totalCacheRead +
    totals.totalCacheCreation;

  return {
    ...totals,
    totalTokens,
    totalCost: estimateCost({
      inputTokens: totals.totalInput,
      outputTokens: totals.totalOutput,
      cacheReadTokens: totals.totalCacheRead,
      cacheCreationTokens: totals.totalCacheCreation,
    }),
    peakDay,
    rangeStart: days[0]?.date ?? "",
    rangeEnd: days[days.length - 1]?.date ?? "",
  };
}

export function dayTokens(d: DailyUsage): number {
  return (
    d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheCreationTokens
  );
}
