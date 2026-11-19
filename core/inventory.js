// Pantry stock arithmetic. Pure functions returning new Maps.

/**
 * Add everything bought on a shopping list to the pantry.
 * @param {Map<string, number>} pantry
 * @param {import('./shopping.js').ShoppingLine[]} lines
 */
export function applyPurchase(pantry, lines) {
  const next = new Map(pantry);
  for (const l of lines) {
    if (l.purchasedGrams > 0) next.set(l.foodId, (next.get(l.foodId) ?? 0) + l.purchasedGrams);
  }
  return next;
}

/**
 * Remove consumed grams. Stock never goes negative; anything that could not be
 * covered is reported as a shortage instead of being hidden.
 * @param {Map<string, number>} pantry
 * @param {Map<string, number>} used
 * @returns {{ pantry: Map<string, number>, shortages: Map<string, number> }}
 */
export function consume(pantry, used) {
  const next = new Map(pantry);
  const shortages = new Map();
  for (const [foodId, grams] of used) {
    const stock = next.get(foodId) ?? 0;
    const taken = Math.min(stock, grams);
    const left = stock - taken;
    if (left > 1e-9) next.set(foodId, left);
    else next.delete(foodId);
    if (grams - taken > 1e-9) shortages.set(foodId, grams - taken);
  }
  return { pantry: next, shortages };
}
