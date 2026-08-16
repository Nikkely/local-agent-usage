// Trend analysis over per-message usage records. The HTML report answers "how
// much did I use"; this answers "how is my usage changing, and where does it
// go" — the slices (project / model / session / time of day) that DailyUsage
// throws away.

import { estimateCost } from "./aggregate.js";
import { fmtTokens, fmtUsd } from "./fmt.js";
import type { UsageRecord } from "./types.js";

/** Token totals plus the counters every breakdown row reports. */
export interface Bucket {
  key: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
  calls: number;
  sessions: number;
  activeDays: number;
  firstDate: string;
  lastDate: string;
}

export interface Insights {
  range: { start: string; end: string; activeDays: number };
  overall: Bucket;
  bySource: Bucket[];
  byMonth: Bucket[];
  byWeek: Bucket[];
  byProject: Bucket[];
  byModel: Bucket[];
  byHour: Bucket[];
  byWeekday: Bucket[];
  /** Per-session totals, ascending — the basis for the concentration stats. */
  sessionTokens: number[];
}

interface Acc {
  key: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  calls: number;
  sessions: Set<string>;
  days: Set<string>;
  firstDate: string;
  lastDate: string;
}

function groupBy(
  records: UsageRecord[],
  key: (r: UsageRecord) => string
): Bucket[] {
  const map = new Map<string, Acc>();
  for (const r of records) {
    const k = key(r);
    let a = map.get(k);
    if (!a) {
      a = {
        key: k,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: 0,
        sessions: new Set(),
        days: new Set(),
        firstDate: r.date,
        lastDate: r.date,
      };
      map.set(k, a);
    }
    a.inputTokens += r.inputTokens;
    a.outputTokens += r.outputTokens;
    a.cacheReadTokens += r.cacheReadTokens;
    a.cacheCreationTokens += r.cacheCreationTokens;
    a.calls++;
    a.sessions.add(`${r.source}:${r.sessionId}`);
    a.days.add(r.date);
    if (r.date < a.firstDate) a.firstDate = r.date;
    if (r.date > a.lastDate) a.lastDate = r.date;
  }
  return [...map.values()].map((a) => ({
    key: a.key,
    inputTokens: a.inputTokens,
    outputTokens: a.outputTokens,
    cacheReadTokens: a.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens,
    totalTokens:
      a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheCreationTokens,
    cost: estimateCost(a),
    calls: a.calls,
    sessions: a.sessions.size,
    activeDays: a.days.size,
    firstDate: a.firstDate,
    lastDate: a.lastDate,
  }));
}

const byKey = (a: Bucket, b: Bucket) => a.key.localeCompare(b.key);
const byTokensDesc = (a: Bucket, b: Bucket) => b.totalTokens - a.totalTokens;

