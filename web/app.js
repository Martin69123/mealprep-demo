// Prototype UI. All arithmetic comes from ../core — this file only reads state, calls core, renders.
import * as N from '../core/nutrition.js';
import * as S from '../core/shopping.js';
import * as I from '../core/inventory.js';
import * as T from '../core/training.js';
import * as K from '../core/tracking.js';
import * as B from '../core/batches.js';
import * as P from '../core/planning.js';
import { FOODS, MICRO_UNITS, microTotals } from '../core/foods.js';
import { RECIPES, EXERCISES, TEMPLATES, DATA_NOTICE, DEFAULT_PACKS, LEGACY_IDS, byId } from '../core/seed.js';
import { STRINGS } from './i18n.js';
import * as store from './store.js';
import * as assistant from './assistant.js';
import { snapshotOf, recipeForEntry, isISODate } from '../core/state.js';

const foods = byId(FOODS);
const seedRecipes = byId(RECIPES);

const loaded = store.load();
let state = loaded.state;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const mondayOf = (iso) => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return K.addDays(iso, -((dow + 6) % 7));
};
const ui = { tab: 'home', week: mondayOf(todayISO()), recipeId: RECIPES[0].id, trainDate: todayISO(), dayIndex: 0, flash: '', ai: { state: 'checking' }, aiBusy: false, aiText: '', aiResult: null };

