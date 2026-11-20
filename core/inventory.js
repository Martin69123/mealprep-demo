// Pantry stock arithmetic. Pure functions that return new lists and never change their input.
//
// The pantry is a list of lots: one per food and best-before date. Stock bought on different days
// can therefore carry different dates. A lot without a date never expires in the app; a lot past
// the user's own date is kept and shown, but is not counted as available and is never taken
// automatically. The app does not judge whether food is safe to eat — the dates are the user's.

/** @typedef {{ foodId: string, grams: number, useBy: string | null }} Lot */

const EPS = 1e-9;
const sameLot = (l, foodId, useBy) => l.foodId === foodId && (l.useBy ?? null) === (useBy ?? null);

/** Past the user's own date. */
export const lotExpired = (lot, today) => !!lot.useBy && lot.useBy < today;

/**
 * Grams per food. With `today`, lots past their date are left out.
 * @param {Lot[]} lots @param {string} [today]
 * @returns {Map<string, number>}
 */
export function totals(lots, today) {
  const out = new Map();
  for (const l of lots) {
    if (today && lotExpired(l, today)) continue;
    out.set(l.foodId, (out.get(l.foodId) ?? 0) + l.grams);
  }
  return out;
}

/**
 * Add everything bought on a shopping list to the stock, without a date.
 * @param {Lot[]} lots @param {import('./shopping.js').ShoppingLine[]} lines
 */
export function applyPurchase(lots, lines) {
  return lines.reduce((acc, l) => addLot(acc, l.foodId, l.purchasedGrams, null), lots);
}

/** Adds stock. Grams with the same food and date join the existing lot. */
export function addLot(lots, foodId, grams, useBy = null) {
  if (!(grams > 0) || !Number.isFinite(grams)) return lots.slice();
  let found = false;
  const next = lots.map((l) => {
    if (!sameLot(l, foodId, useBy)) return l;
    found = true;
    return { ...l, grams: l.grams + grams };
  });
  if (!found) next.push({ foodId, grams, useBy: useBy ?? null });
  return next;
}

/** Sets the grams of one lot; zero removes it. A lot that does not exist yet is created. */
export function setLot(lots, foodId, useBy, grams) {
  if (!(grams >= 0) || !Number.isFinite(grams)) throw new RangeError('grams must be >= 0');
  const rest = lots.filter((l) => !sameLot(l, foodId, useBy));
  return grams > EPS ? addLot(rest, foodId, grams, useBy) : rest;
}

/** Changes the date of one lot (null = no date). If a lot with the new date exists, they join. */
export function redateLot(lots, foodId, fromUseBy, toUseBy) {
  const lot = lots.find((l) => sameLot(l, foodId, fromUseBy));
  if (!lot) return lots.slice();
  return addLot(lots.filter((l) => l !== lot), foodId, lot.grams, toUseBy ?? null);
}

/**
 * Takes grams out of the stock. Order within a food: the earliest date first, lots without a date
 * last. Lots past their date are not touched. What could not be covered is reported as a shortage
 * and is not taken. `taken` records exactly which lots gave what, so it can be put back unchanged.
 * @param {Lot[]} lots @param {Map<string, number>} used @param {string} today
 * @returns {{ lots: Lot[], shortages: Map<string, number>, taken: Lot[] }}
 */
export function take(lots, used, today) {
  const next = lots.map((l) => ({ ...l }));
  const shortages = new Map();
  const taken = [];
  for (const [foodId, grams] of used) {
    let need = grams;
    const mine = next.filter((l) => l.foodId === foodId && !lotExpired(l, today))
      .sort((a, b) => (a.useBy === null) - (b.useBy === null) || (a.useBy ?? '').localeCompare(b.useBy ?? ''));
    for (const l of mine) {
      if (need <= EPS) break;
      const part = Math.min(l.grams, need);
      l.grams -= part;
      need -= part;
      taken.push({ foodId, grams: part, useBy: l.useBy });
    }
    if (need > EPS) shortages.set(foodId, need);
  }
  return { lots: next.filter((l) => l.grams > EPS), shortages, taken };
}

/** Puts back what take() took, each amount to the date it came from. */
export function putBack(lots, taken) {
  return taken.reduce((acc, t) => addLot(acc, t.foodId, t.grams, t.useBy ?? null), lots);
}

/** Grams per food in a `taken` list. */
export function takenTotals(taken) {
  const out = {};
  for (const t of taken) if (t.grams > EPS) out[t.foodId] = (out[t.foodId] ?? 0) + t.grams;
  return out;
}

/**
 * Dated lots, soonest first — what to use first. Lots without a date are not listed.
 * @returns {(Lot & { daysLeft: number })[]} daysLeft is negative when the date has passed
 */
export function useFirst(lots, today) {
  const days = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);
  return lots.filter((l) => l.useBy && l.grams > EPS).map((l) => ({ ...l, daysLeft: days(l.useBy) }))
    .sort((a, b) => a.useBy.localeCompare(b.useBy) || a.foodId.localeCompare(b.foodId));
}
