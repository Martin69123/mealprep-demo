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

/**
 * Where the weight stands against the user's own target. Pure arithmetic on logged weigh-ins:
 * "now" is the latest point of the 7-day trend. The app does not judge whether the target or
 * the pace is healthy or realistic.
 * @param {WeightEntry[]} weights @param {number | null} targetKg @param {string | null} deadline @param {string} today
 * @returns {{ currentKg: number, remainingKg: number, reached: boolean, daysLeft: number | null, perWeekKg: number | null } | null}
 *   null without a target or without a weigh-in. remainingKg is signed: negative means the weight must go down.
 *   perWeekKg is the change per week needed to arrive on the deadline; null without a deadline or when it is today or past.
 */
export function weightGoalStatus(weights, targetKg, deadline, today) {
  if (!(targetKg > 0) || weights.length === 0) return null;
  const trend = weightTrend(weights);
  const start = trend[0].trendKg;
  const currentKg = trend.at(-1).trendKg;
  const remainingKg = targetKg - currentKg;
  // Reached when the trend is at the target, or has crossed it coming from the starting side.
  const reached = Math.abs(remainingKg) < 0.05 || (trend.length > 1 && (start - targetKg) * (currentKg - targetKg) < 0);
  const daysLeft = deadline ? Math.round((toUTC(deadline) - toUTC(today)) / DAY_MS) : null;
  const perWeekKg = !reached && daysLeft != null && daysLeft > 0 ? (remainingKg / daysLeft) * 7 : null;
  return { currentKg, remainingKg, reached, daysLeft, perWeekKg };
}

/** The goal as it stood on each date it was changed, newest change of a day replacing an earlier one. */
export function recordGoal(history, goal, today) {
  const entry = { date: today, type: goal.type, kcal: goal.kcal, protein: goal.protein };
  const last = [...history].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (last && last.date !== today && last.type === entry.type && last.kcal === entry.kcal && last.protein === entry.protein) return history.slice();
  return history.filter((h) => h.date !== today).concat(entry).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * One week in numbers. Confirmed and planned food are kept apart: only confirmed meals are
 * evidence of what was eaten. Only confirmed sets count as training.
 * @param {string[]} dates the seven ISO dates of the week
 * @param {{ date: string, status?: string }[]} plan
 * @param {(entry: object) => { kcal: number, protein: number }} nutrientsOf
 * @param {{ date: string, sets: { reps: number, kg: number, confirmed: boolean }[] }[]} workouts
 * @param {WeightEntry[]} weights
 */
export function weekSummary(dates, plan, nutrientsOf, workouts, weights) {
  const inWeek = (d) => d >= dates[0] && d <= dates.at(-1);
  const meals = plan.filter((e) => inWeek(e.date));
  const total = (list) => list.reduce((acc, e) => { const n = nutrientsOf(e); return { kcal: acc.kcal + n.kcal, protein: acc.protein + n.protein }; }, { kcal: 0, protein: 0 });
  const confirmedMeals = meals.filter((e) => e.status === 'confirmed');
  const sets = workouts.filter((w) => inWeek(w.date)).map((w) => ({ date: w.date, sets: w.sets.filter((s) => s.confirmed) })).filter((w) => w.sets.length > 0);
  const trend = weightTrend(weights).filter((p) => inWeek(p.date));
  return {
    meals: adherence(meals),
    confirmed: total(confirmedMeals),
    confirmedDays: new Set(confirmedMeals.map((e) => e.date)).size,
    planned: total(meals.filter((e) => e.status !== 'skipped')),
    trainingDays: new Set(sets.map((w) => w.date)).size,
    sets: sets.reduce((acc, w) => acc + w.sets.length, 0),
    volumeKg: sets.reduce((acc, w) => acc + w.sets.reduce((a, s) => a + s.reps * s.kg, 0), 0),
    weighIns: trend.length,
    weightChangeKg: trend.length >= 2 ? trend.at(-1).trendKg - trend[0].trendKg : null,
  };
}

/**
 * One of the user's own measures over time, oldest first, with the change since the first value.
 * @param {{ date: string, measureId: string, value: number }[]} measurements
 */
export function measureSeries(measurements, measureId) {
  const list = measurements.filter((m) => m.measureId === measureId).sort((a, b) => a.date.localeCompare(b.date));
  return list.map((m) => ({ date: m.date, value: m.value, change: m.value - list[0].value }));
}
