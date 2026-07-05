import { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { readClaudeUsage } from "./claude.js";
import { readCodexUsage } from "./codex.js";
import { estimateCost, dayTokens, mergeDaily, summarize } from "./aggregate.js";
import { fmtTokens, fmtUsd } from "./fmt.js";
import type { DailyUsage, SourceUsage } from "./types.js";

export interface TuiInit {
  initialSource: "claude" | "codex" | "all";
  initialMonth: string | null;
}

const SPARK = "▁▂▃▄▅▆▇█";
const SELECTORS = ["all", "claude", "codex"] as const;
type Sel = (typeof SELECTORS)[number];

/** Merge the picked source(s) and keep only rows inside the given YYYY-MM. */
function dailyFor(sources: SourceUsage[], sel: Sel, monthKey: string): DailyUsage[] {
  const picked = sel === "all" ? sources : sources.filter((s) => s.source === sel);
  return mergeDaily(picked).filter((d) => d.date.startsWith(monthKey));
}

/** One sparkline glyph per calendar day of the month (position stays stable). */
function sparkline(daily: DailyUsage[], monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const days = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this
  const byDay = new Map<number, number>();
  let max = 0;
  for (const d of daily) {
    const day = Number(d.date.slice(8, 10));
    const t = dayTokens(d);
    byDay.set(day, t);
    if (t > max) max = t;
  }
  let out = "";
  for (let day = 1; day <= days; day++) {
    const t = byDay.get(day) ?? 0;
    if (t <= 0 || max <= 0) out += " ";
    else out += SPARK[Math.min(SPARK.length - 1, Math.floor((t / max) * (SPARK.length - 1)))];
  }
  return out;
}

interface AppProps {
  sources: SourceUsage[];
  months: string[];
  init: TuiInit;
}

export function App({ sources, months, init }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [selIdx, setSelIdx] = useState(SELECTORS.indexOf(init.initialSource as Sel));
  const initMonthIdx =
    init.initialMonth && months.includes(init.initialMonth)
      ? months.indexOf(init.initialMonth)
      : months.length - 1;
  const [monthIdx, setMonthIdx] = useState(initMonthIdx);
  const [dayIdx, setDayIdx] = useState(0);

  // ink repaints on resize but does not re-run components, so track dimensions
  // in state to recompute the row window and dividers when the terminal resizes.
  const [dims, setDims] = useState({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  });
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setDims({ rows: stdout.rows, columns: stdout.columns });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  const sel = SELECTORS[selIdx];
  const monthKey = months[monthIdx] ?? "";

  const daily = useMemo(
    () => (monthKey ? dailyFor(sources, sel, monthKey) : []),
    [sources, sel, monthKey]
  );
  const summary = useMemo(() => summarize(daily), [daily]);

  // Clamp the day cursor to the current month's rows.
  const clampedDay = daily.length === 0 ? 0 : Math.min(dayIdx, daily.length - 1);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    // vim-style hjkl, with the arrow keys kept as aliases.
    if (key.leftArrow || input === "h") {
      setMonthIdx((i) => Math.max(0, i - 1));
      setDayIdx(0);
    } else if (key.rightArrow || input === "l") {
      setMonthIdx((i) => Math.min(months.length - 1, i + 1));
      setDayIdx(0);
    } else if (key.upArrow || input === "k") {
      if (daily.length === 0) return;
      setDayIdx((i) => Math.max(0, Math.min(i, daily.length - 1) - 1));
    } else if (key.downArrow || input === "j") {
      if (daily.length === 0) return;
      setDayIdx((i) => Math.min(daily.length - 1, i + 1));
    } else if (key.tab || input === "s") {
      setSelIdx((i) => (i + 1) % SELECTORS.length);
      setDayIdx(0);
    }
  });

  if (months.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold color="magenta">local-agent-usage</Text>
        <Text>
          No usage data found under ~/.claude/projects or ~/.codex/sessions.
        </Text>
        <Text dimColor>q to quit</Text>
      </Box>
    );
  }

  // Windowed day rows sized to terminal height (reserve fixed chrome).
  const visible = Math.max(3, dims.rows - 12);
  let startRow = 0;
  if (daily.length > visible) {
    startRow = Math.min(
      Math.max(0, clampedDay - Math.floor(visible / 2)),
      daily.length - visible
    );
  }
  const rows = daily.slice(startRow, startRow + visible);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {/* header: source tabs + month cursor */}
      <Box justifyContent="space-between">
        <Box>
          {SELECTORS.map((s) => (
            <Text key={s} inverse={s === sel} color="magenta">
              {" "}
              {s}{" "}
            </Text>
          ))}
        </Box>
        <Text>
          {monthIdx > 0 ? "‹ " : "  "}
          <Text bold color="cyan">{monthKey}</Text>
          {monthIdx < months.length - 1 ? " ›" : "  "}
        </Text>
      </Box>

      <Text dimColor>{"─".repeat(Math.max(10, dims.columns - 4))}</Text>

      {/* summary line */}
      <Text>
        Total <Text bold color="magenta">{fmtTokens(summary.totalTokens)}</Text> tok
        {"   "}est <Text bold>{fmtUsd(summary.totalCost)}</Text>
        {summary.peakDay ? <Text dimColor>{"   peak " + summary.peakDay.date}</Text> : null}
      </Text>
      <Text color="cyan">{sparkline(daily, monthKey)}</Text>
      <Text> </Text>

      {/* day rows */}
      {daily.length === 0 ? (
        <Text dimColor>no data this month</Text>
      ) : (
        rows.map((d, i) => {
          const isSel = startRow + i === clampedDay;
          return (
            <Text key={d.date} inverse={isSel}>
              {isSel ? "▸ " : "  "}
              {d.date}
              {"  "}
              {fmtTokens(dayTokens(d)).padStart(9)}
              {"   in "}
              {fmtTokens(d.inputTokens).padStart(7)}
              {" out "}
              {fmtTokens(d.outputTokens).padStart(7)}
              {"  "}
              {fmtUsd(estimateCost(d)).padStart(8)}
            </Text>
          );
        })
      )}

      <Text dimColor>{"─".repeat(Math.max(10, dims.columns - 4))}</Text>
      <Text dimColor>j/k day  h/l month  tab source  q quit</Text>
    </Box>
  );
}

export async function runTui(init: TuiInit): Promise<void> {
  console.error("Reading local agent logs...");
  const opts = { since: new Date(0), throwIfEmpty: false } as const;
  const sources: SourceUsage[] = [
    { source: "claude", daily: await readClaudeUsage(opts) },
    { source: "codex", daily: await readCodexUsage(opts) },
  ];
  const months = [
    ...new Set(sources.flatMap((s) => s.daily.map((d) => d.date.slice(0, 7)))),
  ].sort();

  const app = render(<App sources={sources} months={months} init={init} />);
  await app.waitUntilExit();
}