// ---------- helpers ----------
const t = (key) => STRINGS[state.lang][key] ?? key;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nm = (x) => esc(x?.name?.[state.lang] ?? x?.name?.da ?? '?');
const locale = () => (state.lang === 'da' ? 'da-DK' : 'en-GB');
const fmt = (x, digits = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(x);
const kr = (ore) => `${S.formatOre(ore)} kr.`;
const shortDate = (iso) => `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}.`;
const num = (text) => {
  const v = Number(String(text).trim().replace(',', '.'));
  return String(text).trim() !== '' && Number.isFinite(v) ? v : null;
};
const recipeMap = () => byId(state.recipes);
const pantryMap = () => new Map(Object.entries(state.pantry));
const weekDates = () => Array.from({ length: 7 }, (_, i) => K.addDays(ui.week, i));
const weekEntries = () => state.plan.filter((e) => e.date >= ui.week && e.date <= K.addDays(ui.week, 6));
const entryRecipe = (e) => recipeForEntry(e, recipeMap());
const entryNutrients = (e) => N.multiply(N.perServing(entryRecipe(e), foods), e.servings);
const allExercises = () => [...EXERCISES, ...state.exercises];
const exMap = () => byId(allExercises());
const allPrograms = () => [...TEMPLATES, ...state.programs];
const currentProgram = () => allPrograms().find((p) => p.id === state.templateId) ?? TEMPLATES[0];
const ownProgram = () => state.programs.find((p) => p.id === state.templateId) ?? null;
const exerciseInUse = (id) => state.workouts.some((w) => w.exerciseId === id) || state.programs.some((p) => p.days.some((d) => d.exercises.some((x) => x.exerciseId === id)));
const packOf = (id) => state.packs[id] ?? DEFAULT_PACKS[id] ?? null;
// Unique display label per food in the current language (Frida has a few duplicate English names).
let labelCache = { lang: null, byId: new Map(), toId: new Map() };
function foodLabels() {
  if (labelCache.lang === state.lang) return labelCache;
  const seen = new Map();
  for (const f of FOODS) seen.set(f.name[state.lang], (seen.get(f.name[state.lang]) ?? 0) + 1);
  const byIdMap = new Map();
  const toId = new Map();
  for (const f of FOODS) {
    const n = f.name[state.lang];
    const label = seen.get(n) > 1 ? `${n} (#${f.sourceId})` : n;
    byIdMap.set(f.id, label);
    toId.set(label.toLowerCase(), f.id);
  }
  document.getElementById('food-list').innerHTML = [...byIdMap.values()]
    .sort((a, b) => a.localeCompare(b, locale())).map((l) => `<option value="${esc(l)}">`).join('');
  return (labelCache = { lang: state.lang, byId: byIdMap, toId });
}
const options = (list, selected, label = nm) =>
  list.map((x) => `<option value="${esc(x.id)}"${x.id === selected ? ' selected' : ''}>${label(x)}</option>`).join('');

function commit(flash = '') {
  for (const id of Object.keys(state.pantryDates)) if (!(state.pantry[id] > 0)) delete state.pantryDates[id];
  ui.flash = store.save(state) ? flash : t('saveFailed');
  render();
}

/** Shopping lines for the visible week: only meals still to be cooked (status assumed). */
/** Planned (assumed) meals of the visible week that cooked portions will cover: entry id → takes. */
const coverage = () => B.allocate(weekEntries().filter((e) => e.status === 'assumed'), state.batches, todayISO());
function shoppingLines(recipes = recipeMap()) {
  const covered = coverage();
  const needs = S.aggregateNeeds(weekEntries().filter((e) => e.status === 'assumed' && !covered.has(e.id)), recipes);
  const products = new Map(
    [...needs.keys()].map((id) => [id, { packGrams: packOf(id), priceOre: state.prices[id]?.priceOre ?? null, priceDate: state.prices[id]?.priceDate ?? null }]),
  );
  return S.buildShoppingList(needs, pantryMap(), products)
    .sort((a, b) => nm(foods.get(a.foodId)).localeCompare(nm(foods.get(b.foodId)), locale()));
}
function budgetText(lines) {
  const b = S.budget(lines);
  if (lines.every((l) => l.toBuyGrams === 0)) return { main: t('nothingToBuy'), sub: '' };
  return {
    main: `${b.complete ? '' : `${t('atLeast')} `}${kr(b.knownOre)}`,
    sub: b.complete ? '' : `${b.missingPrices} ${t('pricesMissing')}`,
  };
}
const macroLine = (n) => {
  const r = N.rounded(n);
  return `${fmt(r.kcal)} kcal · P ${fmt(r.protein, 1)} g · K ${fmt(r.carbs, 1)} g · F ${fmt(r.fat, 1)} g`;
};
const statusTag = (s) => `<span class="tag ${s}">${t(s)}</span>`;

// ---------- views ----------
function viewHome() {
  const today = todayISO();
  const todays = state.plan.filter((e) => e.date === today && e.status !== 'skipped');
  const sumOf = (list) => N.sum(list.map(entryNutrients));
  const total = sumOf(todays);
  const confirmed = sumOf(todays.filter((e) => e.status === 'confirmed'));
  const lines = shoppingLines();
  const bud = budgetText(lines);
  const adh = K.adherence(weekEntries());
  const change = K.trendChange(state.weights);
  const prs = T.detectPRs(state.workouts).slice(-5).reverse();
  const g = state.goal;
  foodLabels(); // fills the shared food datalist
  const dated = Object.keys(state.pantryDates).map((id) => P.daysBetween(today, state.pantryDates[id]));
  const ready = B.usable(state.batches, today).reduce((acc, b) => acc + b.servingsLeft, 0);
  const latest = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const perKg = latest ? `${fmt(g.protein / latest.kg, 2)} ${t('proteinPerKg')} (${fmt(latest.kg, 1)} kg, ${shortDate(latest.date)})` : t('proteinPerKgNone');
  return `
  <section class="card"><h2>${t('goal')}</h2>
    <div class="row">
      <label>${t('goalType')}<select data-act="goal" data-field="type">
        ${['cut', 'maintain', 'build'].map((k) => `<option value="${k}"${g.type === k ? ' selected' : ''}>${t(k)}</option>`).join('')}
      </select></label>
      <label>${t('kcalTarget')}<input class="num" inputmode="numeric" data-act="goal" data-field="kcal" value="${g.kcal}"></label>
      <label>${t('proteinTarget')}<input class="num" inputmode="numeric" data-act="goal" data-field="protein" value="${g.protein}"></label>
    </div><p class="muted">${perKg}</p>
    <h3>${t('avoidTitle')}</h3>
    ${state.goal.avoid.length === 0 ? `<p class="muted">${t('avoidNone')}</p>` : `<div class="row">${state.goal.avoid.map((id) =>
      `<span class="tag">${nm(foods.get(id))} <button type="button" class="chip" data-act="removeAvoid" data-food="${id}" aria-label="${t('remove')} ${nm(foods.get(id))}">✕</button></span>`).join('')}</div>`}
    <div class="row"><input class="food grow" list="food-list" id="avoid-food" aria-label="${t('avoidTitle')}" placeholder="${t('searchFood')}">
      <button type="button" data-act="addAvoid">${t('addMeal')}</button></div>
    <p class="muted">${t('avoidNote')}</p></section>
  <section class="card"><h2>${t('today')}</h2>
    ${todays.length === 0 ? `<p class="muted">${t('noMealsToday')}</p>` : `
    <div class="grid">
      <div><div class="stat">${fmt(total.kcal)} kcal</div><div class="muted">${t('planned')} · ${fmt((total.kcal / g.kcal) * 100)} % ${t('ofTarget')}</div>
        <progress max="${g.kcal}" value="${Math.min(total.kcal, g.kcal)}"></progress></div>
      <div><div class="stat">${fmt(total.protein)} g protein</div><div class="muted">${t('planned')} · ${fmt((total.protein / g.protein) * 100)} % ${t('ofTarget')}</div>
        <progress max="${g.protein}" value="${Math.min(total.protein, g.protein)}"></progress></div>
    </div>
    <p class="muted">${statusTag('confirmed')} ${fmt(confirmed.kcal)} kcal · ${statusTag('assumed')} ${fmt(total.kcal - confirmed.kcal)} kcal</p>`}
  </section>
  <section class="grid">
    <div class="card"><h2>${t('weekBudget')}</h2><div class="stat">${bud.main}</div><div class="muted">${bud.sub}</div></div>
    <div class="card"><h2>${t('stockTitle')}</h2>
      <div class="stat">${fmt(ready, 2)}</div><div class="muted">${t('portionsReady')}</div>
      <p class="muted">${dated.filter((d) => d >= 0 && d <= 3).length} ${t('stockSoon')} · ${dated.filter((d) => d < 0).length + state.batches.filter((b) => b.servingsLeft > 0 && B.isExpired(b, today)).length} ${t('stockExpired')}</p></div>
    <div class="card"><h2>${t('adherence')}</h2>
      <div class="row">${statusTag('confirmed')} ${adh.confirmed} ${statusTag('assumed')} ${adh.assumed} ${statusTag('skipped')} ${adh.skipped}</div>
      <p class="muted">${t('assumedNote')}</p></div>
    <div class="card"><h2>${t('weightTrend')}</h2>
      ${change ? `<div class="stat">${change.deltaKg > 0 ? '+' : ''}${fmt(change.deltaKg, 1)} kg</div>
        <div class="muted">${shortDate(change.fromDate)} – ${shortDate(change.toDate)}</div>` : `<p class="muted">${t('noWeight')}</p>`}
      <p class="muted">${t('trendNote')}</p></div>
  </section>
  <section class="card"><h2>${t('recentPRs')}</h2>${prList(prs)}</section>`;
}

function prList(prs) {
  if (prs.length === 0) return `<p class="muted">${t('noPRs')}</p>`;
  return `<ul class="plain">${prs.map((p) => `<li><span class="tag confirmed">${t('prBadge')}</span>
    ${nm(exMap().get(p.exerciseId))}: ${fmt(p.kg, 2)} kg × ${p.reps}
    <span class="muted">(${shortDate(p.date)}${p.previousKg ? ` · ${t('previous')} ${fmt(p.previousKg, 2)} kg` : ''})</span></li>`).join('')}</ul>`;
}

function viewPlan() {
  const days = weekDates();
  const covered = coverage();
  const dayBlocks = days.map((date, i) => {
    const entries = state.plan.filter((e) => e.date === date);
    const total = N.sum(entries.filter((e) => e.status !== 'skipped').map(entryNutrients));
    return `<div class="day">
      <div class="row between"><h3>${t('days')[i]} ${shortDate(date)}</h3>
        <span class="muted">${t('dayTotal')}: ${fmt(total.kcal)} / ${state.goal.kcal} kcal · ${fmt(total.protein)} / ${state.goal.protein} g protein</span></div>
      <ul class="plain">${entries.map((e) => `<li class="row between">
        <span>${nm(entryRecipe(e))} <span class="muted">× ${fmt(e.servings, 2)} · ${macroLine(entryNutrients(e))}${recipeMap().has(e.recipeId) ? '' : ` · ${t('recipeDeleted')}`}</span>
          ${e.fromBatch ? `<span class="tag confirmed">${t('fromBatchTag')}</span>` : covered.has(e.id) ? `<span class="tag assumed">${t('coveredTag')}</span>` : ''} ${avoidTag(entryRecipe(e))}</span>
        <span class="row">${['assumed', 'confirmed', 'skipped'].map((s) =>
          `<button type="button" data-act="status" data-id="${e.id}" data-status="${s}" aria-pressed="${e.status === s}"${recipeMap().has(e.recipeId) ? '' : ' disabled'}>${t(s)}</button>`).join('')}
          <button type="button" class="ghost danger" data-act="removeMeal" data-id="${e.id}" aria-label="${t('remove')}">✕</button></span></li>`).join('')}</ul>
      <div class="row">
        <select aria-label="${t('recipes')}" id="add-recipe-${date}">${options(state.recipes, ui.recipeId)}</select>
        <input class="num" inputmode="decimal" aria-label="${t('servings')}" id="add-servings-${date}" value="1">
        <button type="button" class="primary" data-act="addMeal" data-date="${date}">${t('addMeal')}</button>
      </div></div>`;
  }).join('');

  if (!recipeMap().has(ui.recipeId)) ui.recipeId = state.recipes[0].id;
  const recipe = recipeMap().get(ui.recipeId);
  const original = seedRecipes.get(ui.recipeId) ?? null; // null for the user's own recipes
  const after = N.perServing(recipe, foods);
  const before = original ? N.perServing(original, foods) : after;
  const d = N.diff(before, after);
  const changed = !!original && JSON.stringify(original.ingredients) !== JSON.stringify(recipe.ingredients);
  const costNow = budgetText(shoppingLines());
  const costOriginal = changed ? budgetText(shoppingLines(new Map([...recipeMap()]).set(original.id, original))) : costNow;
  const macroRow = (label, n) => `<tr><td>${label}</td><td class="n">${fmt(n.kcal)}</td><td class="n">${fmt(n.protein, 1)}</td><td class="n">${fmt(n.carbs, 1)}</td><td class="n">${fmt(n.fat, 1)}</td></tr>`;
  const sign = (x, digits) => `<span class="${x > 0 ? 'delta-up' : x < 0 ? 'delta-down' : ''}">${x > 0 ? '+' : ''}${fmt(x, digits)}</span>`;
  return `
  ${viewAssistant()}
  <section class="card">
    <div class="row between"><h2>${t('week')} ${shortDate(days[0])} – ${shortDate(days[6])}</h2>
      <span class="row"><button type="button" data-act="week" data-step="-7">${t('prevWeek')}</button>
      <button type="button" data-act="week" data-step="7">${t('nextWeek')}</button></span></div>
    ${dayBlocks}
    <p class="muted">${t('assumedNote')}</p>
  </section>
  <section class="card"><h2>${t('editRecipe')}</h2>
    <div class="row"><select data-act="pickRecipe" aria-label="${t('recipes')}">${options(state.recipes, ui.recipeId)}</select>
      <button type="button" data-act="newRecipe">${t('newRecipe')}</button>
      ${original ? `<span class="muted">${fmt(recipe.servings)} ${t('servings').toLowerCase()}</span>` : ''}</div>
    ${original ? '' : `<div class="row">
      <label>${t('recipeName')}<input data-act="recipeName" maxlength="80" value="${nm(recipe)}"></label>
      <label>${t('servings')}<input class="num" inputmode="decimal" data-act="recipeServings" value="${recipe.servings}"></label>
      <button type="button" class="danger" data-act="deleteRecipe">${t('deleteRecipe')}</button></div>`}
    ${recipe.ingredients.length === 0 ? `<p class="muted">${t('noIngredients')}</p>` : `
    <div class="tablewrap"><table><thead><tr><th>${t('ingredient')}</th><th class="n">${t('grams')}</th><th></th></tr></thead><tbody>
      ${recipe.ingredients.map((ing, i) => `<tr>
        <td><input class="food" list="food-list" data-act="swapFood" data-index="${i}" aria-label="${t('ingredient')} ${i + 1}" title="${t('searchFood')}" value="${esc(foodLabels().byId.get(ing.foodId) ?? '?')}"></td>
        <td class="n"><input class="num" inputmode="decimal" data-act="swapGrams" data-index="${i}" aria-label="${t('grams')} ${i + 1}" value="${fmt(ing.grams, 1).replace(/\s/g, '')}"></td>
        <td class="n"><button type="button" class="ghost danger" data-act="removeIngredient" data-index="${i}" aria-label="${t('remove')} ${t('ingredient')} ${i + 1}">✕</button></td></tr>`).join('')}
    </tbody></table></div>`}
    <div class="row">
      <input class="food grow" list="food-list" id="new-food" aria-label="${t('addIngredient')}" placeholder="${t('searchFood')}">
      <input class="num" inputmode="decimal" id="new-grams" aria-label="${t('grams')}" value="100">
      <button type="button" class="primary" data-act="addIngredient">${t('addIngredient')}</button></div>
    <h3>${t('perServing')}</h3>
    <div class="tablewrap"><table><thead><tr><th></th><th class="n">kcal</th><th class="n">Protein</th><th class="n">${state.lang === 'da' ? 'Kulhydrat' : 'Carbs'}</th><th class="n">${state.lang === 'da' ? 'Fedt' : 'Fat'}</th></tr></thead><tbody>
      ${original ? `${macroRow(t('before'), before)}${macroRow(t('after'), after)}
      <tr><td>${t('change')}</td><td class="n">${sign(d.kcal, 0)}</td><td class="n">${sign(d.protein, 1)}</td><td class="n">${sign(d.carbs, 1)}</td><td class="n">${sign(d.fat, 1)}</td></tr>` : macroRow(t('perServing'), after)}
    </tbody></table></div>
    ${avoidNames(recipe).length ? `<p>${avoidTag(recipe)}</p>` : ''}
    <h3>${t('cookTitle')}</h3>
    <div class="row"><label>${t('servings')}<input class="num" inputmode="decimal" id="cook-servings" value="${recipe.servings}"></label>
      <button type="button" class="primary" data-act="cook"${recipe.ingredients.length === 0 ? ' disabled' : ''}>${t('cook')}</button></div>
    <p class="muted">${t('cookNote')}</p>
    <h3>${t('yieldTitle')}</h3>
    <div class="row"><label>${t('cookedGrams')}<input class="num" inputmode="decimal" data-act="cookedGrams" value="${recipe.cookedGrams ?? ''}"></label>
      <span class="muted">${t('rawWeight')}: ${fmt(N.rawGrams(recipe))} g</span></div>
    ${recipe.cookedGrams > 0 && N.rawGrams(recipe) > 0 ? `<p>${t('yieldPerServing')}: <strong>${fmt(N.cookedGramsPerServing(recipe, recipe.cookedGrams))} g</strong>
      <span class="muted">· ${t('yieldFactor')} ${fmt(N.yieldFactor(recipe, recipe.cookedGrams) * 100)} % · ${t('per100Cooked')}: ${macroLine(N.per100Cooked(recipe, foods, recipe.cookedGrams))}</span>
      <span class="tag confirmed">${t('measuredTag')}</span></p>` : ''}
    <p class="muted">${t('yieldNote')}</p>
    <h3>${t('microTitle')}</h3>
    <div class="tablewrap"><table><tbody>${Object.entries(microTotals(recipe.ingredients, foods, 1 / recipe.servings)).map(([k, m]) => `<tr>
      <td>${t('micro')[k]}</td><td class="n">${m.unknown ? '≥ ' : ''}${fmt(m.value, m.value < 10 ? 2 : 0)} ${MICRO_UNITS[k]}</td>
      <td class="muted">${m.unknown ? `${t('microUnknown')} ${m.unknown} ${t('ingredientsWord')}` : ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted">${t('microNote')}</p>
    <p>${t('weekCostChange')}: <strong>${costNow.main}</strong> ${costNow.sub ? `<span class="muted">(${costNow.sub})</span>` : ''}
      ${changed ? `<span class="muted">· ${t('before')}: ${costOriginal.main}</span>` : ''}</p>
    ${!original ? '' : changed ? `<button type="button" data-act="resetRecipe">${t('resetRecipe')}</button>` : `<p class="muted">${t('recipeUnchanged')}</p>`}
  </section>`;
}

function viewShop() {
  const lines = shoppingLines();
  const bud = budgetText(lines);
  const days = weekDates();
  const stock = Object.entries(state.pantry).filter(([, g]) => g > 0)
    .sort((a, b) => nm(foods.get(a[0])).localeCompare(nm(foods.get(b[0])), locale()));
  return `
  <section class="card">
    <div class="row between"><h2>${t('shoppingList')} · ${shortDate(days[0])} – ${shortDate(days[6])}</h2>
      <span class="row"><button type="button" data-act="week" data-step="-7">${t('prevWeek')}</button>
      <button type="button" data-act="week" data-step="7">${t('nextWeek')}</button></span></div>
    ${lines.length === 0 ? `<p class="muted">${t('shopEmpty')}</p>` : `
    <div class="tablewrap"><table class="stack"><thead><tr><th>${t('food')}</th><th class="n">${t('need')}</th><th class="n">${t('fromPantry')}</th>
      <th class="n">${t('packSize')}</th><th class="n">${t('buy')}</th><th class="n">${t('leftover')}</th><th class="n">${t('packPrice')}</th><th class="n">${t('cost')}</th></tr></thead><tbody>
      ${lines.map((l) => {
        const p = state.prices[l.foodId];
        return `<tr><td class="title">${nm(foods.get(l.foodId))}</td>
        <td class="n" data-label="${t('need')}">${fmt(l.neededGrams)} g</td><td class="n" data-label="${t('fromPantry')}">${fmt(l.fromPantryGrams)} g</td>
        <td class="n" data-label="${t('packSize')}"><input class="num" inputmode="decimal" data-act="pack" data-food="${l.foodId}" aria-label="${t('packSize')} ${nm(foods.get(l.foodId))}" value="${l.packGrams ?? ''}">
          <div class="muted">${state.packs[l.foodId] ? t('packOwn') : l.packGrams ? t('packAssumed') : t('noPack')}</div></td>
        <td class="n" data-label="${t('buy')}">${l.packs > 0 ? `${l.packs} ${t('packs')}` : l.toBuyGrams > 0 ? `${fmt(l.toBuyGrams)} g` : '–'}</td>
        <td class="n" data-label="${t('leftover')}">${fmt(l.leftoverGrams)} g</td>
        <td class="n" data-label="${t('packPrice')}"><input class="num" inputmode="decimal" data-act="price" data-food="${l.foodId}" aria-label="${t('packPrice')} ${nm(foods.get(l.foodId))}" value="${p ? S.formatOre(p.priceOre) : ''}">
          <div class="muted">${p ? `${p.example ? t('example') : t('priceFrom')} ${shortDate(p.priceDate)}` : t('noPrice')}</div></td>
        <td class="n" data-label="${t('cost')}">${l.costOre == null ? `<span class="tag assumed">${t('noPrice')}</span>` : kr(l.costOre)}</td></tr>`;
      }).join('')}
      </tbody><tfoot><tr><th colspan="7">${t('total')}</th><th class="n">${bud.main}</th></tr></tfoot></table></div>
    ${bud.sub ? `<p class="muted">${bud.sub}</p>` : ''}
    <div class="row"><button type="button" class="primary" data-act="bought"${lines.every((l) => l.purchasedGrams === 0) ? ' disabled' : ''}>${t('markBought')}</button>
      <button type="button" data-act="examplePrices">${t('examplePrices')}</button></div>`}
    ${coverage().size ? `<p><span class="tag confirmed">${coverage().size}</span> ${t('coveredNote')}</p>` : ''}
    <p class="muted">${t('shopNote')} ${t('examplePricesNote')}</p>
  </section>
  <section class="card"><h2>${t('pantry')}</h2>
    ${stock.length === 0 ? `<p class="muted">${t('pantryEmpty')}</p>` : `<div class="tablewrap"><table class="stack"><thead><tr><th>${t('food')}</th><th class="n">${t('inStock')}</th><th class="n">${t('useBy')}</th></tr></thead><tbody>
      ${stock.map(([id, g]) => `<tr><td class="title">${nm(foods.get(id))} ${dateTag(state.pantryDates[id])}</td><td class="n" data-label="${t('inStock')}"><input class="num" inputmode="decimal" data-act="pantry" data-food="${id}" aria-label="${t('inStock')} ${nm(foods.get(id))}" value="${fmt(g, 1).replace(/\s/g, '')}"></td>
        <td class="n" data-label="${t('useBy')}"><input type="date" data-act="pantryDate" data-food="${id}" aria-label="${t('useBy')} ${nm(foods.get(id))}" value="${state.pantryDates[id] ?? ''}"></td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted">${t('dateNote')}</p>`}
  </section>
  ${viewBatches()}`;
}

function viewTrain() {
  const program = currentProgram();
  const own = ownProgram();
  if (ui.dayIndex >= program.days.length) ui.dayIndex = 0;
  const day = program.days[ui.dayIndex] ?? null;
  const logs = state.workouts.filter((w) => w.date === ui.trainDate);
  const prs = T.detectPRs(state.workouts);
  const list = allExercises();
  // Only the first set that reached a record weight carries the badge, not later repeats of it.
  const isPR = (log, index) => {
    const set = log.sets[index];
    const first = log.sets.findIndex((s) => s.kg === set.kg && s.reps === set.reps);
    return first === index && prs.some((p) => p.date === log.date && p.exerciseId === log.exerciseId && p.kg === set.kg && p.reps === set.reps);
  };
  const selected = list.some((x) => x.id === ui.lastExercise) ? ui.lastExercise : list[0].id;
  const last = T.lastSet(state.workouts, selected);
  const progress = day ? T.dayProgress(day, logs) : [];
  const doneCount = progress.filter((p) => p.complete).length;
  return `
  <section class="card"><h2>${t('template')}</h2>
    <div class="row"><select data-act="template" aria-label="${t('template')}">${options(allPrograms(), program.id)}</select>
      <button type="button" data-act="newProgram">${t('newProgram')}</button></div>
    ${program.days.length === 0 ? `<p class="muted">${t('noDays')}</p>` : `
    <div class="row" role="group" aria-label="${t('programDay')}">${program.days.map((d, i) =>
      `<button type="button" data-act="pickDay" data-index="${i}" aria-pressed="${i === ui.dayIndex}">${esc(d.name)}</button>`).join('')}</div>
    <h3>${esc(day.name)} · ${shortDate(ui.trainDate)} · ${doneCount} / ${progress.length} ${t('exercisesDone')}</h3>
    ${progress.length === 0 ? `<p class="muted">${t('noExercisesInDay')}</p>` : `<ul class="plain">${progress.map((p) => {
      const prev = T.lastSet(state.workouts, p.exerciseId);
      return `<li class="row between"><span><strong>${nm(exMap().get(p.exerciseId))}</strong>
        <span class="muted">${t('planned')} ${p.plannedSets} × ${p.plannedReps}${prev ? ` · ${t('lastTime')} ${fmt(prev.kg, 2)} kg × ${prev.reps} (${shortDate(prev.date)})` : ''}</span><br>
        <span class="tag ${p.complete ? 'confirmed' : p.loggedSets > 0 ? 'assumed' : 'skipped'}">${p.loggedSets} / ${p.plannedSets} ${t('setsLogged')}</span></span>
        <button type="button" data-act="prefill" data-ex="${esc(p.exerciseId)}" data-reps="${p.plannedReps}">${t('logThis')}</button></li>`;
    }).join('')}</ul>`}`}
    <p class="muted">${t('plannedNote')}</p>
  </section>
  <section class="card" id="log-card"><h2>${t('logSet')}</h2>
    <div class="row">
      <label>${t('date')}<input type="date" data-act="trainDate" value="${ui.trainDate}"></label>
      <label>${t('exercise')}<select id="set-exercise" data-act="pickExercise">${options(list, selected)}</select></label>
      <label>${t('reps')}<input class="num" inputmode="numeric" id="set-reps" value="${ui.lastReps ?? 5}"></label>
      <label>${t('kg')}<input class="num" inputmode="decimal" id="set-kg" value="${ui.lastKg ?? ''}"></label>
      <button type="button" class="primary" data-act="logSet">${t('logSet')}</button>
    </div>
    <p class="muted">${last ? `${t('lastTime')}: ${fmt(last.kg, 2)} kg × ${last.reps} (${shortDate(last.date)})` : t('neverLogged')}</p>
    <h3>${t('todaysSets')} · ${shortDate(ui.trainDate)}</h3>
    ${logs.length === 0 ? `<p class="muted">${t('noSets')}</p>` : logs.map((log) => `
      <p><strong>${nm(exMap().get(log.exerciseId))}</strong> <span class="muted">${t('volume')}: ${fmt(T.volume(log.sets))} kg</span></p>
      <ul class="plain">${log.sets.map((s, i) => {
        const e1 = T.estimated1RM(s.kg, s.reps);
        return `<li class="row between"><span>${fmt(s.kg, 2)} kg × ${s.reps} ${statusTag('confirmed')}
          ${isPR(log, i) ? `<span class="tag confirmed">${t('prBadge')}</span>` : ''}
          ${e1 ? `<span class="muted">${t('est1rm')}: ${fmt(e1, 1)} kg (${t('estimate')})</span>` : ''}</span>
          <button type="button" class="ghost danger" data-act="removeSet" data-ex="${esc(log.exerciseId)}" data-index="${i}" aria-label="${t('remove')}">✕</button></li>`;
      }).join('')}</ul>`).join('')}
  </section>
  <section class="card"><h2>${t('recentPRs')}</h2>${prList(prs.slice(-8).reverse())}</section>
  <section class="card"><h2>${t('editProgram')}</h2>
    ${!own ? `<p class="muted">${t('builtInProgram')}</p>` : `
    <div class="row"><label>${t('recipeName')}<input data-act="programName" maxlength="80" value="${nm(own)}"></label>
      <button type="button" class="danger" data-act="deleteProgram">${t('deleteProgram')}</button></div>
    ${own.days.map((d, di) => `<div class="day">
      <div class="row between"><label>${t('programDay')}<input data-act="dayName" data-day="${di}" maxlength="40" value="${esc(d.name)}"></label>
        <button type="button" class="ghost danger" data-act="removeDay" data-day="${di}">${t('removeDay')}</button></div>
      <ul class="plain">${d.exercises.map((x, xi) => `<li class="row between"><span>${nm(exMap().get(x.exerciseId))}</span>
        <span class="row"><input class="num small" inputmode="numeric" data-act="planSets" data-day="${di}" data-index="${xi}" aria-label="${t('sets')}" value="${x.sets}"> ×
          <input class="num small" inputmode="numeric" data-act="planReps" data-day="${di}" data-index="${xi}" aria-label="${t('reps')}" value="${x.reps}">
          <button type="button" class="ghost danger" data-act="removePlanExercise" data-day="${di}" data-index="${xi}" aria-label="${t('remove')}">✕</button></span></li>`).join('')}</ul>
      <div class="row"><select id="plan-ex-${di}" aria-label="${t('exercise')}">${options(list)}</select>
        <button type="button" data-act="addPlanExercise" data-day="${di}">${t('addExercise')}</button></div></div>`).join('')}
    <div class="row"><button type="button" data-act="addDay">${t('addDay')}</button></div>`}
  </section>
  <section class="card"><h2>${t('ownExercises')}</h2>
    ${state.exercises.length === 0 ? `<p class="muted">${t('noOwnExercises')}</p>` : `<ul class="plain">${state.exercises.map((x) => `<li class="row between"><span>${nm(x)}</span>
      <button type="button" class="ghost danger" data-act="deleteExercise" data-id="${esc(x.id)}"${exerciseInUse(x.id) ? ` disabled title="${t('exerciseInUse')}"` : ''} aria-label="${t('remove')} ${nm(x)}">✕</button></li>`).join('')}</ul>`}
    <div class="row"><input id="new-exercise" class="grow" maxlength="80" aria-label="${t('exerciseName')}" placeholder="${t('exerciseName')}">
      <button type="button" class="primary" data-act="addExercise">${t('addExercise')}</button></div>
    <p class="muted">${t('ownExercisesNote')}</p>
  </section>`;
}

function weightChart(trend) {
  if (trend.length < 2) return '';
  const W = 600, H = 160, pad = 14;
  const xs = trend.map((p) => Date.parse(p.date));
  const ys = trend.flatMap((p) => [p.kg, p.trendKg]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys) - 0.3, Math.max(...ys) + 0.3];
  const X = (v) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const Y = (v) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('weightTrend')}">
    <polyline class="trend" points="${trend.map((p, i) => `${X(xs[i]).toFixed(1)},${Y(p.trendKg).toFixed(1)}`).join(' ')}"/>
    ${trend.map((p, i) => `<circle class="raw" r="3" cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.kg).toFixed(1)}"/>`).join('')}</svg>`;
}

function viewWeight() {
  const trend = K.weightTrend(state.weights);
  return `
  <section class="card"><h2>${t('logWeight')}</h2>
    <div class="row">
      <label>${t('date')}<input type="date" id="w-date" value="${todayISO()}"></label>
      <label>${t('weightKg')}<input class="num" inputmode="decimal" id="w-kg"></label>
      <button type="button" class="primary" data-act="logWeight">${t('save')}</button>
    </div></section>
  <section class="card"><h2>${t('weightTrend')}</h2>
    ${trend.length === 0 ? `<p class="muted">${t('noWeight')}</p>` : `${weightChart(trend)}
    <p class="muted">${t('trendNote')}</p>
    <div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th class="n">${t('weightKg')}</th><th class="n">${t('trend')}</th><th></th></tr></thead><tbody>
      ${[...trend].reverse().map((p) => `<tr><td>${shortDate(p.date)}${p.date.slice(0, 4)}</td><td class="n">${fmt(p.kg, 1)}</td><td class="n">${fmt(p.trendKg, 1)}</td>
        <td class="n"><button type="button" class="ghost danger" data-act="removeWeight" data-date="${p.date}" aria-label="${t('remove')}">✕</button></td></tr>`).join('')}
    </tbody></table></div>`}
  </section>`;
}

function viewSettings() {
  const rescue = store.rescued();
  return `${rescue == null ? '' : `<section class="card" role="alert"><h2>${t('rescueTitle')}</h2><p>${t('rescueText')}</p>
    <div class="row"><button type="button" class="primary" data-act="downloadRescue">${t('rescueDownload')}</button>
      <button type="button" class="danger" data-act="discardRescue">${t('rescueDiscard')}</button></div></section>`}
  <section class="card"><h2>${t('language')}</h2><div class="row">
    <button type="button" data-act="setLang" data-lang="da" aria-pressed="${state.lang === 'da'}">Dansk</button>
    <button type="button" data-act="setLang" data-lang="en" aria-pressed="${state.lang === 'en'}">English</button></div></section>
  <section class="card"><h2>${t('installTitle')}</h2>
    <p>${isInstalled() ? t('installDone') : t('installHow')}</p>
    <p class="muted">${t('installNote')}</p></section>
  <section class="card"><h2>${t('data')}</h2><p class="muted">${t('dataNote')}</p>
    <div class="row"><button type="button" data-act="export">${t('exportData')}</button>
      <label>${t('importData')}<input type="file" accept="application/json,.json" data-act="import"></label>
      <button type="button" class="danger" data-act="deleteAll">${t('deleteAll')}</button></div></section>`;
}

/** Tag for a date the user entered themselves: expired, soon, or just the date. */
function dateTag(date) {
  if (!date) return '';
  const d = P.daysBetween(todayISO(), date);
  if (d < 0) return `<span class="tag expired">${t('expired')} ${shortDate(date)}</span>`;
  if (d === 0) return `<span class="tag assumed">${t('expiresToday')}</span>`;
  if (d <= 3) return `<span class="tag assumed">${d} ${t(d === 1 ? 'dayLeft' : 'daysLeft')}</span>`;
  return `<span class="muted">${shortDate(date)}</span>`;
}
const avoidNames = (recipe) => P.avoidedIn(recipe, state.goal.avoid).map((id) => nm(foods.get(id)));
const avoidTag = (recipe) => {
  const names = avoidNames(recipe);
  return names.length ? `<span class="tag expired">${t('avoidWarn')}: ${names.join(', ')}</span>` : '';
};

function viewBatches() {
  const list = [...state.batches].sort((a, b) => b.cookedDate.localeCompare(a.cookedDate) || a.id.localeCompare(b.id));
  return `<section class="card"><h2>${t('batches')}</h2>
    ${list.length === 0 ? `<p class="muted">${t('noBatches')}</p>` : `<ul class="plain">${list.map((b) => `<li class="day">
      <div class="row between"><span><strong>${nm(b.snapshot)}</strong>
        <span class="muted">${t('cookedOn')} ${shortDate(b.cookedDate)}</span><br>
        <span class="tag ${b.servingsLeft > 0 && !B.isExpired(b, todayISO()) ? 'confirmed' : 'skipped'}">${fmt(b.servingsLeft, 2)} / ${fmt(b.servings, 2)} ${t('portionsLeft')}</span> ${dateTag(b.useBy)}</span>
        ${b.servingsLeft >= b.servings ? `<button type="button" data-act="undoBatch" data-id="${esc(b.id)}">${t('undoCook')}</button>`
          : `<button type="button" class="danger" data-act="discardBatch" data-id="${esc(b.id)}">${t('discard')}</button>`}</div>
      <label>${t('useBy')}<input type="date" data-act="batchUseBy" data-id="${esc(b.id)}" value="${b.useBy ?? ''}"></label></li>`).join('')}</ul>`}
    <p class="muted">${t('dateNote')}</p></section>`;
}

function viewWeek() {
  const days = weekDates();
  const program = currentProgram();
  const lines = shoppingLines();
  const bud = budgetText(lines);
  const toBuy = lines.filter((l) => l.toBuyGrams > 0).length;
  const covered = coverage();
  const uncooked = weekEntries().filter((e) => e.status === 'assumed' && !covered.has(e.id));
  const byRecipe = new Map();
  for (const e of uncooked) byRecipe.set(e.recipeId, (byRecipe.get(e.recipeId) ?? 0) + e.servings);
  const hasSchedule = Object.keys(state.schedule).length > 0;
  const weekdaySelect = (act, value) => `<select data-act="${act}"><option value="">${t('noneOption')}</option>
    ${t('days').map((d, i) => `<option value="${i}"${value === i ? ' selected' : ''}>${d}</option>`).join('')}</select>`;
  const blocks = days.map((date, i) => {
    const dayIndex = state.schedule[i];
    const planned = dayIndex != null ? program.days[dayIndex] ?? null : null;
    const logs = state.workouts.filter((w) => w.date === date);
    const loggedSets = logs.reduce((acc, w) => acc + w.sets.filter((s) => s.confirmed).length, 0);
    const progress = planned ? T.dayProgress(planned, logs) : [];
    const done = progress.filter((p) => p.complete).length;
    const meals = state.plan.filter((e) => e.date === date);
    const eaten = meals.filter((e) => e.status !== 'skipped');
    const total = N.sum(eaten.map(entryNutrients));
    const adh = K.adherence(meals);
    return `<div class="day${date === todayISO() ? ' today' : ''}">
      <div class="row between"><h3>${t('days')[i]} ${shortDate(date)}${date === todayISO() ? ` · ${t('today')}` : ''}</h3>
        <select data-act="schedule" data-weekday="${i}" aria-label="${t('template')} ${t('days')[i]}">
          <option value="">${t('restDay')}</option>
          ${program.days.map((d, di) => `<option value="${di}"${dayIndex === di ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <ul class="plain">
        <li class="row between"><span>${planned
          ? `<strong>${t('tabTrain')}: ${esc(planned.name)}</strong> <span class="tag ${done === progress.length && progress.length > 0 ? 'confirmed' : done > 0 || loggedSets > 0 ? 'assumed' : 'skipped'}">${done} / ${progress.length} ${t('exercisesDone')}</span>`
          : loggedSets > 0 ? `<strong>${t('tabTrain')}</strong> <span class="tag confirmed">${loggedSets} ${t('setsLogged')}</span>`
          : `<span class="muted">${hasSchedule ? t('restDay') : t('noTrainingPlanned')}</span>`}</span>
          ${planned || loggedSets > 0 ? `<button type="button" data-act="openTraining" data-date="${date}" data-day="${planned ? dayIndex : ''}">${t('openTraining')}</button>` : ''}</li>
        <li>${meals.length === 0 ? `<span class="muted">${t('noMealsDay')}</span>`
          : `<strong>${meals.length} ${t('mealsWord')}</strong> <span class="muted">${fmt(total.kcal)} / ${state.goal.kcal} kcal · ${fmt(total.protein)} / ${state.goal.protein} g protein</span>
            ${adh.confirmed ? `${statusTag('confirmed')} ${adh.confirmed}` : ''} ${adh.assumed ? `${statusTag('assumed')} ${adh.assumed}` : ''} ${adh.skipped ? `${statusTag('skipped')} ${adh.skipped}` : ''}`}</li>
        ${state.shopDay === i ? `<li class="row between"><span><strong>${t('tabShop')}</strong> <span class="muted">${toBuy} ${t('itemsToBuy')} · ${bud.main}${bud.sub ? ` (${bud.sub})` : ''}</span></span>
          <button type="button" data-act="tab" data-tab="shop">${t('tabShop')}</button></li>` : ''}
        ${state.prepDay === i ? `<li class="row between"><span><strong>${t('prepMarker')}</strong> <span class="muted">${byRecipe.size === 0 ? t('nothingToCook')
          : [...byRecipe].map(([id, n]) => `${nm(recipeMap().get(id))} × ${fmt(n, 2)}`).join(' · ')}</span></span>
          <button type="button" data-act="tab" data-tab="plan">${t('tabPlan')}</button></li>` : ''}
      </ul></div>`;
  }).join('');
  return `
  <section class="card">
    <div class="row between"><h2>${t('week')} ${shortDate(days[0])} – ${shortDate(days[6])}</h2>
      <span class="row"><button type="button" data-act="week" data-step="-7">${t('prevWeek')}</button>
      <button type="button" data-act="week" data-step="7">${t('nextWeek')}</button></span></div>
    <div class="row">
      <label>${t('shopDayLabel')}${weekdaySelect('shopDay', state.shopDay)}</label>
      <label>${t('prepDayLabel')}${weekdaySelect('prepDay', state.prepDay)}</label>
      <button type="button" data-act="suggestSchedule"${program.days.length === 0 ? ' disabled' : ''}>${t('suggestSchedule')}</button></div>
    <p class="muted">${t('scheduleNote')} ${nm(program)}.</p>
    ${blocks}
    <p class="muted">${t('plannedNote')} ${t('assumedNote')}</p>
  </section>`;
}

// ---------- assistant (local AI) ----------
// ui.ai: { state: 'checking' | 'ready' | 'off', model, reason }, ui.aiBusy, ui.aiText, ui.aiResult
function viewAssistant() {
  const ai = ui.ai;
  const r = ui.aiResult;
  const dayIndexOf = (date) => weekDates().indexOf(date);
  let result = '';
  if (r && !r.ok) {
    result = `<p role="status">${t(r.error === 'timeout' ? 'aiTimeout' : r.error === 'cancelled' ? 'aiCancelled' : r.error === 'busy' ? 'aiBusyElsewhere' : 'aiFailed')}</p>`;
  } else if (r && r.actions.length === 0) {
    result = `<p role="status">${t('aiNothing')}</p>${r.rejected ? `<p class="muted">${r.rejected} ${t('aiRejected')}</p>` : ''}`;
  } else if (r) {
    const byDate = new Map();
    for (const a of r.actions) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
    result = `<h3>${t('aiProposal')}</h3>
      <ul class="plain">${r.actions.map((a, i) => {
        const recipe = recipeMap().get(a.recipeId);
        return `<li class="row between"><span><strong>${t('days')[dayIndexOf(a.date)]} ${shortDate(a.date)}:</strong> ${nm(recipe)} × ${fmt(a.servings, 2)}
          <span class="muted">${macroLine(N.multiply(N.perServing(recipe, foods), a.servings))}</span> ${avoidTag(recipe)}</span>
          <button type="button" class="ghost danger" data-act="aiDrop" data-index="${i}" aria-label="${t('remove')}">✕</button></li>`;
      }).join('')}</ul>
      <div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th class="n">kcal</th><th class="n">Protein</th></tr></thead><tbody>
      ${[...byDate].map(([date, list]) => {
        const before = N.sum(state.plan.filter((e) => e.date === date && e.status !== 'skipped').map(entryNutrients));
        const after = N.sum([before, ...list.map((a) => N.multiply(N.perServing(recipeMap().get(a.recipeId), foods), a.servings))]);
        return `<tr><td>${t('days')[dayIndexOf(date)]} ${shortDate(date)}</td><td class="n">${fmt(before.kcal)} → <strong>${fmt(after.kcal)}</strong></td><td class="n">${fmt(before.protein)} → <strong>${fmt(after.protein)} g</strong></td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="muted">${t('aiTargets')}: ${state.goal.kcal} kcal · ${state.goal.protein} g protein. ${t('aiNumbersNote')}${r.rejected ? ` ${r.rejected} ${t('aiRejected')}` : ''}</p>
      <div class="row"><button type="button" class="primary" data-act="aiApply">${t('aiApply')}</button>
        <button type="button" data-act="aiDiscard">${t('aiDiscard')}</button></div>`;
  }
  return `<section class="card"><h2>${t('aiTitle')} <span class="tag ${ai.state === 'ready' ? 'confirmed' : 'skipped'}">${ai.state === 'ready' ? `${t('aiLocal')} · ${esc(ai.model)}` : ai.state === 'checking' ? t('aiChecking') : t('aiOff')}</span></h2>
    ${ai.state === 'off' ? `<p>${t(ai.reason === 'model-missing' ? 'aiOffModel' : ai.reason === 'server' ? 'aiOffServer' : 'aiOffRuntime')} ${t('aiOffRest')}</p>
      <div class="row"><button type="button" data-act="aiRecheck">${t('aiRecheck')}</button></div>` : `
    <label>${t('aiPrompt')}<textarea id="ai-text" rows="2" maxlength="400" placeholder="${t('aiExample')}"${ui.aiBusy ? ' disabled' : ''}>${esc(ui.aiText ?? '')}</textarea></label>
    <div class="row"><button type="button" class="primary" data-act="aiAsk"${ai.state !== 'ready' || ui.aiBusy ? ' disabled' : ''}>${ui.aiBusy ? t('aiWorking') : t('aiAsk')}</button>
      ${ui.aiBusy ? `<button type="button" data-act="aiCancel">${t('aiCancel')}</button>` : ''}</div>
    <div aria-live="polite">${result}</div>`}
    <p class="muted">${t('aiNotice')}</p></section>`;
}

let aiAbort = null;
async function checkAssistant() {
  ui.ai = { state: 'checking' };
  const s = await assistant.status();
  ui.ai = s.available ? { state: 'ready', model: s.model } : { state: 'off', reason: s.reason };
  if (ui.tab === 'plan') render();
}

const VIEWS = { home: viewHome, week: viewWeek, plan: viewPlan, shop: viewShop, train: viewTrain, weight: viewWeight, settings: viewSettings };
const TAB_LABELS = { home: 'tabHome', week: 'tabWeek', plan: 'tabPlan', shop: 'tabShop', train: 'tabTrain', weight: 'tabWeight', settings: 'tabSettings' };
// Short labels and line icons for the bottom bar on phones. The icons are drawn for this project.
const TAB_SHORT = { home: 'navHome', week: 'navWeek', plan: 'navPlan', shop: 'navShop', train: 'navTrain', weight: 'navWeight', settings: 'navSettings' };
const TAB_ICONS = {
  home: 'M3 11l9-7 9 7v9h-6v-6H9v6H3z',
  week: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  plan: 'M4 11h16a8 8 0 0 1-16 0z M9 7c0-2 2-2 2-4 M14 7c0-2 2-2 2-4',
  shop: 'M6 8h12l-1 12H7z M9 8V6a3 3 0 0 1 6 0v2',
  train: 'M3 9v6 M6 7v10 M18 7v10 M21 9v6 M6 12h12',
  weight: 'M4 17l5-6 4 3 7-9 M4 20h16',
  settings: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 5v4 M8 15v4',
};
/** Installed on the home screen (iOS reports it through navigator.standalone). */
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function render() {
  const main = document.getElementById('view');
  const focusables = () => [...main.querySelectorAll('button, select, input, textarea')];
  const typed = document.getElementById('ai-text');
  if (typed) ui.aiText = typed.value;
  // Remember WHICH control had focus (not its position): after a change the list may be longer or
  // shorter, and a keyboard user must not land on a neighbouring button.
  const keyOf = (el) => (el.id ? `#${el.id}` : el.dataset?.act ? JSON.stringify([el.tagName, Object.entries(el.dataset).sort()]) : null);
  const hadFocus = main.contains(document.activeElement) && document.activeElement !== main;
  const focusKey = hadFocus ? keyOf(document.activeElement) : null;
  document.documentElement.lang = state.lang;
  document.getElementById('title').textContent = t('title');
  document.getElementById('lang').textContent = t('langButton');
  document.getElementById('tabs').setAttribute('aria-label', t('sections'));
  document.getElementById('tabs').innerHTML = Object.keys(VIEWS)
    .map((k) => `<button type="button" data-act="tab" data-tab="${k}" aria-label="${t(TAB_LABELS[k])}"${ui.tab === k ? ' aria-current="page"' : ''}><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${TAB_ICONS[k]}"/></svg><span class="lbl-long">${t(TAB_LABELS[k])}</span><span class="lbl-short" aria-hidden="true">${t(TAB_SHORT[k])}</span></button>`).join('');
  let body;
  try {
    body = VIEWS[ui.tab]();
  } catch (err) {
    console.error(err);
    body = `<section class="card" role="alert"><h2>${t('viewError')}</h2><p>${t('viewErrorHelp')}</p>
      <div class="row"><button type="button" data-act="export">${t('exportData')}</button></div></section>`;
  }
  main.innerHTML = (ui.flash ? `<p class="card" role="status">${esc(ui.flash)}</p>` : '') + body;
  document.getElementById('notice').textContent = `${DATA_NOTICE[state.lang]} ${t('disclaimer')}`;
  ui.flash = '';
  if (hadFocus) {
    const again = focusKey ? focusables().find((el) => keyOf(el) === focusKey && !el.disabled) : null;
    if (again) again.focus({ preventScroll: true });
    else main.focus({ preventScroll: true }); // the control is gone (e.g. a removed row): stay in the view, on nothing
  }
}

// ---------- actions ----------
/** Undo everything confirming a meal took: raw ingredients back to the pantry, portions back to their batch. */
function release(entry) {
  if (entry.consumed) {
    for (const [id, g] of Object.entries(entry.consumed)) state.pantry[id] = (state.pantry[id] ?? 0) + g;
    delete entry.consumed;
  }
  if (entry.fromBatch) {
    state.batches = B.giveBack(state.batches, entry.fromBatch);
    delete entry.fromBatch;
  }
  delete entry.snapshot;
}

function setStatus(entry, status) {
  if (entry.status === status) return;
  if (entry.status === 'confirmed') release(entry);
  if (status === 'confirmed') {
    const takes = B.allocate([entry], state.batches, todayISO()).get(entry.id);
    if (takes) {
      // Eaten from cooked portions: the ingredients left the pantry when the batch was cooked.
      entry.snapshot = structuredClone(state.batches.find((b) => b.id === takes[0].batchId).snapshot);
      state.batches = B.take(state.batches, takes);
      entry.fromBatch = takes;
    } else {
      const used = S.aggregateNeeds([{ recipeId: entry.recipeId, servings: entry.servings }], recipeMap());
      const result = I.consume(pantryMap(), used);
      entry.consumed = Object.fromEntries([...used].map(([id, g]) => [id, g - (result.shortages.get(id) ?? 0)]).filter(([, g]) => g > 0));
      state.pantry = Object.fromEntries(result.pantry);
      // Freeze what was eaten: later edits to the recipe must not rewrite a confirmed meal.
      entry.snapshot = snapshotOf(recipeMap().get(entry.recipeId));
    }
  }
  entry.status = status;
}

const clickActions = {
  tab: (el) => { ui.tab = el.dataset.tab; render(); document.getElementById('view').focus({ preventScroll: true }); window.scrollTo(0, 0); },
  week: (el) => { ui.week = K.addDays(ui.week, Number(el.dataset.step)); ui.aiResult = null; render(); },
  setLang: (el) => { state.lang = el.dataset.lang; commit(); },
  addMeal: (el) => {
    const date = el.dataset.date;
    const servings = num(document.getElementById(`add-servings-${date}`).value);
    if (servings == null || servings <= 0 || servings > 50) return commit(t('invalid'));
    state.plan.push({ id: crypto.randomUUID(), date, recipeId: document.getElementById(`add-recipe-${date}`).value, servings, status: 'assumed' });
    commit();
  },
  removeMeal: (el) => {
    const entry = state.plan.find((e) => e.id === el.dataset.id);
    if (entry?.status === 'confirmed') release(entry); // return what it took
    state.plan = state.plan.filter((e) => e.id !== el.dataset.id);
    commit();
  },
  status: (el) => {
    const entry = state.plan.find((e) => e.id === el.dataset.id);
    if (entry && recipeMap().has(entry.recipeId)) setStatus(entry, el.dataset.status);
    commit();
  },
  newRecipe: () => {
    const id = `r-${crypto.randomUUID()}`;
    state.recipes.push({ id, name: { da: t('newRecipeName'), en: t('newRecipeName') }, servings: 4, ingredients: [], custom: true });
    ui.recipeId = id;
    commit();
  },
  deleteRecipe: () => {
    if (seedRecipes.has(ui.recipeId) || !confirm(t('confirmDeleteRecipe'))) return;
    // Planned meals of this recipe go too. Confirmed meals are history: they stay, with their snapshot.
    state.plan = state.plan.filter((e) => e.recipeId !== ui.recipeId || (e.status === 'confirmed' && e.snapshot));
    state.recipes = state.recipes.filter((r) => r.id !== ui.recipeId);
    ui.recipeId = state.recipes[0].id;
    commit();
  },
  addIngredient: () => {
    const foodId = foodLabels().toId.get(document.getElementById('new-food').value.trim().toLowerCase());
    const grams = num(document.getElementById('new-grams').value);
    if (!foodId) return commit(t('foodNotFound'));
    if (grams == null || grams <= 0 || grams > 100000) return commit(t('invalid'));
    state.recipes = state.recipes.map((r) => (r.id === ui.recipeId ? N.addIngredient(r, { foodId, grams }) : r));
    commit();
  },
  removeIngredient: (el) => {
    state.recipes = state.recipes.map((r) => (r.id === ui.recipeId ? N.removeIngredient(r, Number(el.dataset.index)) : r));
    commit();
  },
  resetRecipe: () => {
    state.recipes = state.recipes.map((r) => (r.id === ui.recipeId ? structuredClone(seedRecipes.get(r.id)) : r));
    commit();
  },
  bought: () => {
    state.pantry = Object.fromEntries(I.applyPurchase(pantryMap(), shoppingLines()));
    commit(t('boughtDone'));
  },
  examplePrices: () => {
    // Made-up demo figures (kr. per pack) — flagged as examples, never shown as observed prices.
    const demo = { chicken: 6500, beef: 3500, salmon: 4500, tofu: 2000, eggs: 2800, skyr: 2200, milk: 1300, rice: 1600, pasta: 1200, oats: 1400, potato: 1800, broccoli: 1200, carrot: 1000, onion: 1000, tomato: 600, beans: 700, banana: 1500, oil: 5500 };
    for (const [key, priceOre] of Object.entries(demo)) {
      const id = LEGACY_IDS[key];
      if (!state.prices[id]) state.prices[id] = { priceOre, priceDate: todayISO(), example: true };
    }
    commit();
  },
  cook: () => {
    const recipe = recipeMap().get(ui.recipeId);
    const servings = num(document.getElementById('cook-servings').value);
    if (!recipe || recipe.ingredients.length === 0 || servings == null || servings <= 0 || servings > 200) return commit(t('invalid'));
    const r = B.cook(pantryMap(), recipe, servings);
    state.pantry = Object.fromEntries(r.pantry);
    state.batches.push({ id: `b-${crypto.randomUUID()}`, recipeId: recipe.id, snapshot: snapshotOf(recipe), cookedDate: todayISO(), servings, servingsLeft: servings, useBy: null, consumed: r.consumed });
    commit(r.shortages.size ? `${t('cooked')} ${r.shortages.size} ${t('cookedShort')}` : t('cooked'));
  },
  undoBatch: (el) => {
    const b = state.batches.find((x) => x.id === el.dataset.id);
    if (!b || b.servingsLeft < b.servings) return commit(t('invalid'));
    for (const [id, g] of Object.entries(b.consumed)) state.pantry[id] = (state.pantry[id] ?? 0) + g; // exactly what cooking took
    state.batches = state.batches.filter((x) => x.id !== b.id);
    commit();
  },
  discardBatch: (el) => {
    if (!confirm(t('confirmDiscardBatch'))) return;
    state.batches = state.batches.filter((x) => x.id !== el.dataset.id);
    commit();
  },
  addAvoid: () => {
    const foodId = foodLabels().toId.get(document.getElementById('avoid-food').value.trim().toLowerCase());
    if (!foodId) return commit(t('foodNotFound'));
    if (state.goal.avoid.length >= 100) return commit(t('invalid'));
    if (!state.goal.avoid.includes(foodId)) state.goal.avoid.push(foodId);
    commit();
  },
  removeAvoid: (el) => { state.goal.avoid = state.goal.avoid.filter((id) => id !== el.dataset.food); commit(); },
  suggestSchedule: () => { state.schedule = P.suggestSchedule(currentProgram().days.length); commit(t('scheduleSuggested')); },
  openTraining: (el) => {
    Object.assign(ui, { tab: 'train', trainDate: el.dataset.date, dayIndex: el.dataset.day === '' ? ui.dayIndex : Number(el.dataset.day) });
    render();
    document.getElementById('view').focus();
  },
  aiAsk: async () => {
    const text = (document.getElementById('ai-text')?.value ?? '').trim();
    if (!text || ui.aiBusy || ui.ai.state !== 'ready') return;
    const ctx = {
      text, lang: state.lang, today: todayISO(), dates: weekDates(),
      recipes: state.recipes.slice(0, 60).map((r) => ({ id: r.id, name: r.name.da === r.name.en ? r.name.da : `${r.name.da} / ${r.name.en}` })),
    };
    Object.assign(ui, { aiBusy: true, aiText: text, aiResult: null });
    aiAbort = new AbortController();
    render();
    const result = await assistant.propose(ctx, aiAbort.signal);
    aiAbort = null;
    // Keep only proposals that still make sense for the data as it is now.
    if (result.ok) result.actions = result.actions.filter((a) => recipeMap().has(a.recipeId) && weekDates().includes(a.date));
    Object.assign(ui, { aiBusy: false, aiResult: result });
    render();
  },
  aiCancel: () => { aiAbort?.abort(); },
  aiDrop: (el) => { ui.aiResult.actions.splice(Number(el.dataset.index), 1); if (ui.aiResult.actions.length === 0) ui.aiResult = null; render(); },
  aiDiscard: () => { ui.aiResult = null; render(); },
  aiApply: () => {
    const actions = (ui.aiResult?.ok ? ui.aiResult.actions : []).filter((a) => recipeMap().has(a.recipeId));
    if (actions.length === 0) return;
    for (const a of actions) state.plan.push({ id: crypto.randomUUID(), date: a.date, recipeId: a.recipeId, servings: a.servings, status: 'assumed' });
    Object.assign(ui, { aiResult: null, aiText: '' });
    commit(`${actions.length} ${t('aiApplied')}`);
  },
  aiRecheck: () => { checkAssistant(); render(); },
  pickDay: (el) => { ui.dayIndex = Number(el.dataset.index); render(); },
  prefill: (el) => {
    const prev = T.lastSet(state.workouts, el.dataset.ex);
    Object.assign(ui, { lastExercise: el.dataset.ex, lastReps: Number(el.dataset.reps), lastKg: prev?.kg ?? '' });
    render();
    document.getElementById('log-card').scrollIntoView({ block: 'start' });
    document.getElementById('set-kg').focus();
  },
  newProgram: () => {
    const base = currentProgram();
    const id = `g-${crypto.randomUUID()}`;
    const name = `${base.name[state.lang]} (${t('copyWord')})`.slice(0, 80);
    state.programs.push({ id, name: { da: name, en: name }, custom: true, days: structuredClone(base.days) });
    state.templateId = id;
    commit(t('programCopied'));
  },
  deleteProgram: () => {
    if (!ownProgram() || !confirm(t('confirmDeleteProgram'))) return;
    state.programs = state.programs.filter((p) => p.id !== state.templateId);
    state.templateId = TEMPLATES[0].id;
    ui.dayIndex = 0;
    commit();
  },
  addDay: () => {
    const own = ownProgram();
    if (!own || own.days.length >= 14) return commit(t('invalid'));
    own.days.push({ name: `${t('programDay')} ${own.days.length + 1}`, exercises: [] });
    commit();
  },
  removeDay: (el) => {
    const own = ownProgram();
    if (!own) return;
    own.days.splice(Number(el.dataset.day), 1);
    ui.dayIndex = 0;
    commit();
  },
  addPlanExercise: (el) => {
    const own = ownProgram();
    const di = Number(el.dataset.day);
    const exerciseId = document.getElementById(`plan-ex-${di}`).value;
    if (!own?.days[di] || !exMap().has(exerciseId) || own.days[di].exercises.length >= 30) return commit(t('invalid'));
    own.days[di].exercises.push({ exerciseId, sets: 3, reps: 8 });
    commit();
  },
  removePlanExercise: (el) => {
    ownProgram()?.days[Number(el.dataset.day)]?.exercises.splice(Number(el.dataset.index), 1);
    commit();
  },
  addExercise: () => {
    const name = document.getElementById('new-exercise').value.trim();
    if (!name || name.length > 80) return commit(t('invalid'));
    if (allExercises().some((x) => x.name.da.toLowerCase() === name.toLowerCase() || x.name.en.toLowerCase() === name.toLowerCase())) return commit(t('exerciseExists'));
    const id = `x-${crypto.randomUUID()}`;
    state.exercises.push({ id, name: { da: name, en: name } });
    ui.lastExercise = id;
    commit();
  },
  deleteExercise: (el) => {
    if (exerciseInUse(el.dataset.id)) return commit(t('exerciseInUse'));
    state.exercises = state.exercises.filter((x) => x.id !== el.dataset.id);
    commit();
  },
  downloadRescue: () => {
    const raw = store.rescued();
    if (raw == null) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    a.download = `fitness-rescued-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  discardRescue: () => {
    if (!confirm(t('confirmDiscardRescue'))) return;
    store.clearRescued();
    render();
  },
  logSet: () => {
    const exerciseId = document.getElementById('set-exercise').value;
    const reps = num(document.getElementById('set-reps').value);
    const kg = num(document.getElementById('set-kg').value);
    if (!Number.isInteger(reps) || reps < 1 || reps > 100 || kg == null || kg <= 0 || kg > 1000) return commit(t('invalid'));
    let log = state.workouts.find((w) => w.date === ui.trainDate && w.exerciseId === exerciseId);
    if (!log) state.workouts.push((log = { date: ui.trainDate, exerciseId, sets: [] }));
    log.sets.push({ reps, kg, confirmed: true });
    Object.assign(ui, { lastExercise: exerciseId, lastReps: reps, lastKg: kg });
    commit();
  },
  removeSet: (el) => {
    const log = state.workouts.find((w) => w.date === ui.trainDate && w.exerciseId === el.dataset.ex);
    if (log) log.sets.splice(Number(el.dataset.index), 1);
    state.workouts = state.workouts.filter((w) => w.sets.length > 0);
    commit();
  },
  logWeight: () => {
    const date = document.getElementById('w-date').value;
    const kg = num(document.getElementById('w-kg').value);
    if (!isISODate(date) || kg == null || kg < 20 || kg > 400) return commit(t('invalid'));
    state.weights = state.weights.filter((w) => w.date !== date).concat({ date, kg, source: 'measured' });
    commit();
  },
  removeWeight: (el) => { state.weights = state.weights.filter((w) => w.date !== el.dataset.date); commit(); },
  export: async () => {
    const name = `fitness-export-${todayISO()}.json`;
    const text = JSON.stringify(state, null, 2);
    // An installed app on a phone has no download folder to show: hand the file to the system's
    // share sheet instead ("Save to Files", AirDrop, mail …). Elsewhere, download as before.
    if (isInstalled() && typeof File === 'function' && navigator.canShare) {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return; // the user closed the share sheet
        }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  deleteAll: () => {
    if (!confirm(t('confirmDelete'))) return;
    const lang = state.lang;
    store.clear();
    state = { ...store.freshState(), lang };
    Object.assign(ui, { recipeId: state.recipes[0].id, dayIndex: 0 });
    commit(t('deleted'));
  },
};

const changeActions = {
  goal: (el) => {
    if (el.dataset.field === 'type') state.goal.type = el.value;
    else {
      const v = num(el.value);
      if (v == null || v <= 0 || v > 20000) return commit(t('invalid'));
      state.goal[el.dataset.field] = Math.round(v);
    }
    commit();
  },
  pickRecipe: (el) => { ui.recipeId = el.value; render(); },
  recipeName: (el) => {
    const name = el.value.trim();
    if (!name || seedRecipes.has(ui.recipeId)) return commit(t('invalid'));
    state.recipes = state.recipes.map((r) => (r.id === ui.recipeId ? { ...r, name: { da: name, en: name } } : r));
    commit();
  },
  recipeServings: (el) => {
    const servings = num(el.value);
    if (servings == null || servings <= 0 || servings > 100 || seedRecipes.has(ui.recipeId)) return commit(t('invalid'));
    state.recipes = state.recipes.map((r) => (r.id === ui.recipeId ? { ...r, servings } : r));
    commit();
  },
  swapFood: (el) => {
    const foodId = foodLabels().toId.get(el.value.trim().toLowerCase());
    if (!foodId) return commit(t('foodNotFound'));
    updateRecipe(Number(el.dataset.index), { foodId });
  },
  cookedGrams: (el) => {
    const g = el.value.trim() === '' ? null : num(el.value);
    if (el.value.trim() !== '' && (g == null || g < 1 || g > 1e6)) return commit(t('invalid'));
    state.recipes = state.recipes.map((r) => {
      if (r.id !== ui.recipeId) return r;
      const next = { ...r };
      if (g == null) delete next.cookedGrams; else next.cookedGrams = g;
      return next;
    });
    commit();
  },
  pack: (el) => {
    const id = el.dataset.food;
    if (el.value.trim() === '') delete state.packs[id];
    else {
      const g = num(el.value);
      if (g == null || g <= 0 || g > 100000) return commit(t('invalid'));
      state.packs[id] = g;
    }
    commit();
  },
  swapGrams: (el) => {
    const grams = num(el.value);
    if (grams == null || grams < 0 || grams > 100000) return commit(t('invalid'));
    updateRecipe(Number(el.dataset.index), { grams });
  },
  price: (el) => {
    const id = el.dataset.food;
    if (el.value.trim() === '') delete state.prices[id];
    else {
      const ore = S.parseKroner(el.value);
      if (ore == null) return commit(t('invalid'));
      state.prices[id] = { priceOre: ore, priceDate: todayISO() };
    }
    commit();
  },
  pantry: (el) => {
    const g = num(el.value);
    if (g == null || g < 0 || g > 1e6) return commit(t('invalid'));
    if (g === 0) delete state.pantry[el.dataset.food];
    else state.pantry[el.dataset.food] = g;
    commit();
  },
  template: (el) => { state.templateId = el.value; ui.dayIndex = 0; commit(); },
  schedule: (el) => {
    if (el.value === '') delete state.schedule[el.dataset.weekday];
    else state.schedule[el.dataset.weekday] = Number(el.value);
    commit();
  },
  shopDay: (el) => { state.shopDay = el.value === '' ? null : Number(el.value); commit(); },
  prepDay: (el) => { state.prepDay = el.value === '' ? null : Number(el.value); commit(); },
  pantryDate: (el) => {
    if (el.value === '') delete state.pantryDates[el.dataset.food];
    else if (isISODate(el.value)) state.pantryDates[el.dataset.food] = el.value;
    else return commit(t('invalid'));
    commit();
  },
  batchUseBy: (el) => {
    const b = state.batches.find((x) => x.id === el.dataset.id);
    if (!b || !(el.value === '' || isISODate(el.value))) return commit(t('invalid'));
    b.useBy = el.value === '' ? null : el.value;
    commit();
  },
  pickExercise: (el) => {
    const prev = T.lastSet(state.workouts, el.value);
    Object.assign(ui, { lastExercise: el.value, lastReps: prev?.reps ?? ui.lastReps, lastKg: prev?.kg ?? '' });
    render();
  },
  programName: (el) => {
    const own = ownProgram();
    const name = el.value.trim();
    if (!own || !name) return commit(t('invalid'));
    own.name = { da: name, en: name };
    commit();
  },
  dayName: (el) => {
    const d = ownProgram()?.days[Number(el.dataset.day)];
    const name = el.value.trim();
    if (!d || !name) return commit(t('invalid'));
    d.name = name;
    commit();
  },
  planSets: (el) => setPlanNumber(el, 'sets', 20),
  planReps: (el) => setPlanNumber(el, 'reps', 100),
  trainDate: (el) => { if (isISODate(el.value)) ui.trainDate = el.value; render(); },
  import: async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    const imported = store.parseImport(await file.text());
    if (!imported) { el.value = ''; return commit(t('importFailed')); }
    state = imported;
    Object.assign(ui, { recipeId: state.recipes[0].id, dayIndex: 0, lastExercise: undefined, lastReps: undefined, lastKg: undefined });
    el.value = '';
    commit(t('importDone'));
  },
};

function setPlanNumber(el, field, max) {
  const x = ownProgram()?.days[Number(el.dataset.day)]?.exercises[Number(el.dataset.index)];
  const v = num(el.value);
  if (!x || !Number.isInteger(v) || v < 1 || v > max) return commit(t('invalid'));
  x[field] = v;
  commit();
}

function updateRecipe(index, change) {
  state.recipes = state.recipes.map((r) => (r.id === ui.recipeId ? N.swapIngredient(r, index, change) : r));
  commit();
}

// Every action re-renders the view. An edited field reports its change at the moment it loses
// focus — which is often in the middle of a click on a button, or a Tab to the next field. If we
// re-rendered right then, the button under the pointer would be replaced and the click lost, and
// the keyboard focus would fall off the page. So a field's change waits:
//  - while a pointer is down, until the click it belongs to arrives (then: change first, click second);
//  - otherwise one tick, so focus has already reached the next control and can be kept there.
let pointerDown = false;
let pendingChanges = [];
const flushChanges = () => {
  const run = pendingChanges;
  pendingChanges = [];
  for (const fn of run) fn();
};
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => setTimeout(() => { pointerDown = false; flushChanges(); }, 0), true);
}
document.addEventListener('click', (ev) => {
  // Take what we need from the clicked control before a pending change re-renders the view.
  const el = ev.target.closest('[data-act]');
  flushChanges();
  if (el && clickActions[el.dataset.act]) clickActions[el.dataset.act](el);
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || !changeActions[el.dataset.act]) return;
  pendingChanges.push(() => changeActions[el.dataset.act](el));
  if (!pointerDown) setTimeout(flushChanges, 0);
});
document.getElementById('lang').addEventListener('click', () => {
  state.lang = state.lang === 'da' ? 'en' : 'da';
  commit();
});

if (loaded.rescued) ui.flash = t('rescuedFlash');
render();
checkAssistant();
// Offline support. Only available on a secure address (https or this PC); the app works without it.
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
