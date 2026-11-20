// Prototype UI. All arithmetic comes from ../core — this file only reads state, calls core, renders.
import * as N from '../core/nutrition.js';
import * as S from '../core/shopping.js';
import * as I from '../core/inventory.js';
import * as T from '../core/training.js';
import * as K from '../core/tracking.js';
import * as B from '../core/batches.js';
import * as P from '../core/planning.js';
import { FOODS, MICRO_UNITS, microTotals, addMicroTotals, againstReference } from '../core/foods.js';
import { RECIPES, EXERCISES, TEMPLATES, DATA_NOTICE, DEFAULT_PACKS, LEGACY_IDS, SECTIONS, sectionOf, byId } from '../core/seed.js';
import { STRINGS } from './i18n.js';
import * as store from './store.js';
import * as assistant from './assistant.js';
import { snapshotOf, recipeForEntry, isISODate } from '../core/state.js';
import { recipeLabel, applyActions } from '../core/assistant.js';

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
/** Grams per food that can be used today: stock past the user's own date is not counted. */
const pantryMap = () => I.totals(state.lots, todayISO());
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
const mealOptions = (selected) => `<option value="">${t('mealNone')}</option>` + P.MEAL_TYPES.map((m) => `<option value="${m}"${m === selected ? ' selected' : ''}>${t(m)}</option>`).join('');
const isFavourite = (id) => state.favorites.includes(id);
/** Recipes for a picker: favourites first, marked with a star. */
const recipeOptions = (selected) => options(P.favouritesFirst(state.recipes, state.favorites), selected, (r) => `${isFavourite(r.id) ? '★ ' : ''}${nm(r)}`);
const options = (list, selected, label = nm) =>
  list.map((x) => `<option value="${esc(x.id)}"${x.id === selected ? ' selected' : ''}>${label(x)}</option>`).join('');

function commit(flash = '') {
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
/** Micronutrients of planned meals (not skipped) against the EU labelling reference values. */
function microCard(title, entries, days) {
  if (entries.length === 0 || !(days > 0)) return '';
  const totals = addMicroTotals(entries.map((e) => { const r = entryRecipe(e); return microTotals(r.ingredients, foods, e.servings / r.servings); }));
  const rows = againstReference(totals, days);
  return `<details><summary>${title}</summary>
    <div class="tablewrap"><table><thead><tr><th></th><th class="n">${days > 1 ? t('perDayWord') : t('amount')}</th><th class="n">${t('ofReference')}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${t('micro')[r.key]}</td><td class="n">${r.unknown ? '≥ ' : ''}${fmt(r.perDay, r.perDay < 10 ? 2 : 0)} ${MICRO_UNITS[r.key]}</td>
        <td class="n">${r.percent == null ? `<span class="muted">${t('noReference')}</span>` : `${r.unknown ? '≥ ' : ''}${fmt(r.percent)} %`}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted">${t('referenceNote')} ${t('microNote')}</p></details>`;
}

/** A text with {placeholders} filled in. */
const tf = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k]);
/** The week summary as sentences. Put together from the app's own numbers; no AI is involved. */
function weekWords(sum) {
  const out = [];
  out.push(sum.meals.total === 0 ? t('wwNoMeals') : tf('wwMeals', { c: sum.meals.confirmed, n: sum.meals.total, a: sum.meals.assumed, s: sum.meals.skipped }));
  if (sum.meals.total > 0) {
    out.push(sum.confirmedDays === 0 ? t('wwNoFood') : tf('wwFood', { d: sum.confirmedDays, kcal: fmt(sum.confirmed.kcal / sum.confirmedDays), protein: fmt(sum.confirmed.protein / sum.confirmedDays), gk: state.goal.kcal, gp: state.goal.protein }));
  }
  out.push(sum.sets === 0 ? t('wwNoTraining') : tf('wwTraining', { sets: sum.sets, days: sum.trainingDays, kg: fmt(sum.volumeKg) }));
  out.push(sum.weighIns === 0 ? t('wwNoWeight') : sum.weightChangeKg == null ? t('wwOneWeight') : tf('wwWeight', { delta: signed(sum.weightChangeKg, 1), n: sum.weighIns }));
  return out.join(' ');
}
const signed = (x, digits) => `${x > 0 ? '+' : ''}${fmt(x, digits)}`;
/** Tag for a deadline the user set: days left, or that it has passed. */
function deadlineTag(date) {
  if (!date) return '';
  const d = P.daysBetween(todayISO(), date);
  return d < 0 ? `<span class="tag expired">${t('deadlinePassed')} ${shortDate(date)}</span>` : `<span class="muted">${shortDate(date)} · ${d} ${t(d === 1 ? 'dayLeft' : 'daysLeft')}</span>`;
}
/** The weight target against the logged weigh-ins. Arithmetic only. */
function targetLine() {
  const g = state.goal;
  if (g.targetKg == null) return '';
  const s = K.weightGoalStatus(state.weights, g.targetKg, g.deadline, todayISO());
  if (!s) return `<p class="muted">${t('targetNoWeight')}</p>`;
  if (s.reached) return `<p><span class="tag confirmed">${t('targetReached')}</span> <span class="muted">${t('trendNow')}: ${fmt(s.currentKg, 1)} kg</span></p>`;
  return `<p>${t('trendNow')}: <strong>${fmt(s.currentKg, 1)} kg</strong> · <strong>${signed(s.remainingKg, 1)} kg</strong> ${t('targetLeft')}
    ${g.deadline ? ` · ${deadlineTag(g.deadline)}` : ''}${s.perWeekKg != null ? ` · ${t('perWeekNeeded')}: <strong>${signed(s.perWeekKg, 2)} kg</strong>` : ''}</p>
    <p class="muted">${t('targetNote')}</p>`;
}

