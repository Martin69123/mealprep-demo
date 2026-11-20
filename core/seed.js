// Starter content. Nutrition comes from Frida (core/foods.js). Recipes (ingredient lists only, no
// method), exercise names and templates are original to this project. Pack sizes are ASSUMPTIONS about typical Danish packs,
// not observed data; the user can change them.
import { fridaId, FRIDA_META } from './foods.js';

export const DATA_NOTICE = {
  da: `Næringsdata: Frida, version ${FRIDA_META.version}, DTU Fødevareinstituttet (doi:${FRIDA_META.doi}), CC BY 4.0. Data er udvalgt og afrundet. DTU står ikke bag appen. Priser og pakkestørrelser er dine egne eller antagelser.`,
  en: `Nutrition data: Frida, version ${FRIDA_META.version}, National Food Institute, Technical University of Denmark (doi:${FRIDA_META.doi}), CC BY 4.0. Data is a rounded subset. DTU does not endorse this app. Prices and pack sizes are your own or assumptions.`,
};

// Short key → [Frida FoodID, assumed pack size in grams, shop section]. The key is the id used by
// schema v1. The section is where the food is ASSUMED to be found in a typical supermarket.
// Note: Frida 5.5 has no "chicken breast, skinless, raw"; 795 is raw chicken flesh without skin.
const STARTER = {
  chicken: [795, 1000, 'meat'], // Kylling, kød, rå
  beef: [1739, 400, 'meat'], // Oksekød, hakket, 8-12% fedt, rå
  salmon: [1658, 250, 'meat'], // Laks, atlantisk, opdræt, rå
  tofu: [272, 400, 'chilled'], // Tofu, sojabønneost
  eggs: [1664, 600, 'dairy'], // Æg, høne, skrabehøns, rå
  skyr: [1693, 1000, 'dairy'], // Skyr, 0.2 % fedt
  milk: [33, 1000, 'dairy'], // Letmælk, konventionel
  rice: [1252, 1000, 'dry'], // Ris, polerede, rå
  pasta: [377, 500, 'dry'], // Makaroni, spaghetti, fuldkorns-, rå
  oats: [59, 1000, 'dry'], // Havregryn, uspec.
  potato: [4, 2000, 'produce'], // Kartoffel, uspec., rå
  broccoli: [17, 500, 'produce'], // Broccoli, rå
  carrot: [24, 1000, 'produce'], // Gulerod, uspec., rå
  onion: [716, 1000, 'produce'], // Løg, rå
  tomato: [596, 400, 'canned'], // Tomat, flået, konserves
  beans: [1810, 240, 'canned'], // Bønner, røde kidney, kogte, konserves
  banana: [3, 800, 'produce'], // Banan, rå
  oil: [1467, 500, 'dry'], // Olivenolie
};

// Foods added with the larger recipe set (2026-11-20). Same shape; these keys never existed in
// schema v1, so they are not legacy ids.
const MORE = {
  turkeyMince: [905, 400, 'meat'], // Kalkunkød, hakket, 0-5% fedt, råt
  porkMince: [945, 500, 'meat'], // Grisekød, hakket, 5-10% fedt, råt
  cod: [72, 400, 'meat'], // Torsk, filet, rå
  tuna: [825, 160, 'canned'], // Tun i vand, konserves
  shrimp: [518, 300, 'frozen'], // Reje, dybvands-, kogt, dybfrost
  mackerel: [960, 125, 'canned'], // Makrel i tomat, konserves
  lentils: [1799, 500, 'dry'], // Linser, røde, tørrede, rå
  chickpeas: [1812, 240, 'canned'], // Kikærter, lyse, kogte, konserves
  blackBeans: [1814, 240, 'canned'], // Bønner, sorte, kogte, konserves
  edamame: [1806, 400, 'frozen'], // Edamamebønner, pillede, frosne
  cottage: [1679, 450, 'dairy'], // Hytteost, 5+
  feta: [1771, 200, 'dairy'], // Feta, 5% (Salat-tern)
  cheese: [1211, 400, 'dairy'], // Ost, fast, 20+, alle typer
  cream: [303, 250, 'dairy'], // Fløde 9 %
  rye: [1671, 1000, 'bread'], // Rugbrød, fuldkorn, industrifremstillet
  bulgur: [283, 500, 'dry'], // Bulgur, parboiled, rå
  quinoa: [1724, 400, 'dry'], // Quinoa, hvid, rå
  barley: [1730, 500, 'dry'], // Perlebyg
  muesli: [461, 750, 'dry'], // Müsli uden tilsat sukker
  sweetPotato: [714, 1000, 'produce'], // Batat, sød kartoffel, rå
  spinach: [843, 450, 'frozen'], // Spinat, hakket, dybfrost
  pepper: [38, 450, 'produce'], // Peberfrugt, rød, rå
  cucumber: [388, 300, 'produce'], // Agurk, rå
  freshTomato: [52, 500, 'produce'], // Tomat, uspec., rå
  peas: [1821, 600, 'frozen'], // Ærter, grønne, dybfrost
  corn: [1164, 285, 'canned'], // Majs, kerner, konserves
  cabbage: [26, 1000, 'produce'], // Hvidkål, rå
  leek: [824, 400, 'produce'], // Porre, rå
  mushroom: [961, 250, 'produce'], // Champignon, rå
  garlic: [205, 100, 'produce'], // Hvidløg, rå
  apple: [2, 1000, 'produce'], // Æble, uspec., råt
  blueberry: [1817, 300, 'frozen'], // Blåbær, dybfrost
  raspberry: [1818, 300, 'frozen'], // Hindbær, dybfrost
  almond: [35, 200, 'dry'], // Mandel, rå
  soy: [92, 150, 'dry'], // Soja sauce
  curry: [657, 40, 'dry'], // Karry, pulver
};

