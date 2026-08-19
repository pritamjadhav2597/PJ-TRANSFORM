/**
 * bollywood-program-data.js
 * ---------------------------------------------------------------------------
 * Static reference data for the "100 Day Body Program" — mirrors
 * the pattern used throughout the app (program-templates.js, food-database.js,
 * meal-calendar-data.js): pure data + pure builder functions, no storage
 * access. Nutrition preview numbers are always computed via the real
 * FoodCalc engine from the real FoodDatabase — nothing here hardcodes a
 * calorie/protein figure. Workout weights/targets are the supplied source
 * program's starting targets, not a universal prescription — the actual
 * personalized calorie/protein/water/step targets always come from
 * Calculations.calculateAllTargets().
 *
 * IMPORTANT — content honesty:
 *   - Phase 3's "Day 1 — Push" exercise list was not included in the
 *     supplied source material (only Day 2/3/5/6 were). Per the "do not
 *     invent workouts" rule, that day is left as an explicit placeholder
 *     rather than a fabricated Push routine.
 *   - Phases 4 (Shredding) and 5 (Peak Week) are "Coming Soon" — no
 *     workout, nutrition, cardio, or supplement content is invented for
 *     them anywhere in this file.
 * ---------------------------------------------------------------------------
 */

const BollywoodProgramData = (() => {

  const PROGRAM_TYPE = '100_day_bollywood';
  const PROGRAM_NAME = '100 Day Body Program';
  const TOTAL_DAYS = 100;

  const DISCLAIMER =
    "This program is a structured training and nutrition template, not medical advice and not a promise of a specific result. " +
    "The example calorie/protein/fat/carb numbers quoted throughout this program (e.g. for an 80 kg reference person) are the SOURCE program's worked example only — " +
    "your own targets always come from your personalized calculation engine (Profile \u2192 Calculated Targets), never from this example.";

  // -------------------------------------------------------------------
  // PHASES
  // -------------------------------------------------------------------

  const PHASES = [
    { order: 1, phaseKey: 'foundation_week', name: 'Foundation Week', startDay: 1, endDay: 7, comingSoon: false, goalType: '' },
    { order: 2, phaseKey: 'building_the_base', name: 'Building the Base', subtitle: 'Fat Burning Mode', startDay: 8, endDay: 35, comingSoon: false, goalType: 'fat_loss' },
    { order: 3, phaseKey: 'muscle_building_mode', name: 'Muscle Building Mode', startDay: 36, endDay: 63, comingSoon: false, goalType: 'body_recomposition' },
    { order: 4, phaseKey: 'shredding_phase', name: 'Shredding Phase', startDay: 64, endDay: 91, comingSoon: true, goalType: 'fat_loss' },
    { order: 5, phaseKey: 'peak_week', name: 'Peak Week', startDay: 92, endDay: 100, comingSoon: true, goalType: '' },
  ];

  function buildPhases(programId, startDate) {
    return PHASES.map(p => Models.createProgramPhase(programId, {
      order: p.order, phaseKey: p.phaseKey, name: p.name,
      startDay: p.startDay, endDay: p.endDay,
      startDate: ProgramTemplates.addDays(startDate, p.startDay - 1),
      endDate: ProgramTemplates.addDays(startDate, p.endDay - 1),
      comingSoon: p.comingSoon,
      goalType: p.goalType,
      notes: p.subtitle || '',
    }));
  }

  function findPhaseMeta(phaseKey) {
    return PHASES.find(p => p.phaseKey === phaseKey) || null;
  }

  /** Which phase a given 1-indexed program day falls into. */
  function phaseForDay(day) {
    return PHASES.find(p => day >= p.startDay && day <= p.endDay) || null;
  }

  /** Maps a phase + the day-within-that-phase to the workout category
   *  scheduled for it (e.g. Phase 2, phase-day 10 -> cycle day 3 -> "Legs"),
   *  using each phase's own weekly cycle. Returns null on a rest day. */
  function getTodayWorkoutCategory(phase, dayInPhase) {
    const cycleDay = ((dayInPhase - 1) % 7) + 1;
    const scheduleByPhaseKey = {
      foundation_week: PHASE1_WEEKLY_SCHEDULE,
      building_the_base: PHASE2_WEEKLY_SCHEDULE,
      muscle_building_mode: PHASE3_WEEKLY_SCHEDULE,
    };
    const schedule = scheduleByPhaseKey[phase.phaseKey];
    if (!schedule) return null;
    const entry = schedule.find(d => d.day === cycleDay);
    return (entry && entry.label !== 'Rest') ? entry.label : null;
  }

  // -------------------------------------------------------------------
  // Exercise builder — same computation path as seed.js's wex(): looks up
  // ExerciseLibrary for muscle group/type when the name matches, otherwise
  // uses the explicit overrides given here.
  // -------------------------------------------------------------------

  function ex(name, overrides = {}) {
    const found = (typeof ExerciseLibrary !== 'undefined') ? ExerciseLibrary.findByName(name) : null;
    return Models.createWorkoutTemplateExercise({
      exerciseName: name,
      muscleGroup: found ? found.muscleGroup : (overrides.muscleGroup || ''),
      exerciseType: overrides.exerciseType || (found ? found.type : 'compound'),
      isCardio: !!overrides.isCardio,
      ...overrides,
    });
  }

  /** A normal (non-grouped) strength exercise. */
  function strength(name, sets, repsMin, repsMax, restSeconds, overrides = {}) {
    return ex(name, { targetSets: sets, targetRepsMin: repsMin, targetRepsMax: repsMax, restSeconds, ...overrides });
  }

  /** Builds a structural group (superset / giant set): every exercise
   *  shares one groupId + groupType + groupLabel + totalRounds, with
   *  groupOrder marking position (A1/A2/A3...) and restAfterGroupSeconds
   *  applying once per full round, not between the group's own exercises. */
  function group(groupType, label, rounds, restAfterGroupSeconds, entries) {
    const groupId = Models.generateId('wgrp');
    return entries.map((e, i) => Object.assign(e, {
      groupId, groupType, groupLabel: label, groupOrder: i + 1, totalRounds: rounds, restAfterGroupSeconds,
    }));
  }

  function dropSet(entry, dropPercentage) {
    return Object.assign(entry, { groupType: entry.groupType || 'DROP_SET', dropPercentage });
  }

  function cardio(name, mode, overrides = {}) {
    return ex(name, { isCardio: true, exerciseType: 'cardio', cardioMode: mode, ...overrides });
  }

  // -------------------------------------------------------------------
  // PHASE 1 — FOUNDATION WEEK — Full Body (Days 1-6), Day 7 rest
  // -------------------------------------------------------------------

  function buildPhase1FullBodyExercises() {
    return [
      strength('Incline Dumbbell Press', 3, 12, 15, 75, { exerciseType: 'compound', muscleGroup: 'chest' }),
      strength('Pec Deck Fly', 3, 12, 15, 60, { exerciseType: 'isolation', muscleGroup: 'chest' }),
      strength('Lat Pulldown', 3, 12, 15, 75, { exerciseType: 'compound', muscleGroup: 'back' }),
      strength('Face Pulls', 3, 15, 20, 60, { exerciseType: 'isolation', muscleGroup: 'shoulders', formNotes: 'Rear delts / upper back.' }),
      strength('Leg Extension', 3, 12, 15, 60, { exerciseType: 'isolation', muscleGroup: 'legs' }),
      strength('Leg Curl', 3, 12, 15, 60, { exerciseType: 'isolation', muscleGroup: 'legs' }),
      strength('Calf Raises', 3, 15, 20, 60, { exerciseType: 'isolation', muscleGroup: 'legs' }),
      strength('Lateral Delt Raises', 3, 12, 15, 60, { exerciseType: 'isolation', muscleGroup: 'shoulders' }),
      ex('Plank', { targetSets: 3, targetRepsMin: 30, targetRepsMax: 60, restSeconds: 45, exerciseType: 'isolation', muscleGroup: 'abs_core', notes: 'Reps field = seconds held.' }),
      cardio('Moderate Cardio (Treadmill/Cycling/Cross Trainer/Brisk Walk)', 'liss', { targetDurationMinutes: 12, notes: 'You should be able to hold a conversation.' }),
    ];
  }

  const PHASE1_WEEKLY_SCHEDULE = [
    { day: 1, label: 'Full Body' }, { day: 2, label: 'Full Body' }, { day: 3, label: 'Full Body' },
    { day: 4, label: 'Full Body' }, { day: 5, label: 'Full Body' }, { day: 6, label: 'Full Body' },
    { day: 7, label: 'Rest' },
  ];

  const PHASE1_REMOVE_FOODS = [
    'Sugar', 'Mithai', 'Sweets', 'Chocolate', 'Biscuits', 'Ladoo', 'Barfi', 'Sugary drinks', 'Cold drinks',
    'Energy drinks', 'Packaged juices', 'Sweetened chai', 'Junk food', 'Pizza', 'Burger', 'Samosa', 'Pakora',
    'Chips', 'Namkeen', 'Momos', 'Maida products', 'Naan', 'White bread', 'Cakes', 'Pastries', 'Alcohol',
  ];
  const PHASE1_RECOMMENDED_FOODS = {
    proteins: ['Eggs', 'Chicken', 'Fish', 'Paneer', 'Dal', 'Curd', 'Milk'],
    carbohydrates: ['Roti', 'Rice', 'Oats', 'Poha', 'Upma', 'Sweet potato'],
    vegetables: ['Sabji', 'Salads', 'Any vegetables'],
    healthyFats: ['Ghee', 'Nuts', 'Seeds', 'Coconut'],
    fruits: ['Fresh fruits (max 2 servings/day, source guideline)'],
  };

  // -------------------------------------------------------------------
  // PHASE 2 — BUILDING THE BASE — Push / Pull / Legs, Days 8-35
  // -------------------------------------------------------------------

  function buildPhase2PushExercises() {
    return [
      strength('Incline Bench Press', 3, 10, 10, 90, { exerciseType: 'compound', muscleGroup: 'chest' }),
      strength('Incline Dumbbell Press', 3, 12, 12, 90, { exerciseType: 'compound', muscleGroup: 'chest' }),
      strength('Flat Dumbbell Fly', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'chest' }),
      strength('Machine Incline Press', 3, 12, 12, 90, { exerciseType: 'compound', muscleGroup: 'chest' }),
      strength('Dumbbell Shoulder Press', 3, 10, 10, 90, { exerciseType: 'compound', muscleGroup: 'shoulders' }),
      strength('Side Lateral Raises', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'shoulders' }),
      strength('Tricep Pushdown', 3, 12, 12, 60, { exerciseType: 'isolation', muscleGroup: 'arms' }),
      strength('Skull Crushers', 3, 12, 12, 60, { exerciseType: 'isolation', muscleGroup: 'arms' }),
      cardio('LISS (Treadmill / Cycling / Cross Trainer)', 'liss', { targetDurationMinutes: 17 }),
    ];
  }
  function buildPhase2PullExercises() {
    return [
      strength('Lat Pulldown', 3, 12, 12, 90, { exerciseType: 'compound', muscleGroup: 'back' }),
      strength('T-Bar Row', 3, 12, 12, 90, { exerciseType: 'compound', muscleGroup: 'back' }),
      strength('Seated Cable Row', 3, 12, 12, 90, { exerciseType: 'compound', muscleGroup: 'back' }),
      strength('Face Pulls', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'shoulders' }),
      strength('Dumbbell Shrugs', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'back' }),
      strength('Dumbbell Bicep Curls', 3, 12, 12, 60, { exerciseType: 'isolation', muscleGroup: 'arms' }),
      strength('Preacher Curls', 3, 12, 12, 60, { exerciseType: 'isolation', muscleGroup: 'arms' }),
      cardio('LISS (Treadmill / Cycling / Cross Trainer)', 'liss', { targetDurationMinutes: 17 }),
    ];
  }
  function buildPhase2LegsExercises() {
    return [
      strength('Barbell Back Squat', 4, 10, 10, 120, { exerciseType: 'compound', muscleGroup: 'legs' }),
      strength('Leg Extension', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'legs' }),
      strength('Leg Press', 3, 12, 12, 90, { exerciseType: 'compound', muscleGroup: 'legs' }),
      strength('Leg Curls', 3, 12, 12, 60, { exerciseType: 'isolation', muscleGroup: 'legs' }),
      ex('Walking Lunges', { targetSets: 3, targetRepsMin: 20, targetRepsMax: 20, restSeconds: 75, exerciseType: 'compound', muscleGroup: 'legs', notes: 'Reps = total steps.' }),
      strength('Calf Raises', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'legs' }),
      strength('Back Extension', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'back' }),
      cardio('LISS (Treadmill / Cycling / Cross Trainer)', 'liss', { targetDurationMinutes: 17 }),
    ];
  }

  const PHASE2_WEEKLY_SCHEDULE = [
    { day: 1, label: 'Push' }, { day: 2, label: 'Pull' }, { day: 3, label: 'Legs' },
    { day: 4, label: 'Push' }, { day: 5, label: 'Pull' }, { day: 6, label: 'Legs' }, { day: 7, label: 'Rest' },
  ];

  /** Abs mini-routine — performed after the main workout, before cardio,
   *  6 days/week (day 7 rest), rotating through 6 short routines. */
  const PHASE2_ABS_ROTATION = [
    { day: 1, title: 'Upper Abs', exercises: [['Crunches', '3 \u00d7 20'], ['Toe Touches', '3 \u00d7 15']] },
    { day: 2, title: 'Lower Abs', exercises: [['Reverse Crunches', '3 \u00d7 15'], ['Leg Raises', '3 \u00d7 12']] },
    { day: 3, title: 'Obliques', exercises: [['Bicycle Crunches', '3 \u00d7 20 each side'], ['Side Plank', '3 \u00d7 30 sec each side']] },
    { day: 4, title: 'Core Stability', exercises: [['Plank', '3 \u00d7 45\u201360 sec'], ['Dead Bug', '3 \u00d7 12 each side']] },
    { day: 5, title: 'Upper + Lower', exercises: [['V-Ups', '3 \u00d7 12'], ['Mountain Climbers', '3 \u00d7 30 sec']] },
    { day: 6, title: 'Total Core', exercises: [['Crunches', '3 \u00d7 20'], ['Plank', '3 \u00d7 45\u201360 sec']] },
    { day: 7, title: 'Rest', exercises: [] },
  ];

  const PHASE2_VEGETARIAN_PROTEIN_FOODS = [
    'Paneer (100 g)', 'Tofu (100 g)', 'Soy chunks dry (50 g)', 'Moong dal cooked (1 bowl)', 'Rajma / Chole (1 bowl)',
    'Curd / Yogurt (200 g)', 'Greek yogurt / Hung curd (150 g)', 'Whey protein (1 scoop)', 'Peanuts (30 g)',
    'Peanut butter (1 tbsp)', 'Soy milk (200 ml)', 'Cottage cheese / Chenna (100 g)', 'Moong sprouts (1 bowl)',
  ];

  const PHASE2_FASTING = { window: '8:00 PM \u2192 12:00 PM next day', eatingWindow: '12:00 PM \u2192 8:00 PM', meals: '2 main meals + 1 snack', duringFasting: ['Water', 'Black coffee', 'Green tea', 'Zero-calorie beverages'] };

  /** Source-example macro formula (illustrative only — see DISCLAIMER;
   *  the app always uses Calculations.calculateAllTargets() for the
   *  person's actual target). */
  function phase2ExampleMacros(bodyweightKg) {
    const maintenance = Math.round(bodyweightKg * 29);
    const calorieTarget = maintenance - 500;
    const proteinG = Math.round(bodyweightKg * 2);
    const fatG = Math.round(bodyweightKg * 0.9);
    const carbG = Math.round((calorieTarget - proteinG * 4 - fatG * 9) / 4);
    return { maintenance, calorieTarget, proteinG, fatG, carbG };
  }
  function phase3ExampleMacros(bodyweightKg) {
    const maintenance = Math.round(bodyweightKg * 29);
    const calorieTarget = maintenance - 300;
    const proteinG = Math.round(bodyweightKg * 2);
    const fatG = Math.round(bodyweightKg * 0.9);
    const carbG = Math.round((calorieTarget - proteinG * 4 - fatG * 9) / 4);
    return { maintenance, calorieTarget, proteinG, fatG, carbG };
  }

  // Meal-item builder, identical computation path to seed.js's genericItem().
  function mealItem(category, itemKey, prepKey, quantity, unit, note = '') {
    const foodItem = FoodDatabase.findItem(category, itemKey);
    const prep = FoodDatabase.findPreparation(category, itemKey, prepKey);
    const computed = prep && prep.per100g ? FoodCalc.computeGenericNutrition(prep.per100g, quantity, unit) : null;
    return Models.createMealTemplateItem({
      sourceType: 'generic', foodCategory: category, foodItemKey: itemKey, preparationKey: prepKey,
      preparationLabel: prep ? prep.label : '', foodLabel: foodItem ? foodItem.label : '',
      quantity, unit, preparation: prep ? prep.label : '',
      measurementBasis: (prepKey === 'dry_raw' || prepKey === 'raw' || prepKey === 'raw_package' || prepKey === 'as_is') ? 'before_cooking' : 'after_cooking',
      notes: note, computedNutrition: computed,
    });
  }
  // For foods not in FoodDatabase yet (e.g. tofu, whey) — logged as custom
  // with no invented nutrition, per "do not invent missing nutrition values".
  function customMealItem(label, quantity, unit, note = '') {
    return Models.createMealTemplateItem({
      sourceType: 'custom', foodLabel: label, quantity, unit,
      measurementBasis: 'after_cooking', notes: note || 'No database figure yet — enter nutrition manually or use a saved product.',
      manualNutrients: { calories: null, proteinG: null, carbsG: null, fatG: null, fibreG: null, sugarG: null },
    });
  }

  function buildPhase2MealOptionA() {
    return [
      customMealItem('Paneer Bhurji', 200, 'g', 'Meal 1, 12:00 PM'),
      customMealItem('Chole / Rajma', 1, 'serving', 'Meal 1 — 1 large thick bowl'),
      mealItem('jowar', 'jowar', 'cooked', 80, 'g', 'Meal 1 — 2 whole wheat roti (substitute with roti in your food log)'),
      mealItem('vegetables', 'salad_mixed_raw', 'raw', 150, 'g', 'Meal 1 — salad'),
      customMealItem('Whey Protein (2 scoops)', 2, 'serving', 'Snack, 3-4 PM'),
      mealItem('nuts', 'peanuts', 'raw', 30, 'g', 'Snack — roasted peanuts'),
      customMealItem('Tofu / Soy Chunks Curry', 150, 'g', 'Meal 2, 7-8 PM — 150g tofu OR 50g dry soy'),
      mealItem('legumes', 'moong_dal_split', 'boiled', 200, 'g', 'Meal 2 — moong dal, 1 large bowl'),
      mealItem('grains', 'rice_white', 'cooked', 150, 'g', 'Meal 2 — rice, 1 small cup cooked'),
      mealItem('vegetables', 'mixed_vegetables_cooked', 'cooked', 200, 'g', 'Meal 2 — sabzi'),
    ];
  }
  function buildPhase2MealOptionB() {
    return [
      mealItem('soy_chunks', 'soy_chunks', 'dry_raw', 50, 'g', 'Meal 1, 12 PM — soy chunks dry sabzi'),
      customMealItem('Paneer Paratha (2, 150g paneer)', 2, 'piece', 'Meal 1'),
      mealItem('curd', 'curd', 'as_is', 200, 'g', 'Meal 1 — curd/raita'),
      customMealItem('Whey Protein (2 scoops)', 2, 'serving', 'Snack, 3-4 PM'),
      customMealItem('Soy Milk', 200, 'ml', 'Snack'),
      customMealItem('Peanut Butter', 1, 'custom', 'Snack — 1 tbsp'),
      customMealItem('Tofu Tikka / Grilled Tofu', 200, 'g', 'Meal 2, 7-8 PM'),
      customMealItem('Dal Makhani', 1, 'serving', 'Meal 2 — 1 large bowl'),
      mealItem('grains', 'rice_white', 'cooked', 150, 'g', 'Meal 2 — rice, 1 small cup cooked'),
      customMealItem('Buttermilk / Chaas', 1, 'custom', 'Meal 2 — 1 glass'),
    ];
  }

  // -------------------------------------------------------------------
  // PHASE 3 — MUSCLE BUILDING MODE — Days 36-63
  // -------------------------------------------------------------------

  const PHASE3_WEEKLY_SCHEDULE = [
    { day: 1, label: 'Push' }, { day: 2, label: 'Pull' }, { day: 3, label: 'Legs' }, { day: 4, label: 'Rest' },
    { day: 5, label: 'Chest + Back' }, { day: 6, label: 'Arms + Delts' }, { day: 7, label: 'Rest' },
  ];

  function buildPhase3PullExercises() {
    return [
      strength('Deadlift / Rack Pulls', 4, 6, 8, 150, { exerciseType: 'compound', muscleGroup: 'back' }),
      strength('Weighted Pull-Ups / Lat Pulldown', 3, 8, 10, 120, { exerciseType: 'compound', muscleGroup: 'back' }),
      strength('T-Bar Row', 3, 10, 12, 90, { exerciseType: 'compound', muscleGroup: 'back' }),
      ...group('SUPERSET', 'A', 3, 60, [
        strength('Seated Cable Row', 3, 12, 12, 0, { exerciseType: 'compound', muscleGroup: 'back' }),
        strength('Face Pulls', 3, 15, 15, 0, { exerciseType: 'isolation', muscleGroup: 'shoulders' }),
      ]),
      strength('Barbell Curls', 3, 10, 12, 60, { exerciseType: 'isolation', muscleGroup: 'arms' }),
      dropSet(strength('Hammer Curls', 3, 12, 12, 60, { exerciseType: 'isolation', muscleGroup: 'arms' }), 20),
      cardio('Sprints', 'sprint', { sprintRounds: 5, sprintDistanceM: 125, notes: '4\u20136 rounds \u00d7 100\u2013150 m' }),
    ];
  }

  function buildPhase3LegsExercises() {
    return [
      strength('Barbell Squats', 4, 8, 10, 150, { exerciseType: 'compound', muscleGroup: 'legs' }),
      strength('Romanian Deadlifts', 3, 10, 12, 120, { exerciseType: 'compound', muscleGroup: 'legs' }),
      dropSet(strength('Leg Press', 3, 12, 12, 90, { exerciseType: 'compound', muscleGroup: 'legs', notes: 'Drop set on last set only.' }), 20),
      ex('Walking Lunges', { targetSets: 3, targetRepsMin: 12, targetRepsMax: 12, restSeconds: 75, exerciseType: 'compound', muscleGroup: 'legs', notes: '12 reps each leg.' }),
      ...group('SUPERSET', 'A', 3, 60, [
        strength('Leg Extension', 3, 15, 15, 0, { exerciseType: 'isolation', muscleGroup: 'legs' }),
        strength('Leg Curls', 3, 15, 15, 0, { exerciseType: 'isolation', muscleGroup: 'legs' }),
      ]),
      dropSet(strength('Calf Raises', 4, 15, 20, 60, { exerciseType: 'isolation', muscleGroup: 'legs', notes: 'Drop set on last set only.' }), 20),
      ex('Plank', { targetSets: 3, targetRepsMin: 60, targetRepsMax: 60, restSeconds: 45, exerciseType: 'isolation', muscleGroup: 'abs_core', notes: 'Reps field = seconds held.' }),
      cardio('LISS', 'liss', { targetDurationMinutes: 15 }),
    ];
  }

  function buildPhase3ChestBackExercises() {
    return [
      ...group('GIANT_SET', 'A', 3, 90, [
        strength('Incline Dumbbell Press', 3, 10, 12, 0, { exerciseType: 'compound', muscleGroup: 'chest' }),
        strength('Lat Pulldown', 3, 10, 12, 0, { exerciseType: 'compound', muscleGroup: 'back' }),
        strength('Dumbbell Pullovers', 3, 12, 15, 0, { exerciseType: 'isolation', muscleGroup: 'chest' }),
      ]),
      ...group('GIANT_SET', 'B', 3, 90, [
        strength('Pec Deck Fly / Cable Fly', 3, 12, 15, 0, { exerciseType: 'isolation', muscleGroup: 'chest' }),
        strength('Seated Cable Row', 3, 10, 12, 0, { exerciseType: 'compound', muscleGroup: 'back' }),
        ex('Push-Ups', { targetSets: 3, toFailure: true, restSeconds: 0, exerciseType: 'compound', muscleGroup: 'chest' }),
      ]),
      cardio('Sprints', 'sprint', { sprintRounds: 5, sprintDistanceM: 125, notes: '4\u20136 rounds \u00d7 100\u2013150 m. Keep weights moderate; focus on pump and contraction.' }),
    ];
  }

  function buildPhase3ArmsDeltsExercises() {
    return [
      ...group('SUPERSET', 'A', 3, 60, [
        strength('Barbell Curl', 3, 10, 12, 0, { exerciseType: 'isolation', muscleGroup: 'arms' }),
        strength('Skull Crushers', 3, 10, 12, 0, { exerciseType: 'isolation', muscleGroup: 'arms' }),
      ]),
      ...group('SUPERSET', 'B', 3, 60, [
        strength('Preacher Curls', 3, 12, 12, 0, { exerciseType: 'isolation', muscleGroup: 'arms' }),
        strength('Tricep Rope Pushdown', 3, 12, 12, 0, { exerciseType: 'isolation', muscleGroup: 'arms' }),
      ]),
      ...group('SUPERSET', 'C', 3, 60, [
        dropSet(strength('Hammer Curls', 3, 12, 12, 0, { exerciseType: 'isolation', muscleGroup: 'arms', notes: 'Drop set both exercises on the last round.' }), 20),
        dropSet(strength('Overhead Tricep Extension', 3, 12, 12, 0, { exerciseType: 'isolation', muscleGroup: 'arms', notes: 'Drop set both exercises on the last round.' }), 20),
      ]),
      strength('Seated DB Shoulder Press', 3, 10, 12, 75, { exerciseType: 'compound', muscleGroup: 'shoulders' }),
      dropSet(strength('Lateral Raises', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'shoulders', notes: 'Drop set last set.' }), 20),
      strength('Rear Delt Fly / Face Pulls', 3, 15, 15, 60, { exerciseType: 'isolation', muscleGroup: 'shoulders' }),
      cardio('LISS', 'liss', { targetDurationMinutes: 15 }),
    ];
  }

  /** Day 1 — Push: the source material referenced this section but did not
   *  supply its exercise list (unlike Days 2/3/5/6). Per "do not invent
   *  workouts", this returns null rather than a fabricated Push day; the UI
   *  must show this as "content not yet provided", not silently skip it. */
  function buildPhase3PushExercises() {
    return null;
  }

  const PHASE3_REST_DAY_GUIDANCE = {
    sleepHours: '7\u20138 hours minimum',
    nutrition: 'Hit protein and calorie targets',
    hydration: '4+ liters guideline',
    stretching: '10\u201315 min light stretching',
    walking: 'Optional 20\u201330 min easy walk',
    rule: 'Do not train. Do not add an extra workout.',
  };

  const PHASE3_WEEKLY_RULE = 'Increase weight or reps on at least 2 exercises where appropriate. Do not automatically increase weight if form or performance does not support it.';

  // -------------------------------------------------------------------
  // WARM-UP / COOL-DOWN
  // -------------------------------------------------------------------

  const WARMUP_COOLDOWN = {
    push: { warmupMinutes: 6, routine: ['5\u20137 min light cardio', 'Dynamic shoulder/chest mobility', 'Activation set(s) for chest/shoulders/triceps', 'Light warm-up set(s) before the first heavy exercise'] },
    pull: { warmupMinutes: 6, routine: ['5\u20137 min light cardio', 'Dynamic back/lat mobility', 'Band pull-aparts for activation', 'Light warm-up set(s) before the first heavy pull'] },
    legs: { warmupMinutes: 8, routine: ['7\u201310 min light cardio', 'Dynamic hip/ankle mobility', 'Bodyweight squats / leg swings for activation', 'Light warm-up set(s) before the first heavy lift'] },
    full_body: { warmupMinutes: 6, routine: ['5\u20137 min light cardio', 'Full-body dynamic mobility', 'Light activation sets for the day\u2019s major movements'] },
    cooldown: { minutes: 5, routine: ['Static stretches, ~30\u201345 sec holds', 'Breathe normally', 'Never stretch through sharp pain'] },
  };

  return {
    PROGRAM_TYPE, PROGRAM_NAME, TOTAL_DAYS, DISCLAIMER,
    PHASES, buildPhases, findPhaseMeta, phaseForDay, getTodayWorkoutCategory,
    buildPhase1FullBodyExercises, PHASE1_WEEKLY_SCHEDULE, PHASE1_REMOVE_FOODS, PHASE1_RECOMMENDED_FOODS,
    buildPhase2PushExercises, buildPhase2PullExercises, buildPhase2LegsExercises, PHASE2_WEEKLY_SCHEDULE,
    PHASE2_ABS_ROTATION, PHASE2_VEGETARIAN_PROTEIN_FOODS, PHASE2_FASTING, phase2ExampleMacros,
    buildPhase2MealOptionA, buildPhase2MealOptionB,
    PHASE3_WEEKLY_SCHEDULE, buildPhase3PushExercises, buildPhase3PullExercises, buildPhase3LegsExercises,
    buildPhase3ChestBackExercises, buildPhase3ArmsDeltsExercises, PHASE3_REST_DAY_GUIDANCE, PHASE3_WEEKLY_RULE,
    phase3ExampleMacros,
    WARMUP_COOLDOWN,
  };
})();
