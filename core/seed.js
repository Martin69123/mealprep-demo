// Starter content. Nutrition comes from Frida (core/foods.js). Recipes, exercise names and
// templates are original to this project. Pack sizes are ASSUMPTIONS about typical Danish packs,
// not observed data; the user can change them.
import { fridaId, FRIDA_META } from './foods.js';

export const DATA_NOTICE = {
  da: `Næringsdata: Frida, version ${FRIDA_META.version}, DTU Fødevareinstituttet (doi:${FRIDA_META.doi}), CC BY 4.0. Data er udvalgt og afrundet. DTU står ikke bag appen. Priser og pakkestørrelser er dine egne eller antagelser.`,
  en: `Nutrition data: Frida, version ${FRIDA_META.version}, National Food Institute, Technical University of Denmark (doi:${FRIDA_META.doi}), CC BY 4.0. Data is a rounded subset. DTU does not endorse this app. Prices and pack sizes are your own or assumptions.`,
};

// Short key → [Frida FoodID, assumed pack size in grams]. The key is the id used by schema v1.
// Note: Frida 5.5 has no "chicken breast, skinless, raw"; 795 is raw chicken flesh without skin.
const STARTER = {
  chicken: [795, 1000], // Kylling, kød, rå
  beef: [1739, 400], // Oksekød, hakket, 8-12% fedt, rå
  salmon: [1658, 250], // Laks, atlantisk, opdræt, rå
  tofu: [272, 400], // Tofu, sojabønneost
  eggs: [1664, 600], // Æg, høne, skrabehøns, rå
  skyr: [1693, 1000], // Skyr, 0.2 % fedt
  milk: [33, 1000], // Letmælk, konventionel
  rice: [1252, 1000], // Ris, polerede, rå
  pasta: [377, 500], // Makaroni, spaghetti, fuldkorns-, rå
  oats: [59, 1000], // Havregryn, uspec.
  potato: [4, 2000], // Kartoffel, uspec., rå
  broccoli: [17, 500], // Broccoli, rå
  carrot: [24, 1000], // Gulerod, uspec., rå
  onion: [716, 1000], // Løg, rå
  tomato: [596, 400], // Tomat, flået, konserves
  beans: [1810, 240], // Bønner, røde kidney, kogte, konserves
  banana: [3, 800], // Banan, rå
  oil: [1467, 500], // Olivenolie
};

/** Schema-v1 ids → current ids, used to migrate stored data. */
export const LEGACY_IDS = Object.fromEntries(Object.entries(STARTER).map(([k, [id]]) => [k, fridaId(id)]));
/** Assumed pack size in grams per food id. Foods not listed have no assumption. */
export const DEFAULT_PACKS = Object.fromEntries(Object.values(STARTER).map(([id, pack]) => [fridaId(id), pack]));

const recipe = (id, da, en, servings, ingredients) => ({
  id,
  name: { da, en },
  servings,
  ingredients: ingredients.map(([key, grams]) => ({ foodId: LEGACY_IDS[key], grams })),
});

export const RECIPES = [
  recipe('chicken-rice', 'Kylling, ris og broccoli', 'Chicken, rice and broccoli', 4, [
    ['chicken', 600], ['rice', 300], ['broccoli', 500], ['oil', 15],
  ]),
  recipe('chili', 'Chili con carne med ris', 'Chili con carne with rice', 4, [
    ['beef', 500], ['beans', 480], ['tomato', 800], ['onion', 150], ['rice', 300], ['oil', 10],
  ]),
  recipe('salmon-potato', 'Laks med kartofler og gulerødder', 'Salmon with potatoes and carrots', 4, [
    ['salmon', 500], ['potato', 800], ['carrot', 400], ['oil', 15],
  ]),
  recipe('bolognese', 'Fuldkornspasta med kødsovs', 'Wholegrain pasta with meat sauce', 4, [
    ['beef', 400], ['pasta', 350], ['tomato', 400], ['onion', 100], ['carrot', 150], ['oil', 10],
  ]),
  recipe('tofu-wok', 'Tofu-wok med ris', 'Tofu stir-fry with rice', 4, [
    ['tofu', 400], ['rice', 300], ['broccoli', 300], ['carrot', 200], ['oil', 15],
  ]),
  recipe('oats', 'Overnight oats med skyr', 'Overnight oats with skyr', 1, [
    ['oats', 60], ['skyr', 200], ['banana', 100], ['milk', 100],
  ]),
];

const ex = (id, da, en) => ({ id, name: { da, en } });
export const EXERCISES = [
  ex('squat', 'Squat', 'Squat'),
  ex('bench', 'Bænkpres', 'Bench press'),
  ex('deadlift', 'Dødløft', 'Deadlift'),
  ex('ohp', 'Skulderpres', 'Overhead press'),
  ex('row', 'Foroverbøjet rows', 'Bent-over row'),
  ex('pullup', 'Pull-ups', 'Pull-ups'),
  ex('rdl', 'Rumænsk dødløft', 'Romanian deadlift'),
  ex('lunge', 'Lunges', 'Lunges'),
  ex('dip', 'Dips', 'Dips'),
  ex('curl', 'Biceps curl', 'Biceps curl'),
];

const day = (name, list) => ({ name, exercises: list.map(([exerciseId, sets, reps]) => ({ exerciseId, sets, reps })) });
/** Planned sets are a plan, never evidence that anything was performed. */
export const TEMPLATES = [
  {
    id: 'full-body-3',
    name: { da: 'Helkrop, 3 dage', en: 'Full body, 3 days' },
    days: [
      day('A', [['squat', 3, 5], ['bench', 3, 5], ['row', 3, 8]]),
      day('B', [['deadlift', 2, 5], ['ohp', 3, 6], ['pullup', 3, 8]]),
      day('C', [['lunge', 3, 8], ['dip', 3, 8], ['rdl', 3, 8]]),
    ],
  },
  {
    id: 'upper-lower-4',
    name: { da: 'Over-/underkrop, 4 dage', en: 'Upper/lower, 4 days' },
    days: [
      day('Over 1', [['bench', 4, 5], ['row', 4, 6], ['curl', 3, 10]]),
      day('Under 1', [['squat', 4, 5], ['rdl', 3, 8]]),
      day('Over 2', [['ohp', 4, 6], ['pullup', 4, 6], ['dip', 3, 8]]),
      day('Under 2', [['deadlift', 3, 4], ['lunge', 3, 8]]),
    ],
  },
];

export const byId = (list) => new Map(list.map((x) => [x.id, x]));
