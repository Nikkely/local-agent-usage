import type { DailyUsage, PeriodUsage, SourceUsage } from "./types.js";
import { fmtTokens, fmtUsd } from "./fmt.js";
import {
  RATES,
  aggregateMonthly,
  aggregateWeekly,
  estimateCost,
  mergeDaily,
  summarize,
  type Summary,
} from "./aggregate.js";

const ACCENT = "#c97fff";
const ACCENT2 = "#6ee7ff";
const OUTPUT_COLOR = "#ffb86c";
const CACHE_COLOR = "#50fa7b";

interface ReportData {
  daily: DailyUsage[];
  weekly: PeriodUsage[];
  monthly: PeriodUsage[];
  summary: Summary;
}

function buildData(daily: DailyUsage[]): ReportData {
  return {
    daily,
    weekly: aggregateWeekly(daily),
    monthly: aggregateMonthly(daily),
    summary: summarize(daily),
  };
}

function dailyTotal(d: DailyUsage): number {
  return (
    d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheCreationTokens
  );
}

function sumTokens(daily: DailyUsage[]): number {
  return daily.reduce((n, d) => n + dailyTotal(d), 0);
}

export function renderHtml(sources: SourceUsage[]): string {
  const daily = mergeDaily(sources);
  const data = buildData(daily);
  const s = data.summary;

  const monthlyCumulative = withMonthlyCumulative(data.daily);

  const peakCost = s.peakDay ? estimateCost(s.peakDay) : 0;

  // Only show the per-agent split when more than one source is present.
  const multiSource = sources.filter((x) => x.daily.length > 0).length > 1;
  const sourceSplit = sources.map((x) => ({
    source: x.source,
    total: sumTokens(x.daily),
    daily: x.daily,
  }));
  const splitMeta = multiSource
    ? sourceSplit
        .filter((x) => x.total > 0)
        .map((x) => `${x.source} ${fmtTokens(x.total)}`)
        .join(" · ")
    : "";

  // Everything the client charts needs, serialized once.
  const payload = JSON.stringify({
    daily: data.daily,
    weekly: data.weekly,
    monthly: data.monthly,
    monthlyCumulative,
    bySource: multiSource ? sourceSplit.filter((x) => x.total > 0) : [],
    colors: { ACCENT, ACCENT2, OUTPUT_COLOR, CACHE_COLOR },
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Local Agent Usage Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0d0d12;
    --panel: #16161f;
    --panel2: #1d1d2a;
    --text: #e6e6f0;
    --muted: #8a8aa3;
    --accent: ${ACCENT};
    --accent2: ${ACCENT2};
    --border: #2a2a3a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: "SF Mono", "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace;
    padding: 32px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: 0.5px; }
  h1 .accent { color: var(--accent); }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 28px; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 16px;
    margin-bottom: 32px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px;
  }
  .card .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .card .v { font-size: 26px; margin-top: 8px; color: var(--accent); }
  .card .v.alt { color: var(--accent2); }
  .card .meta { color: var(--muted); font-size: 12px; margin-top: 6px; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px;
    margin-bottom: 20px;
  }
  .panel h2 {
    font-size: 14px; margin: 0 0 14px; color: var(--text);
    display: flex; justify-content: space-between; align-items: center;
  }
  .toggle { display: inline-flex; gap: 4px; }
  .toggle button {
    background: var(--panel2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
  }
  .toggle button.active { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .chart-wrap { position: relative; height: 300px; }
  footer { color: var(--muted); font-size: 11px; margin-top: 24px; text-align: center; }
</style>
</head>
<body>
  <h1><span class="accent">local-agent</span>-usage</h1>
  <div class="sub">
    ${s.rangeStart || "—"} → ${s.rangeEnd || "—"} &nbsp;·&nbsp;
    rates: input ${fmtUsd(RATES.input)}/MTok, output ${fmtUsd(RATES.output)}/MTok (Sonnet 4.6 est., applied to all agents)
  </div>

  <div class="cards">
    <div class="card">
      <div class="k">Total Tokens</div>
      <div class="v">${fmtTokens(s.totalTokens)}</div>
      <div class="meta">in ${fmtTokens(s.totalInput)} · out ${fmtTokens(
    s.totalOutput
  )}${splitMeta ? `<br>${splitMeta}` : ""}</div>
    </div>
    <div class="card">
      <div class="k">Cache Tokens</div>
      <div class="v alt">${fmtTokens(
        s.totalCacheRead + s.totalCacheCreation
      )}</div>
      <div class="meta">read ${fmtTokens(s.totalCacheRead)} · write ${fmtTokens(
    s.totalCacheCreation
  )}</div>
    </div>
    <div class="card">
      <div class="k">Estimated Cost</div>
      <div class="v">${fmtUsd(s.totalCost)}</div>
      <div class="meta">includes cache pricing</div>
    </div>
    <div class="card">
      <div class="k">Peak Day</div>
      <div class="v alt">${s.peakDay ? s.peakDay.date : "—"}</div>
      <div class="meta">${
        s.peakDay
          ? fmtTokens(
              s.peakDay.inputTokens +
                s.peakDay.outputTokens +
                s.peakDay.cacheReadTokens +
                s.peakDay.cacheCreationTokens
            ) +
            " tok · " +
            fmtUsd(peakCost)
          : "no data"
      }</div>
    </div>
  </div>

  <div class="grid">
    <div class="panel">
      <h2>Weekly (Input / Output)</h2>
      <div class="chart-wrap"><canvas id="weekly"></canvas></div>
    </div>
    <div class="panel">
      <h2>Monthly (Input / Output)</h2>
      <div class="chart-wrap"><canvas id="monthly"></canvas></div>
    </div>
  </div>

  ${
    multiSource
      ? `<div class="panel">
    <h2>Daily by Agent &amp; Cumulative <span style="color:var(--muted);font-weight:normal">— bars: per-agent total · line: cumulative (resets monthly)</span></h2>
    <div class="chart-wrap" style="height:360px"><canvas id="bySource"></canvas></div>
  </div>`
      : `<div class="panel">
    <h2>Cumulative Tokens (resets monthly)</h2>
    <div class="chart-wrap"><canvas id="cumulative"></canvas></div>
  </div>`
  }

  <div class="panel">
    <h2>Daily Detail (Input / Output / Cache)</h2>
    <div class="chart-wrap" style="height:340px"><canvas id="daily"></canvas></div>
  </div>

  <footer>Generated by local-agent-usage · cost figures are estimates only</footer>

<script>
const DATA = ${payload};
const C = DATA.colors;

Chart.defaults.color = "#8a8aa3";
Chart.defaults.font.family = "monospace";
Chart.defaults.borderColor = "#2a2a3a";

const stackedOpts = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { stacked: true, grid: { display: false } },
    y: { stacked: true, ticks: { callback: fmtTok } },
  },
  plugins: { legend: { labels: { boxWidth: 12 } } },
};

function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return n;
}