/** Schema-v1 ids → current ids, used to migrate stored data. */
export const LEGACY_IDS = Object.fromEntries(Object.entries(STARTER).map(([k, [id]]) => [k, fridaId(id)]));
/** Recipe key → food id, for every food the built-in recipes use. */
const KEYS = Object.fromEntries(Object.entries({ ...STARTER, ...MORE }).map(([k, [id]]) => [k, fridaId(id)]));
// MADE-UP demo prices in øre per assumed pack, so the budget can be tried without typing prices.
// They are not observed in any shop. The app marks every one of them as an example.
const DEMO_PRICES = {
  chicken: 6500, beef: 3500, salmon: 4500, tofu: 2000, eggs: 2800, skyr: 2200, milk: 1300, rice: 1600, pasta: 1200, oats: 1400, potato: 1800, broccoli: 1200,
  carrot: 1000, onion: 1000, tomato: 600, beans: 700, banana: 1500, oil: 5500,
  turkeyMince: 3500, porkMince: 3000, cod: 5500, tuna: 1500, shrimp: 3500, mackerel: 1200, lentils: 1800, chickpeas: 700, blackBeans: 800, edamame: 2200,
  cottage: 1600, feta: 1500, cheese: 3500, cream: 900, rye: 1800, bulgur: 1500, quinoa: 2500, barley: 1400, muesli: 2800, sweetPotato: 2000, spinach: 1200,
  pepper: 1800, cucumber: 800, freshTomato: 1500, peas: 1400, corn: 800, cabbage: 1200, leek: 1200, mushroom: 1500, garlic: 800, apple: 1800, blueberry: 2500,
  raspberry: 2500, almond: 2800, soy: 1500, curry: 1200,
};
/** Made-up example price in øre per pack, per food id. Examples only — never shown as real prices. */
export const EXAMPLE_PRICES = Object.fromEntries(Object.entries(DEMO_PRICES).map(([key, ore]) => [KEYS[key], ore]));

/** Shop sections in the order the shopping list shows them. 'other' holds every food without an assumption. */
export const SECTIONS = ['produce', 'bread', 'meat', 'chilled', 'dairy', 'dry', 'canned', 'frozen', 'other'];
const FOOD_SECTIONS = Object.fromEntries(Object.values({ ...STARTER, ...MORE }).map(([id, , section]) => [fridaId(id), section]));
/** Assumed shop section of a food; 'other' when the project has made no assumption. */
export const sectionOf = (foodId) => FOOD_SECTIONS[foodId] ?? 'other';
/** Assumed pack size in grams per food id. Foods not listed have no assumption. */
export const DEFAULT_PACKS = Object.fromEntries(Object.values({ ...STARTER, ...MORE }).map(([id, pack]) => [fridaId(id), pack]));

