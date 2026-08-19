/**
 * food-calculations.js
 * ---------------------------------------------------------------------------
 * Pure math for the Food & Product system. No storage access — pages call
 * DataService themselves and pass plain records in here.
 *
 * Every function returns null (or a null nutrient field) rather than a
 * fabricated number whenever the inputs don't support a real calculation.
 * "Product-specific nutrition overrides generic nutrition. Do not invent
 * missing product values." is enforced here: computeProductNutrition never
 * reaches into FoodDatabase, and a product's own null fields stay null all
 * the way through scaling.
 * ---------------------------------------------------------------------------
 */

const FoodCalc = (() => {

  /** The full nutrient key set — matches Models.createFoodProduct().nutrients.
   *  Generic FoodDatabase entries only ever populate a subset of these; the
   *  rest are left null so totals still add up correctly. */
  const NUTRIENT_KEYS = [
    'calories', 'proteinG', 'carbsG', 'fatG', 'saturatedFatG', 'fibreG', 'sugarG',
    'calciumMg', 'potassiumMg', 'magnesiumMg', 'ironMg', 'zincMg', 'sodiumMg',
    'vitaminCMg', 'vitaminAMcg', 'folateMcg', 'vitaminB12Mcg', 'vitaminDMcg', 'omega3Mg',
  ];

  /** Display metadata for the full nutrient set — shared by the Products
   *  form, the custom-food entry form, and any nutrition summary view. */
  const NUTRIENT_FIELDS = [
    { key: 'calories', label: 'Calories', unit: 'kcal', group: 'Macros' },
    { key: 'proteinG', label: 'Protein', unit: 'g', group: 'Macros' },
    { key: 'carbsG', label: 'Carbohydrates', unit: 'g', group: 'Macros' },
    { key: 'fatG', label: 'Fat', unit: 'g', group: 'Macros' },
    { key: 'saturatedFatG', label: 'Saturated Fat', unit: 'g', group: 'Macros' },
    { key: 'fibreG', label: 'Fibre', unit: 'g', group: 'Macros' },
    { key: 'sugarG', label: 'Sugar', unit: 'g', group: 'Macros' },
    { key: 'calciumMg', label: 'Calcium', unit: 'mg', group: 'Minerals' },
    { key: 'potassiumMg', label: 'Potassium', unit: 'mg', group: 'Minerals' },
    { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', group: 'Minerals' },
    { key: 'ironMg', label: 'Iron', unit: 'mg', group: 'Minerals' },
    { key: 'zincMg', label: 'Zinc', unit: 'mg', group: 'Minerals' },
    { key: 'sodiumMg', label: 'Sodium', unit: 'mg', group: 'Minerals' },
    { key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', group: 'Vitamins' },
    { key: 'vitaminAMcg', label: 'Vitamin A', unit: 'mcg', group: 'Vitamins' },
    { key: 'folateMcg', label: 'Folate', unit: 'mcg', group: 'Vitamins' },
    { key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', group: 'Vitamins' },
    { key: 'vitaminDMcg', label: 'Vitamin D', unit: 'mcg', group: 'Vitamins' },
    { key: 'omega3Mg', label: 'Omega-3', unit: 'mg', group: 'Vitamins' },
  ];

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  /** Scales a partial nutrient object by `factor`, normalized to the full
   *  NUTRIENT_KEYS set. Missing/non-numeric source values stay null. */
  function scaleNutrients(sourceValues, factor) {
    const out = {};
    NUTRIENT_KEYS.forEach(key => {
      const v = sourceValues ? sourceValues[key] : null;
      out[key] = isNum(v) && isNum(factor) ? round2(v * factor) : null;
    });
    return out;
  }

  /** Generic-food scaling: FoodDatabase values are always per 100g, so unit
   *  must be grams or millilitres (treated 1:1) — anything else can't be
   *  scaled without inventing a conversion, so this returns null. */
  function computeGenericNutrition(per100g, quantity, unit) {
    if (!per100g || !isNum(Number(quantity))) return null;
    if (unit !== 'g' && unit !== 'ml') return null;
    return scaleNutrients(per100g, Number(quantity) / 100);
  }

  /** Product scaling — respects labelBasis. Falls back to a gram/mL
   *  conversion only when the product itself recorded that gram weight;
   *  never guesses one. Returns null if the entry's unit can't be
   *  reconciled with how the label was printed. */
  function computeProductNutrition(product, quantity, unit) {
    if (!product) return null;
    const q = Number(quantity);
    if (!isNum(q)) return null;

    let factor = null;
    switch (product.labelBasis) {
      case 'per_100g':
        if (unit === 'g' || unit === 'ml') factor = q / 100;
        break;
      case 'per_serving':
        if (unit === 'serving') factor = q;
        else if ((unit === 'g' || unit === 'ml') && isNum(product.servingSizeG) && product.servingSizeG > 0) {
          factor = q / product.servingSizeG;
        }
        break;
      case 'per_piece':
        if (unit === 'piece') factor = q;
        else if ((unit === 'g' || unit === 'ml') && isNum(product.pieceWeightG) && product.pieceWeightG > 0) {
          factor = q / product.pieceWeightG;
        }
        break;
      case 'custom':
        if (unit === 'custom') factor = q;
        else if ((unit === 'g' || unit === 'ml') && isNum(product.customUnitG) && product.customUnitG > 0) {
          factor = q / product.customUnitG;
        }
        break;
      default:
        factor = null;
    }
    if (factor === null) return null;
    return scaleNutrients(product.nutrients, factor);
  }

  /** Which entry units are valid for a given product, given what gram
   *  equivalence (if any) was recorded on it. Used to build the Unit
   *  dropdown so the person can't pick a unit the app can't scale. */
  function validUnitsForProduct(product) {
    if (!product) return ['g'];
    switch (product.labelBasis) {
      case 'per_100g':
        return ['g', 'ml'];
      case 'per_serving':
        return isNum(product.servingSizeG) ? ['serving', 'g', 'ml'] : ['serving'];
      case 'per_piece':
        return isNum(product.pieceWeightG) ? ['piece', 'g', 'ml'] : ['piece'];
      case 'custom':
        return isNum(product.customUnitG) ? ['custom', 'g', 'ml'] : ['custom'];
      default:
        return ['g'];
    }
  }

  /** Cooking oil is tracked separately from the food itself; generic
   *  fat-energy convention (9 kcal/g), oil treated as ~100% fat. */
  function computeOilNutrition(oilG) {
    const g = Number(oilG);
    if (!isNum(g) || g <= 0) return null;
    return {
      calories: round2(g * FoodDatabase.OIL_KCAL_PER_G),
      fatG: round2(g * FoodDatabase.OIL_FAT_G_PER_G),
    };
  }

  /** Adds two (possibly partial) nutrient objects. A key stays null only if
   *  it's null/absent in BOTH inputs — otherwise absent is treated as 0 so
   *  day totals aren't wiped out by one entry missing a micronutrient. */
  function addNutrients(a, b) {
    const out = {};
    NUTRIENT_KEYS.forEach(key => {
      const av = a ? a[key] : null;
      const bv = b ? b[key] : null;
      if (!isNum(av) && !isNum(bv)) { out[key] = null; return; }
      out[key] = round2((isNum(av) ? av : 0) + (isNum(bv) ? bv : 0));
    });
    return out;
  }

  /** Consolidates the sourceType branching used whenever an entry's
   *  nutrition needs computing (Food Entry save, meal-template logging,
   *  Copy Yesterday) so every call site reuses the same logic instead of
   *  re-deriving it. Returns { computed, nutritionSource }. */
  function computeEntryNutrition({ sourceType, per100g, product, manualNutrients, quantity, unit, cookingOilG }) {
    let computed = null;
    let nutritionSource = '';

    if (sourceType === 'generic') {
      if (per100g) {
        computed = computeGenericNutrition(per100g, quantity, unit);
        nutritionSource = computed ? 'generic_estimate' : '';
      } else {
        computed = scaleNutrients(manualNutrients, 1);
        nutritionSource = 'user_entered';
      }
    } else if (sourceType === 'product') {
      computed = computeProductNutrition(product, quantity, unit);
      nutritionSource = computed ? 'product_label' : '';
    } else if (sourceType === 'custom') {
      computed = scaleNutrients(manualNutrients, 1);
      nutritionSource = 'user_entered';
    }

    if (isNum(Number(cookingOilG)) && Number(cookingOilG) > 0) {
      const oil = computeOilNutrition(cookingOilG);
      if (oil) computed = addNutrients(computed || {}, oil);
    }

    return { computed, nutritionSource };
  }

  function sumEntries(nutrientObjects) {
    return nutrientObjects.reduce((acc, n) => addNutrients(acc, n), {});
  }

  return {
    NUTRIENT_KEYS,
    NUTRIENT_FIELDS,
    round2,
    scaleNutrients,
    computeGenericNutrition,
    computeProductNutrition,
    validUnitsForProduct,
    computeOilNutrition,
    computeEntryNutrition,
    addNutrients,
    sumEntries,
  };
})();
