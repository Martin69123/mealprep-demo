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

/** Meal types a planned meal can carry, in the order they are shown. A meal may also have none. */
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

/** A day's meals in meal-type order; meals without a type come last. Otherwise the order is kept. */
export function sortMeals(entries) {
  const rank = (e) => { const i = MEAL_TYPES.indexOf(e.meal); return i === -1 ? MEAL_TYPES.length : i; };
  return entries.map((e, i) => [e, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([e]) => e);
}

/**
 * Copies planned meals from one date to another. A copy is a PLAN: it is always "assumed" and
 * carries nothing of what happened to the original (no confirmation, no stock taken, no snapshot).
 * Meals whose recipe no longer exists cannot be planned again and are counted in `skipped`.
 * Copies are made from `plan` as it is, so a copy is never itself copied in the same call.
 * @param {{ id: string, date: string, recipeId: string, servings: number, meal?: string }[]} plan
 * @param {[string, string][]} pairs  [from date, to date]; a pair with equal dates is ignored
 * @param {Set<string>} recipeIds     recipes that exist now
 * @param {() => string} newId
 * @returns {{ entries: object[], skipped: number }}
 */
export function copyMeals(plan, pairs, recipeIds, newId) {
  const entries = [];
  let skipped = 0;
  for (const [from, to] of pairs) {
    if (from === to) continue;
    for (const e of plan) {
      if (e.date !== from) continue;
      if (!recipeIds.has(e.recipeId)) { skipped += 1; continue; }
      entries.push({ id: newId(), date: to, recipeId: e.recipeId, servings: e.servings, status: 'assumed', ...(MEAL_TYPES.includes(e.meal) ? { meal: e.meal } : {}) });
    }
  }
  return { entries, skipped };
}

/**
 * Moves a planned meal to another date. A confirmed meal is a record of what was eaten on its day
 * and is not moved. Returns the same list when nothing changes.
 */
export function moveMeal(plan, id, toDate) {
  const entry = plan.find((e) => e.id === id);
  if (!entry || entry.status === 'confirmed' || entry.date === toDate) return plan;
  return plan.map((e) => (e === entry ? { ...e, date: toDate } : e));
}

/** Recipes with the user's favourites first; the order is otherwise unchanged. */
export function favouritesFirst(recipes, favorites) {
  const fav = new Set(favorites);
  return [...recipes.filter((r) => fav.has(r.id)), ...recipes.filter((r) => !fav.has(r.id))];
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