new Chart(document.getElementById("weekly"), {
  type: "bar",
  data: {
    labels: DATA.weekly.map((p) => p.label),
    datasets: [
      { label: "Input", data: DATA.weekly.map((p) => p.inputTokens), backgroundColor: C.ACCENT },
      { label: "Output", data: DATA.weekly.map((p) => p.outputTokens), backgroundColor: C.OUTPUT_COLOR },
    ],
  },
  options: stackedOpts,
});

new Chart(document.getElementById("monthly"), {
  type: "bar",
  data: {
    labels: DATA.monthly.map((p) => p.label),
    datasets: [
      { label: "Input", data: DATA.monthly.map((p) => p.inputTokens), backgroundColor: C.ACCENT },
      { label: "Output", data: DATA.monthly.map((p) => p.outputTokens), backgroundColor: C.OUTPUT_COLOR },
    ],
  },
  options: stackedOpts,
});

new Chart(document.getElementById("daily"), {
  type: "bar",
  data: {
    labels: DATA.daily.map((d) => d.date),
    datasets: [
      { label: "Input", data: DATA.daily.map((d) => d.inputTokens), backgroundColor: C.ACCENT },
      { label: "Output", data: DATA.daily.map((d) => d.outputTokens), backgroundColor: C.OUTPUT_COLOR },
      { label: "Cache read", data: DATA.daily.map((d) => d.cacheReadTokens), backgroundColor: C.ACCENT2 },
      { label: "Cache write", data: DATA.daily.map((d) => d.cacheCreationTokens), backgroundColor: C.CACHE_COLOR },
    ],
  },
  options: stackedOpts,
});

// Daily by Agent: per-agent stacked bars (left axis) + monthly-reset cumulative line (right axis).
if (DATA.bySource.length > 1) {
  const dayTot = (d) => d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheCreationTokens;
  const dates = [...new Set(DATA.bySource.flatMap((s) => s.daily.map((d) => d.date)))].sort();
  const palette = [C.ACCENT2, C.OUTPUT_COLOR, C.CACHE_COLOR];
  const cumByDate = Object.fromEntries(DATA.monthlyCumulative.map((p) => [p.label, p.cumulative]));
  new Chart(document.getElementById("bySource"), {
    type: "bar",
    data: {
      labels: dates,
      datasets: [
        ...DATA.bySource.map((s, i) => {
          const byDate = Object.fromEntries(s.daily.map((d) => [d.date, dayTot(d)]));
          return {
            label: s.source,
            data: dates.map((dt) => byDate[dt] ?? 0),
            backgroundColor: palette[i % palette.length],
            yAxisID: "y",
          };
        }),
        {
          type: "line",
          label: "Cumulative (resets monthly)",
          data: dates.map((dt) => cumByDate[dt] ?? null),
          borderColor: C.ACCENT,
          backgroundColor: "rgba(201,127,255,0.12)",
          fill: true,
          tension: 0.25,
          pointRadius: 1,
          spanGaps: true,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, position: "left", ticks: { callback: fmtTok } },
        y1: {
          position: "right",
          grid: { display: false },
          ticks: { callback: fmtTok },
          title: { display: true, text: "cumulative" },
        },
      },
      plugins: { legend: { labels: { boxWidth: 12 } } },
    },
  });
}

// Single-source fallback: standalone cumulative line (no per-agent split to merge into).
const cumEl = document.getElementById("cumulative");
if (cumEl) {
  new Chart(cumEl, {
    type: "line",
    data: {
      labels: DATA.monthlyCumulative.map((p) => p.label),
      datasets: [
        {
          label: "Cumulative (resets monthly)",
          data: DATA.monthlyCumulative.map((p) => p.cumulative),
          borderColor: C.ACCENT,
          backgroundColor: "rgba(201,127,255,0.15)",
          fill: true,
          tension: 0.25,
          pointRadius: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: fmtTok } } },
      plugins: { legend: { display: false } },
    },
  });
}
</script>
</body>
</html>`;
}

/** Per-day cumulative total tokens, reset to 0 at the start of each month. */
function withMonthlyCumulative(
  daily: DailyUsage[]
): Array<{ label: string; cumulative: number }> {
  let running = 0;
  let month = "";
  return daily.map((d) => {
    const mo = d.date.slice(0, 7); // YYYY-MM
    if (mo !== month) {
      running = 0;
      month = mo;
    }
    running += dailyTotal(d);
    return { label: d.date, cumulative: running };
  });
}
