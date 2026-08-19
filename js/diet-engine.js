/**
 * diet-engine.js
 * ---------------------------------------------------------------------------
 * The "Diet and Nutrition Engine" — but only the pure logic. It deliberately
 * computes NOTHING that already exists elsewhere:
 *   - profile/program targets come from Calculations.calculateAllTargets()
 *   - food/product scaling comes from FoodCalc (food-calculations.js)
 * This module only reconciles the two: it maps Calculations' target bundle
 * onto FoodCalc's nutrient keys, sums what was actually logged, and derives
 * the source breakdown + quality score from that. No storage access.
 * ---------------------------------------------------------------------------
 */

const DietEngine = (() => {

  /** Bridges FoodCalc.NUTRIENT_KEYS to where Calculations.calculateAllTargets()
   *  puts the matching target. `targetMultiplier` handles the one unit
   *  mismatch between the two engines (omega-3 target is in grams; food
   *  entries are logged in milligrams). */
  const NUTRIENT_DISPLAY = [
    { key: 'calories', label: 'Calories', unit: 'kcal', targetPath: 'calorieTarget' },
    { key: 'proteinG', label: 'Protein', unit: 'g', targetPath: 'proteinTargetG' },
    { key: 'carbsG', label: 'Carbohydrates', unit: 'g', targetPath: 'carbTargetG' },
    { key: 'fatG', label: 'Fat', unit: 'g', targetPath: 'fatTargetG' },
    { key: 'fibreG', label: 'Fibre', unit: 'g', targetPath: 'fibreTargetG' },
    { key: 'calciumMg', label: 'Calcium', unit: 'mg', targetPath: 'micronutrients.calciumMg' },
    { key: 'potassiumMg', label: 'Potassium', unit: 'mg', targetPath: 'micronutrients.potassiumMg' },
    { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', targetPath: 'micronutrients.magnesiumMg' },
    { key: 'ironMg', label: 'Iron', unit: 'mg', targetPath: 'micronutrients.ironMg' },
    { key: 'zincMg', label: 'Zinc', unit: 'mg', targetPath: 'micronutrients.zincMg' },
    { key: 'sodiumMg', label: 'Sodium', unit: 'mg', targetPath: 'micronutrients.sodiumMg' },
    { key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', targetPath: 'micronutrients.vitaminCMg' },
    { key: 'vitaminAMcg', label: 'Vitamin A', unit: 'mcg', targetPath: 'micronutrients.vitaminAMcg' },
    { key: 'folateMcg', label: 'Folate', unit: 'mcg', targetPath: 'micronutrients.folateMcg' },
    { key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', targetPath: 'micronutrients.vitaminB12Mcg' },
    { key: 'vitaminDMcg', label: 'Vitamin D', unit: 'mcg', targetPath: 'micronutrients.vitaminDMcg' },
    { key: 'omega3Mg', label: 'Omega-3', unit: 'mg', targetPath: 'micronutrients.omega3G', targetMultiplier: 1000 },
  ];

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? null : o[k]), obj);
  }

  function targetFor(targets, def) {
    if (!targets) return null;
    const raw = getPath(targets, def.targetPath);
    if (raw === null || raw === undefined) return null;
    return def.targetMultiplier ? FoodCalc.round2(raw * def.targetMultiplier) : raw;
  }

  /** Consumed / Target / Remaining / % for every tracked nutrient, for
   *  whatever entries were actually logged for the day. */
  function computeDailySummary(entries, targets) {
    const consumedTotals = FoodCalc.sumEntries(entries.map(e => e.computedNutrition));
    return NUTRIENT_DISPLAY.map(def => {
      const consumed = consumedTotals[def.key];
      const target = targetFor(targets, def);
      const remaining = (consumed != null && target != null) ? FoodCalc.round2(target - consumed) : null;
      const percent = (consumed != null && target != null && target > 0) ? Math.round((consumed / target) * 100) : null;
      return { key: def.key, label: def.label, unit: def.unit, consumed, target, remaining, percent };
    });
  }

  /** Per-food contribution for one nutrient — "only count food actually
   *  consumed" means this only ever looks at logged entries, never templates. */
  function computeSourceBreakdown(entries, nutrientKey) {
    const rows = entries
      .map(e => ({
        label: e.brand ? `${e.foodLabel || 'Untitled'} (${e.brand})` : (e.foodLabel || 'Untitled'),
        mealType: e.mealType,
        amount: e.computedNutrition ? e.computedNutrition[nutrientKey] : null,
      }))
      .filter(r => typeof r.amount === 'number' && r.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const total = rows.length ? FoodCalc.round2(rows.reduce((sum, r) => sum + r.amount, 0)) : null;
    return { rows, total };
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function sumCategoryGrams(entries, category) {
    return entries
      .filter(e => e.sourceType === 'generic' && e.foodCategory === category && (e.unit === 'g' || e.unit === 'ml'))
      .reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
  }

  /**
   * A 0–100 nutrition quality score from 7 factors: protein adequacy,
   * calorie adherence, fibre, vegetables, fruit, healthy fats, and
   * micronutrient coverage.
   *
   * "Do not reward starvation": the calorie-adherence factor scores a big
   * deficit no better than a big surplus (deviation from target in either
   * direction costs points), and — on top of that — logging well under
   * target calories (< 70%) caps the WHOLE score at 40, no matter how
   * clean the rest of the day looks.
   */
  function computeNutritionQuality(entries, targets) {
    if (!entries || !entries.length) {
      return { score: null, label: 'No data entered', factors: [], severelyUnderCalorie: false };
    }

    const consumed = FoodCalc.sumEntries(entries.map(e => e.computedNutrition));
    const factors = [];

    // 1. Protein adequacy
    const proteinTarget = targets?.proteinTargetG ?? null;
    const proteinScore = (proteinTarget && consumed.proteinG != null) ? clamp((consumed.proteinG / proteinTarget) * 100, 0, 100) : null;
    factors.push({ key: 'protein', label: 'Protein adequacy', score: proteinScore,
      detail: proteinTarget ? `${fmt(consumed.proteinG)} / ${fmt(proteinTarget)} g` : 'No target set' });

    // 2. Calorie adherence — symmetric penalty; flags severe under-eating separately.
    const calorieTarget = targets?.calorieTarget ?? null;
    let calorieScore = null;
    let severelyUnderCalorie = false;
    if (calorieTarget && consumed.calories != null) {
      const ratio = consumed.calories / calorieTarget;
      if (ratio < 0.7) severelyUnderCalorie = true;
      const deviation = Math.abs(ratio - 1);
      calorieScore = clamp(100 - deviation * 250, 0, 100); // ~15% off -> ~62, ~40% off -> 0
    }
    factors.push({ key: 'calories', label: 'Calorie adherence', score: calorieScore,
      detail: calorieTarget ? `${fmt(consumed.calories)} / ${fmt(calorieTarget)} kcal` : 'No target set' });

    // 3. Fibre
    const fibreTarget = targets?.fibreTargetG ?? null;
    const fibreScore = (fibreTarget && consumed.fibreG != null) ? clamp((consumed.fibreG / fibreTarget) * 100, 0, 100) : null;
    factors.push({ key: 'fibre', label: 'Fibre', score: fibreScore,
      detail: fibreTarget ? `${fmt(consumed.fibreG)} / ${fmt(fibreTarget)} g` : 'No target set' });

    // 4. Vegetables (reference: ~300 g/day from the generic 'vegetables' category)
    const vegG = sumCategoryGrams(entries, 'vegetables');
    factors.push({ key: 'vegetables', label: 'Vegetables', score: clamp((vegG / 300) * 100, 0, 100), detail: `${FoodCalc.round2(vegG)} g logged` });

    // 5. Fruit (reference: ~150 g/day from the generic 'fruits' category)
    const fruitG = sumCategoryGrams(entries, 'fruits');
    factors.push({ key: 'fruit', label: 'Fruit', score: clamp((fruitG / 150) * 100, 0, 100), detail: `${FoodCalc.round2(fruitG)} g logged` });

    // 6. Healthy fats — nuts/seeds logged, or meaningful omega-3 intake
    const nutsSeedsG = sumCategoryGrams(entries, 'nuts') + sumCategoryGrams(entries, 'seeds');
    const omega3Mg = consumed.omega3Mg || 0;
    const fatScore = clamp(Math.max((nutsSeedsG / 15) * 100, (omega3Mg / 500) * 100), 0, 100);
    factors.push({ key: 'healthy_fats', label: 'Healthy fats', score: fatScore,
      detail: `${FoodCalc.round2(nutsSeedsG)} g nuts/seeds · ${FoodCalc.round2(omega3Mg)} mg omega-3` });

    // 7. Micronutrient coverage — share of tracked micros (excl. sodium, a limit not a goal) at >= 50% of target
    const microDefs = NUTRIENT_DISPLAY.filter(d => d.targetPath.startsWith('micronutrients.') && d.key !== 'sodiumMg');
    let covered = 0, tracked = 0;
    microDefs.forEach(def => {
      const target = targetFor(targets, def);
      if (!target) return;
      tracked++;
      const val = consumed[def.key];
      if (val != null && val >= target * 0.5) covered++;
    });
    factors.push({ key: 'micronutrients', label: 'Micronutrient coverage', score: tracked ? (covered / tracked) * 100 : null,
      detail: tracked ? `${covered}/${tracked} nutrients ≥ 50% of target` : 'No targets set (complete your profile)' });

    const scored = factors.filter(f => f.score != null);
    let overall = scored.length ? Math.round(scored.reduce((s, f) => s + f.score, 0) / scored.length) : null;

    if (severelyUnderCalorie && overall != null) {
      overall = Math.min(overall, 40);
    }

    const label = overall == null ? 'No data entered'
      : overall >= 85 ? 'Excellent'
      : overall >= 70 ? 'Good'
      : overall >= 50 ? 'Fair'
      : 'Needs attention';

    return { score: overall, label, factors, severelyUnderCalorie };
  }

  function fmt(n) { return (n === null || n === undefined) ? '—' : n; }

  /**
   * Per-meal calorie/macro budgets — the day's ONE real target (from
   * Calculations.calculateAllTargets) split across meals by percentage.
   * The percentages are a real, user-editable setting on the profile
   * (profile.mealSplitPercent) — not a second, independently-fabricated
   * number — so "Lunch target: 620 kcal" is always traceable back to
   * "your daily target is 2061 kcal and lunch is set to 30% of it".
   * Falls back to a sensible default split when the profile hasn't set
   * one, and always re-normalizes to 100% so a split that doesn't sum
   * correctly (e.g. mid-edit) never silently misallocates the day.
   */
  const MEAL_SPLIT_DEFAULT = { breakfast: 20, lunch: 30, pre_workout: 15, dinner: 30, snack: 5, other: 0 };
  const MEAL_SPLIT_KEYS = Object.keys(MEAL_SPLIT_DEFAULT);

  function normalizedMealSplit(profile) {
    const raw = (profile && profile.mealSplitPercent) || MEAL_SPLIT_DEFAULT;
    const sum = MEAL_SPLIT_KEYS.reduce((s, k) => s + (Number(raw[k]) || 0), 0);
    if (!sum) return { ...MEAL_SPLIT_DEFAULT };
    const norm = {};
    MEAL_SPLIT_KEYS.forEach(k => { norm[k] = ((Number(raw[k]) || 0) / sum) * 100; });
    return norm;
  }

  /** Target calories/protein/carbs/fat/fibre for ONE meal — the same
   *  percentage of the daily target for every macro, since the split
   *  represents "how big a share of the day's food this meal is", not a
   *  separate per-macro decision. Returns null with no daily targets. */
  function computeMealTarget(mealType, targets, profile) {
    if (!targets) return null;
    const split = normalizedMealSplit(profile);
    const percent = split[mealType] ?? 0;
    const scale = percent / 100;
    const scaled = (v) => (v == null ? null : FoodCalc.round2(v * scale));
    return {
      percent: FoodCalc.round2(percent),
      calorieTarget: scaled(targets.calorieTarget),
      proteinTargetG: scaled(targets.proteinTargetG),
      carbTargetG: scaled(targets.carbTargetG),
      fatTargetG: scaled(targets.fatTargetG),
      fibreTargetG: scaled(targets.fibreTargetG),
    };
  }

  /** Consumed / Target / Remaining / % for one meal's items against its
   *  own slice of the day (see computeMealTarget) — same shape as
   *  computeDailySummary so the UI can render both with one component. */
  function computeMealSummary(items, mealType, targets, profile) {
    const mealTarget = computeMealTarget(mealType, targets, profile);
    const consumedTotals = FoodCalc.sumEntries(items.map(e => e.computedNutrition));
    const defs = [
      { key: 'calories', label: 'Calories', unit: 'kcal', targetKey: 'calorieTarget' },
      { key: 'proteinG', label: 'Protein', unit: 'g', targetKey: 'proteinTargetG' },
      { key: 'carbsG', label: 'Carbohydrates', unit: 'g', targetKey: 'carbTargetG' },
      { key: 'fatG', label: 'Fat', unit: 'g', targetKey: 'fatTargetG' },
      { key: 'fibreG', label: 'Fibre', unit: 'g', targetKey: 'fibreTargetG' },
    ];
    const rows = defs.map(def => {
      const consumed = consumedTotals[def.key];
      const target = mealTarget ? mealTarget[def.targetKey] : null;
      const remaining = (consumed != null && target != null) ? FoodCalc.round2(target - consumed) : null;
      const percent = (consumed != null && target != null && target > 0) ? Math.round((consumed / target) * 100) : null;
      return { key: def.key, label: def.label, unit: def.unit, consumed, target, remaining, percent };
    });
    return { mealTarget, rows };
  }

  return {
    NUTRIENT_DISPLAY,
    computeDailySummary,
    computeSourceBreakdown,
    computeNutritionQuality,
    MEAL_SPLIT_DEFAULT,
    MEAL_SPLIT_KEYS,
    normalizedMealSplit,
    computeMealTarget,
    computeMealSummary,
  };
})();
