/**
 * calculations.js
 * ---------------------------------------------------------------------------
 * PERSONAL CALCULATION ENGINE — the single source of truth for every
 * computed number in the app (BMI, BMR, TDEE, calorie target, macros,
 * fibre, water, steps, micronutrient references, weight trends).
 *
 * No UI component or page should ever compute any of these inline —
 * everything routes through here so there is exactly one place to fix or
 * extend a formula. Every future module (Diet, Nutrition, Workout, Progress,
 * Reports, ...) reads its targets from Calculations.calculateAllTargets();
 * nothing duplicates target values elsewhere.
 *
 * Most functions here are pure: (inputs) -> number|object|null. They return
 * null when there isn't enough data to compute a value — callers show
 * "No data entered" rather than a fabricated number. The exception is
 * recordTargetChangesIfNeeded(), which is intentionally impure: it is the
 * one function in this module allowed to read/write storage, because
 * "whenever a calculated target changes, store previous value / new value /
 * date / reason" is inherently a storage operation.
 * ---------------------------------------------------------------------------
 */

const Calculations = (() => {

  // -----------------------------------------------------------------------
  // Constants / reference tables
  // -----------------------------------------------------------------------

  /** Simple whole-day activity multipliers, used only when activityLevelSource === 'manual'. */
  const ACTIVITY_MULTIPLIERS = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };

  const GOALS = {
    FAT_LOSS: 'fat_loss',
    MAINTENANCE: 'maintenance',
    MUSCLE_GAIN: 'muscle_gain',
    BODY_RECOMPOSITION: 'body_recomposition',
    GENERAL_FITNESS: 'general_fitness',
  };

  /** NEAT baseline multiplier by occupation type — non-exercise daily movement only. */
  const OCCUPATION_BASE_MULTIPLIER = {
    mostly_sitting: 1.20,
    mostly_standing: 1.35,
    physical: 1.50,
  };

  /** Baseline daily-step assumption by occupation, used only when no step average is logged. */
  const OCCUPATION_STEP_BASELINE = {
    mostly_sitting: 4000,
    mostly_standing: 6500,
    physical: 9000,
  };

  /** Additional NEAT multiplier bump from logged average daily steps (tiered, additive). */
  const STEP_MULTIPLIER_TIERS = [
    { min: 12500, bump: 0.10 },
    { min: 10000, bump: 0.075 },
    { min: 7500, bump: 0.05 },
    { min: 5000, bump: 0.025 },
    { min: 0, bump: 0 },
  ];

  /** Rough kcal/kg-bodyweight/minute cost of structured training, by self-rated intensity. */
  const EXERCISE_INTENSITY_KCAL_PER_KG_PER_MIN = {
    low: 0.07,
    moderate: 0.10,
    high: 0.13,
  };

  /** Default weekly rate of progress (percent of bodyweight/week) when the person hasn't set one. */
  const DEFAULT_WEEKLY_RATE_PERCENT = {
    fat_loss: 0.6,
    muscle_gain: 0.25,
    body_recomposition: 0.25,
    general_fitness: 0,
    maintenance: 0,
  };

  const KCAL_PER_KG_BODY_MASS = 7700; // approx. energy density used to translate a rate of change into kcal/day
  const SAFE_DEFICIT_CAP_PERCENT = 0.25; // never cut more than 25% below TDEE
  const SAFE_DEFICIT_CAP_KCAL = 1000;    // absolute ceiling on the daily deficit, regardless of %
  const MIN_CALORIE_FLOOR_MULTIPLIER = 1.1; // calorie target never drops below 1.1x BMR
  const MAX_SURPLUS_KCAL = 500;             // cap on a lean-gain surplus

  const PROTEIN_RANGE_G_PER_KG = { min: 1.6, mid: 1.9, upper: 2.2 }; // resistance-training range
  const PROTEIN_RANGE_G_PER_KG_UNTRAINED = { min: 1.2, mid: 1.4, upper: 1.6 };

  const CLIMATE_WATER_ADJUSTMENT_ML = { temperate: 0, hot: 500, cold: -150 };

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function isNum(v) {
    return typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);
  }
  function round0(n) { return Math.round(n); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function roundToNearest(n, step) { return Math.round(n / step) * step; }
  function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

  function mapPrimaryGoalToDirection(primaryGoal = '') {
    const g = (primaryGoal || '').toLowerCase();
    if (g.includes('recomposition') || g.includes('recomp')) return GOALS.BODY_RECOMPOSITION;
    if (g.includes('fat loss') || g.includes('weight loss')) return GOALS.FAT_LOSS;
    if (g.includes('muscle gain') || g.includes('bulk')) return GOALS.MUSCLE_GAIN;
    if (g.includes('general') || g.includes('fitness')) return GOALS.GENERAL_FITNESS;
    return GOALS.MAINTENANCE;
  }

  /** Resolves the effective goal: an explicit goalType wins; otherwise inferred from free-text primaryGoal. */
  function resolveGoal(profile) {
    if (profile?.goalType && Object.values(GOALS).includes(profile.goalType)) return profile.goalType;
    return mapPrimaryGoalToDirection(profile?.primaryGoal);
  }

  // -----------------------------------------------------------------------
  // BMI
  // -----------------------------------------------------------------------

  /** BMI = kg / m^2. Descriptive only — never used, alone, to set calorie intake. */
  function calculateBMI(weightKg, heightCm) {
    if (!isNum(weightKg) || !isNum(heightCm) || heightCm <= 0) return null;
    const heightM = heightCm / 100;
    return round1(weightKg / (heightM * heightM));
  }

  // -----------------------------------------------------------------------
  // BMR — Mifflin-St Jeor
  // -----------------------------------------------------------------------

  function calculateBMR({ currentWeightKg, heightCm, age, sex } = {}) {
    if (![currentWeightKg, heightCm, age].every(isNum) || !sex) return null;
    const base = 10 * currentWeightKg + 6.25 * heightCm - 5 * age;
    if (sex === 'male') return round0(base + 5);
    if (sex === 'female') return round0(base - 161);
    return round0(base - 78); // midpoint fallback for 'other'/unspecified
  }

  // -----------------------------------------------------------------------
  // TDEE
  //
  // Two mutually-exclusive paths so activity is never double-counted:
  //   - "manual"  activityLevelSource: BMR x the person's chosen activity
  //     multiplier. Assumed to already reflect their whole lifestyle.
  //   - "auto"    activityLevelSource (default): BMR x a NEAT multiplier
  //     derived only from occupation + average daily steps (non-exercise
  //     movement), PLUS an explicit kcal/day add-on for structured training
  //     (frequency x duration x intensity). Occupation/steps and
  //     training/duration/intensity describe different kinds of activity,
  //     so adding them is not double counting — using the manual multiplier
  //     AND adding training on top of it would be, which is why manual mode
  //     stops at the multiplier.
  // -----------------------------------------------------------------------

  function deriveNeatMultiplier({ occupationType, averageDailySteps } = {}) {
    const base = OCCUPATION_BASE_MULTIPLIER[occupationType] ?? ACTIVITY_MULTIPLIERS.sedentary;
    const steps = isNum(averageDailySteps) ? averageDailySteps : 0;
    const tier = STEP_MULTIPLIER_TIERS.find(t => steps >= t.min);
    return round2(base + (tier ? tier.bump : 0));
  }

  function calculateExerciseCaloriesPerDay({ currentWeightKg, trainingFrequencyPerWeek, exerciseDurationMinutes, exerciseIntensity } = {}) {
    if (![currentWeightKg, trainingFrequencyPerWeek, exerciseDurationMinutes].every(isNum)) return 0;
    const factor = EXERCISE_INTENSITY_KCAL_PER_KG_PER_MIN[exerciseIntensity] ?? EXERCISE_INTENSITY_KCAL_PER_KG_PER_MIN.moderate;
    const weeklyMinutes = trainingFrequencyPerWeek * exerciseDurationMinutes;
    const weeklyKcal = weeklyMinutes * factor * currentWeightKg;
    return round0(weeklyKcal / 7);
  }

  function calculateTDEE(profile = {}) {
    const bmr = calculateBMR(profile);
    if (bmr === null) return null;

    if (profile.activityLevelSource === 'manual' && profile.activityLevel) {
      const multiplier = ACTIVITY_MULTIPLIERS[profile.activityLevel];
      if (!multiplier) return null;
      return round0(bmr * multiplier);
    }

    // auto: NEAT multiplier (occupation + steps) applied to BMR, plus explicit exercise kcal
    const neatMultiplier = deriveNeatMultiplier(profile);
    const neatTdee = bmr * neatMultiplier;
    const exerciseKcal = calculateExerciseCaloriesPerDay(profile);
    return round0(neatTdee + exerciseKcal);
  }

  // -----------------------------------------------------------------------
  // Calorie target
  // -----------------------------------------------------------------------

  function impliedWeeklyChangeKg({ currentWeightKg, targetWeightKg, programDurationDays }) {
    if (![currentWeightKg, targetWeightKg, programDurationDays].every(isNum) || programDurationDays <= 0) return null;
    const totalChangeKg = currentWeightKg - targetWeightKg; // positive => needs to lose, negative => needs to gain
    const weeks = programDurationDays / 7;
    if (weeks <= 0) return null;
    return totalChangeKg / weeks;
  }

  function resolveWeeklyChangeKg({ currentWeightKg, targetWeightKg, programDurationDays, goal, desiredWeeklyChangePercent }) {
    if (!isNum(currentWeightKg)) return null;

    // An explicit rate the person set always wins.
    if (isNum(desiredWeeklyChangePercent)) {
      const direction = goal === GOALS.FAT_LOSS ? -1 : (goal === GOALS.MUSCLE_GAIN || goal === GOALS.BODY_RECOMPOSITION ? 1 : 0);
      return direction * (Math.abs(desiredWeeklyChangePercent) / 100) * currentWeightKg;
    }

    // Otherwise, what the program's duration + target weight implies.
    // (impliedWeeklyChangeKg is "current - target" per week, i.e. loss-positive;
    // TDEE deltas are loss-negative, so it's negated here.)
    // This is only trusted when it actually points the same direction as the
    // selected goal — a leftover/mismatched target weight (e.g. a fat-loss
    // target still on file after switching to a muscle-gain goal) must never
    // silently put a "muscle gain" plan into a calorie deficit, or a "fat
    // loss" plan into a surplus.
    const implied = impliedWeeklyChangeKg({ currentWeightKg, targetWeightKg, programDurationDays });
    if (isNum(implied) && implied !== 0) {
      const impliedChangeKg = -implied; // loss-negative, gain-positive
      const goalExpectsLoss = goal === GOALS.FAT_LOSS;
      const goalExpectsGain = goal === GOALS.MUSCLE_GAIN || goal === GOALS.BODY_RECOMPOSITION;
      const matchesGoal = (!goalExpectsLoss && !goalExpectsGain)
        || (goalExpectsLoss && impliedChangeKg <= 0)
        || (goalExpectsGain && impliedChangeKg >= 0);
      if (matchesGoal) return impliedChangeKg;
      // Mismatch: fall through to the goal-based default below instead of
      // trusting a target weight that contradicts the chosen goal.
    }

    // Fall back to a conservative, goal-based default.
    const pct = DEFAULT_WEEKLY_RATE_PERCENT[goal] ?? 0;
    const direction = goal === GOALS.FAT_LOSS ? -1 : (goal === GOALS.MUSCLE_GAIN || goal === GOALS.BODY_RECOMPOSITION ? 1 : 0);
    return direction * (pct / 100) * currentWeightKg;
  }

  /**
   * Individualized calorie target. Never a flat universal number and never
   * an extreme deficit: the daily deficit is capped at the lesser of 25% of
   * TDEE or 1000 kcal, and the resulting target never drops below 1.1x BMR.
   * Surpluses (muscle gain / recomposition) are capped for a lean gain.
   */
  function calculateCalorieTarget({ tdee, bmr, currentWeightKg, targetWeightKg, goal = GOALS.MAINTENANCE, programDurationDays, desiredWeeklyChangePercent } = {}) {
    if (!isNum(tdee)) return null;
    if (goal === GOALS.MAINTENANCE || goal === GOALS.GENERAL_FITNESS || !isNum(currentWeightKg)) {
      return round0(tdee);
    }

    const weeklyChangeKg = resolveWeeklyChangeKg({ currentWeightKg, targetWeightKg, programDurationDays, goal, desiredWeeklyChangePercent });
    if (!isNum(weeklyChangeKg) || weeklyChangeKg === 0) return round0(tdee);

    let dailyDeltaKcal = (weeklyChangeKg * KCAL_PER_KG_BODY_MASS) / 7;

    if (dailyDeltaKcal < 0) {
      const maxDeficit = Math.min(tdee * SAFE_DEFICIT_CAP_PERCENT, SAFE_DEFICIT_CAP_KCAL);
      dailyDeltaKcal = Math.max(dailyDeltaKcal, -maxDeficit);
      let target = tdee + dailyDeltaKcal;
      const floor = isNum(bmr) ? bmr * MIN_CALORIE_FLOOR_MULTIPLIER : tdee * 0.6;
      target = Math.max(target, floor);
      return round0(target);
    }

    dailyDeltaKcal = Math.min(dailyDeltaKcal, MAX_SURPLUS_KCAL);
    return round0(tdee + dailyDeltaKcal);
  }

  // -----------------------------------------------------------------------
  // Protein — shown as a min / recommended / upper range, never a single number
  // -----------------------------------------------------------------------

  function calculateProteinTarget({ currentWeightKg, bodyFatPercent, goal, trainingFrequencyPerWeek } = {}) {
    if (!isNum(currentWeightKg)) return null;
    const trains = isNum(trainingFrequencyPerWeek) && trainingFrequencyPerWeek > 0;

    let { min, mid, upper } = trains ? PROTEIN_RANGE_G_PER_KG : PROTEIN_RANGE_G_PER_KG_UNTRAINED;
    if (trains && goal === GOALS.FAT_LOSS) mid = 2.0;      // lean toward the upper end in a deficit to protect muscle
    if (trains && goal === GOALS.MUSCLE_GAIN) mid = 1.9;

    // Protein scales with lean tissue, not fat mass — use lean mass when body-fat % is known.
    const baseWeightKg = isNum(bodyFatPercent) ? currentWeightKg * (1 - bodyFatPercent / 100) : currentWeightKg;

    return {
      minG: round0(baseWeightKg * min),
      recommendedG: round0(baseWeightKg * mid),
      upperG: round0(baseWeightKg * upper),
    };
  }

  // -----------------------------------------------------------------------
  // Fat — a share of total calories, floored so it's never excessively low
  // -----------------------------------------------------------------------

  function calculateFatTarget({ calorieTarget, currentWeightKg } = {}) {
    if (!isNum(calorieTarget)) return null;
    let grams = round0((calorieTarget * 0.27) / 9);
    if (isNum(currentWeightKg)) grams = Math.max(grams, round0(currentWeightKg * 0.6));
    return grams;
  }

  // -----------------------------------------------------------------------
  // Carbohydrates — whatever calories remain after protein and fat
  // -----------------------------------------------------------------------

  function calculateCarbohydrateTarget(calorieTarget, proteinG, fatG) {
    if (!isNum(calorieTarget) || !isNum(proteinG) || !isNum(fatG)) return null;
    const remainingKcal = calorieTarget - (proteinG * 4) - (fatG * 9);
    return round0(Math.max(remainingKcal, 0) / 4);
  }

  // -----------------------------------------------------------------------
  // Fibre
  // -----------------------------------------------------------------------

  function calculateFibreTarget(calorieTarget) {
    if (!isNum(calorieTarget)) return null;
    const raw = (calorieTarget / 1000) * 14;
    return Math.max(roundToNearest(raw, 5), 20); // rounded to a practical, achievable target
  }

  // -----------------------------------------------------------------------
  // Water — never a single universal number
  // -----------------------------------------------------------------------

  function calculateWaterTarget({ currentWeightKg, exerciseDurationMinutes, trainingFrequencyPerWeek, climate, averageDailySteps } = {}) {
    if (!isNum(currentWeightKg)) return null;
    let ml = currentWeightKg * 35;

    if (isNum(exerciseDurationMinutes) && isNum(trainingFrequencyPerWeek)) {
      const dailyExerciseMin = (exerciseDurationMinutes * trainingFrequencyPerWeek) / 7;
      ml += dailyExerciseMin * 12; // extra mL/min of training, to offset sweat losses
    }
    if (isNum(averageDailySteps) && averageDailySteps > 8000) ml += 250;
    ml += CLIMATE_WATER_ADJUSTMENT_ML[climate] ?? 0;

    return round0(Math.max(ml, currentWeightKg * 25));
  }

  // -----------------------------------------------------------------------
  // Steps — a practical, gradually-increasing target
  // -----------------------------------------------------------------------

  function calculateStepTarget({ averageDailySteps, occupationType, goal, trainingFrequencyPerWeek } = {}) {
    const baseline = isNum(averageDailySteps) ? averageDailySteps : (OCCUPATION_STEP_BASELINE[occupationType] ?? 6000);

    let goalBump = 0;
    if (goal === GOALS.FAT_LOSS) goalBump = 2000;
    else if (goal === GOALS.GENERAL_FITNESS || goal === GOALS.BODY_RECOMPOSITION) goalBump = 1500;

    // Someone already training hard needs a smaller extra step nudge.
    if (isNum(trainingFrequencyPerWeek) && trainingFrequencyPerWeek >= 5) goalBump = round0(goalBump * 0.6);

    // Sedentary occupations get the increase capped so the ramp stays gradual, not a jump.
    const isSedentary = occupationType === 'mostly_sitting';
    const increase = isSedentary ? Math.min(goalBump, 1500) : goalBump;

    return clamp(roundToNearest(baseline + increase, 500), 5000, 15000);
  }

  // -----------------------------------------------------------------------
  // Weight metrics + trends
  // -----------------------------------------------------------------------

  /**
   * weightDifferenceKg: change since the program/profile started (negative = lost weight)
   * targetWeightDifferenceKg: how far current weight is from the target (positive = still to lose)
   * percentWeightChangeSinceStart: % change relative to the starting weight
   */
  function calculateWeightMetrics({ currentWeightKg, targetWeightKg, startingWeightKg } = {}) {
    const weightDifferenceKg = (isNum(currentWeightKg) && isNum(startingWeightKg))
      ? round1(currentWeightKg - startingWeightKg) : null;
    const targetWeightDifferenceKg = (isNum(currentWeightKg) && isNum(targetWeightKg))
      ? round1(currentWeightKg - targetWeightKg) : null;
    const percentWeightChangeSinceStart = (isNum(currentWeightKg) && isNum(startingWeightKg) && startingWeightKg > 0)
      ? round1(((currentWeightKg - startingWeightKg) / startingWeightKg) * 100) : null;

    return { weightDifferenceKg, targetWeightDifferenceKg, percentWeightChangeSinceStart };
  }

  function averageWeightInRange(entries, startDaysAgo, endDaysAgo) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const inRange = entries.filter(e => {
      const d = new Date(e.date + 'T00:00:00');
      const daysAgo = Math.round((today - d) / 86400000);
      return daysAgo >= endDaysAgo && daysAgo <= startDaysAgo;
    });
    if (!inRange.length) return null;
    return round1(inRange.reduce((sum, e) => sum + e.weightKg, 0) / inRange.length);
  }

  /**
   * sevenDayAverageWeightKg: mean of logged weights in the last 7 days.
   * weeklyWeightTrendKg: 7-day average now vs. the 7-day average from the week before.
   * fourWeekWeightTrendKg: 7-day average now vs. the average from ~4 weeks ago.
   * All three return null (not fabricated) when there isn't enough logged history.
   */
  function calculateWeightTrends(weightEntries = []) {
    const entries = (weightEntries || []).filter(e => e && e.date && isNum(e.weightKg));

    const sevenDayAverageWeightKg = averageWeightInRange(entries, 6, 0);
    const priorWeekAverageKg = averageWeightInRange(entries, 13, 7);
    const fourWeeksAgoAverageKg = averageWeightInRange(entries, 27, 21);

    const weeklyWeightTrendKg = (isNum(sevenDayAverageWeightKg) && isNum(priorWeekAverageKg))
      ? round1(sevenDayAverageWeightKg - priorWeekAverageKg) : null;
    const fourWeekWeightTrendKg = (isNum(sevenDayAverageWeightKg) && isNum(fourWeeksAgoAverageKg))
      ? round1(sevenDayAverageWeightKg - fourWeeksAgoAverageKg) : null;

    return { sevenDayAverageWeightKg, weeklyWeightTrendKg, fourWeekWeightTrendKg };
  }

  // -----------------------------------------------------------------------
  // Micronutrient references — personalized reference values, by age/sex
  // (standard adult DRI/RDA ballpark figures; descriptive references only)
  // -----------------------------------------------------------------------

  function getMicronutrientReferences({ age, sex } = {}) {
    if (!isNum(age) || !sex) return null;
    const isMale = sex === 'male';
    const isOlder = age >= 51;
    const isSenior = age >= 71;
    const isPremenopausalFemale = !isMale && age < 51;

    return {
      calciumMg: isOlder && !isMale ? 1200 : 1000,
      potassiumMg: isMale ? 3400 : 2600,
      magnesiumMg: isOlder ? (isMale ? 420 : 320) : (isMale ? 400 : 310),
      ironMg: isPremenopausalFemale ? 18 : 8,
      zincMg: isMale ? 11 : 8,
      sodiumMg: 2300,
      vitaminCMg: isMale ? 90 : 75,
      vitaminAMcg: isMale ? 900 : 700,
      folateMcg: 400,
      vitaminB12Mcg: 2.4,
      vitaminDMcg: isSenior ? 20 : 15,
      omega3G: isMale ? 1.6 : 1.1,
      fibreG: isMale ? (isOlder ? 28 : 34) : (isOlder ? 22 : 28),
    };
  }

  // -----------------------------------------------------------------------
  // Orchestrator — the one function every page should call
  // -----------------------------------------------------------------------

  /**
   * Computes the full target bundle for a profile.
   * @param {object} profile - a profile record (see Models.createProfile)
   * @param {object} [context]
   * @param {Array}  [context.weightEntries] - this user's weightEntries records, any order
   * @param {object} [context.program] - the user's active program record, if any
   * @param {object} [context.phase] - the program's current phase record, if any. Any
   *   non-null field on a phase (calorieTarget, proteinTargetG, fatTargetG, carbTargetG,
   *   fibreTargetG, stepTarget, waterTargetMl, trainingFrequencyPerWeek, weightTargetKg,
   *   goalType) overrides the profile-driven calculation for that field only.
   */
  function calculateAllTargets(profile, context = {}) {
    if (!profile) return null;
    const { weightEntries = [], program = null, phase = null } = context;

    // A phase can shift the effective goal, target weight, and training frequency
    // for the period it covers — those feed into the underlying calculations
    // (TDEE, calorie target, protein, steps) before any direct number overrides apply.
    const effectiveProfile = phase ? {
      ...profile,
      goalType: phase.goalType || profile.goalType,
      targetWeightKg: phase.weightTargetKg ?? profile.targetWeightKg,
      trainingFrequencyPerWeek: phase.trainingFrequencyPerWeek ?? profile.trainingFrequencyPerWeek,
    } : profile;

    const goal = resolveGoal(effectiveProfile);
    const programDurationDays = program?.durationDays ?? null;
    const startingWeightKg = program?.startingWeightKg ?? effectiveProfile.currentWeightKg;

    const bmi = calculateBMI(effectiveProfile.currentWeightKg, effectiveProfile.heightCm);
    const bmr = calculateBMR(effectiveProfile);
    const tdee = calculateTDEE(effectiveProfile);
    const activitySource = effectiveProfile.activityLevelSource === 'manual' ? 'manual' : 'auto';

    const calorieTarget = calculateCalorieTarget({
      tdee, bmr,
      currentWeightKg: effectiveProfile.currentWeightKg,
      targetWeightKg: effectiveProfile.targetWeightKg,
      goal, programDurationDays,
      desiredWeeklyChangePercent: effectiveProfile.desiredWeeklyChangePercent,
    });

    const proteinRange = calculateProteinTarget({
      currentWeightKg: effectiveProfile.currentWeightKg,
      bodyFatPercent: effectiveProfile.bodyFatPercent,
      goal,
      trainingFrequencyPerWeek: effectiveProfile.trainingFrequencyPerWeek,
    });
    const fatTargetG = calculateFatTarget({ calorieTarget, currentWeightKg: effectiveProfile.currentWeightKg });
    const carbTargetG = calculateCarbohydrateTarget(calorieTarget, proteinRange?.recommendedG ?? null, fatTargetG);
    const fibreTargetG = calculateFibreTarget(calorieTarget);
    const waterTargetMl = calculateWaterTarget(effectiveProfile);
    const stepTarget = calculateStepTarget({ ...effectiveProfile, goal });

    const weightMetrics = calculateWeightMetrics({
      currentWeightKg: effectiveProfile.currentWeightKg,
      targetWeightKg: effectiveProfile.targetWeightKg,
      startingWeightKg,
    });
    const weightTrends = calculateWeightTrends(weightEntries);
    const micronutrients = getMicronutrientReferences(effectiveProfile);

    const result = {
      bmi, bmr, tdee, activitySource, goal,
      calorieTarget,
      proteinTargetG: proteinRange?.recommendedG ?? null,
      proteinRange,
      fatTargetG, carbTargetG, fibreTargetG, waterTargetMl, stepTarget,
      ...weightMetrics,
      ...weightTrends,
      micronutrients,
    };

    // Direct per-field overrides from the phase — applied last, on top of everything else.
    if (phase) {
      const overridden = [];
      const applyIfSet = (key, value) => {
        if (value !== null && value !== undefined) { result[key] = value; overridden.push(key); }
      };
      applyIfSet('calorieTarget', phase.calorieTarget);
      applyIfSet('proteinTargetG', phase.proteinTargetG);
      applyIfSet('fatTargetG', phase.fatTargetG);
      applyIfSet('carbTargetG', phase.carbTargetG);
      applyIfSet('fibreTargetG', phase.fibreTargetG);
      applyIfSet('stepTarget', phase.stepTarget);
      applyIfSet('waterTargetMl', phase.waterTargetMl);
      result.phaseOverriddenFields = overridden;
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Program progress — day counters, current phase lookup, weight progress %.
  // Pure functions; pages call these instead of computing date math inline.
  // -----------------------------------------------------------------------

  /** Returns { day, totalDays, daysRemaining, isComplete } for a program, or null. */
  function getProgramDayCounters(program) {
    if (!program || !program.startDate) return null;
    const start = new Date(program.startDate + 'T00:00:00');
    const now = new Date();
    const diffDays = Math.floor((now - start) / 86400000) + 1;
    const totalDays = program.durationDays || null;
    const day = diffDays < 1 ? 0 : (totalDays ? Math.min(diffDays, totalDays) : diffDays);
    const daysRemaining = totalDays != null ? Math.max(0, totalDays - day) : null;
    const isComplete = totalDays != null && diffDays > totalDays;
    return { day, totalDays, daysRemaining, isComplete };
  }

  /** Picks the phase covering "today" (by date range), falling back to the last phase
   *  if the program has run past its final phase's end date, or the first phase if
   *  today precedes the program start. Returns null if there are no phases. */
  function getCurrentPhase(phases = []) {
    if (!phases || !phases.length) return null;
    const sorted = [...phases].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const todayIso = new Date().toISOString().slice(0, 10);
    const match = sorted.find(p => p.startDate && p.endDate && todayIso >= p.startDate && todayIso <= p.endDate);
    if (match) return match;
    if (sorted[0].startDate && todayIso < sorted[0].startDate) return sorted[0];
    return sorted[sorted.length - 1];
  }

  /** % progress toward the target weight, clamped 0–100. Works for loss or gain goals. */
  function calculateProgressPercent({ startingWeightKg, currentWeightKg, targetWeightKg } = {}) {
    if (![startingWeightKg, currentWeightKg, targetWeightKg].every(isNum)) return null;
    const totalChange = targetWeightKg - startingWeightKg;
    if (totalChange === 0) return currentWeightKg === targetWeightKg ? 100 : 0;
    const achieved = currentWeightKg - startingWeightKg;
    const pct = (achieved / totalChange) * 100;
    return round0(clamp(pct, 0, 100));
  }

  // -----------------------------------------------------------------------
  // Target history — the one impure function in this module.
  // Whenever a calculated target actually changes, store previous value,
  // new value, date, and reason. No-ops (returns null) when nothing changed.
  // -----------------------------------------------------------------------

  const TRACKED_TARGET_FIELDS = [
    'calorieTarget', 'proteinTargetG', 'fatTargetG',
    'carbTargetG', 'fibreTargetG', 'waterTargetMl', 'stepTarget',
  ];

  function snapshotTrackedFields(source) {
    const snap = {};
    TRACKED_TARGET_FIELDS.forEach(key => { snap[key] = source ? (source[key] ?? null) : null; });
    return snap;
  }

  async function recordTargetChangesIfNeeded(userId, targets, reason = 'recalculation') {
    if (!userId || !targets || typeof DataService === 'undefined') return null;

    const history = await DataService.targetHistory.list(h => h.userId === userId);
    // Compare full createdAt timestamps, not the day-granularity effectiveDate:
    // multiple target changes on the same calendar day would otherwise tie on
    // effectiveDate and silently resolve to the wrong ("first same-day") record.
    const latest = history.length
      ? history.reduce((a, b) => ((a.createdAt || a.effectiveDate) >= (b.createdAt || b.effectiveDate) ? a : b))
      : null;

    const newSnapshot = snapshotTrackedFields(targets);
    const changed = !latest || TRACKED_TARGET_FIELDS.some(key => latest[key] !== newSnapshot[key]);
    if (!changed) return null;

    const record = Models.createTargetHistory(userId, {
      ...newSnapshot,
      previousSnapshot: latest ? snapshotTrackedFields(latest) : null,
      reason,
    });
    return DataService.targetHistory.create(record);
  }

  return {
    GOALS,
    ACTIVITY_MULTIPLIERS,
    calculateBMI,
    calculateBMR,
    calculateTDEE,
    calculateCalorieTarget,
    calculateProteinTarget,
    calculateFatTarget,
    calculateCarbohydrateTarget,
    calculateFibreTarget,
    calculateWaterTarget,
    calculateStepTarget,
    calculateWeightMetrics,
    calculateWeightTrends,
    getMicronutrientReferences,
    calculateAllTargets,
    recordTargetChangesIfNeeded,
    mapPrimaryGoalToDirection,
    resolveGoal,
    getProgramDayCounters,
    getCurrentPhase,
    calculateProgressPercent,
  };
})();
