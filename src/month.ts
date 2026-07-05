/** A single calendar month as a half-open [since, until) local-time window. */
export interface MonthRange {
  since: Date;
  until: Date;
  key: string; // YYYY-MM
}

/** Parse and validate a `YYYY-MM` month string into a local-time range. */
export function parseMonth(v: string): MonthRange {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) throw new Error(`--month must be YYYY-MM, e.g. 2026-06 (got "${v}")`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12)
    throw new Error(`--month month part must be 01-12 (got "${m[2]}")`);
  return {
    since: new Date(year, month - 1, 1), // first instant of the month, local
    until: new Date(year, month, 1), // first instant of next month (rolls Dec → Jan)
    key: v,
  };
}
