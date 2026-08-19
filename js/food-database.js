/**
 * food-database.js
 * ---------------------------------------------------------------------------
 * Static generic reference data for the Food System — mirrors the pattern
 * used by program-templates.js (pure data + pure lookup helpers, no storage
 * access). Every numeric value here is a GENERIC ESTIMATE, not a measured
 * product value — the Food Entry UI always labels food logged from this
 * database with source = 'generic_estimate', and a saved Product's own
 * label values always take priority over anything in this file (see
 * pages/nutrition.js and the "Product-specific nutrition overrides generic
 * nutrition" rule).
 *
 * Shape:
 *   CATEGORIES: [{ key, label, items: [{ key, label, preparations: [
 *     { key, label, per100g: { calories, proteinG, carbsG, fatG, fibreG, sugarG?, calciumMg? } | null
 *   ] }] }]
 *
 * A preparation with per100g = null (e.g. "Other") means the database has no
 * generic figure for it — the UI must NOT invent one; it should ask the
 * person to enter values manually (source becomes 'user_entered' for that
 * entry instead of 'generic_estimate').
 * ---------------------------------------------------------------------------
 */

const FoodDatabase = (() => {

  /** Generic energy density of cooking oil/ghee, used only for the separate
   *  Cooking Oil tracker. Standard nutrition-label convention: fat = 9 kcal/g. */
  const OIL_KCAL_PER_G = 9;
  const OIL_FAT_G_PER_G = 1; // cooking oil is treated as ~100% fat

  const CATEGORIES = [
    {
      key: 'soy_chunks', label: 'Soy Chunks',
      items: [
        {
          key: 'soy_chunks', label: 'Soy Chunks (Soya Nuggets)',
          preparations: [
            { key: 'dry_raw', label: 'Dry / Raw', per100g: { calories: 345, proteinG: 52, carbsG: 33, fatG: 0.5, fibreG: 13, sugarG: 9 } },
            { key: 'boiled', label: 'Boiled / Rehydrated', per100g: { calories: 115, proteinG: 17.3, carbsG: 11, fatG: 0.2, fibreG: 4.3, sugarG: 3 } },
            { key: 'cooked', label: 'Cooked (curry — oil tracked separately)', per100g: { calories: 120, proteinG: 17, carbsG: 12, fatG: 0.3, fibreG: 4, sugarG: 3 } },
            { key: 'air_cooked', label: 'Air-cooked', per100g: { calories: 118, proteinG: 17.2, carbsG: 11.5, fatG: 0.25, fibreG: 4.2, sugarG: 3 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
      ],
    },
    {
      key: 'paneer', label: 'Paneer',
      items: [
        {
          key: 'paneer', label: 'Paneer',
          preparations: [
            { key: 'raw_package', label: 'Raw / From Package', per100g: { calories: 265, proteinG: 18.3, carbsG: 1.2, fatG: 20.8, fibreG: 0, sugarG: 1.2, calciumMg: 208 } },
            { key: 'air_cooked', label: 'Air-cooked', per100g: { calories: 270, proteinG: 18.6, carbsG: 1.2, fatG: 21.2, fibreG: 0, sugarG: 1.2, calciumMg: 208 } },
            { key: 'grilled', label: 'Grilled', per100g: { calories: 280, proteinG: 19.5, carbsG: 1.3, fatG: 22, fibreG: 0, sugarG: 1.3, calciumMg: 210 } },
            { key: 'pan_cooked', label: 'Pan-cooked (oil tracked separately)', per100g: { calories: 275, proteinG: 19, carbsG: 1.3, fatG: 21.5, fibreG: 0, sugarG: 1.3, calciumMg: 208 } },
            { key: 'cooked', label: 'Cooked (curry — oil tracked separately)', per100g: { calories: 272, proteinG: 18.8, carbsG: 1.5, fatG: 21.3, fibreG: 0, sugarG: 1.3, calciumMg: 205 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
      ],
    },
    {
      key: 'curd', label: 'Curd',
      items: [
        {
          key: 'curd', label: 'Curd / Dahi (Whole Milk, Plain)',
          preparations: [
            { key: 'as_is', label: 'As-is / Fresh', per100g: { calories: 60, proteinG: 3.5, carbsG: 4.7, fatG: 3.3, fibreG: 0, sugarG: 4.7, calciumMg: 120 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
      ],
    },
    {
      key: 'roasted_chana', label: 'Roasted Chana',
      items: [
        {
          key: 'roasted_chana', label: 'Roasted Chana (Roasted Gram)',
          preparations: [
            { key: 'roasted', label: 'Roasted (as bought)', per100g: { calories: 364, proteinG: 22.5, carbsG: 57.8, fatG: 5.5, fibreG: 12.5, sugarG: 3 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
      ],
    },
    {
      key: 'jowar', label: 'Jowar',
      items: [
        {
          key: 'jowar', label: 'Jowar (Sorghum) — grain/flour',
          preparations: [
            { key: 'dry_raw', label: 'Dry Grain / Flour (Raw)', per100g: { calories: 349, proteinG: 10.4, carbsG: 72.6, fatG: 3.1, fibreG: 6.7 } },
            { key: 'cooked', label: 'Cooked (roti / porridge)', per100g: { calories: 97, proteinG: 2.9, carbsG: 21, fatG: 0.9, fibreG: 2 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
      ],
    },
    {
      key: 'vegetables', label: 'Vegetables',
      items: [
        veg('Spinach (Palak)', { calories: 23, proteinG: 2.9, carbsG: 3.6, fatG: 0.4, fibreG: 2.2 }, { calories: 23, proteinG: 3, carbsG: 3.8, fatG: 0.3, fibreG: 2.4 }),
        veg('Tomato', { calories: 18, proteinG: 0.9, carbsG: 3.9, fatG: 0.2, fibreG: 1.2 }, { calories: 18, proteinG: 0.9, carbsG: 4, fatG: 0.2, fibreG: 1.3 }),
        veg('Onion', { calories: 40, proteinG: 1.1, carbsG: 9.3, fatG: 0.1, fibreG: 1.7 }, { calories: 37, proteinG: 1, carbsG: 8.6, fatG: 0.1, fibreG: 1.6 }),
        veg('Potato', { calories: 77, proteinG: 2, carbsG: 17, fatG: 0.1, fibreG: 2.2 }, { calories: 87, proteinG: 1.9, carbsG: 20.1, fatG: 0.1, fibreG: 1.8 }),
        veg('Cauliflower', { calories: 25, proteinG: 1.9, carbsG: 5, fatG: 0.3, fibreG: 2 }, { calories: 23, proteinG: 1.8, carbsG: 4.1, fatG: 0.3, fibreG: 2.3 }),
        veg('Bottle Gourd (Lauki)', { calories: 14, proteinG: 0.6, carbsG: 3.4, fatG: 0.02, fibreG: 0.5 }, { calories: 14, proteinG: 0.5, carbsG: 3.3, fatG: 0.02, fibreG: 0.6 }),
        veg('Brinjal (Eggplant)', { calories: 25, proteinG: 1, carbsG: 6, fatG: 0.2, fibreG: 3 }, { calories: 24, proteinG: 0.8, carbsG: 5.7, fatG: 0.2, fibreG: 2.5 }),
        veg('Carrot', { calories: 41, proteinG: 0.9, carbsG: 10, fatG: 0.2, fibreG: 2.8 }, { calories: 35, proteinG: 0.8, carbsG: 8.2, fatG: 0.2, fibreG: 3 }),
        veg('Cabbage', { calories: 25, proteinG: 1.3, carbsG: 5.8, fatG: 0.1, fibreG: 2.5 }, { calories: 23, proteinG: 1.2, carbsG: 5.3, fatG: 0.1, fibreG: 2.2 }),
        veg('Bhindi (Okra)', { calories: 33, proteinG: 1.9, carbsG: 7.5, fatG: 0.2, fibreG: 3.2 }, { calories: 30, proteinG: 1.7, carbsG: 6.8, fatG: 0.2, fibreG: 3.4 }),
        veg('Cucumber', { calories: 15, proteinG: 0.7, carbsG: 3.6, fatG: 0.1, fibreG: 0.5 }, { calories: 15, proteinG: 0.7, carbsG: 3.6, fatG: 0.1, fibreG: 0.5 }),
        {
          key: 'mixed_vegetables_cooked', label: 'Mixed Vegetables (Cooked, mixed sabzi)',
          preparations: [
            { key: 'cooked', label: 'Cooked (oil tracked separately)', per100g: { calories: 35, proteinG: 1.6, carbsG: 6.8, fatG: 0.3, fibreG: 2.5 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
        {
          key: 'salad_mixed_raw', label: 'Salad (Mixed Raw Vegetables)',
          preparations: [
            { key: 'raw', label: 'Raw', per100g: { calories: 18, proteinG: 1, carbsG: 3.6, fatG: 0.1, fibreG: 1.5 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
      ],
    },
    {
      key: 'fruits', label: 'Fruits',
      items: [
        fruit('Banana', { calories: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fibreG: 2.6, sugarG: 12.2 }),
        fruit('Apple', { calories: 52, proteinG: 0.3, carbsG: 13.8, fatG: 0.2, fibreG: 2.4, sugarG: 10.4 }),
        fruit('Papaya', { calories: 43, proteinG: 0.5, carbsG: 11, fatG: 0.3, fibreG: 1.7, sugarG: 7.8 }),
        fruit('Orange', { calories: 47, proteinG: 0.9, carbsG: 11.8, fatG: 0.1, fibreG: 2.4, sugarG: 9.4 }),
        fruit('Mango', { calories: 60, proteinG: 0.8, carbsG: 15, fatG: 0.4, fibreG: 1.6, sugarG: 13.7 }),
        fruit('Guava', { calories: 68, proteinG: 2.6, carbsG: 14.3, fatG: 1, fibreG: 5.4, sugarG: 8.9 }),
        fruit('Watermelon', { calories: 30, proteinG: 0.6, carbsG: 7.6, fatG: 0.2, fibreG: 0.4, sugarG: 6.2 }),
        fruit('Grapes', { calories: 69, proteinG: 0.7, carbsG: 18.1, fatG: 0.2, fibreG: 0.9, sugarG: 15.5 }),
        fruit('Pomegranate', { calories: 83, proteinG: 1.7, carbsG: 18.7, fatG: 1.2, fibreG: 4, sugarG: 13.7 }),
        fruit('Pineapple', { calories: 50, proteinG: 0.5, carbsG: 13.1, fatG: 0.1, fibreG: 1.4, sugarG: 9.9 }),
        fruit('Lemon (juice/pulp)', { calories: 29, proteinG: 1.1, carbsG: 9.3, fatG: 0.3, fibreG: 2.8, sugarG: 2.5, vitaminCMg: 53 }),
      ],
    },
    {
      key: 'seeds', label: 'Seeds',
      items: [
        seed('Chia Seeds', { calories: 486, proteinG: 16.5, carbsG: 42.1, fatG: 30.7, fibreG: 34.4 }),
        seed('Flax Seeds', { calories: 534, proteinG: 18.3, carbsG: 28.9, fatG: 42.2, fibreG: 27.3 }),
        seed('Pumpkin Seeds', { calories: 559, proteinG: 30.2, carbsG: 10.7, fatG: 49, fibreG: 6 }),
        seed('Sunflower Seeds', { calories: 584, proteinG: 20.8, carbsG: 20, fatG: 51.5, fibreG: 8.6 }),
        seed('Sesame Seeds', { calories: 573, proteinG: 17.7, carbsG: 23.4, fatG: 49.7, fibreG: 11.8 }),
      ],
    },
    {
      key: 'nuts', label: 'Nuts',
      items: [
        nut('Almonds', { calories: 579, proteinG: 21.2, carbsG: 21.6, fatG: 49.9, fibreG: 12.5 }),
        nut('Walnuts', { calories: 654, proteinG: 15.2, carbsG: 13.7, fatG: 65.2, fibreG: 6.7 }),
        nut('Cashews', { calories: 553, proteinG: 18.2, carbsG: 30.2, fatG: 43.9, fibreG: 3.3 }),
        nut('Peanuts', { calories: 567, proteinG: 25.8, carbsG: 16.1, fatG: 49.2, fibreG: 8.5 }),
        nut('Pistachios', { calories: 560, proteinG: 20.2, carbsG: 27.2, fatG: 45.3, fibreG: 10.6 }),
      ],
    },
    {
      key: 'grains', label: 'Grains',
      items: [
        grain('Rice (White)', { calories: 365, proteinG: 7.1, carbsG: 80, fatG: 0.7, fibreG: 1.3 }, { calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fibreG: 0.4 }),
        grain('Wheat Flour (Atta)', { calories: 340, proteinG: 12, carbsG: 72, fatG: 2, fibreG: 11 }, { calories: 120, proteinG: 4.2, carbsG: 25.4, fatG: 0.7, fibreG: 3.9 }),
        grain('Oats', { calories: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9, fibreG: 10.6 }, { calories: 71, proteinG: 2.5, carbsG: 12, fatG: 1.5, fibreG: 1.7 }),
        grain('Quinoa', { calories: 368, proteinG: 14.1, carbsG: 64.2, fatG: 6.1, fibreG: 7 }, { calories: 120, proteinG: 4.4, carbsG: 21.3, fatG: 1.9, fibreG: 2.8 }),
        grain('Bajra (Pearl Millet)', { calories: 361, proteinG: 11.6, carbsG: 67.5, fatG: 5, fibreG: 8.5 }, { calories: 125, proteinG: 4, carbsG: 23.3, fatG: 1.7, fibreG: 2.9 }),
        grain('Ragi (Finger Millet)', { calories: 336, proteinG: 7.3, carbsG: 72, fatG: 1.3, fibreG: 11.5 }, { calories: 116, proteinG: 2.5, carbsG: 24.9, fatG: 0.4, fibreG: 4, calciumMg: 118 }),
      ],
    },
    {
      key: 'legumes', label: 'Legumes',
      items: [
        legume('Chickpeas (Chana)', { calories: 364, proteinG: 19.3, carbsG: 61, fatG: 6, fibreG: 17 }, { calories: 164, proteinG: 8.9, carbsG: 27.4, fatG: 2.6, fibreG: 7.6 }),
        legume('Kidney Beans (Rajma)', { calories: 333, proteinG: 23.6, carbsG: 60, fatG: 0.8, fibreG: 24.9 }, { calories: 127, proteinG: 8.7, carbsG: 22.8, fatG: 0.5, fibreG: 6.4 }),
        legume('Moong Dal (split)', { calories: 347, proteinG: 24, carbsG: 59, fatG: 1.2, fibreG: 16 }, { calories: 105, proteinG: 7, carbsG: 19, fatG: 0.4, fibreG: 7.6 }),
        legume('Toor Dal (split pigeon pea)', { calories: 343, proteinG: 22.3, carbsG: 57.6, fatG: 1.5, fibreG: 15 }, { calories: 121, proteinG: 6.8, carbsG: 20.9, fatG: 0.5, fibreG: 5 }),
        legume('Masoor Dal (red lentil)', { calories: 352, proteinG: 25.8, carbsG: 60, fatG: 1.1, fibreG: 11 }, { calories: 116, proteinG: 9, carbsG: 20, fatG: 0.4, fibreG: 8 }),
      ],
    },
    {
      key: 'other', label: 'Other Foods',
      items: [
        {
          key: 'egg', label: 'Egg (whole, chicken)',
          preparations: [
            { key: 'raw', label: 'Raw', per100g: { calories: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5 } },
            { key: 'boiled', label: 'Boiled', per100g: { calories: 155, proteinG: 13, carbsG: 1.1, fatG: 11 } },
            { key: 'fried', label: 'Fried (oil tracked separately)', per100g: { calories: 170, proteinG: 13.3, carbsG: 0.8, fatG: 12.5 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
        {
          key: 'chicken_breast', label: 'Chicken Breast',
          preparations: [
            { key: 'raw', label: 'Raw', per100g: { calories: 120, proteinG: 22.5, carbsG: 0, fatG: 2.6 } },
            { key: 'cooked', label: 'Cooked (grilled/boiled)', per100g: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
        {
          key: 'milk', label: 'Milk (whole, cow)',
          preparations: [
            { key: 'as_is', label: 'As-is', per100g: { calories: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3, calciumMg: 113 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
        {
          key: 'bread', label: 'Whole Wheat Bread',
          preparations: [
            { key: 'as_is', label: 'As-is', per100g: { calories: 247, proteinG: 13, carbsG: 41, fatG: 3.4, fibreG: 7 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
        {
          key: 'ghee', label: 'Ghee',
          preparations: [
            { key: 'as_is', label: 'As-is', per100g: { calories: 900, proteinG: 0, carbsG: 0, fatG: 100 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
        {
          key: 'sprouts', label: 'Moong Sprouts',
          preparations: [
            { key: 'raw', label: 'Raw', per100g: { calories: 30, proteinG: 3, carbsG: 6.4, fatG: 0.2, fibreG: 1.8 } },
            { key: 'cooked', label: 'Cooked (steamed/boiled)', per100g: { calories: 39, proteinG: 3.9, carbsG: 7.3, fatG: 0.4, fibreG: 2.5 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
        {
          key: 'tea_coffee_no_sugar', label: 'Tea or Coffee (No Sugar/Milk)',
          preparations: [
            { key: 'as_is', label: 'As-is', per100g: { calories: 2, proteinG: 0.1, carbsG: 0.3, fatG: 0, fibreG: 0 } },
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
        {
          key: 'custom_other', label: 'Something else (enter manually)',
          preparations: [
            { key: 'other', label: 'Other', per100g: null },
          ],
        },
      ],
    },
  ];

  // Small builders to keep the per-category lists above readable.
  function veg(label, raw, boiled) {
    return {
      key: slug(label), label,
      preparations: [
        { key: 'raw', label: 'Raw', per100g: raw },
        { key: 'boiled', label: 'Boiled', per100g: boiled },
        { key: 'cooked', label: 'Cooked (sabzi/curry — oil tracked separately)', per100g: boiled },
        { key: 'air_cooked', label: 'Air-cooked', per100g: boiled },
        { key: 'other', label: 'Other', per100g: null },
      ],
    };
  }
  function fruit(label, raw) {
    return {
      key: slug(label), label,
      preparations: [
        { key: 'raw', label: 'Raw / Fresh', per100g: raw },
        { key: 'other', label: 'Other', per100g: null },
      ],
    };
  }
  function seed(label, raw) {
    return {
      key: slug(label), label,
      preparations: [
        { key: 'raw', label: 'Raw', per100g: raw },
        { key: 'roasted', label: 'Roasted', per100g: raw },
        { key: 'other', label: 'Other', per100g: null },
      ],
    };
  }
  function nut(label, raw) {
    return {
      key: slug(label), label,
      preparations: [
        { key: 'raw', label: 'Raw', per100g: raw },
        { key: 'roasted', label: 'Roasted', per100g: raw },
        { key: 'other', label: 'Other', per100g: null },
      ],
    };
  }
  function grain(label, raw, cooked) {
    return {
      key: slug(label), label,
      preparations: [
        { key: 'dry_raw', label: 'Dry / Raw', per100g: raw },
        { key: 'cooked', label: 'Cooked', per100g: cooked },
        { key: 'other', label: 'Other', per100g: null },
      ],
    };
  }
  function legume(label, raw, boiled) {
    return {
      key: slug(label), label,
      preparations: [
        { key: 'dry_raw', label: 'Dry / Raw', per100g: raw },
        { key: 'boiled', label: 'Boiled', per100g: boiled },
        { key: 'cooked', label: 'Cooked (curry — oil tracked separately)', per100g: boiled },
        { key: 'other', label: 'Other', per100g: null },
      ],
    };
  }
  function slug(label) {
    return label.toLowerCase().replace(/[()]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function findCategory(categoryKey) {
    return CATEGORIES.find(c => c.key === categoryKey) || null;
  }
  function findItem(categoryKey, itemKey) {
    const cat = findCategory(categoryKey);
    return cat ? (cat.items.find(i => i.key === itemKey) || null) : null;
  }
  function findPreparation(categoryKey, itemKey, prepKey) {
    const item = findItem(categoryKey, itemKey);
    return item ? (item.preparations.find(p => p.key === prepKey) || null) : null;
  }

  return {
    OIL_KCAL_PER_G,
    OIL_FAT_G_PER_G,
    CATEGORIES,
    findCategory,
    findItem,
    findPreparation,
  };
})();
