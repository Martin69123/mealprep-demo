// Weekly needs → pantry deduction → pack rounding → budget. Pure functions.
// Money is integer øre. Prices are only ever what the user entered; a missing price stays missing.

/** @typedef {{ recipeId: string, servings: number, date?: string, status?: string }} PlanEntry */
/** @typedef {{ packGrams: number, priceOre: number | null, priceDate: string | null, store?: string | null }} Product */
/**
 * @typedef {object} ShoppingLine
 * @property {string} foodId
 * @property {number} neededGrams   total required by the plan
 * @property {number} fromPantryGrams
 * @property {number} toBuyGrams    still missing after pantry
 * @property {number | null} packGrams
 * @property {number} packs         whole packs to buy (0 if nothing to buy or no pack size known)
 * @property {number} purchasedGrams
 * @property {number} leftoverGrams left after this plan is cooked (pantry remainder + pack surplus)
 * @property {number | null} costOre null when something must be bought but no price is known
 * @property {string | null} priceDate
 */

/**
 * Grams of each food required by the plan. Skipped entries are ignored.
 * @param {PlanEntry[]} entries
 * @param {Map<string, import('./nutrition.js').Recipe>} recipes
 * @returns {Map<string, number>}
 */
export function aggregateNeeds(entries, recipes) {
  const needs = new Map();
  for (const e of entries) {
    if (e.status === 'skipped') continue;
    const recipe = recipes.get(e.recipeId);
    if (!recipe) throw new Error(`Unknown recipe: ${e.recipeId}`);
    if (!(e.servings >= 0) || !(recipe.servings > 0)) throw new RangeError('Invalid servings');
    const factor = e.servings / recipe.servings;
    for (const ing of recipe.ingredients) {
      needs.set(ing.foodId, (needs.get(ing.foodId) ?? 0) + ing.grams * factor);
    }
  }
  return needs;
}

/** Whole packs needed to cover `grams`. Tolerates float noise (e.g. 600.0000001 → 600). */
export function packsFor(grams, packGrams) {
  if (!(packGrams > 0)) throw new RangeError('packGrams must be > 0');
  if (grams <= 0) return 0;
  return Math.ceil(grams / packGrams - 1e-9);
}

/**
 * @param {Map<string, number>} needs
 * @param {Map<string, number>} pantry  grams in stock per food
 * @param {Map<string, Product>} products
 * @returns {ShoppingLine[]}
 */
export function buildShoppingList(needs, pantry, products) {
  const lines = [];
  for (const [foodId, neededGrams] of needs) {
    const stock = Math.max(0, pantry.get(foodId) ?? 0);
    const fromPantryGrams = Math.min(stock, neededGrams);
    const toBuyGrams = neededGrams - fromPantryGrams;
    const product = products.get(foodId);
    const packGrams = product && product.packGrams > 0 ? product.packGrams : null;
    const packs = packGrams ? packsFor(toBuyGrams, packGrams) : 0;
    // Without a known pack size we assume the exact amount can be bought.
    const purchasedGrams = packGrams ? packs * packGrams : toBuyGrams;
    let costOre = 0;
    if (toBuyGrams > 0) {
      costOre = packGrams && product.priceOre != null ? packs * product.priceOre : null;
    }
    lines.push({
      foodId,
      neededGrams,
      fromPantryGrams,
      toBuyGrams,
      packGrams,
      packs,
      purchasedGrams,
      leftoverGrams: stock - fromPantryGrams + purchasedGrams - toBuyGrams,
      costOre,
      priceDate: toBuyGrams > 0 && product ? product.priceDate ?? null : null,
    });
  }
  return lines;
}

/**
 * Known total plus how many lines lack a price — the total is a lower bound when missing > 0.
 * @param {ShoppingLine[]} lines
 */
export function budget(lines) {
  let knownOre = 0;
  let missingPrices = 0;
  for (const l of lines) {
    if (l.costOre == null) missingPrices += 1;
    else knownOre += l.costOre;
  }
  return { knownOre, missingPrices, complete: missingPrices === 0 };
}

/** Integer øre → "123,45". */
export function formatOre(ore) {
  if (!Number.isInteger(ore)) throw new TypeError('øre must be an integer');
  const sign = ore < 0 ? '-' : '';
  const abs = Math.abs(ore);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** "24,95" / "24.95" / "25" → integer øre, or null when not a valid non-negative amount. */
export function parseKroner(text) {
  const m = /^\s*(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(String(text));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}
