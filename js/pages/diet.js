/**
 * pages/diet.js — the Diet & Nutrition Engine UI. Reuses, never
 * re-derives:
 *   - targets: Calculations.calculateAllTargets() (profile + program/phase)
 *   - food/product math: FoodCalc (food-calculations.js)
 *   - reconciliation of the two + quality score: DietEngine (diet-engine.js)
 * This page only assembles those into Meal Templates, a Daily Nutrition
 * view, a Source Breakdown, and a Nutrition Quality indicator.
 */

const PageDiet = (() => {

  const MEAL_TYPES = [
    { value: 'breakfast', label: 'Breakfast' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'pre_workout', label: 'Pre-workout' },
    { value: 'dinner', label: 'Dinner' },
    { value: 'snack', label: 'Snack' },
  ];

  const SOURCE_TYPES = [
    { value: 'generic', label: 'Food (generic database)' },
    { value: 'product', label: 'Saved product' },
    { value: 'custom', label: 'Custom / manual entry' },
  ];

  const BASIS_OPTIONS = [
    { value: 'before_cooking', label: 'Measured before cooking' },
    { value: 'after_cooking', label: 'Measured after cooking' },
  ];

  const UNIT_LABELS = { g: 'g', ml: 'ml', serving: 'serving(s)', piece: 'piece(s)', custom: 'custom unit' };

  const MANUAL_MACRO_FIELDS = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'proteinG', label: 'Protein', unit: 'g' },
    { key: 'carbsG', label: 'Carbohydrates', unit: 'g' },
    { key: 'fatG', label: 'Fat', unit: 'g' },
    { key: 'fibreG', label: 'Fibre', unit: 'g' },
    { key: 'sugarG', label: 'Sugar', unit: 'g' },
  ];

  let selectedDate = Models.todayIso();
  let templateView = 'list';        // 'list' | 'builder'
  let editingTemplateId = null;
  let builder = null;
  let selectedBreakdownNutrient = 'calories';

  function blankNewItem() {
    return {
      sourceType: 'generic',
      foodCategory: '', foodItemKey: '', preparationKey: '',
      productId: '',
      customFoodName: '',
      manualNutrients: { calories: null, proteinG: null, carbsG: null, fatG: null, fibreG: null, sugarG: null },
      quantity: '', unit: 'g', customUnitLabel: '',
      preparationText: '',
      measurementBasis: 'after_cooking',
      cookingOilG: '', cookingOilLabel: '',
    };
  }

  function blankBuilder() {
    return { name: '', mealType: 'breakfast', isFavorite: false, items: [], newItem: blankNewItem() };
  }

  async function render(container) {
    await renderInner(container);
  }

  async function renderInner(container) {
    container.innerHTML = '';

    let userId = DataService.getCurrentUserId();
    if (!userId) {
      const user = await DataService.users.create(Models.createUser({ name: 'New User' }));
      userId = user.userId;
      DataService.setCurrentUserId(userId);
    }

    const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
    const program = (await DataService.programs.list(p => p.userId === userId && p.status === 'active'))[0] || null;
    const phases = program ? await DataService.programPhases.list(ph => ph.programId === program.programId) : [];
    const currentPhase = phases.length ? Calculations.getCurrentPhase(phases) : null;
    const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
    const targets = profile ? Calculations.calculateAllTargets(profile, { weightEntries, program, phase: currentPhase }) : null;

    const allTemplates = await DataService.mealTemplates.list(t => t.userId === userId);
    // Program-specific meal templates (programId set) only show while that program is active;
    // unscoped templates (programId null — e.g. the 60-Day program's own meals) always show.
    const templates = allTemplates.filter(t => !t.programId || t.programId === program?.programId);
    const products = await DataService.foodProducts.list(p => p.userId === userId);
    const todayEntries = await DataService.mealItems.list(e => e.userId === userId && e.date === selectedDate);
    const yesterdayDate = ProgramTemplates.addDays(selectedDate, -1);
    const yesterdayEntries = await DataService.mealItems.list(e => e.userId === userId && e.date === yesterdayDate);

    container.appendChild(renderDietHero(todayEntries, targets));
    container.appendChild(renderDateBar(userId, products, yesterdayEntries, container));

    if (templateView === 'builder') {
      container.appendChild(renderBuilderCard(userId, products, container));
    } else {
      container.appendChild(renderTemplatesCard(userId, templates, products, container));
    }

    if (!profile) {
      container.appendChild(Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'Complete your profile to see personalized nutrition targets.'),
          Utils.el('a', { class: 'btn btn--secondary', href: '#/profile' }, 'Go to Profile'),
        ]),
      ]));
    }

    container.appendChild(renderDailyNutritionCard(todayEntries, targets));
    container.appendChild(renderSourceBreakdownCard(todayEntries, container));
    container.appendChild(renderQualityCard(todayEntries, targets));

    UIFx.animateIn(container);
  }

  // -------------------------------------------------------------------
  // HERO — nutrition quality score ring + today's macro rings, so the
  // page opens with a graphic tied directly to the diet plan's own data.
  // -------------------------------------------------------------------

  function renderDietHero(entries, targets) {
    const quality = DietEngine.computeNutritionQuality(entries, targets);
    const totals = entries.length ? FoodCalc.sumEntries(entries.map(e => e.computedNutrition)) : null;

    const macro = (value, target) => {
      const v = value ?? 0;
      const pct = target ? Math.min(100, Math.round((v / target) * 100)) : (v > 0 ? 100 : 0);
      return { pct, number: Utils.fmt(v, ''), of: target ? `of ${Utils.fmt(target, '')}` : '' };
    };
    const cal = macro(totals?.calories, targets?.calorieTarget);
    const pro = macro(totals?.proteinG, targets?.proteinTargetG);
    const carb = macro(totals?.carbsG, targets?.carbTargetG);
    const fat = macro(totals?.fatG, targets?.fatTargetG);

    const hero = UIFx.hero({
      theme: 'nutrition',
      icon: '\uD83C\uDF3F',
      eyebrow: 'Diet Plan',
      title: 'Nutrition Overview',
      subtitle: quality.score != null
        ? `Today\u2019s nutrition quality score: ${quality.score}/100 (${quality.label}).`
        : 'Log today\u2019s food to see a quality score and macro breakdown.',
      stats: [],
    });
    hero.classList.add('card--hero--compact', 'card--accent-nutrition');
    const row = Utils.el('div', { class: 'hero__stats', style: 'flex:1 1 auto;align-items:center;gap:26px;flex-wrap:wrap;' }, [
      quality.score != null ? UIFx.ringNode({
        pct: quality.score, number: `${quality.score}`, of: '/ 100',
        colorFrom: 'var(--gold-soft)', colorTo: 'var(--gold)', size: 110, stroke: 9,
      }) : null,
      UIFx.ringRow([
        { label: 'Calories', ...cal, colorFrom: 'var(--gold-soft)', colorTo: 'var(--gold)' },
        { label: 'Protein', ...pro, colorFrom: 'var(--moss-tint)', colorTo: 'var(--moss)' },
        { label: 'Carbs', ...carb, colorFrom: 'var(--ember-tint)', colorTo: 'var(--ember)' },
        { label: 'Fat', ...fat, colorFrom: '#DCE3F5', colorTo: 'var(--sleep)' },
      ]),
    ].filter(Boolean));
    hero.querySelector('.hero__inner').appendChild(row);
    return hero;
  }

  // -------------------------------------------------------------------
  // DATE BAR + COPY YESTERDAY
  // -------------------------------------------------------------------

  function renderDateBar(userId, products, yesterdayEntries, container) {
    const shift = (days) => { selectedDate = ProgramTemplates.addDays(selectedDate, days); renderInner(container); };

    const copyBtn = Utils.el('button', {
      class: `btn btn--secondary btn--row${yesterdayEntries.length ? '' : ' btn--disabled'}`, type: 'button',
      title: yesterdayEntries.length ? '' : 'Nothing logged yesterday to copy.',
      onClick: async () => {
        if (!yesterdayEntries.length) { Utils.toast('Nothing logged yesterday to copy.', 'error'); return; }
        for (const entry of yesterdayEntries) {
          const { computed, nutritionSource } = recomputeForCopy(entry, products);
          await DataService.mealItems.create(Models.createMealItem(userId, {
            date: selectedDate, mealType: entry.mealType,
            sourceType: entry.sourceType, nutritionSource,
            foodCategory: entry.foodCategory, foodItemKey: entry.foodItemKey, preparationKey: entry.preparationKey,
            preparationLabel: entry.preparationLabel, productId: entry.productId,
            foodLabel: entry.foodLabel, brand: entry.brand,
            quantity: entry.quantity, unit: entry.unit, customUnitLabel: entry.customUnitLabel,
            preparation: entry.preparation, measurementBasis: entry.measurementBasis,
            cookingOilG: entry.cookingOilG, cookingOilLabel: entry.cookingOilLabel,
            notes: entry.notes, computedNutrition: computed,
          }));
        }
        Utils.toast(`Copied yesterday's log (${yesterdayEntries.length} item${yesterdayEntries.length === 1 ? '' : 's'}) to ${Utils.formatDate(selectedDate)}.`, 'success');
        await renderInner(container);
      },
    }, 'Copy Yesterday');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Diet & Nutrition'),
          Utils.el('p', { class: 'card__subtitle' }, Utils.formatDate(selectedDate)),
        ]),
        Utils.el('div', { class: 'row-actions' }, [
          Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => shift(-1) }, '← Prev day'),
          Utils.el('input', {
            class: 'form__input', type: 'date', value: selectedDate,
            onChange: (e) => { if (e.target.value) { selectedDate = e.target.value; renderInner(container); } },
          }),
          Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => shift(1) }, 'Next day →'),
          copyBtn,
          Utils.el('a', { class: 'btn btn--secondary btn--row', href: '#/nutrition' }, 'Open Food Entry'),
        ]),
      ]),
    ]);
  }

  /** Recomputes a copied entry's nutrition through FoodCalc where the
   *  original source can still be resolved (generic DB item or an
   *  existing product) so a since-edited product is reflected; otherwise
   *  reuses the value already stored on the entry (custom / generic
   *  entries with no database figure have no better source to recompute from). */
  function recomputeForCopy(entry, products) {
    if (entry.sourceType === 'generic') {
      const prep = FoodDatabase.findPreparation(entry.foodCategory, entry.foodItemKey, entry.preparationKey);
      if (prep && prep.per100g) {
        return FoodCalc.computeEntryNutrition({
          sourceType: 'generic', per100g: prep.per100g, quantity: entry.quantity, unit: entry.unit, cookingOilG: entry.cookingOilG,
        });
      }
    } else if (entry.sourceType === 'product' && entry.productId) {
      const product = products.find(p => p.productId === entry.productId);
      if (product) {
        return FoodCalc.computeEntryNutrition({
          sourceType: 'product', product, quantity: entry.quantity, unit: entry.unit, cookingOilG: entry.cookingOilG,
        });
      }
    }
    return { computed: entry.computedNutrition, nutritionSource: entry.nutritionSource };
  }

  // -------------------------------------------------------------------
  // MEAL TEMPLATES — list
  // -------------------------------------------------------------------

  function renderTemplatesCard(userId, templates, products, container) {
    const newBtn = Utils.el('button', {
      class: 'btn btn--primary', type: 'button',
      onClick: () => { builder = blankBuilder(); editingTemplateId = null; templateView = 'builder'; renderInner(container); },
    }, '+ New Meal Template');

    let body;
    if (!templates.length) {
      body = Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered'));
    } else {
      const groups = MEAL_TYPES
        .map(mt => ({ meta: mt, items: templates.filter(t => t.mealType === mt.value).sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0)) }))
        .filter(g => g.items.length);
      body = Utils.el('div', { class: 'entry-list' }, groups.map(g => Utils.el('div', { class: 'meal-group' }, [
        Utils.el('h3', { class: 'meal-group__title' }, g.meta.label),
        ...g.items.map(t => renderTemplateRow(t, userId, products, container)),
      ])));
    }

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Meal Templates'),
          Utils.el('p', { class: 'card__subtitle' }, 'Reusable meals — build once, log in one action.'),
        ]),
        newBtn,
      ]),
      body,
    ]);
  }

  function renderTemplateRow(template, userId, products, container) {
    const totals = FoodCalc.sumEntries(template.items.map(i => i.computedNutrition));

    const favBtn = Utils.el('button', {
      class: `btn btn--secondary btn--row${template.isFavorite ? ' chip--active' : ''}`, type: 'button',
      title: template.isFavorite ? 'Unfavorite' : 'Favorite',
      onClick: async () => {
        await DataService.mealTemplates.update(template.mealTemplateId, { isFavorite: !template.isFavorite });
        await renderInner(container);
      },
    }, template.isFavorite ? '★ Favorited' : '☆ Favorite');

    const logBtn = Utils.el('button', {
      class: 'btn btn--primary btn--row', type: 'button',
      onClick: () => logTemplateToDate(template, userId, products, selectedDate, container),
    }, 'Log to Today');

    const editBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => {
        builder = {
          name: template.name, mealType: template.mealType, isFavorite: template.isFavorite,
          items: template.items.map(i => ({ ...i })), newItem: blankNewItem(),
        };
        editingTemplateId = template.mealTemplateId;
        templateView = 'builder';
        renderInner(container);
      },
    }, 'Edit');

    const duplicateBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        await DataService.mealTemplates.create(Models.createMealTemplate(userId, {
          name: `${template.name} (Copy)`, mealType: template.mealType, isFavorite: false,
          items: template.items.map(i => Models.createMealTemplateItem({ ...i, itemId: undefined })),
          notes: template.notes,
        }));
        Utils.toast('Meal template duplicated.', 'success');
        await renderInner(container);
      },
    }, 'Duplicate');

    const deleteBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => {
        const confirmed = window.confirm(`Delete "${template.name || 'Untitled meal'}"? This cannot be undone.`);
        if (!confirmed) return;
        await DataService.mealTemplates.delete(template.mealTemplateId);
        Utils.toast('Meal template deleted.', 'success');
        await renderInner(container);
      },
    }, 'Delete');

    return Utils.el('div', { class: 'entry-row' }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__title-line' }, [
          Utils.el('span', { class: 'entry-row__name' }, template.name || 'Untitled Meal'),
          Utils.el('span', { class: 'badge' }, `${template.items.length} item${template.items.length === 1 ? '' : 's'}`),
        ]),
        Utils.el('div', { class: 'entry-row__meta' },
          `${Utils.fmt(totals.calories, ' kcal')} · P ${Utils.fmt(totals.proteinG, 'g')} · C ${Utils.fmt(totals.carbsG, 'g')} · F ${Utils.fmt(totals.fatG, 'g')}`),
      ]),
      Utils.el('div', { class: 'row-actions' }, [logBtn, favBtn, editBtn, duplicateBtn, deleteBtn]),
    ]);
  }

  async function logTemplateToDate(template, userId, products, date, container) {
    for (const item of template.items) {
      let result;
      if (item.sourceType === 'generic') {
        const prep = FoodDatabase.findPreparation(item.foodCategory, item.foodItemKey, item.preparationKey);
        result = FoodCalc.computeEntryNutrition({
          sourceType: 'generic', per100g: prep ? prep.per100g : null, manualNutrients: item.manualNutrients,
          quantity: item.quantity, unit: item.unit, cookingOilG: item.cookingOilG,
        });
      } else if (item.sourceType === 'product') {
        const product = products.find(p => p.productId === item.productId);
        result = FoodCalc.computeEntryNutrition({
          sourceType: 'product', product, quantity: item.quantity, unit: item.unit, cookingOilG: item.cookingOilG,
        });
      } else {
        result = FoodCalc.computeEntryNutrition({ sourceType: 'custom', manualNutrients: item.manualNutrients, cookingOilG: item.cookingOilG });
      }

      await DataService.mealItems.create(Models.createMealItem(userId, {
        date, mealType: template.mealType, programId: template.programId || null,
        sourceType: item.sourceType, nutritionSource: result.nutritionSource,
        foodCategory: item.foodCategory, foodItemKey: item.foodItemKey, preparationKey: item.preparationKey,
        preparationLabel: item.preparationLabel, productId: item.productId,
        foodLabel: item.foodLabel, brand: item.brand,
        quantity: item.quantity, unit: item.unit, customUnitLabel: item.customUnitLabel,
        preparation: item.preparation, measurementBasis: item.measurementBasis || 'after_cooking',
        cookingOilG: item.cookingOilG, cookingOilLabel: item.cookingOilLabel,
        notes: item.notes, computedNutrition: result.computed,
      }));
    }
    Utils.toast(`"${template.name}" logged to ${Utils.formatDate(date)}.`, 'success');
    await renderInner(container);
  }

  // -------------------------------------------------------------------
  // MEAL TEMPLATE BUILDER (Add / Edit / Save meal)
  // -------------------------------------------------------------------

  function renderBuilderCard(userId, products, container) {
    const refresh = () => {
      const card = renderBuilderCard(userId, products, container);
      const old = document.getElementById('template-builder-card');
      if (old) old.replaceWith(card);
      return card;
    };

    const form = Utils.el('form', { class: 'form', id: 'template-form' });
    const errorsHost = Utils.el('div', { class: 'form__errors' });

    form.appendChild(Utils.el('div', { class: 'form__grid' }, [
      textField('name', 'Meal name', builder.name, (v) => { builder.name = v; }),
      selectField('mealType', 'Meal type', builder.mealType, MEAL_TYPES, (v) => { builder.mealType = v; }),
    ]));

    // Already-added items
    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, `Items (${builder.items.length})`));
    if (builder.items.length) {
      const totals = FoodCalc.sumEntries(builder.items.map(i => i.computedNutrition));
      form.appendChild(Utils.el('div', { class: 'item-list' }, builder.items.map((item, idx) => Utils.el('div', { class: 'entry-row' }, [
        Utils.el('div', { class: 'entry-row__main' }, [
          Utils.el('div', { class: 'entry-row__title-line' }, [
            Utils.el('span', { class: 'entry-row__name' }, item.foodLabel || 'Untitled'),
            item.brand ? Utils.el('span', { class: 'entry-row__brand' }, ` · ${item.brand}`) : null,
          ].filter(Boolean)),
          Utils.el('div', { class: 'entry-row__meta' },
            `${item.quantity} ${UNIT_LABELS[item.unit] || item.unit}${item.preparation ? ' · ' + item.preparation : ''}`),
        ]),
        Utils.el('div', { class: 'entry-row__macros' },
          `${Utils.fmt(item.computedNutrition?.calories, ' kcal')} · P ${Utils.fmt(item.computedNutrition?.proteinG, 'g')}`),
        Utils.el('div', { class: 'row-actions' }, [
          Utils.el('button', {
            class: 'btn btn--danger btn--row', type: 'button',
            onClick: () => { builder.items.splice(idx, 1); refresh(); },
          }, 'Remove'),
        ]),
      ]))));
      form.appendChild(Utils.el('p', { class: 'card__footnote' },
        `Meal total so far: ${Utils.fmt(totals.calories, ' kcal')} · P ${Utils.fmt(totals.proteinG, 'g')} · C ${Utils.fmt(totals.carbsG, 'g')} · F ${Utils.fmt(totals.fatG, 'g')}`));
    } else {
      form.appendChild(Utils.el('p', { class: 'card__footnote' }, 'No items added yet.'));
    }

    // Add-item picker
    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, 'Add an item'));
    form.appendChild(renderItemPicker(products, refresh));

    const actions = Utils.el('div', { class: 'form__actions' }, [
      Utils.el('button', { class: 'btn btn--primary', type: 'submit' }, editingTemplateId ? 'Save changes' : 'Save meal'),
      Utils.el('button', {
        class: 'btn btn--secondary', type: 'button',
        onClick: () => { templateView = 'list'; builder = null; editingTemplateId = null; renderInner(container); },
      }, 'Cancel'),
    ]);
    form.appendChild(actions);

    form.addEventListener('submit', (e) => handleSaveTemplate(e, userId, container));

    return Utils.el('section', { class: 'card card--form', id: 'template-builder-card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, editingTemplateId ? 'Edit Meal Template' : 'New Meal Template'),
      ]),
      errorsHost,
      form,
    ]);
  }

  function renderItemPicker(products, refresh) {
    const ni = builder.newItem;
    const wrap = Utils.el('div', {}, []);

    wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
      selectField('newItemSourceType', 'Food source', ni.sourceType, SOURCE_TYPES, (v) => {
        ni.sourceType = v; ni.foodCategory = ''; ni.foodItemKey = ''; ni.preparationKey = ''; ni.productId = ''; ni.customFoodName = ''; ni.unit = 'g';
        refresh();
      }),
    ]));

    if (ni.sourceType === 'generic') {
      const grid = Utils.el('div', { class: 'form__grid' }, [
        selectField('foodCategory', 'Category', ni.foodCategory,
          [{ value: '', label: '— Select —' }, ...FoodDatabase.CATEGORIES.map(c => ({ value: c.key, label: c.label }))],
          (v) => { ni.foodCategory = v; ni.foodItemKey = ''; ni.preparationKey = ''; refresh(); }),
      ]);
      const category = FoodDatabase.findCategory(ni.foodCategory);
      if (category) {
        grid.appendChild(selectField('foodItemKey', 'Food', ni.foodItemKey,
          [{ value: '', label: '— Select —' }, ...category.items.map(i => ({ value: i.key, label: i.label }))],
          (v) => { ni.foodItemKey = v; ni.preparationKey = ''; refresh(); }));
      }
      const item = category ? FoodDatabase.findItem(ni.foodCategory, ni.foodItemKey) : null;
      if (item) {
        grid.appendChild(selectField('preparationKey', 'Preparation', ni.preparationKey,
          [{ value: '', label: '— Select —' }, ...item.preparations.map(p => ({ value: p.key, label: p.label }))],
          (v) => { ni.preparationKey = v; refresh(); }));
      }
      wrap.appendChild(grid);
      const prep = item ? FoodDatabase.findPreparation(ni.foodCategory, ni.foodItemKey, ni.preparationKey) : null;
      if (prep && !prep.per100g) {
        wrap.appendChild(Utils.el('p', { class: 'card__footnote' }, 'No generic figure for this preparation — enter nutrition manually:'));
        wrap.appendChild(manualMacroGrid(ni));
      }
    } else if (ni.sourceType === 'product') {
      wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
        selectField('productId', 'Saved product', ni.productId,
          [{ value: '', label: '— Select —' }, ...products.map(p => ({ value: p.productId, label: `${p.brand ? p.brand + ' — ' : ''}${p.name}` }))],
          (v) => {
            ni.productId = v;
            const product = products.find(p => p.productId === v);
            ni.unit = (FoodCalc.validUnitsForProduct(product))[0] || 'g';
            refresh();
          }),
      ]));
      if (!products.length) wrap.appendChild(Utils.el('p', { class: 'card__footnote' }, 'No saved products yet — add one on the Products page first.'));
    } else {
      wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
        textField('customFoodName', 'Food name', ni.customFoodName, (v) => { ni.customFoodName = v; }),
      ]));
      wrap.appendChild(Utils.el('p', { class: 'card__footnote' }, 'Enter the nutrition for exactly the quantity below:'));
      wrap.appendChild(manualMacroGrid(ni));
    }

    // Quantity + unit
    let units;
    if (ni.sourceType === 'generic') units = ['g', 'ml'];
    else if (ni.sourceType === 'product') units = FoodCalc.validUnitsForProduct(products.find(p => p.productId === ni.productId));
    else units = ['g', 'ml', 'piece', 'serving', 'custom'];

    const qtyGrid = Utils.el('div', { class: 'form__grid' }, [
      Utils.el('div', { class: 'form__field' }, [
        Utils.el('label', { class: 'form__label' }, 'Quantity'),
        Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: ni.quantity, onInput: (e) => { ni.quantity = e.target.value; } }),
      ]),
      selectField('newItemUnit', 'Unit', ni.unit, units.map(u => ({ value: u, label: UNIT_LABELS[u] || u })), (v) => { ni.unit = v; }),
      selectField('newItemBasis', 'Measurement basis', ni.measurementBasis, BASIS_OPTIONS, (v) => { ni.measurementBasis = v; }),
    ]);
    wrap.appendChild(qtyGrid);

    if (ni.sourceType !== 'generic') {
      wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
        textField('newItemPreparationText', 'Preparation (optional)', ni.preparationText, (v) => { ni.preparationText = v; }),
      ]));
    }

    wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
      Utils.el('div', { class: 'form__field' }, [
        Utils.el('label', { class: 'form__label' }, 'Cooking oil (g, optional)'),
        Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: ni.cookingOilG, onInput: (e) => { ni.cookingOilG = e.target.value; } }),
      ]),
      textField('newItemOilLabel', 'Oil type (optional)', ni.cookingOilLabel, (v) => { ni.cookingOilLabel = v; }),
    ]));

    wrap.appendChild(Utils.el('button', {
      class: 'btn btn--secondary', type: 'button',
      onClick: () => addItemToBuilder(products, refresh),
    }, '+ Add item to meal'));

    return wrap;
  }

  function manualMacroGrid(ni) {
    return Utils.el('div', { class: 'form__grid' }, MANUAL_MACRO_FIELDS.map(f => Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label' }, `${f.label} (${f.unit})`),
      Utils.el('input', {
        class: 'form__input', type: 'number', step: 'any', min: 0, value: ni.manualNutrients[f.key] ?? '',
        onInput: (e) => { ni.manualNutrients[f.key] = e.target.value === '' ? null : Number(e.target.value); },
      }),
    ])));
  }

  function addItemToBuilder(products, refresh) {
    const ni = builder.newItem;
    const qty = Number(ni.quantity);
    if (!qty || qty <= 0) { Utils.toast('Enter a quantity greater than 0.', 'error'); return; }

    let foodLabel = '', brand = '', preparation = '', preparationLabel = '', productId = null;
    let foodCategory = '', foodItemKey = '', preparationKey = '', result;

    if (ni.sourceType === 'generic') {
      if (!ni.foodCategory || !ni.foodItemKey || !ni.preparationKey) { Utils.toast('Select a category, food, and preparation.', 'error'); return; }
      const item = FoodDatabase.findItem(ni.foodCategory, ni.foodItemKey);
      const prep = FoodDatabase.findPreparation(ni.foodCategory, ni.foodItemKey, ni.preparationKey);
      foodLabel = item ? item.label : ''; preparation = prep ? prep.label : ''; preparationLabel = preparation;
      foodCategory = ni.foodCategory; foodItemKey = ni.foodItemKey; preparationKey = ni.preparationKey;
      result = FoodCalc.computeEntryNutrition({ sourceType: 'generic', per100g: prep ? prep.per100g : null, manualNutrients: ni.manualNutrients, quantity: qty, unit: ni.unit, cookingOilG: ni.cookingOilG });
      if (prep && prep.per100g && !result.computed) { Utils.toast('Generic foods can only be logged in grams or millilitres.', 'error'); return; }
    } else if (ni.sourceType === 'product') {
      if (!ni.productId) { Utils.toast('Select a saved product.', 'error'); return; }
      const product = products.find(p => p.productId === ni.productId);
      foodLabel = product.name; brand = product.brand; productId = product.productId; preparation = ni.preparationText;
      result = FoodCalc.computeEntryNutrition({ sourceType: 'product', product, quantity: qty, unit: ni.unit, cookingOilG: ni.cookingOilG });
      if (!result.computed) { Utils.toast("This quantity/unit can't be scaled from the product's label — check the unit.", 'error'); return; }
    } else {
      if (!ni.customFoodName.trim()) { Utils.toast('Enter a food name.', 'error'); return; }
      foodLabel = ni.customFoodName.trim(); preparation = ni.preparationText;
      result = FoodCalc.computeEntryNutrition({ sourceType: 'custom', manualNutrients: ni.manualNutrients, cookingOilG: ni.cookingOilG });
    }

    builder.items.push(Models.createMealTemplateItem({
      sourceType: ni.sourceType, foodCategory, foodItemKey, preparationKey, preparationLabel,
      productId, foodLabel, brand,
      quantity: qty, unit: ni.unit, customUnitLabel: ni.customUnitLabel,
      preparation, measurementBasis: ni.measurementBasis,
      cookingOilG: ni.cookingOilG ? Number(ni.cookingOilG) : null, cookingOilLabel: ni.cookingOilLabel,
      manualNutrients: (ni.sourceType === 'custom' || (ni.sourceType === 'generic' && result.nutritionSource === 'user_entered')) ? { ...ni.manualNutrients } : null,
      computedNutrition: result.computed,
    }));

    builder.newItem = blankNewItem();
    refresh();
  }

  async function handleSaveTemplate(e, userId, container) {
    e.preventDefault();
    const errors = [];
    if (!builder.name.trim()) errors.push('Meal name is required.');
    if (!builder.mealType) errors.push('Meal type is required.');
    if (!builder.items.length) errors.push('Add at least one item.');

    const card = document.getElementById('template-builder-card');
    const errorsHost = card ? card.querySelector('.form__errors') : null;
    if (errorsHost) errorsHost.innerHTML = '';
    if (errors.length) {
      if (errorsHost) errorsHost.appendChild(Utils.el('ul', { class: 'error-list' }, errors.map(msg => Utils.el('li', {}, msg))));
      Utils.toast('Please fix the highlighted errors.', 'error');
      return;
    }

    const patch = { name: builder.name.trim(), mealType: builder.mealType, isFavorite: builder.isFavorite, items: builder.items };
    if (editingTemplateId) {
      await DataService.mealTemplates.update(editingTemplateId, patch);
      Utils.toast('Meal template updated.', 'success');
    } else {
      await DataService.mealTemplates.create(Models.createMealTemplate(userId, patch));
      Utils.toast('Meal template saved.', 'success');
    }

    templateView = 'list'; builder = null; editingTemplateId = null;
    await renderInner(container);
  }

  // -------------------------------------------------------------------
  // FIELD HELPERS
  // -------------------------------------------------------------------

  function selectField(name, label, value, options, onChange) {
    const id = `field-${name}-${Math.random().toString(36).slice(2, 6)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('select', { class: 'form__input', id, onChange: (e) => onChange(e.target.value) }, options.map(o => {
        const opt = Utils.el('option', { value: o.value }, o.label);
        if (value === o.value) opt.setAttribute('selected', 'selected');
        return opt;
      })),
    ]);
  }

  function textField(name, label, value, onInput) {
    const id = `field-${name}-${Math.random().toString(36).slice(2, 6)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('input', { class: 'form__input', id, type: 'text', value, onInput: (e) => onInput(e.target.value) }),
    ]);
  }

  // -------------------------------------------------------------------
  // DAILY NUTRITION
  // -------------------------------------------------------------------

  function renderDailyNutritionCard(entries, targets) {
    if (!entries.length) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Daily Nutrition')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }

    const rows = DietEngine.computeDailySummary(entries, targets);
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Daily Nutrition'),
        Utils.el('p', { class: 'card__subtitle' }, 'Targets from your personalized Calculated Targets — see Profile / Dashboard.'),
      ]),
      Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
        Utils.el('thead', {}, Utils.el('tr', {}, ['Nutrient', 'Consumed', 'Target', 'Remaining', '%'].map(h => Utils.el('th', {}, h)))),
        Utils.el('tbody', {}, rows.map(r => Utils.el('tr', {}, [
          Utils.el('td', {}, r.label),
          Utils.el('td', {}, Utils.fmt(r.consumed, r.consumed != null ? ` ${r.unit}` : '')),
          Utils.el('td', {}, Utils.fmt(r.target, r.target != null ? ` ${r.unit}` : '')),
          Utils.el('td', {}, r.remaining == null ? 'No data entered' : `${r.remaining >= 0 ? '' : '+'}${Math.abs(r.remaining)} ${r.unit}${r.remaining < 0 ? ' over' : ' left'}`),
          Utils.el('td', {}, r.percent == null ? 'No data entered' : `${r.percent}%`),
        ]))),
      ])),
    ]);
  }

  // -------------------------------------------------------------------
  // SOURCE BREAKDOWN
  // -------------------------------------------------------------------

  function renderSourceBreakdownCard(entries, container) {
    if (!entries.length) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Source Breakdown')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }

    const selector = selectField('breakdownNutrient', 'Nutrient', selectedBreakdownNutrient,
      DietEngine.NUTRIENT_DISPLAY.map(d => ({ value: d.key, label: d.label })),
      (v) => { selectedBreakdownNutrient = v; renderInner(container); });

    const def = DietEngine.NUTRIENT_DISPLAY.find(d => d.key === selectedBreakdownNutrient);
    const breakdown = DietEngine.computeSourceBreakdown(entries, selectedBreakdownNutrient);

    const body = breakdown.rows.length
      ? Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
          Utils.el('thead', {}, Utils.el('tr', {}, ['Food', 'Meal', `Amount (${def.unit})`].map(h => Utils.el('th', {}, h)))),
          Utils.el('tbody', {}, [
            ...breakdown.rows.map(r => Utils.el('tr', {}, [
              Utils.el('td', {}, r.label),
              Utils.el('td', {}, MEAL_TYPES.find(m => m.value === r.mealType)?.label || r.mealType || '—'),
              Utils.el('td', {}, `${r.amount} ${def.unit}`),
            ])),
            Utils.el('tr', { style: 'font-weight:700;' }, [
              Utils.el('td', {}, 'Total'), Utils.el('td', {}, ''), Utils.el('td', {}, `${breakdown.total} ${def.unit}`),
            ]),
          ]),
        ]))
      : Utils.el('p', { class: 'card__footnote' }, `No ${def.label.toLowerCase()} logged today from any food.`);

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Source Breakdown'),
        Utils.el('p', { class: 'card__subtitle' }, 'Only counts food actually logged today.'),
      ]),
      Utils.el('div', { class: 'form__grid' }, [selector]),
      body,
    ]);
  }

  // -------------------------------------------------------------------
  // NUTRITION QUALITY
  // -------------------------------------------------------------------

  function renderQualityCard(entries, targets) {
    const quality = DietEngine.computeNutritionQuality(entries, targets);

    if (quality.score == null) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Nutrition Quality')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }

    const badge = Utils.el('div', { class: `quality-badge quality-badge--${qualityTier(quality.score)}` }, [
      Utils.el('span', { class: 'quality-badge__score' }, `${quality.score}`),
      Utils.el('span', { class: 'quality-badge__label' }, quality.label),
    ]);

    const warning = quality.severelyUnderCalorie
      ? Utils.el('p', { class: 'card__footnote', style: 'color:var(--danger);font-style:normal;' },
          'Calorie intake is well below target today — this is capped, not rewarded, as high quality.')
      : null;

    const factorRows = quality.factors.map(f => UIFx.animBar({
      label: f.label,
      pct: f.score == null ? 0 : Math.round(f.score),
      detail: f.score == null ? 'No target set' : `${Math.round(f.score)}% · ${f.detail}`,
      colorVar: 'var(--gold)',
    }));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Nutrition Quality'),
        Utils.el('p', { class: 'card__subtitle' }, 'Protein, calorie adherence, fibre, vegetables, fruit, healthy fats, and micronutrient coverage — never rewards under-eating.'),
      ]),
      badge,
      warning,
      Utils.el('div', { class: 'factor-list' }, factorRows),
    ].filter(Boolean));
  }

  function qualityTier(score) {
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    return 'attention';
  }

  return { render };
})();
