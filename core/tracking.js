// Weight trend and plan adherence. Keeps confirmed and assumed data separate.

/** @typedef {{ date: string, kg: number }} WeightEntry */

const DAY_MS = 86_400_000;
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** ISO date `days` after `iso` (negative for before). */
export function addDays(iso, days) {
  return new Date(toUTC(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Trailing average over a calendar window (default 7 days) for each logged day.
 * Missing days are simply absent from the average — never interpolated.
 * @param {WeightEntry[]} entries
 */
export function weightTrend(entries, windowDays = 7) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((e) => {
    const from = toUTC(e.date) - (windowDays - 1) * DAY_MS;
    const inWindow = sorted.filter((x) => toUTC(x.date) >= from && toUTC(x.date) <= toUTC(e.date));
    const avg = inWindow.reduce((a, x) => a + x.kg, 0) / inWindow.length;
    return { date: e.date, kg: e.kg, trendKg: avg, samples: inWindow.length };
  });
}

/**
 * Change in the trend line between first and last entry, or null with fewer than
 * two entries. A trend change is not proof of fat or muscle change.
 */
export function trendChange(entries, windowDays = 7) {
  const t = weightTrend(entries, windowDays);
  if (t.length < 2) return null;
  return { fromDate: t[0].date, toDate: t.at(-1).date, deltaKg: t.at(-1).trendKg - t[0].trendKg };
}

/**
 * Splits planned meals by evidence. `assumed` meals were planned and never
 * marked — they must be labelled as assumed, not as eaten.
 * @param {{ status?: string }[]} entries
 */
export function adherence(entries) {
  const out = { confirmed: 0, assumed: 0, skipped: 0, total: entries.length };
  for (const e of entries) {
    if (e.status === 'confirmed') out.confirmed += 1;
    else if (e.status === 'skipped') out.skipped += 1;
    else out.assumed += 1;
  }
  return out;
}
