#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readClaudeRecords } from "./claude.js";
import { readCodexRecords } from "./codex.js";
import { foldDaily } from "./aggregate.js";
import { computeInsights, renderInsights } from "./insights.js";
import { renderHtml } from "./report.js";
import { openInBrowser } from "./open.js";
import { parseMonth } from "./month.js";
import { localDate } from "./dates.js";
import type { AgentSource, SourceUsage, UsageRecord } from "./types.js";

interface Cli {
  days: number;
  daysExplicit: boolean;
  month: string | null;
  output: string;
  open: boolean;
  tui: boolean;
  source: "claude" | "codex" | "all";
  insights: boolean;
  json: boolean;
  help: boolean;
}

const HELP = `local-agent-usage — visualize local AI-agent token usage (Claude Code + Codex CLI) as an HTML dashboard

Usage:
  npx local-agent-usage [options]

Default period: from the first day of last month through now (so all of last
month is always fully included). Override with --days or --month.

Options:
  --days <n>        Look back a fixed number of days (overrides the default)
  --month <YYYY-MM> Show a single calendar month (e.g. 2026-06); excludes --days
  --source <src>    Agent logs to read: "claude", "codex", or "all" (default: all)
  --insights        Print a text trend analysis to stdout instead of the HTML
                    report (monthly/weekly trend, projects, models, hour of day,
                    weekday, session-size concentration)
  --json            With --insights, emit the raw breakdown as JSON
  --tui             Open an interactive terminal dashboard instead of HTML
  --output <path>   Output HTML file (default: local-agent-usage.html)
  --open <bool>     Auto-open the report in a browser (default: true)
  -h, --help        Show this help

Sources (all read from this machine's local logs — no API key needed):
  claude  Claude Code logs under ~/.claude/projects (override: CLAUDE_PROJECTS_DIR)
  codex   Codex CLI logs under ~/.codex/sessions   (override: CODEX_SESSIONS_DIR)
  all     Both, shown merged with a per-agent breakdown

Examples:
  npx local-agent-usage
  npx local-agent-usage --days 90
  npx local-agent-usage --month 2026-06
  npx local-agent-usage --insights
  npx local-agent-usage --insights --days 90 --source claude
  npx local-agent-usage --tui
  npx local-agent-usage --source codex --output codex.html --open false

Note: with --tui, --output/--open/--days are ignored (the TUI loads all history
and navigates months interactively); --source and --month seed the initial view.
`;

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    days: NaN, // only read when daysExplicit; default window is last-month-through-now
    daysExplicit: false,
    month: null,
    output: "local-agent-usage.html",
    open: true,
    tui: false,
    source: "all",
    insights: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--days": {
        const v = argv[++i];
        if (v === undefined) throw new Error("--days requires a number");
        cli.days = Number(v);
        cli.daysExplicit = true;
        break;
      }
      case "--month": {
        const v = argv[++i];
        if (v === undefined) throw new Error("--month requires a YYYY-MM value");
        cli.month = v;
        break;
      }
      case "--tui":
        cli.tui = true;
        break;
      case "--insights":
        cli.insights = true;
        break;
      case "--json":
        cli.json = true;
        break;
      case "--output":
      case "-o": {
        const v = argv[++i];
        if (v === undefined) throw new Error(`${arg} requires a file path`);
        cli.output = v;
        break;
      }
      case "--source": {
        const v = argv[++i];
        if (v !== "claude" && v !== "codex" && v !== "all")
          throw new Error(
            `--source must be "claude", "codex", or "all" (got "${v}")`
          );
        cli.source = v;
        break;
      }
      case "--open": {
        // Only consume the next token if it's an actual value, so `--open`
        // (or `--open --tui`) means true rather than swallowing the next flag.
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("-")) cli.open = true;
        else cli.open = parseBool(argv[++i]);
        break;
      }
      case "-h":
      case "--help":
        cli.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return cli;
}

function parseBool(v: string | undefined): boolean {
  return !(v === "false" || v === "0" || v === "no");
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  if (cli.help) {
    process.stdout.write(HELP);
    return;
  }

  // --tui ignores --days entirely, so the two aren't contradictory there.
  if (!cli.tui && cli.month !== null && cli.daysExplicit) {
    throw new Error(
      "--month and --days are mutually exclusive; pass one or the other"
    );
  }

  // Interactive TUI: loads all history itself and navigates months in-memory.
  if (cli.tui) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      throw new Error(
        "--tui requires an interactive terminal (stdin/stdout are not TTYs). " +
          "Drop --tui to write the HTML report instead."
      );
    }
    // Validate --month up front so a bad value errors before ink takes the screen.
    if (cli.month !== null) parseMonth(cli.month);
    const { runTui } = await import("./tui.js");
    await runTui({ initialSource: cli.source, initialMonth: cli.month });
    return;
  }

  // Resolve the reporting window: a calendar month or a trailing --days window.
  let start: Date;
  let until: Date | undefined;
  let periodLabel: string;
  if (cli.month !== null) {
    const r = parseMonth(cli.month);
    start = r.since;
    until = r.until;
    periodLabel = r.key;
  } else if (cli.daysExplicit) {
    if (!Number.isFinite(cli.days) || cli.days <= 0) {
      throw new Error(`--days must be a positive number (got "${cli.days}")`);
    }
    const now = new Date();
    start = new Date(now.getTime() - cli.days * 24 * 60 * 60 * 1000);
    until = undefined;
    periodLabel = `the last ${cli.days} day(s)`;
  } else {
    // Default: from the first day of LAST month through now, so all of last
    // month is always fully included (a trailing 30-day window would clip it).
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    until = undefined;
    periodLabel = `since ${localDate(start)} (all of last month + month-to-date)`;
  }

  const wanted: AgentSource[] =
    cli.source === "all" ? ["claude", "codex"] : [cli.source];

  // One reader set for both outputs: the HTML report folds records into daily
  // totals, and keeps the records for the insight panels.
  const recordReaders = {
    claude: readClaudeRecords,
    codex: readCodexRecords,
  } as const;

  // Text trend analysis, printed instead of writing the HTML report.
  if (cli.insights) {
    const records: UsageRecord[] = [];
    for (const s of wanted) {
      console.error(`Reading local ${s} logs for ${periodLabel}...`);
      records.push(
        ...(await recordReaders[s]({
          since: start,
          until,
          throwIfEmpty: wanted.length === 1,
        }))
      );
    }
    const insights = computeInsights(records);
    process.stdout.write(
      cli.json
        ? JSON.stringify(insights, null, 2) + "\n"
        : renderInsights(insights) + "\n"
    );
    return;
  }

  const sources: SourceUsage[] = [];
  const allRecords: UsageRecord[] = [];
  for (const s of wanted) {
    console.error(`Reading local ${s} logs for ${periodLabel}...`);
    // With multiple sources, a missing one warns and is skipped instead of aborting.
    const records = await recordReaders[s]({
      since: start,
      until,
      throwIfEmpty: wanted.length === 1,
    });
    allRecords.push(...records);
    sources.push({ source: s, daily: foldDaily(records) });
  }

  if (sources.every((s) => s.daily.length === 0)) {
    console.error("No usage data found for this period.");
  }

  const html = renderHtml(sources, allRecords);
  const outPath = resolve(process.cwd(), cli.output);
  await writeFile(outPath, html, "utf8");
  console.error(`Wrote report: ${outPath}`);

  if (cli.open) {
    openInBrowser(pathToFileURL(outPath).href);
  }
}

main().catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
