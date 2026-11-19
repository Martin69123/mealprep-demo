// The one AI task in the app: turn a sentence into PROPOSED meal-plan additions.
// Pure functions: building the prompt and checking the answer. No I/O here.
//
// The model only chooses among things that already exist (a recipe, a date in the visible week,
// a number of servings). It never writes numbers the app shows as nutrition, money or stock; every
// figure is recalculated by the deterministic core after the user approves. Whatever the model
// returns is treated as untrusted text and checked field by field.

export const LIMITS = { textMax: 400, recipesMax: 60, actionsMax: 14, servingsMin: 0.25, servingsMax: 20 };

const WEEKDAYS = {
  da: ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const weekdayIndex = (iso) => (new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay() + 6) % 7;
const isISO = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

const addDays = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86_400_000).toISOString().slice(0, 10);

const STOPWORDS = new Set(['med', 'og', 'til', 'the', 'and', 'with', 'for', 'min', 'mit', 'mine', 'mors', 'uspec']);
/** Lower-case words of at least three letters, without filler words. */
export function words(text) {
  return clean(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}
/**
 * Does the user's text name this recipe? True when a word of the text equals a word of the recipe
 * name, or one is the start of the other (at least four letters, so "kyllingen" matches "kylling").
 * This is a plain text check, not AI: it stops the model from "choosing" a recipe nobody mentioned.
 */
export function mentions(text, recipeName) {
  const a = words(text);
  const b = words(recipeName);
  return a.some((x) => b.some((y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))));
}

/**
 * @typedef {object} AssistantContext
 * @property {string} text    the user's request
 * @property {'da' | 'en'} lang
 * @property {string} today   ISO date
 * @property {string[]} dates the seven ISO dates of the visible week
 * @property {{ id: string, name: string }[]} recipes
 */

/** Checks a context before it is sent anywhere. Returns a list of problems (empty = fine). */
export function checkContext(ctx) {
  const errors = [];
  if (!ctx || typeof ctx !== 'object') return ['no context'];
  if (typeof ctx.text !== 'string' || clean(ctx.text).length === 0) errors.push('empty text');
  else if (ctx.text.length > LIMITS.textMax) errors.push('text too long');
  if (ctx.lang !== 'da' && ctx.lang !== 'en') errors.push('lang');
  if (!isISO(ctx.today)) errors.push('today');
  if (!Array.isArray(ctx.dates) || ctx.dates.length !== 7 || !ctx.dates.every(isISO) || new Set(ctx.dates).size !== 7) errors.push('dates');
  if (!Array.isArray(ctx.recipes) || ctx.recipes.length === 0 || ctx.recipes.length > LIMITS.recipesMax
    || !ctx.recipes.every((r) => r && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 200 && typeof r.name === 'string' && r.name.length > 0 && r.name.length <= 80)
    || new Set(ctx.recipes.map((r) => r.id)).size !== ctx.recipes.length) errors.push('recipes');
  return errors;
}

/** Short stand-in ids (R1, R2 …) so the model never has to copy a long internal id. */
export function aliases(recipes) {
  return recipes.map((r, i) => ({ alias: `R${i + 1}`, id: r.id, name: clean(r.name) }));
}

/**
 * The messages and the JSON schema the model must answer in. The schema restricts recipe and date
 * to the listed values, so a compliant runtime cannot emit anything else.
 * @param {AssistantContext} ctx
 */
export function buildPrompt(ctx) {
  const list = aliases(ctx.recipes);
  const days = ctx.dates.map((d) => `${d} = ${WEEKDAYS.en[weekdayIndex(d)]} / ${WEEKDAYS.da[weekdayIndex(d)]}`);
  const inWeek = (d) => (ctx.dates.includes(d) ? d : 'not in this week (no action)');
  const weekdays = ctx.dates.filter((d) => weekdayIndex(d) < 5);
  const weekend = ctx.dates.filter((d) => weekdayIndex(d) >= 5);
  const system = [
    'You turn one request from a user into additions to a weekly meal plan. You output JSON only.',
    'The request may be in Danish or English.',
    '',
    'Recipes (use the code):',
    ...list.map((r) => `${r.alias} = ${r.name}`),
    '',
    'Days of the week being planned:',
    ...days,
    '',
    'Words for days, already worked out for you:',
    `today / i dag = ${inWeek(ctx.today)}`,
    `tomorrow / i morgen = ${inWeek(addDays(ctx.today, 1))}`,
    `the day after tomorrow / i overmorgen = ${inWeek(addDays(ctx.today, 2))}`,
    `weekdays / hverdage = ${weekdays.join(', ')}`,
    `weekend / weekenden = ${weekend.join(', ')}`,
    `every day / hver dag = ${ctx.dates.join(', ')}`,
    '',
    'Rules:',
    '- Each action adds one meal: a recipe code, one of the listed dates, and a number of servings.',
    '- Use only the recipe codes and dates listed above. Pick the recipe whose name best matches what the user wrote.',
    '- "servings" is how many portions to plan for that meal. If the user gives no number, use 1. Decimals are allowed: half = 0.5.',
    '- One action per day mentioned. Use the worked-out dates above for words like tomorrow, weekdays and every day.',
    '- If the user names a dish that is not on the list, do not pick a different recipe instead: leave it out.',
    '- If the request is not about adding meals to the plan, or names no recipe on the list, answer {"actions": []}.',
    '- Never add meals the user did not ask for. Never give advice.',
  ].join('\n');
  const schema = {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        maxItems: LIMITS.actionsMax,
        items: {
          type: 'object',
          properties: {
            recipe: { type: 'string', enum: list.map((r) => r.alias) },
            date: { type: 'string', enum: [...ctx.dates] },
            servings: { type: 'number' },
          },
          required: ['recipe', 'date', 'servings'],
        },
      },
    },
    required: ['actions'],
  };
  return { system, user: clean(ctx.text), schema };
}

/**
 * Checks the model's raw answer against the context. Anything that is not exactly an existing
 * recipe that the user's text names, a date of the visible week and a sane number of servings is
 * dropped and counted.
 * @param {string} raw @param {AssistantContext} ctx
 * @returns {{ ok: boolean, actions: { recipeId: string, date: string, servings: number }[], rejected: number, error: string | null }}
 */
export function parseProposal(raw, ctx) {
  const fail = (error) => ({ ok: false, actions: [], rejected: 0, error });
  if (typeof raw !== 'string' || raw.length > 20000) return fail('no answer');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('not JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.actions)) return fail('wrong shape');
  const byAlias = new Map(aliases(ctx.recipes).map((r) => [r.alias, r]));
  const dates = new Set(ctx.dates);
  const seen = new Set();
  const actions = [];
  let rejected = 0;
  for (const a of parsed.actions) {
    const recipe = a && typeof a === 'object' ? byAlias.get(a.recipe) : undefined;
    const recipeId = recipe && mentions(ctx.text, recipe.name) ? recipe.id : undefined; // must be named in the user's own words
    const servings = a && typeof a.servings === 'number' && Number.isFinite(a.servings) ? Math.round(a.servings * 100) / 100 : NaN;
    const key = `${recipeId}|${a?.date}`;
    if (!recipeId || !dates.has(a.date) || !(servings >= LIMITS.servingsMin && servings <= LIMITS.servingsMax) || seen.has(key) || actions.length >= LIMITS.actionsMax) {
      rejected += 1;
      continue;
    }
    seen.add(key);
    actions.push({ recipeId, date: a.date, servings });
  }
  actions.sort((x, y) => x.date.localeCompare(y.date));
  return { ok: true, actions, rejected, error: null };
}
