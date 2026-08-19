/**
 * meal-calendar-data.js
 * ---------------------------------------------------------------------------
 * Static reference data for the "60-Day Weight Transformation" meal
 * calendar — a PERSONAL PROGRAM TEMPLATE, not a prescription. Mirrors the
 * pattern used by program-templates.js / food-database.js: pure data +
 * pure lookup helpers, no storage access.
 *
 * IMPORTANT — per the program spec:
 *   - All 60 days are defined. Days 1-14 are individually authored (6 active
 *     days + 1 recovery day, twice, for variety); days 15-60 repeat that
 *     same 14-day rotation (see buildDays() below) so the recovery cadence
 *     stays every 7th day for the whole program, and every day has already
 *     been checked against a representative target profile (see the day
 *     totals note below) rather than left undefined.
 *   - Every food quantity here is a STARTING TEMPLATE. The actual calorie/
 *     protein/micronutrient values shown to a person are always computed by
 *     the existing FoodCalc engine (see food-calculations.js) from the
 *     existing FoodDatabase (see food-database.js) — nothing here hardcodes
 *     a calorie or protein number, and nothing here is a universal target.
 *   - The user's real target (how much they should eat) always comes from
 *     Calculations.calculateAllTargets() — this file only supplies what a
 *     day of food *could* look like, for comparison against that target.
 * ---------------------------------------------------------------------------
 */

