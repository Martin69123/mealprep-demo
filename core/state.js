// The stored document: shape, migrations and validation. Pure functions, no I/O.
// Nothing reaches storage or the UI without passing validate(), so a damaged or hand-edited file
// can never replace good data or leave the app unable to render.
import { RECIPES, EXERCISES, TEMPLATES, LEGACY_IDS } from './seed.js';
import { FOODS } from './foods.js';

export const SCHEMA_VERSION = 4;
export const STATUSES = ['assumed', 'confirmed', 'skipped'];
export const GOAL_TYPES = ['cut', 'maintain', 'build'];

const FOOD_IDS = new Set(FOODS.map((f) => f.id));
const SEED_EXERCISE_IDS = new Set(EXERCISES.map((e) => e.id));
const SEED_TEMPLATE_IDS = new Set(TEMPLATES.map((t) => t.id));

export function freshState() {
  return {
    v: SCHEMA_VERSION,
    lang: 'da',
    goal: { type: 'build', kcal: 2600, protein: 160, avoid: [] }, // avoid: food ids the user has chosen to avoid
    recipes: structuredClone(RECIPES), // { id, name, servings, ingredients, custom?, cookedGrams? }
    plan: [], // { id, date, recipeId, servings, status, consumed?, snapshot?, fromBatch? }
    pantry: {}, // foodId -> grams
    pantryDates: {}, // foodId -> the user's own best-before date for what is in stock
    batches: [], // cooked portions, see core/batches.js
    schedule: {}, // weekday (0 = Monday) -> index of a day in the selected programme
    shopDay: null, // weekday the user shops, or null
    prepDay: null, // weekday the user cooks, or null
    prices: {}, // foodId -> { priceOre, priceDate, example? }   (user-entered or flagged example)
    packs: {}, // foodId -> pack size in grams entered by the user (overrides the assumption)
    templateId: 'full-body-3',
    exercises: [], // the user's own exercises: { id, name: { da, en } }
    programs: [], // the user's own programmes, same shape as a seed template plus custom: true
    workouts: [], // { date, exerciseId, sets: [{ reps, kg, confirmed: true }] }
    weights: [], // { date, kg, source: 'measured' }
  };
}

/** What a confirmed meal was made of at the moment it was confirmed. */
export function snapshotOf(recipe) {
  return { name: { ...recipe.name }, servings: recipe.servings, ingredients: recipe.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })) };
}

/** The recipe a plan entry should be calculated from: its frozen snapshot when it has one. */
export function recipeForEntry(entry, recipes) {
  return entry.snapshot ?? recipes.get(entry.recipeId) ?? null;
}

// ---------- migrations ----------
function v1to2(s) {
  const id = (x) => LEGACY_IDS[x] ?? x;
  const rekey = (obj) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [id(k), v]));
  return {
    ...s,
    v: 2,
    recipes: (s.recipes ?? []).map((r) => ({ ...r, ingredients: (r.ingredients ?? []).map((i) => ({ ...i, foodId: id(i.foodId) })) })),
    plan: (s.plan ?? []).map((e) => (e.consumed ? { ...e, consumed: rekey(e.consumed) } : e)),
    pantry: rekey(s.pantry),
    prices: rekey(s.prices),
    packs: {},
  };
}

/** v3 adds own exercises/programmes and freezes confirmed meals (best available: the recipe as it is now). */
function v2to3(s) {
  const recipes = new Map((s.recipes ?? []).map((r) => [r.id, r]));
  return {
    ...s,
    v: 3,
    exercises: [],
    programs: [],
    plan: (s.plan ?? []).map((e) => {
      const r = recipes.get(e.recipeId);
      return e.status === 'confirmed' && !e.snapshot && r && Array.isArray(r.ingredients) && r.name ? { ...e, snapshot: snapshotOf(r) } : e;
    }),
  };
}

/** v4 adds cooked batches, best-before dates, the week schedule and the avoid list. Nothing is rewritten. */
function v3to4(s) {
  return { ...s, v: 4, goal: { ...(s.goal ?? {}), avoid: [] }, pantryDates: {}, batches: [], schedule: {}, shopDay: null, prepDay: null };
}

