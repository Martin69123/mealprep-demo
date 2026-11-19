// Food catalogue built from the generated Frida module. Values are per 100 g as published by DTU
// (rounded on import). A micronutrient that Frida does not publish for a food is null — unknown,
// never zero.
import { FRIDA_ROWS, FRIDA_KEYS, FRIDA_UNITS, FRIDA_META } from './data/frida.js';

export { FRIDA_META };
export const MICRO_KEYS = FRIDA_KEYS.slice(4);
export const MICRO_UNITS = Object.fromEntries(MICRO_KEYS.map((k) => [k, FRIDA_UNITS[k]]));
export const fridaId = (n) => `f${n}`;

/**
 * @typedef {import('./nutrition.js').Food & {
 *   name: { da: string, en: string }, micro: Record<string, number | null>, source: 'frida', sourceId: number
 * }} CatalogueFood
 */

/** @type {CatalogueFood[]} */
export const FOODS = FRIDA_ROWS.map(([id, da, en, ...v]) => ({
  id: fridaId(id),
  name: { da, en },
  per100: { kcal: v[0], protein: v[1], carbs: v[2], fat: v[3] },
  micro: Object.fromEntries(MICRO_KEYS.map((k, i) => [k, v[4 + i]])),
  source: 'frida',
  sourceId: id,
}));

/**
 * Sum of each micronutrient over the ingredients, times `factor` (e.g. 1 / servings).
 * `unknown` counts ingredients for which the value is not published, so the total can be shown as
 * a lower bound instead of pretending to be complete.
 * @param {{ foodId: string, grams: number }[]} ingredients
 * @param {Map<string, { micro?: Record<string, number | null> }>} foods
 * @returns {Record<string, { value: number, unknown: number }>}
 */
export function microTotals(ingredients, foods, factor = 1, keys = MICRO_KEYS) {
  const out = Object.fromEntries(keys.map((k) => [k, { value: 0, unknown: 0 }]));
  for (const ing of ingredients) {
    const food = foods.get(ing.foodId);
    if (!food) throw new Error(`Unknown food: ${ing.foodId}`);
    if (!(ing.grams > 0)) continue;
    for (const k of keys) {
      const per100 = food.micro?.[k];
      if (per100 == null) out[k].unknown += 1;
      else out[k].value += (per100 * ing.grams * factor) / 100;
    }
  }
  return out;
}