/** Monday of the week containing a YYYY-MM-DD date, as YYYY-MM-DD. */
function weekStart(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function computeInsights(records: UsageRecord[]): Insights {
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const hourOf = (r: UsageRecord) =>
    String(new Date(r.timestamp).getHours()).padStart(2, "0");
  const weekdayOf = (r: UsageRecord) =>
    String(new Date(r.timestamp).getDay());

  return {
    range: {
      start: dates[0] ?? "",
      end: dates[dates.length - 1] ?? "",
      activeDays: dates.length,
    },
    overall: groupBy(records, () => "all")[0] ?? emptyBucket("all"),
    bySource: groupBy(records, (r) => r.source).sort(byTokensDesc),
    byMonth: groupBy(records, (r) => r.date.slice(0, 7)).sort(byKey),
    byWeek: groupBy(records, (r) => weekStart(r.date)).sort(byKey),
    byProject: groupBy(records, (r) => r.project).sort(byTokensDesc),
    byModel: groupBy(records, (r) => `${r.source}/${r.model}`).sort(byTokensDesc),
    byHour: groupBy(records, hourOf).sort(byKey),
    byWeekday: groupBy(records, weekdayOf).sort(byKey),
    sessionTokens: groupBy(records, (r) => `${r.source}:${r.sessionId}`)
      .map((b) => b.totalTokens)
      .sort((a, b) => a - b),
  };
}

function emptyBucket(key: string): Bucket {
  return {
    key,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    cost: 0,
    calls: 0,
    sessions: 0,
    activeDays: 0,
    firstDate: "",
    lastDate: "",
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pct(n: number, of: number): string {
  return of === 0 ? "0%" : (((n / of) * 100).toFixed(0) + "%");
}

function per(n: number, d: number): string {
  return d === 0 ? "-" : fmtTokens(Math.round(n / d));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  // Left-align the first (label) column, right-align the numbers after it.
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join(
    "\n"
  );
}

/** Trailing-period growth: how the last full-ish bucket compares to the prior one. */
function trend(buckets: Bucket[]): string | null {
  if (buckets.length < 2) return null;
  const last = buckets[buckets.length - 1];
  const prev = buckets[buckets.length - 2];
  if (prev.totalTokens === 0) return null;
  const delta = ((last.totalTokens - prev.totalTokens) / prev.totalTokens) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${last.key} vs ${prev.key}: ${sign}${delta.toFixed(0)}% tokens (${fmtUsd(prev.cost)} -> ${fmtUsd(last.cost)})`;
}

export interface RenderOptions {
  /** Cap the project/week rows so the report stays scannable. */
  topProjects?: number;
  weeks?: number;
}

export function renderInsights(
  ins: Insights,
  opts: RenderOptions = {}
): string {
  const topProjects = opts.topProjects ?? 15;
  const weeks = opts.weeks ?? 12;
  const o = ins.overall;
  const out: string[] = [];

  out.push(
    `# Usage insights  ${ins.range.start} .. ${ins.range.end}  (${ins.range.activeDays} active days)`,
    ""
  );

  if (o.calls === 0) {
    out.push("No usage records in this window.");
    return out.join("\n");
  }

  out.push(
    `Total  ${fmtTokens(o.totalTokens)} tokens  ${fmtUsd(o.cost)} (estimated)  ` +
      `${o.calls} calls  ${o.sessions} sessions`,
    `Mix    input ${fmtTokens(o.inputTokens)} (${pct(o.inputTokens, o.totalTokens)})  ` +
      `output ${fmtTokens(o.outputTokens)} (${pct(o.outputTokens, o.totalTokens)})  ` +
      `cache read ${fmtTokens(o.cacheReadTokens)} (${pct(o.cacheReadTokens, o.totalTokens)})  ` +
      `cache write ${fmtTokens(o.cacheCreationTokens)} (${pct(o.cacheCreationTokens, o.totalTokens)})`,
    `Rate   ${per(o.totalTokens, o.activeDays)} tokens/active day  ` +
      `${fmtUsd(o.cost / Math.max(1, o.activeDays))}/active day  ` +
      `${per(o.totalTokens, o.sessions)} tokens/session  ` +
      `${per(o.outputTokens, o.calls)} output/call`,
    ""
  );

  const section = (title: string, body: string) => {
    out.push(`## ${title}`, "", body, "");
  };

  if (ins.bySource.length > 1) {
    section(
      "By agent",
      table(
        ["agent", "tokens", "cost", "share", "days", "sessions", "first", "last"],
        ins.bySource.map((b) => [
          b.key,
          fmtTokens(b.totalTokens),
          fmtUsd(b.cost),
          pct(b.totalTokens, o.totalTokens),
          String(b.activeDays),
          String(b.sessions),
          b.firstDate,
          b.lastDate,
        ])
      )
    );
  }

  section(
    "Monthly",
    table(
      ["month", "tokens", "cost", "days", "sessions", "tok/day", "out/call", "cacheR%"],
      ins.byMonth.map((b) => [
        b.key,
        fmtTokens(b.totalTokens),
        fmtUsd(b.cost),
        String(b.activeDays),
        String(b.sessions),
        per(b.totalTokens, b.activeDays),
        per(b.outputTokens, b.calls),
        pct(b.cacheReadTokens, b.totalTokens),
      ])
    ) + (trend(ins.byMonth) ? `\n\nMoM  ${trend(ins.byMonth)}` : "")
  );

  const shownWeeks = ins.byWeek.slice(-weeks);
  section(
    `Weekly (last ${shownWeeks.length})`,
    table(
      ["week of", "tokens", "cost", "days", "sessions", "tok/day"],
      shownWeeks.map((b) => [
        b.key,
        fmtTokens(b.totalTokens),
        fmtUsd(b.cost),
        String(b.activeDays),
        String(b.sessions),
        per(b.totalTokens, b.activeDays),
      ])
    ) + (trend(shownWeeks) ? `\n\nWoW  ${trend(shownWeeks)}` : "")
  );

  const shownProjects = ins.byProject.slice(0, topProjects);
  const restTokens = ins.byProject
    .slice(topProjects)
    .reduce((a, b) => a + b.totalTokens, 0);
  section(
    `Projects (top ${shownProjects.length} of ${ins.byProject.length})`,
    table(
      ["project", "tokens", "cost", "share", "days", "sessions"],
      shownProjects
        .map((b) => [
          b.key,
          fmtTokens(b.totalTokens),
          fmtUsd(b.cost),
          pct(b.totalTokens, o.totalTokens),
          String(b.activeDays),
          String(b.sessions),
        ])
        .concat(
          restTokens > 0
            ? [
                [
                  `(${ins.byProject.length - shownProjects.length} more)`,
                  fmtTokens(restTokens),
                  "",
                  pct(restTokens, o.totalTokens),
                  "",
                  "",
                ],
              ]
            : []
        )
    )
  );

  section(
    "Models",
    table(
      ["model", "tokens", "cost", "share", "calls", "first", "last"],
      ins.byModel.map((b) => [
        b.key,
        fmtTokens(b.totalTokens),
        fmtUsd(b.cost),
        pct(b.totalTokens, o.totalTokens),
        String(b.calls),
        b.firstDate,
        b.lastDate,
      ])
    )
  );

  const peakHour = Math.max(...ins.byHour.map((b) => b.totalTokens));
  section(
    "Hour of day (local)",
    ins.byHour
      .map(
        (b) =>
          `${b.key}  ${fmtTokens(b.totalTokens).padStart(8)}  ` +
          "#".repeat(Math.round((b.totalTokens / peakHour) * 40))
      )
      .join("\n")
  );

  section(
    "Weekday",
    table(
      ["day", "tokens", "share", "days", "tok/day"],
      ins.byWeekday.map((b) => [
        WEEKDAYS[Number(b.key)] ?? b.key,
        fmtTokens(b.totalTokens),
        pct(b.totalTokens, o.totalTokens),
        String(b.activeDays),
        per(b.totalTokens, b.activeDays),
      ])
    )
  );

  const s = ins.sessionTokens;
  const topDecile = s
    .slice(Math.ceil(s.length * 0.9))
    .reduce((a, b) => a + b, 0);
  section(
    "Session size",
    [
      `sessions ${s.length}   p10 ${fmtTokens(quantile(s, 0.1))}   p50 ${fmtTokens(
        quantile(s, 0.5)
      )}   p90 ${fmtTokens(quantile(s, 0.9))}   max ${fmtTokens(s[s.length - 1] ?? 0)}`,
      `top 10% of sessions account for ${pct(topDecile, o.totalTokens)} of all tokens`,
    ].join("\n")
  );

  out.push(
    "Costs are estimates: one flat Anthropic-style rate card is applied to every",
    "agent and model, so treat the dollar columns as relative, not billing-accurate."
  );

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Chart-ready shapes for the HTML report. The text report answers the same
// questions in tables; these keep the same slices but pre-shape them so the
// client only has to hand arrays to Chart.js.
// ---------------------------------------------------------------------------

export interface InsightCharts {
  /** Token share per model per week — makes model migrations visible. */
  modelByWeek: {
    weeks: string[];
    models: { name: string; tokens: number[] }[];
  };
  /** Top projects by tokens, with the tail folded into one "(other)" row. */
  topProjects: { name: string; tokens: number; cost: number }[];
  /** tokens[weekday][hour], weekday 0 = Sunday. */
  heatmap: number[][];
  /** Lorenz curve of session sizes: cumulative session share -> token share. */
  lorenz: { x: number; y: number }[];
  /** Gini-style headline for the curve: what the largest 10% of sessions cost. */
  topDecileShare: number;
  /** Per-week efficiency, so volume and cost-efficiency can be read together. */
  efficiencyByWeek: {
    week: string;
    tokensPerDay: number;
    cacheShare: number;
    outputPerCall: number;
    costPerMTok: number;
  }[];
}

/** Shorten a project path for axis labels: keep the last two segments. */
function shortProject(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : ".../" + parts.slice(-2).join("/");
}

export function computeCharts(
  records: UsageRecord[],
  opts: { topProjects?: number; topModels?: number; weeks?: number } = {}
): InsightCharts {
  const topProjectCount = opts.topProjects ?? 12;
  const topModelCount = opts.topModels ?? 8;
  const weekCount = opts.weeks ?? 16;

  const ins = computeInsights(records);
  const total = ins.overall.totalTokens || 1;

  const weeks = ins.byWeek.map((b) => b.key).slice(-weekCount);
  const weekIndex = new Map(weeks.map((w, i) => [w, i]));
  const topModels = ins.byModel.slice(0, topModelCount).map((b) => b.key);
  const modelRows = new Map<string, number[]>(
    [...topModels, "(other)"].map((m) => [m, weeks.map(() => 0)])
  );
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));

  for (const r of records) {
    const t =
      r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreationTokens;
    const i = weekIndex.get(weekStart(r.date));
    if (i !== undefined) {
      const name = `${r.source}/${r.model}`;
      const row = modelRows.get(topModels.includes(name) ? name : "(other)")!;
      row[i] += t;
    }
    const d = new Date(r.timestamp);
    heatmap[d.getDay()][d.getHours()] += t;
  }

  const topProjects = ins.byProject
    .slice(0, topProjectCount)
    .map((b) => ({ name: shortProject(b.key), tokens: b.totalTokens, cost: b.cost }));
  const tail = ins.byProject.slice(topProjectCount);
  if (tail.length > 0) {
    topProjects.push({
      name: `(${tail.length} more)`,
      tokens: tail.reduce((a, b) => a + b.totalTokens, 0),
      cost: tail.reduce((a, b) => a + b.cost, 0),
    });
  }

  // Lorenz curve: sessions sorted small -> large, so a curve hugging the
  // bottom-right means a handful of sessions carry the whole bill.
  const s = ins.sessionTokens;
  const lorenz: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let acc = 0;
  s.forEach((v, i) => {
    acc += v;
    lorenz.push({ x: (i + 1) / s.length, y: acc / total });
  });
  const topDecile =
    s.slice(Math.ceil(s.length * 0.9)).reduce((a, b) => a + b, 0) / total;

  const efficiencyByWeek = ins.byWeek.slice(-weekCount).map((b) => ({
    week: b.key,
    tokensPerDay: b.activeDays ? b.totalTokens / b.activeDays : 0,
    cacheShare: b.totalTokens ? b.cacheReadTokens / b.totalTokens : 0,
    outputPerCall: b.calls ? b.outputTokens / b.calls : 0,
    costPerMTok: b.totalTokens ? (b.cost / b.totalTokens) * 1_000_000 : 0,
  }));

  return {
    modelByWeek: {
      weeks,
      models: [...modelRows.entries()]
        .map(([name, tokens]) => ({ name, tokens }))
        .filter((m) => m.tokens.some((v) => v > 0)),
    },
    topProjects,
    heatmap,
    lorenz,
    topDecileShare: topDecile,
    efficiencyByWeek,
  };
}