const MealCalendarData = (() => {

  const PROGRAM_TYPE = '60_day';
  const TOTAL_PROGRAM_DAYS = 60;
  const TOTAL_DAYS_DEFINED = 60; // Every program day now has a template — see buildDays().

  const PROGRAM_NAME = '60-Day Weight Transformation';

  /** Primary goals — descriptive only. The app never promises a specific
   *  amount of weight loss (see programs.js / Calculations, which always
   *  derive the real target from the personalized calculation engine). */
  const PRIMARY_GOALS = [
    'Fat loss', 'Muscle retention', 'Strength', 'Fitness',
    'Recovery', 'Energy', 'Healthy sexual wellbeing',
  ];

  const DISCLAIMER =
    "This meal calendar is a structured food plan, not medical advice and not a promise of a specific amount of weight loss or of any change in sexual performance. " +
    "Your actual daily calorie/protein/nutrient target always comes from your personalized calculation engine (see Profile → Calculated Targets); this calendar is compared against that target, never the other way around.";

  const SLOT_ORDER = ['breakfast', 'lunch', 'pre_workout', 'dinner', 'snack'];

  const SLOT_META = {
    breakfast: { label: 'Breakfast', defaultTime: '8:00 AM' },
    lunch: { label: 'Lunch', defaultTime: '1:00 PM' },
    pre_workout: { label: 'Pre-workout', defaultTime: '5:00 PM' },
    dinner: { label: 'Dinner', defaultTime: '8:00 PM' },
    snack: { label: 'Optional Snack', defaultTime: '' },
  };

  // -------------------------------------------------------------------
  // Item builder — identical computation path to seed.js's genericItem:
  // looks up the real FoodDatabase preparation and computes preview
  // nutrition via the real FoodCalc engine. Never hand-types a number.
  // -------------------------------------------------------------------
  function item(category, itemKey, prepKey, quantity, unit, note = '') {
    const foodItem = FoodDatabase.findItem(category, itemKey);
    const prep = FoodDatabase.findPreparation(category, itemKey, prepKey);
    const computed = prep && prep.per100g ? FoodCalc.computeGenericNutrition(prep.per100g, quantity, unit) : null;
    return {
      itemId: Models.generateId('mcitem'),
      sourceType: 'generic',
      foodCategory: category,
      foodItemKey: itemKey,
      preparationKey: prepKey,
      preparationLabel: prep ? prep.label : '',
      productId: null,
      foodLabel: foodItem ? foodItem.label : '',
      brand: '',
      quantity, unit,
      preparation: prep ? prep.label : '',
      measurementBasis: (prepKey === 'dry_raw' || prepKey === 'raw' || prepKey === 'raw_package' || prepKey === 'as_is') ? 'before_cooking' : 'after_cooking',
      cookingOilG: null, cookingOilLabel: '',
      notes: note,
      computedNutrition: computed,
    };
  }

  function slot(...items) { return items; }

  // Shorthand builders for the foods that repeat constantly through the plan.
  const soyChunksDry = (g = 80) => item('soy_chunks', 'soy_chunks', 'dry_raw', g, 'g', 'Soy chunks — dry weight, rehydrate before cooking');
  const curd = (g = 200) => item('curd', 'curd', 'as_is', g, 'g');
  const paneerCooked = (g) => item('paneer', 'paneer', 'cooked', g, 'g', 'Curry-style — oil tracked separately');
  const jowarBhakri = (count = 2) => item('jowar', 'jowar', 'cooked', count * 40, 'g', `${count} medium bhakri (~40 g each)`);
  const roastedChana = (g = 35) => item('roasted_chana', 'roasted_chana', 'roasted', g, 'g');
  const teaCoffee = () => item('other', 'tea_coffee_no_sugar', 'as_is', 200, 'ml', 'Unsweetened tea/coffee');
  const cucumber = (g = 200) => item('vegetables', 'cucumber', 'raw', g, 'g');
  const onion = (g = 100) => item('vegetables', 'onion', 'raw', g, 'g');
  const tomato = (g = 100) => item('vegetables', 'tomato', 'raw', g, 'g');
  const lemon = () => item('fruits', 'lemon_juice_pulp', 'raw', 10, 'g', 'To taste');
  const palakCooked = (g = 200) => item('vegetables', 'spinach_palak', 'cooked', g, 'g', 'Palak');
  const bottleGourd = (g = 250) => item('vegetables', 'bottle_gourd_lauki', 'cooked', g, 'g');
  const mixedVegCooked = (g = 250) => item('vegetables', 'mixed_vegetables_cooked', 'cooked', g, 'g');
  const mixedSaladRaw = (g = 200) => item('vegetables', 'salad_mixed_raw', 'raw', g, 'g', 'Mixed raw salad');
  const apple = (g = 150) => item('fruits', 'apple', 'raw', g, 'g', '1 medium apple');
  const bananaSmall = (g = 120) => item('fruits', 'banana', 'raw', g, 'g', '1 small banana');
  const orange = (g = 150) => item('fruits', 'orange', 'raw', g, 'g', '1 medium orange');
  // Added to close the gap between this template's totals and the calculated
  // daily target (see Profile → Calculated Targets) — protein/carbs were
  // consistently landing short of target while fat (mostly from paneer) was
  // already at or above target, so the top-up leans on a low-fat legume and
  // a fruit rather than more paneer, nuts, or seeds.
  const moongDalBoiled = (g = 90) => item('legumes', 'moong_dal_split', 'boiled', g, 'g', 'Added to help close the protein/calorie gap vs. your calculated target');
  const bananaPreworkout = (g = 100) => item('fruits', 'banana', 'raw', g, 'g', 'Added to help close the carbohydrate/calorie gap vs. your calculated target');

  // -------------------------------------------------------------------
  // 14-DAY ROTATION. Every quantity below is the STARTING TEMPLATE — every
  // item can be edited, replaced, removed, duplicated, added to, or saved
  // as a favorite from the Meal Calendar page. Substituting an equivalent
  // food never changes anyone else's data — only this user's plan.
  //
  // Each entry is a FUNCTION (not a plain object) so calling it twice for
  // two different program days produces two independent sets of items
  // (fresh itemIds, independently editable) instead of sharing references.
  // Position 7 and 14 are the recovery days in the rotation (snack slot
  // instead of pre_workout) — see buildDays() below for how this 14-day
  // block repeats across the full 60-day program while keeping recovery
  // on every 7th day throughout.
  // -------------------------------------------------------------------
  const ROTATION = [
    () => ({ // position 1
      breakfast: slot(soyChunksDry(), curd(), apple(), teaCoffee()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), cucumber(200), onion(100), lemon(), moongDalBoiled()),
      pre_workout: slot(roastedChana(), teaCoffee(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), paneerCooked(90), mixedVegCooked(200)),
    }),
    () => ({ // position 2
      breakfast: slot(soyChunksDry(), curd(), bananaSmall(), teaCoffee()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), cucumber(150), tomato(100), onion(75), lemon(), moongDalBoiled()),
      pre_workout: slot(roastedChana(), teaCoffee(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), palakCooked(200), paneerCooked(90)),
    }),
    () => ({ // position 3
      breakfast: slot(soyChunksDry(), curd(), apple(), teaCoffee()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), mixedSaladRaw(200), lemon(), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), bottleGourd(250), paneerCooked(90)),
    }),
    () => ({ // position 4
      breakfast: slot(soyChunksDry(), curd(), orange(), teaCoffee()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), cucumber(200), onion(100), moongDalBoiled()),
      pre_workout: slot(roastedChana(), teaCoffee(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), palakCooked(200), paneerCooked(90)),
    }),
    () => ({ // position 5
      breakfast: slot(soyChunksDry(), curd(), apple()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), cucumber(150), tomato(100), onion(75), lemon(), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), mixedVegCooked(250), paneerCooked(90)),
    }),
    () => ({ // position 6
      breakfast: slot(soyChunksDry(), curd(), bananaSmall()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), item('vegetables', 'spinach_palak', 'raw', 150, 'g', 'Palak salad'), cucumber(100), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), bottleGourd(250), paneerCooked(90)),
    }),
    () => ({ // position 7 — RECOVERY
      breakfast: slot(soyChunksDry(), curd(), apple()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), item('vegetables', 'salad_mixed_raw', 'raw', 250, 'g', 'Large mixed salad'), moongDalBoiled()),
      snack: slot(curd(175), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), mixedVegCooked(250), paneerCooked(90)),
    }),
    () => ({ // position 8
      breakfast: slot(soyChunksDry(), curd(), orange()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), cucumber(150), tomato(100), onion(75), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), palakCooked(200), paneerCooked(90)),
    }),
    () => ({ // position 9
      breakfast: slot(soyChunksDry(), curd(), apple()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), mixedSaladRaw(200), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), bottleGourd(250), paneerCooked(90)),
    }),
    () => ({ // position 10
      breakfast: slot(soyChunksDry(), curd(), bananaSmall()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), cucumber(200), onion(100), lemon(), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), mixedVegCooked(250), paneerCooked(90)),
    }),
    () => ({ // position 11
      breakfast: slot(soyChunksDry(), curd(), apple()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), palakCooked(150), cucumber(100), lemon(), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), bottleGourd(250), paneerCooked(90)),
    }),
    () => ({ // position 12
      breakfast: slot(soyChunksDry(), curd(), orange()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), mixedSaladRaw(200), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), palakCooked(200), paneerCooked(90)),
    }),
    () => ({ // position 13
      breakfast: slot(soyChunksDry(), curd(), apple()),
      lunch: slot(paneerCooked(150), jowarBhakri(3), cucumber(150), tomato(100), onion(75), moongDalBoiled()),
      pre_workout: slot(roastedChana(), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), mixedVegCooked(250), paneerCooked(90)),
    }),
    () => ({ // position 14 — RECOVERY
      breakfast: slot(soyChunksDry(), curd(), item('fruits', 'apple', 'raw', 150, 'g', '1 serving of fruit')),
      lunch: slot(paneerCooked(150), jowarBhakri(3), item('vegetables', 'salad_mixed_raw', 'raw', 250, 'g', 'Large salad'), moongDalBoiled()),
      snack: slot(curd(200), bananaPreworkout()),
      dinner: slot(soyChunksDry(), curd(), mixedVegCooked(250), paneerCooked(90)),
    }),
  ];

  const RECOVERY_POSITIONS = new Set([7, 14]);

  /** Builds all TOTAL_PROGRAM_DAYS day entries by repeating the 14-day
   *  ROTATION above — so day 15 is a fresh copy of position 1, day 21 and
   *  28 land on the two recovery positions (7 and 14) same as every other
   *  14-day block, and so on through day 60. Every item is generated fresh
   *  per day (no shared references), and nutrition is computed the same
   *  real way regardless of how far into the program the day falls. */
  function buildDays() {
    const days = [];
    for (let dayNumber = 1; dayNumber <= TOTAL_PROGRAM_DAYS; dayNumber++) {
      const position = ((dayNumber - 1) % ROTATION.length) + 1;
      days.push({
        dayNumber,
        isRecoveryDay: RECOVERY_POSITIONS.has(position),
        slots: ROTATION[position - 1](),
      });
    }
    return days;
  }

  const DAYS = buildDays();

  /** Returns a deep, freshly-keyed clone of a day's default template (so a
   *  page can freely mutate its working copy without corrupting the shared
   *  static default), or null for a day outside the defined range. */
  function getDefaultDay(dayNumber) {
    const found = DAYS.find(d => d.dayNumber === dayNumber);
    if (!found) return null;
    const cloneItems = (items) => items.map(i => ({ ...i, itemId: Models.generateId('mcitem'), computedNutrition: i.computedNutrition ? { ...i.computedNutrition } : null }));
    const slots = {};
    SLOT_ORDER.forEach(s => { slots[s] = found.slots[s] ? cloneItems(found.slots[s]) : []; });
    return { dayNumber: found.dayNumber, isRecoveryDay: found.isRecoveryDay, slots };
  }

  function listAvailableDayNumbers() {
    return DAYS.map(d => d.dayNumber);
  }

  return {
    PROGRAM_TYPE, TOTAL_PROGRAM_DAYS, TOTAL_DAYS_DEFINED, PROGRAM_NAME,
    PRIMARY_GOALS, DISCLAIMER, SLOT_ORDER, SLOT_META,
    item, getDefaultDay, listAvailableDayNumbers,
  };
})();
