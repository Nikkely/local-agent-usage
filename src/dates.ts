/**
 * YYYY-MM-DD in the local timezone. Personal usage reads more naturally local,
 * and bucketing both readers the same way keeps Claude and Codex days aligned.
 */
export function localDate(iso: string | Date): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