const recipe = (id, da, en, servings, ingredients) => ({
  id,
  name: { da, en },
  servings,
  ingredients: ingredients.map(([key, grams]) => ({ foodId: KEYS[key], grams })),
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
  // Added 2026-11-20. New recipes go at the end: stored documents get them appended in this order.
  recipe('turkey-bulgur', 'Kalkunfars med bulgur og peberfrugt', 'Turkey mince with bulgur and peppers', 4, [
    ['turkeyMince', 500], ['bulgur', 300], ['pepper', 300], ['onion', 150], ['tomato', 400], ['oil', 10],
  ]),
  recipe('cod-potato', 'Torsk med kartofler og ærter', 'Cod with potatoes and peas', 4, [
    ['cod', 600], ['potato', 800], ['peas', 300], ['oil', 15],
  ]),
  recipe('lentil-dal', 'Rød linsedal med ris', 'Red lentil dal with rice', 4, [
    ['lentils', 300], ['rice', 250], ['tomato', 400], ['onion', 150], ['spinach', 200], ['garlic', 10], ['curry', 8], ['oil', 15],
  ]),
  recipe('chickpea-curry', 'Kikærtekarry med sød kartoffel', 'Chickpea curry with sweet potato', 4, [
    ['chickpeas', 480], ['sweetPotato', 600], ['rice', 250], ['tomato', 400], ['onion', 150], ['spinach', 200], ['curry', 8], ['oil', 15],
  ]),
  recipe('tuna-pasta', 'Tunpasta med majs og ærter', 'Tuna pasta with sweetcorn and peas', 4, [
    ['tuna', 320], ['pasta', 350], ['corn', 285], ['peas', 200], ['tomato', 400], ['onion', 100], ['oil', 10],
  ]),
  recipe('pork-cabbage', 'Svinefars-wok med hvidkål og ris', 'Pork mince stir-fry with cabbage and rice', 4, [
    ['porkMince', 500], ['cabbage', 400], ['carrot', 200], ['rice', 300], ['soy', 30], ['oil', 10],
  ]),
  recipe('shrimp-rice', 'Stegte ris med rejer, ærter og æg', 'Fried rice with shrimp, peas and egg', 4, [
    ['shrimp', 400], ['rice', 300], ['peas', 250], ['eggs', 240], ['carrot', 150], ['soy', 30], ['oil', 15],
  ]),
  recipe('chicken-sweet-potato', 'Ovnbagt kylling med sød kartoffel', 'Oven-baked chicken with sweet potato', 4, [
    ['chicken', 600], ['sweetPotato', 800], ['broccoli', 400], ['oil', 20],
  ]),
  recipe('chicken-quinoa', 'Kyllingesalat med quinoa og feta', 'Chicken salad with quinoa and feta', 4, [
    ['chicken', 500], ['quinoa', 250], ['cucumber', 300], ['freshTomato', 300], ['feta', 150], ['oil', 20],
  ]),
  recipe('burrito-bowl', 'Burrito bowl med oksekød og sorte bønner', 'Burrito bowl with beef and black beans', 4, [
    ['beef', 400], ['blackBeans', 480], ['rice', 300], ['corn', 285], ['pepper', 200], ['freshTomato', 300], ['oil', 10],
  ]),
  recipe('chicken-barley-soup', 'Suppe med kylling, perlebyg og porre', 'Soup with chicken, pearl barley and leek', 4, [
    ['chicken', 400], ['barley', 200], ['carrot', 300], ['leek', 300], ['potato', 400], ['oil', 10],
  ]),
  recipe('chicken-mushroom-pasta', 'Pasta med kylling, champignon og spinat', 'Pasta with chicken, mushrooms and spinach', 4, [
    ['chicken', 500], ['pasta', 350], ['mushroom', 250], ['spinach', 200], ['cream', 250], ['onion', 100], ['oil', 10],
  ]),
  recipe('edamame-quinoa', 'Quinoaskål med tofu og edamame', 'Quinoa bowl with tofu and edamame', 4, [
    ['tofu', 400], ['quinoa', 250], ['edamame', 300], ['pepper', 200], ['carrot', 200], ['soy', 30], ['oil', 15],
  ]),
  recipe('rye-mackerel', 'Rugbrød med makrel i tomat', 'Rye bread with mackerel in tomato', 1, [
    ['rye', 120], ['mackerel', 125], ['cucumber', 100],
  ]),
  recipe('rye-egg-cottage', 'Rugbrød med æg og hytteost', 'Rye bread with egg and cottage cheese', 1, [
    ['rye', 120], ['eggs', 120], ['cottage', 150], ['freshTomato', 100],
  ]),
  recipe('omelette', 'Omelet med spinat og ost', 'Omelette with spinach and cheese', 1, [
    ['eggs', 180], ['spinach', 100], ['cheese', 30], ['rye', 60], ['oil', 5],
  ]),
  recipe('skyr-muesli', 'Skyr med müsli og blåbær', 'Skyr with muesli and blueberries', 1, [
    ['skyr', 250], ['muesli', 50], ['blueberry', 100], ['almond', 15],
  ]),
  recipe('porridge', 'Havregrød med æble og mandler', 'Porridge with apple and almonds', 1, [
    ['oats', 70], ['milk', 250], ['apple', 100], ['almond', 15],
  ]),
  recipe('cottage-berries', 'Hytteost med hindbær og mandler', 'Cottage cheese with raspberries and almonds', 1, [
    ['cottage', 200], ['raspberry', 100], ['almond', 20],
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
  // Added 2026-11-20.
  ex('frontsquat', 'Front squat', 'Front squat'),
  ex('legpress', 'Benpres', 'Leg press'),
  ex('hipthrust', 'Hip thrust', 'Hip thrust'),
  ex('legcurl', 'Leg curl', 'Leg curl'),
  ex('legext', 'Leg extension', 'Leg extension'),
  ex('calfraise', 'Tåhæv', 'Calf raise'),
  ex('incline', 'Skråbænkpres med håndvægte', 'Incline dumbbell press'),
  ex('dbpress', 'Skulderpres med håndvægte', 'Dumbbell shoulder press'),
  ex('lateral', 'Sideløft', 'Lateral raise'),
  ex('latpull', 'Lat pulldown', 'Lat pulldown'),
  ex('cablerow', 'Siddende kabelrows', 'Seated cable row'),
  ex('facepull', 'Face pull', 'Face pull'),
  ex('pushdown', 'Triceps pushdown', 'Triceps pushdown'),
  ex('hammer', 'Hammer curl', 'Hammer curl'),
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
  // Added 2026-11-20.
  {
    id: 'machines-2',
    name: { da: 'Helkrop i maskiner, 2 dage', en: 'Full body on machines, 2 days' },
    days: [
      day('A', [['legpress', 3, 10], ['incline', 3, 10], ['cablerow', 3, 10], ['legcurl', 2, 12]]),
      day('B', [['legpress', 3, 10], ['dbpress', 3, 10], ['latpull', 3, 10], ['legext', 2, 12]]),
    ],
  },
  {
    id: 'ppl-3',
    name: { da: 'Push/pull/ben, 3 dage', en: 'Push/pull/legs, 3 days' },
    days: [
      day('Push', [['bench', 4, 6], ['dbpress', 3, 8], ['dip', 3, 8], ['lateral', 3, 12], ['pushdown', 3, 12]]),
      day('Pull', [['deadlift', 3, 5], ['pullup', 3, 8], ['cablerow', 3, 10], ['facepull', 3, 15], ['curl', 3, 10]]),
      day('Ben', [['squat', 4, 6], ['rdl', 3, 8], ['legpress', 3, 10], ['legcurl', 3, 12], ['calfraise', 3, 12]]),
    ],
  },
  {
    id: 'upper-lower-5',
    name: { da: 'Over-/underkrop plus helkrop, 5 dage', en: 'Upper/lower plus full body, 5 days' },
    days: [
      day('Over 1', [['bench', 4, 5], ['row', 4, 6], ['dbpress', 3, 8], ['curl', 3, 10]]),
      day('Under 1', [['squat', 4, 5], ['rdl', 3, 8], ['calfraise', 3, 12]]),
      day('Over 2', [['ohp', 4, 6], ['pullup', 4, 6], ['incline', 3, 10], ['pushdown', 3, 12]]),
      day('Under 2', [['deadlift', 3, 4], ['frontsquat', 3, 6], ['hipthrust', 3, 10]]),
      day('Helkrop', [['legpress', 3, 10], ['latpull', 3, 10], ['lateral', 3, 12], ['hammer', 3, 10], ['facepull', 3, 15]]),
    ],
  },
];

export const byId = (list) => new Map(list.map((x) => [x.id, x]));