function viewHome() {
  const today = todayISO();
  const todays = P.sortMeals(state.plan.filter((e) => e.date === today && e.status !== 'skipped'));
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
  const dated = I.useFirst(state.lots, today).map((l) => l.daysLeft);
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
    <div class="row">
      <label>${t('targetKg')}<input class="num" inputmode="decimal" data-act="goal" data-field="targetKg" value="${g.targetKg ?? ''}"></label>
      <label>${t('deadline')}<input type="date" data-act="goal" data-field="deadline" value="${g.deadline ?? ''}"></label>
    </div>
    ${targetLine()}
    <h3>${t('milestones')}</h3>
    ${state.milestones.length === 0 ? `<p class="muted">${t('milestonesEmpty')}</p>` : `<ul class="plain">${state.milestones.map((m) => `<li class="row between">
      <label class="inline"><input type="checkbox" data-act="milestoneDone" data-id="${esc(m.id)}"${m.done ? ' checked' : ''}> <span${m.done ? ' class="muted"' : ''}>${esc(m.text)}</span></label>
      <span class="row">${m.done ? `<span class="tag confirmed">${t('doneTag')}</span>` : deadlineTag(m.date)}
        <button type="button" class="ghost danger" data-act="removeMilestone" data-id="${esc(m.id)}" aria-label="${t('remove')} ${esc(m.text)}">✕</button></span></li>`).join('')}</ul>`}
    <div class="row"><input class="grow" id="ms-text" maxlength="80" aria-label="${t('milestoneText')}" placeholder="${t('milestoneHint')}">
      <input type="date" id="ms-date" aria-label="${t('deadline')}">
      <button type="button" data-act="addMilestone">${t('addMilestone')}</button></div>
    <details><summary>${t('goalHistory')} (${state.goalHistory.length})</summary>
      ${state.goalHistory.length === 0 ? `<p class="muted">${t('goalHistoryEmpty')}</p>` : `<div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th>${t('goalType')}</th><th class="n">kcal</th><th class="n">Protein (g)</th></tr></thead><tbody>
        ${[...state.goalHistory].reverse().slice(0, 20).map((h) => `<tr><td>${shortDate(h.date)}${h.date.slice(0, 4)}</td><td>${t(h.type)}</td><td class="n">${h.kcal}</td><td class="n">${h.protein}</td></tr>`).join('')}
      </tbody></table></div>`}</details>
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
    <p class="muted">${statusTag('confirmed')} ${fmt(confirmed.kcal)} kcal · ${statusTag('assumed')} ${fmt(total.kcal - confirmed.kcal)} kcal</p>
    ${microCard(t('microToday'), todays, 1)}`}
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
    const entries = P.sortMeals(state.plan.filter((e) => e.date === date));
    const total = N.sum(entries.filter((e) => e.status !== 'skipped').map(entryNutrients));
    const targets = [...days.filter((d) => d !== date).map((d) => [d, `${t('days')[days.indexOf(d)]} ${shortDate(d)}`]),
      [K.addDays(date, 7), `${t('days')[i]} ${shortDate(K.addDays(date, 7))} (${t('nextWeekWord')})`]];
    return `<div class="day">
      <div class="row between"><h3>${t('days')[i]} ${shortDate(date)}</h3>
        <span class="muted">${t('dayTotal')}: ${fmt(total.kcal)} / ${state.goal.kcal} kcal · ${fmt(total.protein)} / ${state.goal.protein} g protein</span></div>
      <ul class="plain">${entries.map((e) => `<li class="row between">
        <span><select class="meal" data-act="mealType" data-id="${e.id}" aria-label="${t('mealType')}">${mealOptions(e.meal)}</select>
          <select class="meal" data-act="moveMeal" data-id="${e.id}" aria-label="${t('moveMeal')}"${e.status === 'confirmed' ? ' disabled' : ''}>${days.map((d, di) => `<option value="${d}"${d === date ? ' selected' : ''}>${d === date ? t('days')[di] : `→ ${t('days')[di]}`}</option>`).join('')}</select>
          ${nm(entryRecipe(e))} <span class="muted">× ${fmt(e.servings, 2)} · ${macroLine(entryNutrients(e))}${recipeMap().has(e.recipeId) ? '' : ` · ${t('recipeDeleted')}`}</span>
          ${e.fromBatch ? `<span class="tag confirmed">${t('fromBatchTag')}</span>` : covered.has(e.id) ? `<span class="tag assumed">${t('coveredTag')}</span>` : ''} ${avoidTag(entryRecipe(e))}</span>
        <span class="row">${['assumed', 'confirmed', 'skipped'].map((s) =>
          `<button type="button" data-act="status" data-id="${e.id}" data-status="${s}" aria-pressed="${e.status === s}"${recipeMap().has(e.recipeId) ? '' : ' disabled'}>${t(s)}</button>`).join('')}
          <button type="button" class="ghost danger" data-act="removeMeal" data-id="${e.id}" aria-label="${t('remove')}">✕</button></span></li>`).join('')}</ul>
      <div class="row">
        <select class="meal" aria-label="${t('mealType')}" id="add-meal-${date}">${mealOptions('')}</select>
        <select aria-label="${t('recipes')}" id="add-recipe-${date}">${recipeOptions(ui.recipeId)}</select>
        <input class="num" inputmode="decimal" aria-label="${t('servings')}" id="add-servings-${date}" value="1">
        <button type="button" class="primary" data-act="addMeal" data-date="${date}">${t('addMeal')}</button>
      </div>
      ${entries.length === 0 ? '' : `<div class="row"><label class="inline">${t('copyDayTo')}
        <select id="copy-to-${date}">${targets.map(([d, label]) => `<option value="${d}">${label}</option>`).join('')}</select></label>
        <button type="button" data-act="copyDay" data-date="${date}">${t('copyDo')}</button></div>`}</div>`;
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
    ${weekEntries().length === 0 ? '' : `<div class="row"><button type="button" data-act="copyWeek">${t('copyWeek')}</button></div>`}
    <p class="muted">${t('assumedNote')} ${t('copyNote')}</p>
  </section>
  <section class="card"><h2>${t('editRecipe')}</h2>
    <div class="row"><select data-act="pickRecipe" aria-label="${t('recipes')}">${recipeOptions(ui.recipeId)}</select>
      <button type="button" data-act="favorite" aria-pressed="${isFavourite(ui.recipeId)}">${isFavourite(ui.recipeId) ? '★' : '☆'} ${t('favorite')}</button>
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
  const today = todayISO();
  const bud = budgetText(shoppingLines());
  const days = weekDates();
  // Still to buy first, then what the pantry already covers; grouped by shop section.
  const lines = shoppingLines().map((l, i) => [l, i]).sort((a, b) => (a[0].purchasedGrams > 0 ? 0 : 1) - (b[0].purchasedGrams > 0 ? 0 : 1) || a[1] - b[1]).map(([l]) => l);
  const groups = S.bySection(lines, sectionOf, SECTIONS);
  const sectionName = (s) => t(`sec${s[0].toUpperCase()}${s.slice(1)}`);
  const stock = [...state.lots].sort((a, b) => nm(foods.get(a.foodId)).localeCompare(nm(foods.get(b.foodId)), locale())
    || (a.useBy === null) - (b.useBy === null) || (a.useBy ?? '').localeCompare(b.useBy ?? ''));
  const first = [
    ...I.useFirst(state.lots, today).map((l) => ({ date: l.useBy, text: `${nm(foods.get(l.foodId))} · ${fmt(l.grams)} g` })),
    ...state.batches.filter((b) => b.useBy && b.servingsLeft > 0).map((b) => ({ date: b.useBy, text: `${nm(b.snapshot)} · ${fmt(b.servingsLeft, 2)} ${t('servings').toLowerCase()}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const row = (l) => {
    const p = state.prices[l.foodId];
    const name = nm(foods.get(l.foodId));
    return `<tr><td class="title">${name}</td>
        <td class="n" data-label="${t('need')}">${fmt(l.neededGrams)} g</td><td class="n" data-label="${t('fromPantry')}">${fmt(l.fromPantryGrams)} g</td>
        <td class="n" data-label="${t('packSize')}"><input class="num" inputmode="decimal" data-act="pack" data-food="${l.foodId}" aria-label="${t('packSize')} ${name}" value="${l.packGrams ?? ''}">
          <div class="muted">${state.packs[l.foodId] ? t('packOwn') : l.packGrams ? t('packAssumed') : t('noPack')}</div></td>
        <td class="n" data-label="${t('buy')}">${l.packs > 0 ? `${l.packs} ${t('packs')}` : l.toBuyGrams > 0 ? `${fmt(l.toBuyGrams)} g` : '–'}</td>
        <td class="n" data-label="${t('leftover')}">${fmt(l.leftoverGrams)} g</td>
        <td class="n" data-label="${t('packPrice')}"><input class="num" inputmode="decimal" data-act="price" data-food="${l.foodId}" aria-label="${t('packPrice')} ${name}" value="${p ? S.formatOre(p.priceOre) : ''}">
          <div class="muted">${p ? `${p.example ? t('example') : t('priceFrom')} ${shortDate(p.priceDate)}` : t('noPrice')}</div></td>
        <td class="n" data-label="${t('cost')}">${l.costOre == null ? `<span class="tag assumed">${t('noPrice')}</span>` : kr(l.costOre)}</td>
        <td class="n" data-label="${t('boughtCol')}">${l.purchasedGrams > 0 ? `<input type="date" id="buy-date-${l.foodId}" aria-label="${t('useBy')} ${name} (${t('optionalWord')})">
          <button type="button" data-act="boughtOne" data-food="${l.foodId}" aria-label="${t('boughtOne')}: ${name}">${t('boughtOne')}</button>` : `<span class="tag confirmed">${t('inPantryTag')}</span>`}</td></tr>`;
  };
  return `
  <section class="card">
    <div class="row between"><h2>${t('shoppingList')} · ${shortDate(days[0])} – ${shortDate(days[6])}</h2>
      <span class="row"><button type="button" data-act="week" data-step="-7">${t('prevWeek')}</button>
      <button type="button" data-act="week" data-step="7">${t('nextWeek')}</button></span></div>
    ${lines.length === 0 ? `<p class="muted">${t('shopEmpty')}</p>` : `
    <div class="tablewrap"><table class="stack"><thead><tr><th>${t('food')}</th><th class="n">${t('need')}</th><th class="n">${t('fromPantry')}</th>
      <th class="n">${t('packSize')}</th><th class="n">${t('buy')}</th><th class="n">${t('leftover')}</th><th class="n">${t('packPrice')}</th><th class="n">${t('cost')}</th><th class="n">${t('boughtCol')}</th></tr></thead><tbody>
      ${groups.map((g) => `<tr class="section"><th colspan="9" scope="colgroup">${sectionName(g.section)}</th></tr>${g.lines.map(row).join('')}`).join('')}
      </tbody><tfoot><tr><th colspan="7">${t('total')}</th><th class="n">${bud.main}</th><th></th></tr></tfoot></table></div>
    ${bud.sub ? `<p class="muted">${bud.sub}</p>` : ''}
    <div class="row"><button type="button" class="primary" data-act="bought"${lines.every((l) => l.purchasedGrams === 0) ? ' disabled' : ''}>${t('markBought')}</button>
      <button type="button" data-act="examplePrices">${t('examplePrices')}</button></div>`}
    ${coverage().size ? `<p><span class="tag confirmed">${coverage().size}</span> ${t('coveredNote')}</p>` : ''}
    <p class="muted">${t('shopNote')} ${t('examplePricesNote')} ${t('sectionNote')}</p>
  </section>
  <section class="card"><h2>${t('useFirstTitle')}</h2>
    ${first.length === 0 ? `<p class="muted">${t('useFirstEmpty')}</p>` : `<ul class="plain">${first.map((x) => `<li class="row between"><span>${x.text}</span>${dateTag(x.date)}</li>`).join('')}</ul>`}
  </section>
  <section class="card"><h2>${t('pantry')}</h2>
    ${stock.length === 0 ? `<p class="muted">${t('pantryEmpty')}</p>` : `<div class="tablewrap"><table class="stack"><thead><tr><th>${t('food')}</th><th class="n">${t('inStock')}</th><th class="n">${t('useBy')}</th></tr></thead><tbody>
      ${stock.map((l) => `<tr><td class="title">${nm(foods.get(l.foodId))} ${dateTag(l.useBy)}</td><td class="n" data-label="${t('inStock')}"><input class="num" inputmode="decimal" data-act="pantry" data-food="${l.foodId}" data-useby="${l.useBy ?? ''}" aria-label="${t('inStock')} ${nm(foods.get(l.foodId))} ${l.useBy ? shortDate(l.useBy) : ''}" value="${fmt(l.grams, 1).replace(/\s/g, '')}"></td>
        <td class="n" data-label="${t('useBy')}"><input type="date" data-act="pantryDate" data-food="${l.foodId}" data-useby="${l.useBy ?? ''}" aria-label="${t('useBy')} ${nm(foods.get(l.foodId))} ${l.useBy ? shortDate(l.useBy) : ''}" value="${l.useBy ?? ''}"></td></tr>`).join('')}
    </tbody></table></div>`}
    <p class="muted">${t('lotNote')} ${t('dateNote')}</p>
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
  const suggestion = T.suggestNext(state.workouts, selected, day?.exercises.find((x) => x.exerciseId === selected)?.reps);
  const history = T.exerciseHistory(state.workouts, selected);
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
      <label>${t('rir')}<select id="set-rir"><option value="">–</option>${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
      <label class="grow">${t('setNote')}<input id="set-note" maxlength="200"></label>
      <button type="button" class="primary" data-act="logSet">${t('logSet')}</button>
    </div>
    <p class="muted">${last ? `${t('lastTime')}: ${fmt(last.kg, 2)} kg × ${last.reps} (${shortDate(last.date)})` : t('neverLogged')}</p>
    ${suggestion ? `<p><span class="tag assumed">${t('suggestionTag')}</span> ${t('nextTime')}: <strong>${fmt(suggestion.kg, 2)} kg × ${suggestion.reps}</strong>
      <span class="muted">· ${t(`sug${suggestion.reason[0].toUpperCase()}${suggestion.reason.slice(1)}`)} (${shortDate(suggestion.from.date)}: ${fmt(suggestion.from.kg, 2)} kg × ${suggestion.from.reps.join(', ')})</span>
      <button type="button" data-act="useSuggestion" data-kg="${suggestion.kg}" data-reps="${suggestion.reps}">${t('useSuggestion')}</button></p>
    <p class="muted">${t('suggestionNote')}</p>` : ''}
    <div class="row">
      <label>${t('restLength')}<select data-act="restSeconds">${REST_CHOICES.map((n) => `<option value="${n}"${n === restSeconds() ? ' selected' : ''}>${n} ${t('secondsWord')}</option>`).join('')}</select></label>
      <strong id="rest-clock" role="timer">${restText()}</strong>
      ${ui.restUntil ? `<button type="button" data-act="restStop">${t('restStop')}</button>` : `<button type="button" data-act="restStart">${t('restStart')}</button>`}
    </div>
    <p class="muted">${t('restNote')}</p>
    <h3>${t('todaysSets')} · ${shortDate(ui.trainDate)}</h3>
    ${logs.length === 0 ? `<p class="muted">${t('noSets')}</p>` : logs.map((log) => `
      <p><strong>${nm(exMap().get(log.exerciseId))}</strong> <span class="muted">${t('volume')}: ${fmt(T.volume(log.sets))} kg</span></p>
      <ul class="plain">${log.sets.map((s, i) => {
        const e1 = T.estimated1RM(s.kg, s.reps);
        return `<li class="row between"><span>${fmt(s.kg, 2)} kg × ${s.reps} ${statusTag('confirmed')}
          ${isPR(log, i) ? `<span class="tag confirmed">${t('prBadge')}</span>` : ''}
          ${e1 ? `<span class="muted">${t('est1rm')}: ${fmt(e1, 1)} kg (${t('estimate')})</span>` : ''}
          ${s.rir != null ? `<span class="muted">· RIR ${s.rir}</span>` : ''}${s.note ? ` <span class="muted">· ${esc(s.note)}</span>` : ''}</span>
          <button type="button" class="ghost danger" data-act="removeSet" data-ex="${esc(log.exerciseId)}" data-index="${i}" aria-label="${t('remove')}">✕</button></li>`;
      }).join('')}</ul>`).join('')}
  </section>
  <section class="card"><h2>${t('progressTitle')} · ${nm(exMap().get(selected))}</h2>
    ${history.length === 0 ? `<p class="muted">${t('neverLogged')}</p>` : `${exerciseChart(history)}
    <div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th class="n">${t('topSet')}</th><th class="n">${t('est1rm')}</th><th class="n">${t('volume')}</th><th class="n">${t('setsWord')}</th></tr></thead><tbody>
      ${history.slice(-8).reverse().map((d) => `<tr><td>${shortDate(d.date)}${d.date.slice(0, 4)}</td><td class="n">${fmt(d.topKg, 2)} kg × ${d.topReps}</td>
        <td class="n">${d.est1RM == null ? '–' : `${fmt(d.est1RM, 1)} kg`}</td><td class="n">${fmt(d.volume)} kg</td><td class="n">${d.sets}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted">${t('progressNote')}</p>`}
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

/** Heaviest logged set per training day for one exercise. */
function exerciseChart(history) {
  if (history.length < 2) return '';
  const W = 600, H = 160, pad = 14;
  const xs = history.map((p) => Date.parse(p.date));
  const ys = history.map((p) => p.topKg);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys) - 1, Math.max(...ys) + 1];
  const X = (v) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const Y = (v) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('progressTitle')}: ${t('topSet')} ${fmt(ys[0], 2)} → ${fmt(ys.at(-1), 2)} kg">
    <polyline class="trend" points="${history.map((p, i) => `${X(xs[i]).toFixed(1)},${Y(p.topKg).toFixed(1)}`).join(' ')}"/>
    ${history.map((p, i) => `<circle class="raw" r="3" cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.topKg).toFixed(1)}"/>`).join('')}</svg>`;
}

// ---------- rest timer (not stored: it is only a clock on the screen) ----------
const REST_CHOICES = [60, 90, 120, 180, 240];
const restSeconds = () => (REST_CHOICES.includes(state.restSeconds) ? state.restSeconds : 120);
const restLeft = () => (ui.restUntil ? Math.ceil((ui.restUntil - Date.now()) / 1000) : null);
function restText() {
  const left = restLeft();
  if (left == null) return '';
  return left > 0 ? `${t('rest')}: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : t('restOver');
}
function startRest() {
  ui.restUntil = Date.now() + restSeconds() * 1000;
  ui.restNotified = false;
}
setInterval(() => {
  const el = document.getElementById('rest-clock');
  if (!ui.restUntil) return;
  if (el) el.textContent = restText();
  if (restLeft() <= 0 && !ui.restNotified) {
    ui.restNotified = true;
    if (el) el.setAttribute('role', 'status'); // read out once by a screen reader
    try { navigator.vibrate?.(300); } catch { /* not available: the text is enough */ }
  }
}, 500);

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
  </section>
  ${viewMeasures()}`;
}

function viewMeasures() {
  const selected = state.measures.some((m) => m.id === ui.measureId) ? ui.measureId : state.measures[0]?.id;
  return `<section class="card"><h2>${t('measuresTitle')}</h2>
    ${state.measures.length === 0 ? `<p class="muted">${t('measuresEmpty')}</p>` : `
    <div class="row">
      <label>${t('date')}<input type="date" id="m-date" value="${todayISO()}"></label>
      <label>${t('measure')}<select id="m-measure">${options(state.measures, selected, (m) => esc(m.name))}</select></label>
      <label>${t('value')}<input class="num" inputmode="decimal" id="m-value"></label>
      <button type="button" class="primary" data-act="logMeasure">${t('save')}</button></div>
    ${state.measures.map((m) => {
      const series = K.measureSeries(state.measurements, m.id);
      const unit = m.unit ? ` ${esc(m.unit)}` : '';
      return `<div class="day"><div class="row between"><h3>${esc(m.name)}</h3>
        <button type="button" class="ghost danger" data-act="removeMeasure" data-id="${esc(m.id)}" aria-label="${t('remove')} ${esc(m.name)}">✕</button></div>
        ${series.length === 0 ? `<p class="muted">${t('noValues')}</p>` : `<div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th class="n">${t('value')}</th><th class="n">${t('changeSinceFirst')}</th><th></th></tr></thead><tbody>
          ${[...series].reverse().slice(0, 8).map((x) => `<tr><td>${shortDate(x.date)}${x.date.slice(0, 4)}</td><td class="n">${fmt(x.value, 1)}${unit}</td><td class="n">${signed(x.change, 1)}${unit}</td>
            <td class="n"><button type="button" class="ghost danger" data-act="removeMeasurement" data-id="${esc(m.id)}" data-date="${x.date}" aria-label="${t('remove')}">✕</button></td></tr>`).join('')}
        </tbody></table></div>`}</div>`;
    }).join('')}`}
    <div class="row"><input class="grow" id="new-measure-name" maxlength="40" aria-label="${t('measureName')}" placeholder="${t('measureNameHint')}">
      <input class="num" id="new-measure-unit" maxlength="10" aria-label="${t('unit')}" placeholder="${t('unitHint')}">
      <button type="button" data-act="addMeasure">${t('addMeasure')}</button></div>
    <p class="muted">${t('measuresNote')}</p>
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
    const meals = P.sortMeals(state.plan.filter((e) => e.date === date));
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
  const sum = K.weekSummary(days, state.plan, entryNutrients, state.workouts, state.weights);
  const weekMeals = weekEntries().filter((e) => e.status !== 'skipped');
  const mealDays = new Set(weekMeals.map((e) => e.date)).size;
  return `
  <section class="card"><h2>${t('weekSummary')} · ${shortDate(days[0])} – ${shortDate(days[6])}</h2>
    <div class="grid">
      <div><div class="stat">${sum.meals.confirmed} / ${sum.meals.total}</div><div class="muted">${t('mealsConfirmed')}</div>
        <div class="muted">${statusTag('assumed')} ${sum.meals.assumed} ${statusTag('skipped')} ${sum.meals.skipped}</div></div>
      <div><div class="stat">${sum.confirmedDays ? `${fmt(sum.confirmed.kcal / sum.confirmedDays)} kcal` : '–'}</div>
        <div class="muted">${t('confirmedPerDay')}${sum.confirmedDays ? ` · ${fmt(sum.confirmed.protein / sum.confirmedDays)} g protein · ${sum.confirmedDays} ${t('daysWord')}` : ''}</div></div>
      <div><div class="stat">${sum.trainingDays}</div><div class="muted">${t('trainingDays')} · ${sum.sets} ${t('setsLogged')} · ${fmt(sum.volumeKg)} kg</div></div>
      <div><div class="stat">${sum.weightChangeKg == null ? '–' : `${signed(sum.weightChangeKg, 1)} kg`}</div><div class="muted">${t('weightTrend')} · ${sum.weighIns} ${t('weighIns')}</div></div>
    </div>
    <p class="muted">${t('weekSummaryNote')}</p>
    <h3>${t('weekWords')}</h3>
    <p>${weekWords(sum)}</p>
    <p class="muted">${t('wwNote')}</p>
    ${microCard(`${t('microWeek')} (${mealDays} ${t('daysWord')})`, weekMeals, mealDays)}
  </section>
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
    // What the plan would look like, worked out by the app from the approved-to-be actions.
    let n = 0;
    const after = applyActions(state.plan, r.actions, () => `sim-${++n}`);
    const affected = [...new Set(r.actions.flatMap((a) => (a.op === 'move' ? [a.date, a.to] : [a.date])))].sort();
    const dayName = (d) => `${t('days')[dayIndexOf(d)]} ${shortDate(d)}`;
    const totalOn = (plan, date) => N.sum(plan.filter((e) => e.date === date && e.status !== 'skipped').map(entryNutrients));
    const count = (a) => `<span class="muted">${a.entryIds.length} ${t('mealsWord')}</span>`;
    result = `<h3>${t('aiProposal')}</h3>
      <ul class="plain">${r.actions.map((a, i) => {
        const recipe = recipeMap().get(a.recipeId);
        const what = a.op === 'remove' ? `<strong>${t('aiOpRemove')} · ${dayName(a.date)}:</strong> ${nm(recipe)} ${count(a)}`
          : a.op === 'move' ? `<strong>${t('aiOpMove')} · ${dayName(a.date)} → ${dayName(a.to)}:</strong> ${nm(recipe)} ${count(a)}`
          : `<strong>${t('aiOpAdd')} · ${dayName(a.date)}:</strong> ${nm(recipe)} × ${fmt(a.servings, 2)}
            <span class="muted">${macroLine(N.multiply(N.perServing(recipe, foods), a.servings))}</span> ${avoidTag(recipe)}`;
        return `<li class="row between"><span>${what}</span>
          <button type="button" class="ghost danger" data-act="aiDrop" data-index="${i}" aria-label="${t('remove')}">✕</button></li>`;
      }).join('')}</ul>
      <div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th class="n">kcal</th><th class="n">Protein</th></tr></thead><tbody>
      ${affected.map((date) => {
        const was = totalOn(state.plan, date);
        const will = totalOn(after, date);
        return `<tr><td>${dayName(date)}</td><td class="n">${fmt(was.kcal)} → <strong>${fmt(will.kcal)}</strong></td><td class="n">${fmt(was.protein)} → <strong>${fmt(will.protein)} g</strong></td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="muted">${t('aiTargets')}: ${state.goal.kcal} kcal · ${state.goal.protein} g protein. ${t('aiNumbersNote')}${r.rejected ? ` ${r.rejected} ${t('aiRejected')}` : ''}</p>
      <div class="row"><button type="button" class="primary" data-act="aiApply">${t(r.actions.every((a) => a.op === 'add') ? 'aiApply' : 'aiApplyChanges')}</button>
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
/** What a meal or a batch took from the stock, lot by lot. Data from before lots existed has only totals: those go back without a date. */
const takenOf = (x) => x.taken ?? Object.entries(x.consumed ?? {}).map(([foodId, grams]) => ({ foodId, grams, useBy: null }));

/** Undo everything confirming a meal took: raw ingredients back to the pantry, portions back to their batch. */
function release(entry) {
  if (entry.consumed) {
    state.lots = I.putBack(state.lots, takenOf(entry));
    delete entry.consumed;
    delete entry.taken;
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
      const result = I.take(state.lots, used, todayISO());
      entry.consumed = I.takenTotals(result.taken);
      entry.taken = result.taken;
      state.lots = result.lots;
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
    const meal = document.getElementById(`add-meal-${date}`).value;
    state.plan.push({ id: crypto.randomUUID(), date, recipeId: document.getElementById(`add-recipe-${date}`).value, servings, status: 'assumed', ...(P.MEAL_TYPES.includes(meal) ? { meal } : {}) });
    commit();
  },
  copyDay: (el) => {
    const to = document.getElementById(`copy-to-${el.dataset.date}`)?.value;
    if (!isISODate(to)) return commit(t('invalid'));
    copyMeals([[el.dataset.date, to]]);
  },
  copyWeek: () => {
    const next = K.addDays(ui.week, 7);
    const busy = state.plan.some((e) => e.date >= next && e.date <= K.addDays(next, 6));
    if (busy && !confirm(t('confirmCopyWeek'))) return;
    copyMeals(weekDates().map((d) => [d, K.addDays(d, 7)]));
  },
  favorite: () => {
    if (!recipeMap().has(ui.recipeId)) return;
    state.favorites = isFavourite(ui.recipeId) ? state.favorites.filter((id) => id !== ui.recipeId) : [...state.favorites, ui.recipeId];
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
    state.favorites = state.favorites.filter((id) => id !== ui.recipeId);
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
    state.lots = I.applyPurchase(state.lots, shoppingLines());
    commit(t('boughtDone'));
  },
  boughtOne: (el) => {
    const line = shoppingLines().find((l) => l.foodId === el.dataset.food);
    const date = document.getElementById(`buy-date-${el.dataset.food}`)?.value ?? '';
    if (!line || !(line.purchasedGrams > 0) || !(date === '' || isISODate(date))) return commit(t('invalid'));
    state.lots = I.addLot(state.lots, line.foodId, line.purchasedGrams, date === '' ? null : date);
    commit(`${foods.get(line.foodId).name[state.lang]}: ${fmt(line.purchasedGrams)} g ${t('boughtOneDone')}`);
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
    const r = B.cook(state.lots, recipe, servings, todayISO());
    state.lots = r.lots;
    state.batches.push({ id: `b-${crypto.randomUUID()}`, recipeId: recipe.id, snapshot: snapshotOf(recipe), cookedDate: todayISO(), servings, servingsLeft: servings, useBy: null, consumed: r.consumed, taken: r.taken });
    commit(r.shortages.size ? `${t('cooked')} ${r.shortages.size} ${t('cookedShort')}` : t('cooked'));
  },
  undoBatch: (el) => {
    const b = state.batches.find((x) => x.id === el.dataset.id);
    if (!b || b.servingsLeft < b.servings) return commit(t('invalid'));
    state.lots = I.putBack(state.lots, takenOf(b)); // exactly what cooking took, back under the dates it came from
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
      recipes: state.recipes.slice(0, 60).map((r) => ({ id: r.id, name: recipeLabel(r) })),
    };
    Object.assign(ui, { aiBusy: true, aiText: text, aiResult: null });
    aiAbort = new AbortController();
    render();
    // The plan is used on this side to check the answer; it is not part of what is sent.
    const meals = weekEntries().map((e) => ({ id: e.id, recipeId: e.recipeId, date: e.date, status: e.status }));
    const result = await assistant.propose(ctx, aiAbort.signal, meals);
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
    state.plan = applyActions(state.plan, actions, () => crypto.randomUUID());
    Object.assign(ui, { aiResult: null, aiText: '' });
    commit(`${actions.length} ${t(actions.every((a) => a.op === 'add') ? 'aiApplied' : 'aiChangesApplied')}`);
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
  addMilestone: () => {
    const text = document.getElementById('ms-text').value.trim().slice(0, 80);
    const date = document.getElementById('ms-date').value;
    if (!text || !(date === '' || isISODate(date)) || state.milestones.length >= 200) return commit(t('invalid'));
    state.milestones.push({ id: `m-${crypto.randomUUID()}`, text, date: date || null, done: false });
    commit();
  },
  removeMilestone: (el) => { state.milestones = state.milestones.filter((m) => m.id !== el.dataset.id); commit(); },
  addMeasure: () => {
    const name = document.getElementById('new-measure-name').value.trim().slice(0, 40);
    const unit = document.getElementById('new-measure-unit').value.trim().slice(0, 10);
    if (!name || state.measures.length >= 50) return commit(t('invalid'));
    const id = `q-${crypto.randomUUID()}`;
    state.measures.push({ id, name, unit });
    ui.measureId = id;
    commit();
  },
  removeMeasure: (el) => {
    if (!confirm(t('confirmRemoveMeasure'))) return;
    state.measures = state.measures.filter((m) => m.id !== el.dataset.id);
    state.measurements = state.measurements.filter((m) => m.measureId !== el.dataset.id);
    commit();
  },
  logMeasure: () => {
    const date = document.getElementById('m-date').value;
    const measureId = document.getElementById('m-measure').value;
    const value = num(document.getElementById('m-value').value);
    if (!isISODate(date) || !state.measures.some((m) => m.id === measureId) || value == null || value < 0 || value > 100000) return commit(t('invalid'));
    state.measurements = state.measurements.filter((m) => !(m.measureId === measureId && m.date === date)).concat({ date, measureId, value });
    ui.measureId = measureId;
    commit();
  },
  removeMeasurement: (el) => {
    state.measurements = state.measurements.filter((m) => !(m.measureId === el.dataset.id && m.date === el.dataset.date));
    commit();
  },
  useSuggestion: (el) => {
    Object.assign(ui, { lastReps: Number(el.dataset.reps), lastKg: Number(el.dataset.kg) });
    render();
    document.getElementById('set-kg').focus();
  },
  restStart: () => { startRest(); render(); },
  restStop: () => { ui.restUntil = null; render(); },
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
    const rirText = document.getElementById('set-rir')?.value ?? '';
    const note = (document.getElementById('set-note')?.value ?? '').trim().slice(0, 200);
    log.sets.push({ reps, kg, confirmed: true, ...(/^[0-5]$/.test(rirText) ? { rir: Number(rirText) } : {}), ...(note ? { note } : {}) });
    Object.assign(ui, { lastExercise: exerciseId, lastReps: reps, lastKg: kg });
    startRest();
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
    const field = el.dataset.field;
    if (field === 'type') state.goal.type = el.value;
    else if (field === 'targetKg') {
      const v = el.value.trim() === '' ? null : num(el.value);
      if (el.value.trim() !== '' && (v == null || v < 20 || v > 400)) return commit(t('invalid'));
      state.goal.targetKg = v;
    } else if (field === 'deadline') {
      if (!(el.value === '' || isISODate(el.value))) return commit(t('invalid'));
      state.goal.deadline = el.value || null;
    } else {
      const v = num(el.value);
      if (v == null || v <= 0 || v > 20000) return commit(t('invalid'));
      state.goal[field] = Math.round(v);
    }
    if (['type', 'kcal', 'protein'].includes(field)) state.goalHistory = K.recordGoal(state.goalHistory, state.goal, todayISO());
    commit();
  },
  milestoneDone: (el) => {
    const m = state.milestones.find((x) => x.id === el.dataset.id);
    if (m) m.done = el.checked;
    commit();
  },
  moveMeal: (el) => {
    if (!isISODate(el.value)) return commit(t('invalid'));
    state.plan = P.moveMeal(state.plan, el.dataset.id, el.value);
    commit();
  },
  pickRecipe: (el) => { ui.recipeId = el.value; render(); },
  mealType: (el) => {
    const entry = state.plan.find((e) => e.id === el.dataset.id);
    if (!entry) return;
    if (P.MEAL_TYPES.includes(el.value)) entry.meal = el.value;
    else delete entry.meal;
    commit();
  },
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
    state.lots = I.setLot(state.lots, el.dataset.food, el.dataset.useby || null, g);
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
    if (!(el.value === '' || isISODate(el.value))) return commit(t('invalid'));
    state.lots = I.redateLot(state.lots, el.dataset.food, el.dataset.useby || null, el.value || null);
    commit();
  },
  batchUseBy: (el) => {
    const b = state.batches.find((x) => x.id === el.dataset.id);
    if (!b || !(el.value === '' || isISODate(el.value))) return commit(t('invalid'));
    b.useBy = el.value === '' ? null : el.value;
    commit();
  },
  restSeconds: (el) => {
    const n = Number(el.value);
    if (!REST_CHOICES.includes(n)) return commit(t('invalid'));
    state.restSeconds = n;
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

/** Adds copies of the meals on the given dates. Copies are planned meals; nothing is confirmed or taken from stock. */
function copyMeals(pairs) {
  const result = P.copyMeals(state.plan, pairs, new Set(state.recipes.map((r) => r.id)), () => crypto.randomUUID());
  state.plan.push(...result.entries);
  const skipped = result.skipped ? ` ${result.skipped} ${t('copySkipped')}` : '';
  commit(result.entries.length ? `${result.entries.length} ${t('mealsCopied')}${skipped}` : `${t('nothingToCopy')}${skipped}`);
}

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
