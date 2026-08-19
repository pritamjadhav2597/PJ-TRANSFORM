/**
 * shopping-engine.js
 * ---------------------------------------------------------------------------
 * Pure logic for the Shopping module. No storage access -- pages fetch
 * MealTemplates (the person's actual selected meals) and ShoppingItems and
 * pass them in.
 *
 * "Generate from meals" always recomputes straight from each template's
 * current item quantities -- there is no separate stored formula to drift
 * out of sync, so "quantities update when meal quantities change" holds by
 * construction: regenerating just re-reads the templates.
 * ---------------------------------------------------------------------------
 */

const ShoppingEngine = (() => {

  const CATEGORIES = ['Protein', 'Vegetables', 'Fruit', 'Grains', 'Seeds/Nuts', 'Other'];

  const OTHER_CATEGORY_PROTEIN_ITEMS = ['egg', 'chicken_breast', 'milk', 'sprouts'];

  /** Categorizes one meal-template item. Generic-database items use their
   *  FoodDatabase category; products and custom entries have no reliable
   *  category signal and land in "Other" (still fully editable afterward). */
  function categorizeItem(item) {
    if (item.sourceType !== 'generic') return 'Other';
    const cat = item.foodCategory;
    if (cat === 'vegetables') return 'Vegetables';
    if (cat === 'fruits') return 'Fruit';
    if (cat === 'seeds' || cat === 'nuts') return 'Seeds/Nuts';
    if (cat === 'grains' || cat === 'jowar') return 'Grains';
    if (['soy_chunks', 'paneer', 'curd', 'roasted_chana', 'legumes'].includes(cat)) return 'Protein';
    if (cat === 'other') return OTHER_CATEGORY_PROTEIN_ITEMS.includes(item.foodItemKey) ? 'Protein' : 'Other';
    return 'Other';
  }

  /**
   * Aggregates quantities across every item in every given Meal Template,
   * grouped by (food name + unit) so the same food logged in two meals
   * sums correctly. Items with a different unit for the same food stay as
   * separate lines rather than guessing a conversion.
   */
  function generateAggregatedItems(templates) {
    const map = new Map();
    (templates || []).forEach(t => {
      (t.items || []).forEach(item => {
        if (!item.foodLabel || item.quantity == null) return;
        const unit = item.unit || '';
        const key = `${item.foodLabel.trim().toLowerCase()}|${unit}`;
        if (!map.has(key)) {
          map.set(key, {
            name: item.foodLabel, brand: item.brand || '', category: categorizeItem(item),
            quantity: 0, unit, templateNames: new Set(),
          });
        }
        const entry = map.get(key);
        entry.quantity += Number(item.quantity) || 0;
        entry.templateNames.add(t.name || 'Untitled meal');
      });
    });

    return [...map.values()].map(e => ({
      name: e.name,
      brand: e.brand,
      category: e.category,
      quantity: Math.round(e.quantity * 100) / 100,
      unit: e.unit,
      templateNames: [...e.templateNames],
    }));
  }

  /** Plain-text export, grouped by category, ready to save/share. */
  function buildExportText(items, listName = 'Shopping List') {
    const byCategory = Object.fromEntries(CATEGORIES.map(c => [c, []]));
    items.forEach(i => { (byCategory[i.category] || (byCategory[i.category] = [])).push(i); });

    let text = `${listName}\n${'='.repeat(listName.length)}\n\n`;
    Object.keys(byCategory).forEach(cat => {
      const list = byCategory[cat];
      if (!list.length) return;
      text += `${cat}\n${'-'.repeat(cat.length)}\n`;
      list.forEach(i => {
        const qty = i.quantity != null ? ` \u2014 ${i.quantity}${i.unit ? ' ' + i.unit : ''}` : '';
        text += `[${i.purchased ? 'x' : ' '}] ${i.name}${i.brand ? ` (${i.brand})` : ''}${qty}\n`;
      });
      text += '\n';
    });
    return text;
  }

  return { CATEGORIES, categorizeItem, generateAggregatedItems, buildExportText };
})();
