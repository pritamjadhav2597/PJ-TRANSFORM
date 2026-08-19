/**
 * models.js
 * ---------------------------------------------------------------------------
 * Database-ready data model definitions for the Personal Transformation app.
 *
 * These are plain factory functions (not classes) so that the exact same
 * shape can later be produced by a real API/database layer. Every record
 * carries its own primary key (never rely on array position) and, where
 * relevant, a userId foreign key so multi-user data never mixes.
 *
 * Dates are stored as ISO 8601 strings (YYYY-MM-DD for calendar dates,
 * full ISO timestamp for created/updated audit fields) — never as
 * locale-formatted display strings. Formatting for display happens only
 * at render time (see utils.formatDate).
 * ---------------------------------------------------------------------------
 */

const Models = (() => {

  /** Collection names. Centralized so storage-service and pages never hardcode strings. */
  const COLLECTIONS = {
    USERS: 'users',
    PROFILES: 'profiles',
    PROGRAMS: 'programs',
    PROGRAM_PHASES: 'programPhases',
    DAILY_LOGS: 'dailyLogs',
    FOODS: 'foods',
    FOOD_PRODUCTS: 'foodProducts',
    MEALS: 'meals',
    MEAL_ITEMS: 'mealItems',
    MEAL_TEMPLATES: 'mealTemplates',
    NUTRITION_ENTRIES: 'nutritionEntries',
    WATER_ENTRIES: 'waterEntries',
    STEP_ENTRIES: 'stepEntries',
    WORKOUTS: 'workouts',
    WORKOUT_EXERCISES: 'workoutExercises',
    WORKOUT_SETS: 'workoutSets',
    WEIGHT_ENTRIES: 'weightEntries',
    MEASUREMENT_ENTRIES: 'measurementEntries',
    PROGRESS_PHOTOS: 'progressPhotos',
    SLEEP_ENTRIES: 'sleepEntries',
    RECOVERY_ENTRIES: 'recoveryEntries',
    SEXUAL_WELLBEING_ENTRIES: 'sexualWellbeingEntries',
    SHOPPING_LISTS: 'shoppingLists',
    SHOPPING_ITEMS: 'shoppingItems',
    TARGET_HISTORY: 'targetHistory',
    REPORTS: 'reports',
    SCHEDULE_ITEMS: 'scheduleItems',
    DAILY_CHECKLISTS: 'dailyChecklists',
    WORKOUT_TEMPLATES: 'workoutTemplates',
    MILESTONES: 'milestones',
    CRAVING_EVENTS: 'cravingEvents',
    MEAL_CALENDAR_PLANS: 'mealCalendarPlans',
    EXERCISE_VIDEOS: 'exerciseVideos',
  };

  /** Generates a reasonably unique, sortable-ish ID: prefix_timestamp36_random4 */
  function generateId(prefix) {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `${prefix}_${time}${rand}`;
  }

  const nowIso = () => new Date().toISOString();
  const todayIso = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // ---------------------------------------------------------------------
  // Core identity
  // ---------------------------------------------------------------------

  function createUser({ email = '', name = '', authProvider = 'local' } = {}) {
    return {
      userId: generateId('user'),
      email,               // reserved for future authentication
      name,
      authProvider,        // 'local' | 'email' | 'google' | ... (future)
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  function createProfile(userId, overrides = {}) {
    return {
      profileId: generateId('profile'),
      userId,
      name: '',
      age: null,
      sex: '',                    // 'male' | 'female' | 'other'
      heightCm: null,
      currentWeightKg: null,
      targetWeightKg: null,
      activityLevel: '',          // 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
      occupationType: '',         // e.g. 'mostly_sitting', 'mostly_standing', 'physical'
      averageDailySteps: null,
      trainingFrequencyPerWeek: null,
      dietaryPreference: '',      // 'vegetarian' | 'vegan' | 'omnivore' | 'pescatarian' | ...
      primaryGoal: '',
      goalType: '',                // 'fat_loss' | 'maintenance' | 'muscle_gain' | 'body_recomposition' | 'general_fitness'
      desiredWeeklyChangePercent: null, // optional manual override, % of bodyweight/week; null = engine picks a safe default
      programPreference: '60_day', // '60_day' | '1_year' | 'custom' — 60-Day Transformation is the app's personal/default goal; other users can change this on their own profile
      programStartDate: null,
      // optional fields
      bodyFatPercent: null,
      waistCm: null,
      chestCm: null,
      hipCm: null,
      armCm: null,
      thighCm: null,
      typicalSleepHours: null,
      exerciseDurationMinutes: null,
      exerciseIntensity: '',      // 'low' | 'moderate' | 'high'
      climate: 'temperate',        // 'temperate' | 'hot' | 'cold' — used for water target
      mealSplitPercent: null,      // { breakfast, lunch, pre_workout, dinner, snack, other } % of daily target per meal; null = DietEngine's default split
      activityLevelSource: 'auto', // 'auto' (derived from occupation/steps/training) | 'manual' (use activityLevel as-is)
      wellbeingDashboardVisible: false, // private by default — Sexual Wellbeing data never appears on the Dashboard unless explicitly enabled
      navOrder: [],                       // custom sidebar nav order (array of NAV_ITEMS path strings); [] = use the app's default order — see js/router.js and pages/settings.js
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Programs
  // ---------------------------------------------------------------------

  function createProgram(userId, overrides = {}) {
    return {
      programId: generateId('prog'),
      userId,
      name: '',
      goal: '',
      programType: 'custom',      // '60_day' | '1_year' | 'custom'
      startDate: null,
      endDate: null,
      durationDays: null,
      startingWeightKg: null,
      targetWeightKg: null,
      targetWeightMinKg: null,    // optional target range (e.g. 78–80kg); targetWeightKg is used as the calc-engine midpoint
      targetWeightMaxKg: null,
      status: 'draft',            // 'draft' | 'future' | 'active' | 'paused' | 'completed'
      currentPhaseId: null,
      pausedAt: null,
      pauseReason: '',
      resumedAt: null,
      completedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  function createProgramPhase(programId, overrides = {}) {
    return {
      phaseId: generateId('phase'),
      programId,
      name: '',
      phaseKey: '',                     // stable machine key, e.g. 'foundation_week' — used to look up static phase content
      order: 1,
      startDay: null,                    // relative day number within the program (1-indexed)
      endDay: null,
      startDate: null,
      endDate: null,
      comingSoon: false,                  // true = content not yet defined; UI shows "Coming Soon" and never invents content
      notes: '',
      // Optional per-phase overrides. Anything left null falls back to the
      // profile-driven calculation for that field (see Calculations.calculateAllTargets).
      goalType: '',                    // '' = inherit from profile
      calorieTarget: null,
      proteinTargetG: null,
      fatTargetG: null,
      carbTargetG: null,
      fibreTargetG: null,
      stepTarget: null,
      waterTargetMl: null,
      trainingFrequencyPerWeek: null,
      weightTargetKg: null,
      createdAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Daily log (rollup pointer for a given user+date; detail lives in
  // the specific entry collections below)
  // ---------------------------------------------------------------------

  function createDailyLog(userId, date = todayIso(), overrides = {}) {
    return {
      dailyLogId: generateId('dlog'),
      userId,
      date,
      programId: null,
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Food / nutrition
  // ---------------------------------------------------------------------

  function createFood(overrides = {}) {
    return {
      foodId: generateId('food'),
      name: '',
      caloriesPer100g: null,
      proteinPer100g: null,
      fatPer100g: null,
      carbsPer100g: null,
      fibrePer100g: null,
      createdAt: nowIso(),
      ...overrides,
    };
  }

  /**
   * A user-saved packaged Product. Every nutrient field is null until the
   * person types in what's printed on the label — nothing here is ever
   * auto-filled from the generic FoodDatabase. `labelBasis` records which
   * of the four ways the package printed its numbers, and the matching
   * size field (servingSizeG / pieceWeightG / customUnitG) is what lets a
   * Food Entry scale these values to an arbitrary logged quantity; when
   * that gram-equivalence isn't known, scaling is limited to whole
   * multiples of the label's own unit (see Calculations-style logic in
   * pages/nutrition.js: computeProductNutrition).
   */
  function createFoodProduct(userId, overrides = {}) {
    return {
      productId: generateId('prod'),
      userId,
      brand: '',
      name: '',
      barcode: '',

      // How the values below are printed on the package.
      labelBasis: 'per_100g',      // 'per_100g' | 'per_serving' | 'per_piece' | 'custom'
      servingSizeG: null,           // grams per serving, only if the label states it
      servingSizeLabel: '',         // free text, e.g. "1 scoop (30 g)"
      pieceWeightG: null,           // grams per piece, only if the label states it
      pieceLabel: '',                // e.g. "1 biscuit"
      customUnitLabel: '',           // e.g. "1 bar", "1 sachet"
      customUnitG: null,             // grams per custom unit, only if known

      nutrients: {
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        saturatedFatG: null,
        fibreG: null,
        sugarG: null,
        calciumMg: null,
        potassiumMg: null,
        magnesiumMg: null,
        ironMg: null,
        zincMg: null,
        sodiumMg: null,
        vitaminCMg: null,
        vitaminAMcg: null,
        folateMcg: null,
        vitaminB12Mcg: null,
        vitaminDMcg: null,
        omega3Mg: null,
      },
      otherNutrients: [],   // [{ label: 'e.g. Vitamin E', amount: '2.4 mg' }] — free-form, printed-as-is

      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  /**
   * A reusable Meal Template ("Breakfast", "Pre-workout", ...) — a saved
   * list of food items a person can log in one action. Item shape mirrors
   * the food-selection fields of a Food Entry (see createMealItem) minus
   * date/userId/mealType, which belong to the template itself or to the
   * logged entry created from it. `computedNutrition` on each item is a
   * preview only — logging always recomputes fresh via FoodCalc so a
   * later product edit is reflected (see FoodCalc.computeEntryNutrition).
   */
  function createMealTemplateItem(overrides = {}) {
    return {
      itemId: generateId('titem'),
      sourceType: '',          // 'generic' | 'product' | 'custom'
      foodCategory: '', foodItemKey: '', preparationKey: '', preparationLabel: '',
      productId: null,
      foodLabel: '', brand: '',
      quantity: null, unit: 'g', customUnitLabel: '',
      preparation: '',
      measurementBasis: '',
      cookingOilG: null, cookingOilLabel: '',
      notes: '',
      manualNutrients: null,   // used when sourceType is 'custom', or 'generic' with no database figure
      computedNutrition: null, // preview only, see note above
      ...overrides,
    };
  }

  function createMealTemplate(userId, overrides = {}) {
    return {
      mealTemplateId: generateId('mtpl'),
      userId,
      programId: null,   // null = general/unscoped template, shown regardless of active program (preserves existing behavior)
      phaseId: null,
      name: '',
      mealType: '',        // 'breakfast' | 'lunch' | 'pre_workout' | 'dinner' | 'snack'
      dietType: '',          // '' | 'vegetarian' | 'egg_vegetarian' | 'non_vegetarian' — which diet preference this option suits
      isFavorite: false,
      items: [],            // createMealTemplateItem() entries
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  /**
   * One day's worth of the Meal Calendar (see meal-calendar-data.js for the
   * static Day 1-15 defaults this overrides). Only created once a person
   * actually edits/replaces/removes/adds/duplicates an item for that day —
   * until then the page reads straight from the static default so nothing
   * is written just for viewing. `slots` mirrors MealCalendarData's shape:
   * { breakfast: [items], lunch: [...], pre_workout: [...], dinner: [...], snack: [...] }.
   * Each item mirrors createMealTemplateItem's shape (see MealCalendarData.item).
   */
  function createMealCalendarPlan(userId, overrides = {}) {
    return {
      mealCalendarPlanId: generateId('mcplan'),
      userId,
      programType: '60_day',
      dayNumber: 1,
      slots: { breakfast: [], lunch: [], pre_workout: [], dinner: [], snack: [] },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  /**
   * A person-attached demo video for an exercise the built-in library
   * doesn't already ship one for (see exercise-library.js's doc comment —
   * the app never invents a video link it hasn't verified). Keyed by the
   * exercise's normalized name so it's shared across every workout/template
   * that uses that exercise, not tied to one specific instance of it.
   */
  function createExerciseVideo(exerciseKey, overrides = {}) {
    return {
      exerciseVideoId: generateId('exvid'),
      exerciseKey,          // normalized (lowercased/trimmed) exercise name
      exerciseName: '',     // original display-case name, for reference
      videoId: null,        // YouTube video ID, when the link is a YouTube URL
      url: '',               // raw URL as pasted, kept for non-YouTube links
      addedByUserId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  function createMeal(userId, overrides = {}) {
    return {
      mealId: generateId('meal'),
      userId,
      date: todayIso(),
      mealType: '',   // 'breakfast' | 'lunch' | 'dinner' | 'snack'
      name: '',
      createdAt: nowIso(),
      ...overrides,
    };
  }

  /**
   * A single logged Food Entry (stored in the mealItems collection). This
   * is intentionally denormalized — date/mealType live directly on the
   * entry — so the Food Entry UI never has to juggle a separate Meal
   * object. `mealId` stays available for future grouping but is not
   * required.
   *
   * sourceType: 'generic' (FoodDatabase) | 'product' (saved FoodProduct) | 'custom' (typed in by hand)
   * nutritionSource: 'generic_estimate' | 'product_label' | 'user_entered' — always shown to the person.
   */
  function createMealItem(userId, overrides = {}) {
    return {
      mealItemId: generateId('mitem'),
      mealId: null,
      userId,
      programId: null,          // set when logged from a program-scoped Meal Template (see pages/diet.js logTemplateToDate)
      date: todayIso(),
      mealType: '',            // 'breakfast' | 'lunch' | 'pre_workout' | 'dinner' | 'snack' | 'other'

      sourceType: '',           // 'generic' | 'product' | 'custom'
      nutritionSource: '',      // 'generic_estimate' | 'product_label' | 'user_entered'

      // Generic-food reference (sourceType === 'generic')
      foodCategory: '',
      foodItemKey: '',
      preparationKey: '',
      preparationLabel: '',

      // Product reference (sourceType === 'product')
      productId: null,

      // Shared display fields (captured at entry time so history reads
      // correctly even if the product/food record changes later).
      foodLabel: '',
      brand: '',

      quantity: null,
      unit: 'g',                // 'g' | 'ml' | 'serving' | 'piece' | 'custom'
      customUnitLabel: '',

      preparation: '',           // free label shown to the user (mirrors preparationLabel for generic/custom foods)
      measurementBasis: '',      // 'before_cooking' | 'after_cooking' — required, never silently converted

      cookingOilG: null,
      cookingOilLabel: '',        // e.g. "Sunflower oil" — optional free text

      notes: '',

      // Computed at save time from the source values (see pages/nutrition.js).
      // Null fields mean "not entered on the source" — never fabricated.
      computedNutrition: null,

      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  function createNutritionEntry(userId, date = todayIso(), overrides = {}) {
    return {
      nutritionEntryId: generateId('nutr'),
      userId,
      date,
      totalCalories: null,
      totalProteinG: null,
      totalFatG: null,
      totalCarbsG: null,
      totalFibreG: null,
      createdAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Water / steps
  // ---------------------------------------------------------------------

  function createWaterEntry(userId, date = todayIso(), overrides = {}) {
    return {
      waterEntryId: generateId('water'),
      userId,
      date,
      amountMl: null,
      source: 'manual',   // 'manual' | future device provider key — see device-integration.js
      createdAt: nowIso(),
      ...overrides,
    };
  }

  function createStepEntry(userId, date = todayIso(), overrides = {}) {
    return {
      stepEntryId: generateId('step'),
      userId,
      date,
      steps: null,
      source: 'manual',   // 'manual' | future device provider key — see device-integration.js
      createdAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Workouts — logged sessions. See createWorkoutTemplate below for the
  // *planned* weekly split; these records are what actually happened.
  // ---------------------------------------------------------------------

  function createWorkout(userId, overrides = {}) {
    return {
      workoutId: generateId('wkt'),
      userId,
      programId: null,
      templateId: null,      // the WorkoutTemplate this session was started from, if any
      date: todayIso(),
      dayOfWeek: '',           // 'monday'..'sunday' — convenience copy from the template
      name: '',
      status: 'in_progress',   // 'in_progress' | 'completed' | 'paused'
      durationMinutes: null,
      notes: '',
      // Live-session timing — powers the elapsed-time readout and the rest
      // timer in the immersive Workout Mode (see workout-session.js). Every
      // workout gets a startedAt the moment it's created; pausing the whole
      // session (not just a rest timer) accumulates into totalPausedMs so
      // elapsed time never counts time the person wasn't actually training.
      startedAt: nowIso(),
      completedAt: null,
      pausedAt: null,
      totalPausedMs: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  /** One exercise within a logged session. Per-set weight/reps/RIR live on
   *  WorkoutSet below; difficulty/form/notes are logged once per exercise
   *  per session rather than per set. Cardio exercises (isCardio: true)
   *  use the cardio* fields instead of sets.
   *
   *  Advanced set structures (superset/drop set/giant set) are stored
   *  STRUCTURALLY, never as a text note: `groupId` ties multiple exercises
   *  together, `groupType` says what kind of group it is, `groupOrder` is
   *  this exercise's position within the group (A1/A2/A3...), and `round`
   *  is which repetition of the group this is (giant sets are done for N
   *  rounds). `restAfterGroupSeconds` is the rest taken once the WHOLE
   *  group is complete (per-exercise rest inside a group is 0 by design —
   *  supersets/giant sets have no rest between their own exercises). */
  function createWorkoutExercise(workoutId, overrides = {}) {
    return {
      workoutExerciseId: generateId('wex'),
      workoutId,
      exerciseName: '',
      muscleGroup: '',
      exerciseType: 'compound',  // 'compound' | 'isolation' | 'cardio'
      isCardio: false,
      order: 1,

      // Targets carried from the template (or set directly for a custom exercise)
      // for reference only — actual performance lives on WorkoutSet.
      targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRIR: null, restSeconds: null,

      // Advanced set-structure grouping — see doc comment above.
      groupId: null,               // null = a normal standalone exercise
      groupType: '',                 // '' | 'SUPERSET' | 'DROP_SET' | 'GIANT_SET'
      groupOrder: null,               // 1 = A1/B1/C1, 2 = A2/B2/C2, etc.
      groupLabel: '',                   // e.g. 'A', 'B', 'C' — the giant-set/superset letter
      round: null,                        // which round of the group (giant sets run for multiple rounds)
      totalRounds: null,
      restAfterGroupSeconds: null,
      dropPercentage: null,                // e.g. 20 = drop ~20% of weight for the drop-set portion

      toFailure: false,                     // true when reps are prescribed "to failure" rather than a number

      // Cardio tracking. Machine calorie estimates are never treated as exact —
      // see WorkoutEngine / the Cardio card, which labels this figure accordingly.
      cardioMode: '',        // '' | 'liss' | 'sprint'
      cardioDurationMinutes: null, cardioSpeed: null, cardioIncline: null,
      cardioDistance: null, cardioCaloriesEstimated: null,
      sprintRounds: null, sprintDistanceM: null,

      difficulty: '',   // 'easy' | 'moderate' | 'hard' | 'very_hard'
      formRating: '',    // 'good' | 'minor_breakdown' | 'poor'
      formNotes: '',        // e.g. "keep elbows tucked" — instructional, not a substitute for structured fields
      mistakesToAvoid: '',
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  function createWorkoutSet(workoutExerciseId, overrides = {}) {
    return {
      workoutSetId: generateId('wset'),
      workoutExerciseId,
      setNumber: 1,
      weightKg: null,
      reps: null,
      rir: null,          // reps in reserve
      completed: false,
      skipped: false,      // explicitly skipped (distinct from just not-yet-done)
      completedAt: null,     // timestamp the set was marked done — drives the rest timer
      createdAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Workout Templates — the editable weekly split (Creator Workout, or any
  // custom workout a person builds). Parallel to createMealTemplate: a
  // reusable plan you can start a real logged Workout from in one action.
  // ---------------------------------------------------------------------

  function createWorkoutTemplateExercise(overrides = {}) {
    return {
      itemId: generateId('wtex'),
      exerciseName: '', muscleGroup: '', exerciseType: 'compound', isCardio: false, order: 1,
      targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRIR: null, restSeconds: null,
      targetDurationMinutes: null, targetSpeed: null, targetIncline: null, targetDistance: null,

      // Advanced set-structure grouping — mirrors createWorkoutExercise's
      // fields exactly, so starting a workout from a template just copies
      // these straight across (see pages/workout.js startWorkoutFromTemplate).
      groupId: null, groupType: '', groupOrder: null, groupLabel: '', round: null, totalRounds: null,
      restAfterGroupSeconds: null, dropPercentage: null, toFailure: false,
      cardioMode: '', sprintRounds: null, sprintDistanceM: null,
      formNotes: '', mistakesToAvoid: '',

      notes: '',
      ...overrides,
    };
  }

  function createWorkoutTemplate(userId, overrides = {}) {
    return {
      workoutTemplateId: generateId('wtpl'),
      userId,
      programId: null,     // null = general/unscoped template, shown regardless of active program (preserves existing behavior)
      phaseId: null,         // which ProgramPhase this belongs to, when programId is set
      name: '',
      dayOfWeek: '',      // 'monday'..'sunday' | '' (unassigned / custom)
      programDayLabel: '',  // e.g. 'Day 1' or 'Day 5' — used instead of dayOfWeek for phase-based programs where the cycle isn't calendar-week-aligned
      category: '',        // e.g. 'Chest + Triceps'
      isFavorite: false,
      exercises: [],         // createWorkoutTemplateExercise() entries
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------

  function createWeightEntry(userId, date = todayIso(), overrides = {}) {
    return {
      weightEntryId: generateId('wt'),
      userId,
      date,
      weightKg: null,
      createdAt: nowIso(),
      ...overrides,
    };
  }

  function createMeasurementEntry(userId, date = todayIso(), overrides = {}) {
    return {
      measurementEntryId: generateId('meas'),
      userId,
      date,
      waistCm: null,
      chestCm: null,
      hipCm: null,
      armCm: null,
      thighCm: null,
      neckCm: null,
      bodyFatPercent: null,
      notes: '',
      createdAt: nowIso(),
      ...overrides,
    };
  }

  function createProgressPhoto(userId, date = todayIso(), overrides = {}) {
    return {
      progressPhotoId: generateId('photo'),
      userId,
      date,
      imageDataUrl: '',
      angle: '',   // 'front' | 'side' | 'back'
      notes: '',
      createdAt: nowIso(),
      ...overrides,
    };
  }

  /**
   * A weight-range guideline tied to a program day (e.g. "Day 15 —
   * approximately 85–87 kg"). Only ever seeded for the creator's own
   * program (see seed.js) or added manually by a person for their own
   * program — never invented for a program with no stated guidance.
   * ALWAYS a range, never a single hard number, and always shown with the
   * disclaimer that these are guidelines, not guarantees (see
   * ProgressEngine.MILESTONE_DISCLAIMER).
   */
  function createMilestone(programId, overrides = {}) {
    return {
      milestoneId: generateId('mile'),
      programId,
      dayNumber: null,
      label: '',
      weightMinKg: null,
      weightMaxKg: null,
      notes: '',
      createdAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Sleep / recovery / wellbeing
  // ---------------------------------------------------------------------

  function createSleepEntry(userId, date = todayIso(), overrides = {}) {
    return {
      sleepEntryId: generateId('sleep'),
      userId,
      date,
      bedtime: '',       // 'HH:MM', 24h — the night before `date`'s wake time
      wakeTime: '',        // 'HH:MM', 24h
      hoursSlept: null,     // derived from bedtime/wakeTime when both are set, or entered directly
      quality: null,          // 1-5
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  function createRecoveryEntry(userId, date = todayIso(), overrides = {}) {
    return {
      recoveryEntryId: generateId('rec'),
      userId,
      date,
      energyLevel: null,        // 1-5
      stressLevel: null,         // 1-5 (higher = more stressed)
      sorenessLevel: null,        // 1-5 (higher = more sore)
      recoveryScore: null,         // 1-5 (higher = more recovered)
      workoutPerformanceRating: null, // 1-5, how the day's training felt/went
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  /**
   * Private wellbeing check-in — never shown on the main Dashboard unless
   * the person explicitly opts in (see Profile.wellbeingDashboardVisible,
   * checked by the Sexual Wellbeing page only). All fields 1-5, same scale
   * as Recovery, so RecoveryEngine's generic trend math works unchanged.
   */
  function createSexualWellbeingEntry(userId, date = todayIso(), overrides = {}) {
    return {
      sexualWellbeingEntryId: generateId('swb'),
      userId,
      date,
      libidoLevel: null,        // 1-5
      energyLevel: null,         // 1-5
      stressLevel: null,          // 1-5 (higher = more stressed)
      sleepQuality: null,          // 1-5
      recoveryLevel: null,          // 1-5
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Craving Control
  // ---------------------------------------------------------------------

  /** One "I Have a Craving" protocol run. Logged regardless of outcome so
   *  CravingEngine can spot a frequent-hunger pattern and suggest
   *  reviewing the diet — never used to shame a single craving. */
  function createCravingEvent(userId, overrides = {}) {
    return {
      cravingEventId: generateId('crav'),
      userId,
      date: todayIso(),
      startedAt: nowIso(),
      stepsCompleted: [],    // subset of ['water','waited','tea_coffee','walk']
      outcome: '',              // 'resolved_without_food' | 'ate_suggested_food' | 'ate_something_else' | 'abandoned'
      suggestedFoodChosen: '',   // e.g. 'curd' | 'fruit' | 'cucumber' | 'roasted_chana' — only when outcome is ate_suggested_food
      notes: '',
      createdAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Shopping
  // ---------------------------------------------------------------------

  function createShoppingList(userId, overrides = {}) {
    return {
      shoppingListId: generateId('slist'),
      userId,
      name: 'Shopping List',
      lastGeneratedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  /** `sourceGenerated: true` marks an item as produced by "Regenerate from
   *  Meals" (see ShoppingEngine) — regenerating replaces only these items,
   *  never touching anything the person added by hand. */
  function createShoppingItem(shoppingListId, overrides = {}) {
    return {
      shoppingItemId: generateId('sitem'),
      shoppingListId,
      name: '',
      category: 'Other',   // 'Protein' | 'Vegetables' | 'Fruit' | 'Grains' | 'Seeds/Nuts' | 'Other'
      quantity: null,
      unit: '',
      purchased: false,
      sourceGenerated: false,
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Targets / reports
  // ---------------------------------------------------------------------

  function createTargetHistory(userId, overrides = {}) {
    return {
      targetHistoryId: generateId('tgt'),
      userId,
      effectiveDate: todayIso(),
      calorieTarget: null,
      proteinTargetG: null,
      fatTargetG: null,
      carbTargetG: null,
      fibreTargetG: null,
      waterTargetMl: null,
      stepTarget: null,
      previousSnapshot: null, // { calorieTarget, proteinTargetG, fatTargetG, carbTargetG, fibreTargetG, waterTargetMl, stepTarget } | null (null = first calculation)
      reason: '',   // e.g. 'profile_update', 'phase_change', 'program_change', 'weight_update', 'recalculation'
      createdAt: nowIso(),
      ...overrides,
    };
  }

  function createReport(userId, overrides = {}) {
    return {
      reportId: generateId('rpt'),
      userId,
      programId: null,
      generatedAt: nowIso(),
      periodStart: null,
      periodEnd: null,
      summary: {},
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Daily Tracking — schedule + checklist
  // ---------------------------------------------------------------------

  /** One row of the person's editable daily schedule (e.g. "6:00 wake").
   *  `category` optionally links a schedule row to a Daily Checklist item
   *  key (see daily-tracking-engine.js CHECKLIST_DEFS) purely for display —
   *  it never stores completion itself; completion always comes from the
   *  real underlying data (a mealItem, a waterEntry, ...). */
  function createScheduleItem(userId, overrides = {}) {
    return {
      scheduleItemId: generateId('sched'),
      userId,
      order: 1,
      label: '',
      startTime: '',    // 'HH:MM', 24h
      endTime: '',       // 'HH:MM', 24h — optional, for time ranges like a workout block
      category: '',       // '' | one of the Daily Checklist item keys this row corresponds to
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  /** Per-day storage for the checklist items that have no other backing
   *  data anywhere in the app (Morning walk / Evening walk — there's no
   *  distance/duration tracker yet). Every other checklist item (weight,
   *  meals, water, steps, workout, protein, vegetables, fruit, healthy
   *  fats, sleep) is derived live from its real collection — see
   *  daily-tracking-engine.js — so nothing about them is duplicated here. */
  function createDailyChecklist(userId, date = todayIso(), overrides = {}) {
    return {
      dailyChecklistId: generateId('chk'),
      userId,
      date,
      checks: { morning_walk: false, evening_walk: false },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  return {
    COLLECTIONS,
    generateId,
    nowIso,
    todayIso,
    createUser,
    createProfile,
    createProgram,
    createProgramPhase,
    createDailyLog,
    createFood,
    createFoodProduct,
    createMealCalendarPlan,
    createExerciseVideo,
    createMeal,
    createMealItem,
    createMealTemplate,
    createMealTemplateItem,
    createNutritionEntry,
    createWaterEntry,
    createStepEntry,
    createWorkout,
    createWorkoutExercise,
    createWorkoutSet,
    createWorkoutTemplate,
    createWorkoutTemplateExercise,
    createWeightEntry,
    createMeasurementEntry,
    createProgressPhoto,
    createMilestone,
    createSleepEntry,
    createRecoveryEntry,
    createSexualWellbeingEntry,
    createCravingEvent,
    createShoppingList,
    createShoppingItem,
    createTargetHistory,
    createReport,
    createScheduleItem,
    createDailyChecklist,
  };
})();
