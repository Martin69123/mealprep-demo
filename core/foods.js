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

// ---------- reference values ----------
// EU nutrient reference values (NRVs) for vitamins and minerals: Regulation (EU) No 1169/2011,
// Annex XIII, Part A, point 1, read on EUR-Lex in the consolidated version of 2018-01-01 on
// 2026-11-20. These are the single set of adult values used for food LABELLING. They are not
// personal recommendations: they do not vary with age, sex, pregnancy or anything else.
// The source has no value for dietary fibre or for sodium, so those two have none here.
// The source's row is "Folic acid"; Frida publishes "folate". They are compared as printed.
export const NRV_SOURCE = { regulation: '(EU) No 1169/2011', annex: 'XIII, Part A, point 1', consolidated: '2018-01-01', read: '2026-11-20' };
/** Per day, in the same units as FRIDA_UNITS. */
export const NRV = Object.freeze({ vitD: 5, b12: 2.5, vitC: 80, folate: 200, calcium: 800, iron: 14, zinc: 10, magnesium: 375, potassium: 2000, selenium: 55, iodine: 150 });

/** Adds micronutrient totals: values are summed, and so are the counts of unknown ingredients. */
export function addMicroTotals(list, keys = MICRO_KEYS) {
  const out = Object.fromEntries(keys.map((k) => [k, { value: 0, unknown: 0 }]));
  for (const totals of list) for (const k of keys) { out[k].value += totals[k].value; out[k].unknown += totals[k].unknown; }
  return out;
}

/**
 * Totals over `days` days against the reference values, per day. `percent` is null where the source
 * has no reference value. A total with unknown ingredients is a lower bound, and so is its percent.
 * @param {Record<string, { value: number, unknown: number }>} totals @param {number} [days]
 * @returns {{ key: string, perDay: number, unknown: number, reference: number | null, percent: number | null }[]}
 */
export function againstReference(totals, days = 1) {
  if (!(days > 0)) throw new RangeError('days must be > 0');
  return Object.keys(totals).map((key) => {
    const perDay = totals[key].value / days;
    const reference = NRV[key] ?? null;
    return { key, perDay, unknown: totals[key].unknown, reference, percent: reference ? (perDay / reference) * 100 : null };
  });
}
