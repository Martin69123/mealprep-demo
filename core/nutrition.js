// Deterministic nutrition arithmetic. Pure functions, no I/O.
// Nutrient values are per 100 g of the food as described (raw/dry unless the name says otherwise).

/** @typedef {{ kcal: number, protein: number, carbs: number, fat: number }} Nutrients */
/** @typedef {{ id: string, per100: Nutrients }} Food */
/** @typedef {{ foodId: string, grams: number }} Ingredient */
/** @typedef {{ id: string, servings: number, ingredients: Ingredient[] }} Recipe */

export const NUTRIENT_KEYS = /** @type {const} */ (['kcal', 'protein', 'carbs', 'fat']);

/** @returns {Nutrients} */
export const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 });

/** Energy from macros with Atwater general factors (4/4/9 kcal per g). */
export function kcalFromMacros(protein, carbs, fat) {
  return 4 * protein + 4 * carbs + 9 * fat;
}

function assertGrams(grams) {
  if (!Number.isFinite(grams) || grams < 0) throw new RangeError(`Invalid grams: ${grams}`);
}

/** @param {Nutrients} per100 @param {number} grams @returns {Nutrients} */
export function scale(per100, grams) {
  assertGrams(grams);
  const out = zero();
  for (const k of NUTRIENT_KEYS) out[k] = (per100[k] * grams) / 100;
  return out;
}

/** @param {Nutrients[]} list @returns {Nutrients} */
export function sum(list) {
  const out = zero();
  for (const n of list) for (const k of NUTRIENT_KEYS) out[k] += n[k];
  return out;
}

/** @param {Nutrients} n @param {number} factor @returns {Nutrients} */
export function multiply(n, factor) {
  const out = zero();
  for (const k of NUTRIENT_KEYS) out[k] = n[k] * factor;
  return out;
}

/** after − before, per nutrient. */
export function diff(before, after) {
  const out = zero();
  for (const k of NUTRIENT_KEYS) out[k] = after[k] - before[k];
  return out;
}

/**
 * Total nutrients for the whole recipe. Throws on an unknown food so a missing
 * food can never silently count as zero.
 * @param {Recipe} recipe @param {Map<string, Food>} foods
 */
export function recipeTotal(recipe, foods) {
  return sum(
    recipe.ingredients.map((ing) => {
      const food = foods.get(ing.foodId);
      if (!food) throw new Error(`Unknown food: ${ing.foodId}`);
      return scale(food.per100, ing.grams);
    }),
  );
}

/** @param {Recipe} recipe @param {Map<string, Food>} foods */
export function perServing(recipe, foods) {
  if (!(recipe.servings > 0)) throw new RangeError('Recipe servings must be > 0');
  return multiply(recipeTotal(recipe, foods), 1 / recipe.servings);
}

/**
 * Returns a new recipe with one ingredient replaced (food and/or grams).
 * @param {Recipe} recipe @param {number} index @param {Partial<Ingredient>} change
 * @returns {Recipe}
 */
export function swapIngredient(recipe, index, change) {
  if (!recipe.ingredients[index]) throw new RangeError(`No ingredient at index ${index}`);
  const next = { ...recipe.ingredients[index], ...change };
  assertGrams(next.grams);
  return { ...recipe, ingredients: recipe.ingredients.map((ing, i) => (i === index ? next : ing)) };
}

/** Returns a new recipe with one ingredient appended. @param {Recipe} recipe @param {Ingredient} ingredient */
export function addIngredient(recipe, ingredient) {
  if (typeof ingredient.foodId !== 'string' || !ingredient.foodId) throw new TypeError('foodId is required');
  assertGrams(ingredient.grams);
  return { ...recipe, ingredients: [...recipe.ingredients, { foodId: ingredient.foodId, grams: ingredient.grams }] };
}

/** Returns a new recipe without the ingredient at `index`. @param {Recipe} recipe @param {number} index */
export function removeIngredient(recipe, index) {
  if (!recipe.ingredients[index]) throw new RangeError(`No ingredient at index ${index}`);
  return { ...recipe, ingredients: recipe.ingredients.filter((_, i) => i !== index) };
}

/** Round for display only; never feed rounded values back into calculations. */
export function rounded(n) {
  return { kcal: Math.round(n.kcal), protein: round1(n.protein), carbs: round1(n.carbs), fat: round1(n.fat) };
}
const round1 = (x) => Math.round(x * 10) / 10;

// ---------- cooking yield ----------
// Ingredient grams are raw/dry weights. The finished dish weighs something else (rice takes up
// water, meat loses it). We do not guess a yield factor: the user weighs the cooked dish once, and
// everything below follows from that measured number. The nutrient total does not change —
// only the weight it is spread over.

/** Sum of the raw ingredient weights. @param {Recipe} recipe */
export function rawGrams(recipe) {
  return recipe.ingredients.reduce((acc, ing) => acc + ing.grams, 0);
}

/** Cooked weight ÷ raw weight, or null when either is missing. @param {Recipe} recipe @param {number | null | undefined} cookedGrams */
export function yieldFactor(recipe, cookedGrams) {
  const raw = rawGrams(recipe);
  return cookedGrams > 0 && raw > 0 ? cookedGrams / raw : null;
}

/** Nutrients per 100 g of the finished dish. @param {Recipe} recipe @param {Map<string, Food>} foods @param {number} cookedGrams */
export function per100Cooked(recipe, foods, cookedGrams) {
  if (!(cookedGrams > 0)) throw new RangeError('cookedGrams must be > 0');
  return multiply(recipeTotal(recipe, foods), 100 / cookedGrams);
}

/** Grams of the finished dish in one serving. @param {Recipe} recipe @param {number} cookedGrams */
export function cookedGramsPerServing(recipe, cookedGrams) {
  if (!(cookedGrams > 0) || !(recipe.servings > 0)) throw new RangeError('cookedGrams and servings must be > 0');
  return cookedGrams / recipe.servings;
}
