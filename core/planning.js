// Week planning helpers. Pure functions. Everything here is a SUGGESTION or a plan —
// never evidence that something happened.

const DAY_MS = 86_400_000;
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

/** Weekday index with Monday = 0 … Sunday = 6. */
export function weekdayOf(iso) {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}

// Fixed spreads with rest days between sessions where the count allows it (0 = Monday).
const SPREADS = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };

/**
 * Suggested weekdays for a programme with `dayCount` days: weekday → programme day index.
 * A programme with more than 7 days gets its first 7 days. This is a starting point the user
 * approves or changes; it is not training advice.
 * @returns {Record<number, number>}
 */
export function suggestSchedule(dayCount) {
  const n = Math.max(0, Math.min(7, Math.floor(dayCount)));
  return Object.fromEntries((SPREADS[n] ?? []).map((weekday, i) => [weekday, i]));
}

/**
 * Foods in a recipe that the user has said they avoid. The app only repeats the user's own list;
 * it knows nothing about allergens in a food.
 * @param {{ ingredients: { foodId: string, grams: number }[] }} recipe @param {Iterable<string>} avoid
 * @returns {string[]} food ids, in recipe order, without duplicates
 */
export function avoidedIn(recipe, avoid) {
  const set = new Set(avoid);
  return [...new Set(recipe.ingredients.filter((i) => i.grams > 0 && set.has(i.foodId)).map((i) => i.foodId))];
}
