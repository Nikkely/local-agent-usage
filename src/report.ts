import type {
  DailyUsage,
  PeriodUsage,
  SourceUsage,
  UsageRecord,
} from "./types.js";
import { computeCharts } from "./insights.js";
import { fmtTokens, fmtUsd } from "./fmt.js";
import {
  RATES,
  aggregateMonthly,
  aggregateWeekly,
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

/**
 * @param records Optional per-message records. When present, the report gains
 * the insight panels (model migration, projects, when-you-work, session
 * concentration, efficiency) that day-level totals cannot answer.
 */
/**
 * The insight half of the report: the same slices the `--insights` text report
 * tables, drawn so the trend is visible. Deliberately no written takeaways —
 * any interpretation baked in here goes stale as soon as the data moves, so
 * reading the charts is left to whoever (or whatever) is looking at them.
 */
const INSIGHT_PANELS = `
  <div class="section-title">Insights — how the usage is changing</div>

  <div class="panel">
    <h2>Model mix by week <span style="color:var(--muted);font-weight:normal">— share of tokens</span></h2>
    <div class="chart-wrap" style="height:320px"><canvas id="modelMix"></canvas></div>
  </div>

  <div class="grid">
    <div class="panel">
      <h2>Where the tokens go <span style="color:var(--muted);font-weight:normal">— by project (cwd)</span></h2>
      <div class="chart-wrap" style="height:360px"><canvas id="projects"></canvas></div>
    </div>
    <div class="panel">
      <h2>Session concentration <span style="color:var(--muted);font-weight:normal">— cumulative share of tokens by session size</span></h2>
      <div class="chart-wrap" style="height:360px"><canvas id="lorenz"></canvas></div>
    </div>
  </div>

  <div class="panel">
    <h2>Efficiency by week <span style="color:var(--muted);font-weight:normal">— tokens per active day vs $/MTok vs cache read share</span></h2>
    <div class="chart-wrap" style="height:320px"><canvas id="efficiency"></canvas></div>
  </div>

  <div class="panel">
    <h2>When you work <span style="color:var(--muted);font-weight:normal">— tokens by weekday × hour (local)</span></h2>
    <div id="heat" class="heat"></div>
  </div>
`;

export function renderHtml(
  sources: SourceUsage[],
  records: UsageRecord[] = []
): string {
  const daily = mergeDaily(sources);
  const data = buildData(daily);
  const s = data.summary;

  const monthlyCumulative = withMonthlyCumulative(data.daily);

  // Only show the per-agent split when more than one source is present.
  const multiSource = sources.filter((x) => x.daily.length > 0).length > 1;
  const sourceSplit = sources.map((x) => ({
    source: x.source,
    total: sumTokens(x.daily),
    daily: x.daily,
  }));
  const charts = records.length > 0 ? computeCharts(records) : null;

  // Everything the client charts needs, serialized once.
  const payload = JSON.stringify({
    charts,
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
  .section-title {
    font-size: 13px; color: var(--muted); letter-spacing: 2px;
    text-transform: uppercase; margin: 34px 2px 14px;
    border-top: 1px solid var(--border); padding-top: 18px;
  }
  .heat { display: grid; grid-template-columns: 34px repeat(24, 1fr); gap: 2px; }
  .heat div { font-size: 10px; color: var(--muted); text-align: center; }
  .heat .cell { border-radius: 2px; height: 18px; }
  footer { color: var(--muted); font-size: 11px; margin-top: 24px; text-align: center; }
</style>
</head>
<body>
  <h1><span class="accent">local-agent</span>-usage</h1>
  <div class="sub">
    ${s.rangeStart || "—"} → ${s.rangeEnd || "—"} &nbsp;·&nbsp;
    rates: input ${fmtUsd(RATES.input)}/MTok, output ${fmtUsd(RATES.output)}/MTok (Sonnet 4.6 est., applied to all agents)
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

  ${charts ? INSIGHT_PANELS : ""}

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

// --- Insight charts -------------------------------------------------------
if (DATA.charts) {
  const K = DATA.charts;
  const PALETTE = ["#c97fff","#6ee7ff","#ffb86c","#50fa7b","#ff79c6","#8be9fd","#f1fa8c","#bd93f9","#5a5a72"];
  const pctTick = (v) => Math.round(v * 100) + "%";

  // Model mix: shares per week, so migrations read regardless of volume swings.
  const weekTotals = K.modelByWeek.weeks.map((_, i) =>
    K.modelByWeek.models.reduce((a, m) => a + m.tokens[i], 0)
  );
  new Chart(document.getElementById("modelMix"), {
    type: "bar",
    data: {
      labels: K.modelByWeek.weeks,
      datasets: K.modelByWeek.models.map((m, i) => ({
        label: m.name,
        data: m.tokens.map((v, j) => (weekTotals[j] ? v / weekTotals[j] : 0)),
        backgroundColor: PALETTE[i % PALETTE.length],
        rawTokens: m.tokens,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, max: 1, ticks: { callback: pctTick } },
      },
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (c) =>
              c.dataset.label + ": " + Math.round(c.parsed.y * 100) + "% (" +
              fmtTok(c.dataset.rawTokens[c.dataIndex]) + ")",
          },
        },
      },
    },
  });

  new Chart(document.getElementById("projects"), {
    type: "bar",
    data: {
      labels: K.topProjects.map((p) => p.name),
      datasets: [{
        label: "tokens",
        data: K.topProjects.map((p) => p.tokens),
        // Highlight the throwaway/ephemeral paths — they are the ones whose
        // context never gets reused across sessions.
        backgroundColor: K.topProjects.map((p) =>
          ["worktrees", "private/var/folders", "/tmp/", "more)"].some((x) => p.name.indexOf(x) >= 0)
            ? C.OUTPUT_COLOR
            : C.ACCENT
        ),
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { ticks: { callback: fmtTok } }, y: { grid: { display: false } } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => fmtTok(c.parsed.x) + "  ($" + K.topProjects[c.dataIndex].cost.toFixed(0) + ")",
          },
        },
      },
    },
  });

  // Lorenz curve vs the diagonal: the gap IS the concentration.
  new Chart(document.getElementById("lorenz"), {
    type: "line",
    data: {
      datasets: [
        {
          label: "sessions -> tokens",
          data: K.lorenz,
          borderColor: C.ACCENT,
          backgroundColor: "rgba(201,127,255,0.15)",
          fill: true,
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: "perfectly even",
          data: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          borderColor: "#5a5a72",
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: { type: "linear", min: 0, max: 1, ticks: { callback: pctTick }, title: { display: true, text: "sessions (smallest -> largest)" } },
        y: { min: 0, max: 1, ticks: { callback: pctTick }, title: { display: true, text: "share of tokens" } },
      },
      plugins: { legend: { labels: { boxWidth: 12 } } },
    },
  });

  new Chart(document.getElementById("efficiency"), {
    type: "bar",
    data: {
      labels: K.efficiencyByWeek.map((w) => w.week),
      datasets: [
        {
          label: "tokens / active day",
          data: K.efficiencyByWeek.map((w) => w.tokensPerDay),
          backgroundColor: C.ACCENT,
          yAxisID: "y",
        },
        {
          type: "line",
          label: "$ / MTok",
          data: K.efficiencyByWeek.map((w) => w.costPerMTok),
          borderColor: C.OUTPUT_COLOR,
          pointRadius: 2,
          tension: 0.25,
          yAxisID: "y1",
        },
        {
          type: "line",
          label: "cache read share",
          data: K.efficiencyByWeek.map((w) => w.cacheShare),
          borderColor: C.CACHE_COLOR,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.25,
          yAxisID: "y2",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { position: "left", ticks: { callback: fmtTok } },
        y1: { position: "right", grid: { display: false }, ticks: { callback: (v) => "$" + v.toFixed(2) } },
        y2: { display: false, min: 0, max: 1 },
      },
      plugins: { legend: { labels: { boxWidth: 12 } } },
    },
  });

  // Heatmap as a CSS grid — Chart.js has no matrix type without a plugin, and
  // the report must stay dependency-free beyond the single Chart.js script.
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const peak = Math.max(...K.heatmap.flat(), 1);
  const heat = document.getElementById("heat");
  let html = "<div></div>" + Array.from({ length: 24 }, (_, h) => "<div>" + (h % 3 === 0 ? h : "") + "</div>").join("");
  K.heatmap.forEach((row, d) => {
    html += "<div>" + DAYS[d] + "</div>";
    row.forEach((v, h) => {
      const a = v / peak;
      html += '<div class="cell" style="background:rgba(201,127,255,' + (0.06 + a * 0.94).toFixed(3) +
        ')" title="' + DAYS[d] + " " + h + ":00 — " + fmtTok(v) + ' tokens"></div>';
    });
  });
  heat.innerHTML = html;
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