/** Brings an older document up to the current version. Unknown versions are returned untouched. */
export function migrate(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return s;
  let out = s;
  if (out.v === 1) out = v1to2(out);
  if (out.v === 2) out = v2to3(out);
  if (out.v === 3) out = v3to4(out);
  return out;
}

// ---------- validation ----------
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isStr = (x, max = 200) => typeof x === 'string' && x.length > 0 && x.length <= max;
const isNum = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const isInt = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
export function isISODate(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`); // month 13 gives an invalid date; day 31 in February rolls over
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}
const isName = (n) => isObj(n) && isStr(n.da, 80) && isStr(n.en, 80);
const unique = (list) => new Set(list).size === list.length;

/**
 * Checks every field and every cross-reference. Returns a list of problems (empty = valid).
 * @returns {string[]}
 */
export function validate(s) {
  const errors = [];
  const bad = (msg) => { if (errors.length < 20) errors.push(msg); };
  if (!isObj(s)) return ['not an object'];
  if (s.v !== SCHEMA_VERSION) return [`unsupported version: ${JSON.stringify(s.v)}`];
  for (const k of ['recipes', 'plan', 'exercises', 'programs', 'workouts', 'weights', 'batches']) if (!Array.isArray(s[k])) bad(`${k} is not a list`);
  for (const k of ['goal', 'pantry', 'prices', 'packs', 'pantryDates', 'schedule']) if (!isObj(s[k])) bad(`${k} is not an object`);
  if (errors.length) return errors;

  if (s.lang !== 'da' && s.lang !== 'en') bad('lang');
  if (!GOAL_TYPES.includes(s.goal.type) || !isInt(s.goal.kcal, 1, 20000) || !isInt(s.goal.protein, 1, 20000)) bad('goal');
  if (!Array.isArray(s.goal.avoid) || s.goal.avoid.length > 100 || !unique(s.goal.avoid) || !s.goal.avoid.every((id) => FOOD_IDS.has(id))) bad('goal.avoid');

  const snapshotOk = (x) => isObj(x) && isName(x.name) && isNum(x.servings, 0.01, 100) && ingredientsOk(x.ingredients);
  const gramsMapOk = (x) => isObj(x) && Object.entries(x).every(([id, g]) => FOOD_IDS.has(id) && isNum(g, 0, 1e6));
  const ingredientsOk = (list) => Array.isArray(list) && list.every((i) => isObj(i) && FOOD_IDS.has(i.foodId) && isNum(i.grams, 0, 100000));
  if (s.recipes.length === 0) bad('no recipes');
  for (const r of s.recipes) {
    if (!isObj(r) || !isStr(r.id) || !isName(r.name) || !isNum(r.servings, 0.01, 100) || !ingredientsOk(r.ingredients)) bad(`recipe ${r?.id}`);
    else if (r.cookedGrams != null && !isNum(r.cookedGrams, 1, 1e6)) bad(`recipe ${r.id} cookedGrams`);
  }
  const recipeIds = s.recipes.map((r) => r?.id);
  if (!unique(recipeIds)) bad('duplicate recipe id');
  const recipeSet = new Set(recipeIds);

  for (const e of s.plan) {
    if (!isObj(e) || !isStr(e.id) || !isISODate(e.date) || !isStr(e.recipeId) || !isNum(e.servings, 0.01, 50) || !STATUSES.includes(e.status)) { bad(`plan entry ${e?.id}`); continue; }
    if (e.snapshot != null && !snapshotOk(e.snapshot)) bad(`plan entry ${e.id} snapshot`);
    if (e.fromBatch != null && !(Array.isArray(e.fromBatch) && e.fromBatch.every((t) => isObj(t) && isStr(t.batchId) && isNum(t.servings, 0, 50)))) bad(`plan entry ${e.id} fromBatch`);
    if (!e.snapshot && !recipeSet.has(e.recipeId)) bad(`plan entry ${e.id} points at unknown recipe ${e.recipeId}`);
    if (e.consumed != null && !gramsMapOk(e.consumed)) bad(`plan entry ${e.id} consumed`);
  }
  if (!unique(s.plan.map((e) => e?.id))) bad('duplicate plan id');

  for (const [id, g] of Object.entries(s.pantry)) if (!FOOD_IDS.has(id) || !isNum(g, 0, 1e6)) bad(`pantry ${id}`);
  for (const [id, d] of Object.entries(s.pantryDates)) if (!FOOD_IDS.has(id) || !isISODate(d)) bad(`pantry date ${id}`);
  for (const b of s.batches) {
    if (!isObj(b) || !isStr(b.id) || !isStr(b.recipeId) || !snapshotOk(b.snapshot) || !isISODate(b.cookedDate) || !isNum(b.servings, 0.01, 200)
      || !isNum(b.servingsLeft, 0, b.servings + 1e-9) || !(b.useBy === null || isISODate(b.useBy)) || !gramsMapOk(b.consumed)) bad(`batch ${b?.id}`);
  }
  if (!unique(s.batches.map((b) => b?.id))) bad('duplicate batch id');
  for (const [k, v] of Object.entries(s.schedule)) if (!/^[0-6]$/.test(k) || !isInt(v, 0, 13)) bad(`schedule ${k}`);
  for (const k of ['shopDay', 'prepDay']) if (!(s[k] === null || isInt(s[k], 0, 6))) bad(k);
  for (const [id, g] of Object.entries(s.packs)) if (!FOOD_IDS.has(id) || !isNum(g, 0.01, 100000)) bad(`pack ${id}`);
  for (const [id, p] of Object.entries(s.prices)) {
    if (!FOOD_IDS.has(id) || !isObj(p) || !isInt(p.priceOre, 0, 1e8) || !isISODate(p.priceDate)) bad(`price ${id}`);
  }

  for (const x of s.exercises) if (!isObj(x) || !isStr(x.id) || SEED_EXERCISE_IDS.has(x.id) || !isName(x.name)) bad(`exercise ${x?.id}`);
  if (!unique(s.exercises.map((x) => x?.id))) bad('duplicate exercise id');
  const exerciseSet = new Set([...SEED_EXERCISE_IDS, ...s.exercises.map((x) => x?.id)]);

  for (const p of s.programs) {
    const daysOk = isObj(p) && Array.isArray(p.days) && p.days.length <= 14 && p.days.every((d) => isObj(d) && isStr(d.name, 40) && Array.isArray(d.exercises)
      && d.exercises.every((x) => isObj(x) && exerciseSet.has(x.exerciseId) && isInt(x.sets, 1, 20) && isInt(x.reps, 1, 100)));
    if (!daysOk || !isStr(p.id) || SEED_TEMPLATE_IDS.has(p.id) || !isName(p.name)) bad(`programme ${p?.id}`);
  }
  if (!unique(s.programs.map((p) => p?.id))) bad('duplicate programme id');
  if (!SEED_TEMPLATE_IDS.has(s.templateId) && !s.programs.some((p) => p?.id === s.templateId)) bad('templateId');

  for (const w of s.workouts) {
    const setsOk = isObj(w) && Array.isArray(w.sets) && w.sets.length > 0
      && w.sets.every((x) => isObj(x) && isInt(x.reps, 1, 100) && isNum(x.kg, 0.01, 1000) && typeof x.confirmed === 'boolean');
    if (!setsOk || !isISODate(w.date) || !exerciseSet.has(w.exerciseId)) bad(`workout ${w?.date} ${w?.exerciseId}`);
  }
  for (const w of s.weights) if (!isObj(w) || !isISODate(w.date) || !isNum(w.kg, 20, 400)) bad(`weight ${w?.date}`);
  if (!unique(s.weights.map((w) => w?.date))) bad('duplicate weight date');
  return errors;
}

/**
 * Parses stored or imported text. Never throws.
 * @returns {{ ok: true, state: object } | { ok: false, errors: string[] }}
 */
export function parseState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['not valid JSON'] };
  }
  let migrated;
  try {
    migrated = migrate(parsed);
  } catch {
    return { ok: false, errors: ['could not be migrated'] };
  }
  const errors = validate(migrated);
  return errors.length ? { ok: false, errors } : { ok: true, state: migrated };
}
