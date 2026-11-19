// Mealprep batches: cooked portions waiting to be eaten. Pure functions.
// A batch is created when the user says they cooked a recipe. It takes raw ingredients from the
// pantry once; meals eaten from the batch then take portions, not raw ingredients.
import { aggregateNeeds } from './shopping.js';
import { consume } from './inventory.js';

const EPS = 1e-9;

/**
 * @typedef {object} Batch
 * @property {string} id
 * @property {string} recipeId
 * @property {{ name: object, servings: number, ingredients: { foodId: string, grams: number }[] }} snapshot recipe as cooked
 * @property {string} cookedDate
 * @property {number} servings      portions made
 * @property {number} servingsLeft
 * @property {string | null} useBy  the user's own date; the app never sets or suggests one
 * @property {Record<string, number>} consumed raw grams actually taken from the pantry
 */
/** @typedef {{ batchId: string, servings: number }} Take */

/** Past the user's own use-by date. A batch without a date never expires in the app. */
export const isExpired = (batch, today) => !!batch.useBy && batch.useBy < today;

/** Batches that still have portions and are not past their date, oldest first. */
export function usable(batches, today) {
  return batches.filter((b) => b.servingsLeft > EPS && !isExpired(b, today))
    .sort((a, b) => a.cookedDate.localeCompare(b.cookedDate) || a.id.localeCompare(b.id));
}

/**
 * Take the raw ingredients for `servings` of a recipe from the pantry. Anything not in stock is
 * reported as a shortage and is NOT taken — the batch records only what really left the pantry.
 */
export function cook(pantry, recipe, servings) {
  if (!(servings > 0)) throw new RangeError('servings must be > 0');
  const used = aggregateNeeds([{ recipeId: recipe.id, servings }], new Map([[recipe.id, recipe]]));
  const result = consume(pantry, used);
  const consumed = Object.fromEntries(
    [...used].map(([id, g]) => [id, g - (result.shortages.get(id) ?? 0)]).filter(([, g]) => g > EPS),
  );
  return { pantry: result.pantry, shortages: result.shortages, consumed };
}

/**
 * Decide which planned meals can be eaten from cooked portions. All-or-nothing per meal: a meal is
 * covered only when usable batches of the same recipe hold all its servings, otherwise it is left
 * to be cooked from raw ingredients. Meals are served in date order, oldest batch first.
 * @param {{ id: string, date: string, recipeId: string, servings: number }[]} entries
 * @param {Batch[]} batches
 * @returns {Map<string, Take[]>} entry id → portions taken per batch
 */
export function allocate(entries, batches, today) {
  const pool = usable(batches, today);
  const left = new Map(pool.map((b) => [b.id, b.servingsLeft]));
  const out = new Map();
  const ordered = entries.map((e, i) => [e, i]).sort((a, b) => a[0].date.localeCompare(b[0].date) || a[1] - b[1]);
  for (const [e] of ordered) {
    const mine = pool.filter((b) => b.recipeId === e.recipeId);
    const total = mine.reduce((acc, b) => acc + left.get(b.id), 0);
    if (total + EPS < e.servings) continue;
    let need = e.servings;
    const takes = [];
    for (const b of mine) {
      const take = Math.min(left.get(b.id), need);
      if (take > EPS) {
        takes.push({ batchId: b.id, servings: take });
        left.set(b.id, left.get(b.id) - take);
        need -= take;
      }
      if (need <= EPS) break;
    }
    out.set(e.id, takes);
  }
  return out;
}

/** Remove the taken portions. Throws if a batch does not hold them, so stock can never go negative. */
export function take(batches, takes) {
  return batches.map((b) => {
    const amount = takes.filter((t) => t.batchId === b.id).reduce((acc, t) => acc + t.servings, 0);
    if (amount === 0) return b;
    if (amount > b.servingsLeft + EPS) throw new RangeError(`Batch ${b.id} holds ${b.servingsLeft}, cannot take ${amount}`);
    return { ...b, servingsLeft: Math.max(0, b.servingsLeft - amount) };
  });
}

/** Undo of take(). Portions of a batch that no longer exists cannot be returned and are dropped. */
export function giveBack(batches, takes) {
  return batches.map((b) => {
    const amount = takes.filter((t) => t.batchId === b.id).reduce((acc, t) => acc + t.servings, 0);
    return amount === 0 ? b : { ...b, servingsLeft: Math.min(b.servings, b.servingsLeft + amount) };
  });
}
