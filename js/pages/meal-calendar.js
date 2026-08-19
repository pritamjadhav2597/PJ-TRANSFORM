/**
 * pages/meal-calendar.js — the 60-Day Transformation Meal Calendar.
 *
 * This page NEVER computes nutrition itself: every number comes from the
 * existing FoodCalc engine (food-calculations.js), fed by the existing
 * FoodDatabase / a user's own saved FoodProducts. Personalized targets
 * always come from Calculations.calculateAllTargets() — this page only
 * compares a planned day against that target and warns, it never invents
 * a universal calorie/protein number and never silently edits quantities.
 *
 * "Log this day" writes real records into the existing Meal System
 * (Models.createMealItem / DataService.mealItems) exactly the way
 * pages/diet.js's "Log to Today" does — so everything downstream
 * (Daily Tracking, Calendar, Reports) already works unchanged.
 */

const PageMealCalendar = (() => {

  const SOURCE_TYPES = [
    { value: 'generic', label: 'Food database' },
    { value: 'product', label: 'Saved product (enter label)' },
    { value: 'custom', label: 'Custom / manual entry' },
  ];

  const MANUAL_MACRO_FIELDS = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'proteinG', label: 'Protein', unit: 'g' },
    { key: 'carbsG', label: 'Carbohydrates', unit: 'g' },
    { key: 'fatG', label: 'Fat', unit: 'g' },
    { key: 'fibreG', label: 'Fibre', unit: 'g' },
  ];

  let selectedDayNumber = 1;
  let editState = null;       // { slotKey, itemIndex (null = adding new), draft }
  let logDate = Models.todayIso();

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

    const programs = await DataService.programs.list(p => p.userId === userId && p.programType === MealCalendarData.PROGRAM_TYPE);
    if (!programs.length) {
      container.appendChild(renderNoProgramCard());
      return;
    }
    const program = programs.find(p => p.status === 'active') || programs[0];

    const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
    const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
    const targets = profile ? Calculations.calculateAllTargets(profile, { weightEntries, program }) : null;
    const products = await DataService.foodProducts.list(p => p.userId === userId);

    const dayNumbers = MealCalendarData.listAvailableDayNumbers();
    if (!dayNumbers.includes(selectedDayNumber)) selectedDayNumber = dayNumbers[0];

    const existingPlan = (await DataService.mealCalendarPlans.list(
      p => p.userId === userId && p.programType === MealCalendarData.PROGRAM_TYPE && p.dayNumber === selectedDayNumber
    ))[0] || null;
    const dayDefault = MealCalendarData.getDefaultDay(selectedDayNumber);
    const daySlots = existingPlan ? existingPlan.slots : dayDefault.slots;
    const isRecoveryDay = dayDefault.isRecoveryDay;

    container.appendChild(renderMealCalendarHero(dayNumbers, daySlots, targets));
    container.appendChild(renderHeaderCard(program, dayNumbers, container));
    container.appendChild(renderProgramInfoCard());

    if (!profile) {
      container.appendChild(Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'Complete your profile to compare this calendar against your personalized targets.'),
          Utils.el('a', { class: 'btn btn--secondary', href: '#/profile' }, 'Go to Profile'),
        ]),
      ]));
    }

    if (isRecoveryDay) {
      container.appendChild(Utils.el('section', { class: 'card' }, [
        Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, `Day ${selectedDayNumber} is a recovery day — lighter training focus, same personalized nutrition target.`),
      ]));
    }

    MealCalendarData.SLOT_ORDER.forEach(slotKey => {
      const items = daySlots[slotKey] || [];
      container.appendChild(renderSlotCard(userId, selectedDayNumber, slotKey, items, products, daySlots, container));
    });

    container.appendChild(renderDaySummaryCard(userId, selectedDayNumber, daySlots, targets, !!existingPlan, container));
    container.appendChild(renderLogDayCard(userId, selectedDayNumber, daySlots, products, container));

    UIFx.animateIn(container);
  }

  function renderMealCalendarHero(dayNumbers, daySlots, targets) {
    const totalDays = dayNumbers.length;
    const pct = totalDays ? Math.round((selectedDayNumber / totalDays) * 100) : 0;
    const allItems = MealCalendarData.SLOT_ORDER.flatMap(s => daySlots[s] || []);
    const plannedCalories = allItems.length ? FoodCalc.sumEntries(allItems.map(i => i.computedNutrition)).calories : null;

    const hero = UIFx.hero({
      theme: 'nutrition',
      icon: '\uD83D\uDCC5',
      eyebrow: 'Meal Calendar',
      title: `Day ${selectedDayNumber} of ${totalDays}`,
      subtitle: plannedCalories != null
        ? `${Math.round(plannedCalories)} kcal planned${targets?.calorieTarget ? ` against a ${targets.calorieTarget} kcal target` : ''}.`
        : 'This day has no planned items yet.',
      stats: [],
      ring: { pct, number: `${selectedDayNumber}`, of: `of ${totalDays}` },
    });
    return hero;
  }

  // -------------------------------------------------------------------
  // SCALE TO MY TARGETS — every user has a different personalized target
  // (Calculations.calculateAllTargets depends on their own weight, sex,
  // age, activity, goal...), but the template above is one shared shape.
  // This scales every generic, weight/volume-based item in the day by the
  // SAME factor (targetCalories / plannedCalories) and recomputes each
  // item's nutrition for real via FoodCalc — it does not touch the shared
  // MealCalendarData template, only this user's own saved plan for this
  // day, so two users viewing Day 1 can end up with two different
  // quantities without affecting each other.
  // -------------------------------------------------------------------

  function scaleSlotsToTarget(slots, targets) {
    const allItems = MealCalendarData.SLOT_ORDER.flatMap(s => slots[s] || []);
    const currentCalories = FoodCalc.sumEntries(allItems.map(i => i.computedNutrition)).calories;
    if (!targets || !targets.calorieTarget || !currentCalories) return null;
    const factor = targets.calorieTarget / currentCalories;

    const scaleItem = (it) => {
      // Only generic, weight/volume-based items came from a real per-100g
      // reference we can rescale honestly. Saved products, custom manual
      // entries, and pieces/servings (e.g. "2 bhakri" as a piece count)
      // are left untouched rather than guessed at.
      if (it.sourceType !== 'generic' || (it.unit !== 'g' && it.unit !== 'ml')) return it;
      const prep = FoodDatabase.findPreparation(it.foodCategory, it.foodItemKey, it.preparationKey);
      if (!prep || !prep.per100g) return it;
      const newQuantity = Math.max(5, Math.round((it.quantity * factor) / 5) * 5);
      const computed = FoodCalc.computeGenericNutrition(prep.per100g, newQuantity, it.unit);
      return { ...it, quantity: newQuantity, computedNutrition: computed };
    };

    const scaledSlots = {};
    MealCalendarData.SLOT_ORDER.forEach(s => { scaledSlots[s] = (slots[s] || []).map(scaleItem); });
    return scaledSlots;
  }

  // -------------------------------------------------------------------
  // NO PROGRAM YET
  // -------------------------------------------------------------------

  function renderNoProgramCard() {
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, '60-Day Meal Calendar')),
      Utils.el('div', { class: 'card__empty-state' }, [
        Utils.el('p', {}, `This calendar is part of the ${MealCalendarData.PROGRAM_NAME} program. Select it from Programs to view it — it's never applied automatically to any account except the creator's.`),
        Utils.el('a', { class: 'btn btn--primary', href: '#/programs' }, 'Choose Your Program'),
      ]),
    ]);
  }

  // -------------------------------------------------------------------
  // HEADER + DAY NAV
  // -------------------------------------------------------------------

  function renderHeaderCard(program, dayNumbers, container) {
    const counters = Calculations.getProgramDayCounters(program);
    const tabs = Utils.el('div', { class: 'chip-row' }, dayNumbers.map(n => Utils.el('button', {
      class: `chip${n === selectedDayNumber ? ' chip--active' : ''}`, type: 'button',
      onClick: () => { selectedDayNumber = n; editState = null; renderInner(container); },
    }, `Day ${n}`)));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, `${MealCalendarData.PROGRAM_NAME} — Meal Calendar`),
          Utils.el('p', { class: 'card__subtitle' },
            `${program.name} · ${counters ? `Day ${counters.day} of ${counters.totalDays}` : `${program.durationDays} days`} · ${MealCalendarData.TOTAL_DAYS_DEFINED >= MealCalendarData.TOTAL_PROGRAM_DAYS ? `All ${MealCalendarData.TOTAL_PROGRAM_DAYS} days available` : `Days 1–${MealCalendarData.TOTAL_DAYS_DEFINED} available now (Days ${MealCalendarData.TOTAL_DAYS_DEFINED + 1}–${MealCalendarData.TOTAL_PROGRAM_DAYS} arrive in later updates)`}`),
        ]),
      ]),
      tabs,
    ]);
  }

  function renderProgramInfoCard() {
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Goals')),
      Utils.el('div', { class: 'chip-row' }, MealCalendarData.PRIMARY_GOALS.map(g => Utils.el('span', { class: 'badge' }, g))),
      Utils.el('p', { class: 'card__footnote' }, MealCalendarData.DISCLAIMER),
    ]);
  }

  // -------------------------------------------------------------------
  // SLOT CARD — items + row actions + inline editor
  // -------------------------------------------------------------------

  function renderSlotCard(userId, dayNumber, slotKey, items, products, daySlots, container) {
    const meta = MealCalendarData.SLOT_META[slotKey];
    const totals = FoodCalc.sumEntries(items.map(i => i.computedNutrition));

    const addBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => {
        editState = { slotKey, itemIndex: null, draft: blankDraft() };
        renderInner(container);
      },
    }, '+ Add item');

    const rows = items.length
      ? items.map((item, idx) => renderItemRow(userId, dayNumber, slotKey, item, idx, daySlots, container))
      : [Utils.el('p', { class: 'card__footnote' }, 'No items in this meal yet.')];

    const editorRow = (editState && editState.slotKey === slotKey)
      ? renderItemEditor(userId, dayNumber, slotKey, products, daySlots, container)
      : null;

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, `${meta.label}${meta.defaultTime ? ` · ${meta.defaultTime}` : ''}`),
          items.length ? Utils.el('p', { class: 'card__subtitle' },
            `${Utils.fmt(totals.calories, ' kcal')} · P ${Utils.fmt(totals.proteinG, 'g')} · C ${Utils.fmt(totals.carbsG, 'g')} · F ${Utils.fmt(totals.fatG, 'g')} · Fibre ${Utils.fmt(totals.fibreG, 'g')}`) : null,
        ]),
        addBtn,
      ]),
      Utils.el('div', { class: 'entry-list' }, rows),
      editorRow,
    ].filter(Boolean));
  }

  function renderItemRow(userId, dayNumber, slotKey, item, idx, daySlots, container) {
    const n = item.computedNutrition;

    const editBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => { editState = { slotKey, itemIndex: idx, draft: draftFromItem(item) }; renderInner(container); },
    }, 'Edit');

    const replaceBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => { editState = { slotKey, itemIndex: idx, draft: { ...blankDraft(), quantity: item.quantity, unit: item.unit } }; renderInner(container); },
    }, 'Replace');

    const duplicateBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        const clone = { ...item, itemId: Models.generateId('mcitem') };
        const nextSlots = { ...daySlots, [slotKey]: [...daySlots[slotKey].slice(0, idx + 1), clone, ...daySlots[slotKey].slice(idx + 1)] };
        await persistDay(userId, dayNumber, nextSlots);
        Utils.toast('Item duplicated.', 'success');
        await renderInner(container);
      },
    }, 'Duplicate');

    const favoriteBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        const name = window.prompt('Save this item as a favorite meal — name it:', item.foodLabel || 'Favorite item');
        if (!name) return;
        await DataService.mealTemplates.create(Models.createMealTemplate(userId, {
          name, mealType: slotKey === 'pre_workout' ? 'pre_workout' : slotKey,
          isFavorite: true,
          items: [Models.createMealTemplateItem({ ...item, itemId: undefined })],
          notes: `Saved from the ${MealCalendarData.PROGRAM_NAME} calendar, Day ${dayNumber}.`,
        }));
        Utils.toast('Saved to your Meal Templates as a favorite.', 'success');
      },
    }, 'Save as favorite');

    const removeBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => {
        const nextItems = daySlots[slotKey].filter((_, i) => i !== idx);
        const nextSlots = { ...daySlots, [slotKey]: nextItems };
        await persistDay(userId, dayNumber, nextSlots);
        Utils.toast('Item removed from this day\'s plan.', 'success');
        await renderInner(container);
      },
    }, 'Remove');

    return Utils.el('div', { class: 'entry-row' }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__title-line' }, [
          Utils.el('span', { class: 'entry-row__name' }, item.foodLabel || 'Untitled'),
          item.brand ? Utils.el('span', { class: 'entry-row__brand' }, ` · ${item.brand}`) : null,
        ].filter(Boolean)),
        Utils.el('div', { class: 'entry-row__meta' },
          `${item.quantity} ${item.unit}${item.preparation ? ' · ' + item.preparation : ''}${item.notes ? ' · ' + item.notes : ''}`),
      ]),
      Utils.el('div', { class: 'entry-row__macros' },
        n ? `${Utils.fmt(n.calories, ' kcal')} · P ${Utils.fmt(n.proteinG, 'g')} · C ${Utils.fmt(n.carbsG, 'g')} · F ${Utils.fmt(n.fatG, 'g')}` : 'No data entered'),
      Utils.el('div', { class: 'row-actions' }, [editBtn, replaceBtn, duplicateBtn, favoriteBtn, removeBtn]),
    ]);
  }

  // -------------------------------------------------------------------
  // ITEM EDITOR (Add / Edit / Replace share this form)
  // -------------------------------------------------------------------

  function blankDraft() {
    return {
      sourceType: 'generic',
      foodCategory: '', foodItemKey: '', preparationKey: '',
      productId: '',
      customFoodName: '',
      manualNutrients: { calories: null, proteinG: null, carbsG: null, fatG: null, fibreG: null },
      quantity: '', unit: 'g',
      notes: '',
    };
  }

  function draftFromItem(item) {
    return {
      sourceType: item.sourceType || 'generic',
      foodCategory: item.foodCategory || '', foodItemKey: item.foodItemKey || '', preparationKey: item.preparationKey || '',
      productId: item.productId || '',
      customFoodName: item.sourceType === 'custom' ? item.foodLabel : '',
      manualNutrients: { calories: null, proteinG: null, carbsG: null, fatG: null, fibreG: null },
      quantity: item.quantity ?? '', unit: item.unit || 'g',
      notes: item.notes || '',
    };
  }

  function renderItemEditor(userId, dayNumber, slotKey, products, daySlots, container) {
    const draft = editState.draft;
    const isNew = editState.itemIndex === null;

    const refresh = () => renderInner(container);

    const sourceSelect = selectField('Food source', draft.sourceType, SOURCE_TYPES, (v) => {
      draft.sourceType = v; draft.foodCategory = ''; draft.foodItemKey = ''; draft.preparationKey = ''; draft.productId = ''; refresh();
    });

    const fields = [sourceSelect];

    if (draft.sourceType === 'generic') {
      fields.push(selectField('Category', draft.foodCategory,
        [{ value: '', label: '— Select —' }, ...FoodDatabase.CATEGORIES.map(c => ({ value: c.key, label: c.label }))],
        (v) => { draft.foodCategory = v; draft.foodItemKey = ''; draft.preparationKey = ''; refresh(); }));

      const category = FoodDatabase.findCategory(draft.foodCategory);
      if (category) {
        fields.push(selectField('Food', draft.foodItemKey,
          [{ value: '', label: '— Select —' }, ...category.items.map(i => ({ value: i.key, label: i.label }))],
          (v) => { draft.foodItemKey = v; draft.preparationKey = ''; refresh(); }));
      }
      const foodItem = category ? category.items.find(i => i.key === draft.foodItemKey) : null;
      if (foodItem) {
        fields.push(selectField('Measurement basis (Raw / Dry / Cooked / Boiled / Air-cooked / Other)', draft.preparationKey,
          [{ value: '', label: '— Select —' }, ...foodItem.preparations.map(p => ({ value: p.key, label: p.label }))],
          (v) => { draft.preparationKey = v; refresh(); }));
      }
      fields.push(numberField('Quantity (g)', draft.quantity, (v) => { draft.quantity = v; }));
    } else if (draft.sourceType === 'product') {
      fields.push(selectField('Saved product', draft.productId,
        [{ value: '', label: products.length ? '— Select —' : 'No saved products yet — add one on the Products page' },
          ...products.map(p => ({ value: p.productId, label: `${p.name}${p.brand ? ' — ' + p.brand : ''}` }))],
        (v) => { draft.productId = v; refresh(); }));
      const product = products.find(p => p.productId === draft.productId);
      const validUnits = FoodCalc.validUnitsForProduct(product);
      fields.push(selectField('Unit', draft.unit, validUnits.map(u => ({ value: u, label: u })), (v) => { draft.unit = v; }));
      fields.push(numberField('Quantity', draft.quantity, (v) => { draft.quantity = v; }));
    } else {
      fields.push(textField('Food name', draft.customFoodName, (v) => { draft.customFoodName = v; }));
      fields.push(numberField('Quantity (g)', draft.quantity, (v) => { draft.quantity = v; }));
      MANUAL_MACRO_FIELDS.forEach(f => {
        fields.push(numberField(`${f.label} (${f.unit})`, draft.manualNutrients[f.key], (v) => { draft.manualNutrients[f.key] = v === '' ? null : Number(v); }));
      });
    }

    fields.push(textField('Note (optional)', draft.notes, (v) => { draft.notes = v; }));

    const saveBtn = Utils.el('button', {
      class: 'btn btn--primary', type: 'button',
      onClick: async () => {
        const result = buildItemFromDraft(draft, products);
        if (!result) { Utils.toast('Please complete the food selection and quantity.', 'error'); return; }
        const nextItems = [...daySlots[slotKey]];
        if (isNew) nextItems.push(result); else nextItems[editState.itemIndex] = result;
        const nextSlots = { ...daySlots, [slotKey]: nextItems };
        await persistDay(userId, dayNumber, nextSlots);
        editState = null;
        Utils.toast(isNew ? 'Item added.' : 'Item updated.', 'success');
        await renderInner(container);
      },
    }, isNew ? 'Add to meal' : 'Save changes');

    const cancelBtn = Utils.el('button', {
      class: 'btn btn--secondary', type: 'button',
      onClick: () => { editState = null; renderInner(container); },
    }, 'Cancel');

    return Utils.el('div', { class: 'card card--form', style: 'margin-top:12px;' }, [
      Utils.el('h3', { class: 'form__group-title' }, isNew ? 'Add an item' : 'Edit item'),
      Utils.el('div', { class: 'form__grid' }, fields),
      Utils.el('div', { class: 'form__actions' }, [saveBtn, cancelBtn]),
    ]);
  }

  function buildItemFromDraft(draft, products) {
    const quantity = Number(draft.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;

    if (draft.sourceType === 'generic') {
      if (!draft.foodCategory || !draft.foodItemKey || !draft.preparationKey) return null;
      const foodItem = FoodDatabase.findItem(draft.foodCategory, draft.foodItemKey);
      const prep = FoodDatabase.findPreparation(draft.foodCategory, draft.foodItemKey, draft.preparationKey);
      const { computed, nutritionSource } = FoodCalc.computeEntryNutrition({
        sourceType: 'generic', per100g: prep ? prep.per100g : null, manualNutrients: null, quantity, unit: 'g',
      });
      return {
        itemId: Models.generateId('mcitem'), sourceType: 'generic',
        foodCategory: draft.foodCategory, foodItemKey: draft.foodItemKey, preparationKey: draft.preparationKey,
        preparationLabel: prep ? prep.label : '', productId: null,
        foodLabel: foodItem ? foodItem.label : '', brand: '',
        quantity, unit: 'g', preparation: prep ? prep.label : '',
        measurementBasis: ['raw', 'raw_package', 'dry_raw', 'as_is'].includes(draft.preparationKey) ? 'before_cooking' : 'after_cooking',
        cookingOilG: null, cookingOilLabel: '', notes: draft.notes || '',
        computedNutrition: computed, nutritionSource,
      };
    }

    if (draft.sourceType === 'product') {
      if (!draft.productId) return null;
      const product = products.find(p => p.productId === draft.productId);
      if (!product) return null;
      const { computed, nutritionSource } = FoodCalc.computeEntryNutrition({
        sourceType: 'product', product, quantity, unit: draft.unit,
      });
      return {
        itemId: Models.generateId('mcitem'), sourceType: 'product',
        foodCategory: '', foodItemKey: '', preparationKey: '', preparationLabel: '',
        productId: product.productId, foodLabel: product.name, brand: product.brand,
        quantity, unit: draft.unit, preparation: 'Per product label',
        measurementBasis: 'after_cooking', cookingOilG: null, cookingOilLabel: '', notes: draft.notes || '',
        computedNutrition: computed, nutritionSource,
      };
    }

    // custom
    if (!draft.customFoodName) return null;
    const { computed, nutritionSource } = FoodCalc.computeEntryNutrition({
      sourceType: 'custom', manualNutrients: draft.manualNutrients,
    });
    return {
      itemId: Models.generateId('mcitem'), sourceType: 'custom',
      foodCategory: '', foodItemKey: '', preparationKey: '', preparationLabel: '',
      productId: null, foodLabel: draft.customFoodName, brand: '',
      quantity, unit: 'g', preparation: '', measurementBasis: 'after_cooking',
      cookingOilG: null, cookingOilLabel: '', notes: draft.notes || '',
      computedNutrition: computed, nutritionSource,
    };
  }

  // -------------------------------------------------------------------
  // DAY SUMMARY — compares planned totals against the personalized
  // target, via the SAME engine the Diet page uses. Never silently
  // changes food quantities — only warns.
  // -------------------------------------------------------------------

  function renderDaySummaryCard(userId, dayNumber, daySlots, targets, hasCustomPlan, container) {
    const allItems = MealCalendarData.SLOT_ORDER.flatMap(s => daySlots[s] || []);
    if (!allItems.length) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Daily Summary')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }

    if (!targets) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Daily Summary')),
        Utils.el('p', { class: 'card__footnote' }, 'Complete your profile to compare this plan against your personalized target.'),
      ]);
    }

    const rows = DietEngine.computeDailySummary(allItems, targets);
    const calorieRow = rows.find(r => r.key === 'calories');
    let warning = null;
    if (calorieRow && calorieRow.percent != null) {
      if (calorieRow.percent < 90) {
        warning = `This planned day is running below your personalized calorie target (${calorieRow.percent}% of target). Use "Scale this day to my targets" below, add to a meal, or use the optional snack — quantities are never changed automatically.`;
      } else if (calorieRow.percent > 110) {
        warning = `This planned day is running above your personalized calorie target (${calorieRow.percent}% of target). Use "Scale this day to my targets" below, or remove/shrink an item — quantities are never changed automatically.`;
      }
    }

    const actions = Utils.el('div', { class: 'chip-row' }, [
      Utils.el('button', {
        class: 'btn btn--secondary', type: 'button',
        onClick: async () => {
          const scaled = scaleSlotsToTarget(daySlots, targets);
          if (scaled) { await persistDay(userId, dayNumber, scaled); renderInner(container); }
        },
      }, 'Scale this day to my targets'),
      hasCustomPlan ? Utils.el('button', {
        class: 'btn btn--danger', type: 'button',
        onClick: async () => {
          const existing = (await DataService.mealCalendarPlans.list(
            p => p.userId === userId && p.programType === MealCalendarData.PROGRAM_TYPE && p.dayNumber === dayNumber
          ))[0];
          if (existing) await DataService.mealCalendarPlans.delete(existing.mealCalendarPlanId);
          renderInner(container);
        },
      }, 'Reset to default template') : null,
    ].filter(Boolean));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Daily Summary'),
        Utils.el('p', { class: 'card__subtitle' }, 'Planned totals vs. your personalized target — from Calculations.calculateAllTargets, never a fixed number.'),
      ]),
      warning ? Utils.el('p', { class: 'card__footnote', style: 'color:var(--danger);font-style:normal;' }, warning) : null,
      Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
        Utils.el('thead', {}, Utils.el('tr', {}, ['Nutrient', 'Planned', 'Target', 'Remaining', '%'].map(h => Utils.el('th', {}, h)))),
        Utils.el('tbody', {}, rows.map(r => Utils.el('tr', {}, [
          Utils.el('td', {}, r.label),
          Utils.el('td', {}, Utils.fmt(r.consumed, r.consumed != null ? ` ${r.unit}` : '')),
          Utils.el('td', {}, Utils.fmt(r.target, r.target != null ? ` ${r.unit}` : '')),
          Utils.el('td', {}, r.remaining == null ? 'No data entered' : `${r.remaining >= 0 ? '' : '+'}${Math.abs(r.remaining)} ${r.unit}${r.remaining < 0 ? ' over' : ' left'}`),
          Utils.el('td', {}, r.percent == null ? 'No data entered' : `${r.percent}%`),
        ]))),
      ])),
      actions,
      Utils.el('p', { class: 'card__footnote' }, 'Scaling multiplies every weight/volume-based food in this day by the same factor so the day\'s calories match your target — it recalculates each item through the real food database rather than guessing, and only changes your own saved plan for this day.'),
      Utils.el('div', { class: 'form__grid' }, [
        statBox('Water target', targets.waterTargetMl != null ? `${targets.waterTargetMl} ml` : 'No data entered'),
        statBox('Step target', targets.stepTarget != null ? `${targets.stepTarget}` : 'No data entered'),
      ]),
    ].filter(Boolean));
  }

  function statBox(label, value) {
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label' }, label),
      Utils.el('p', { class: 'form__static-value' }, value),
    ]);
  }

  // -------------------------------------------------------------------
  // LOG THIS DAY — writes real Meal System records via the same path
  // pages/diet.js uses for "Log to Today".
  // -------------------------------------------------------------------

  function renderLogDayCard(userId, dayNumber, daySlots, products, container) {
    const dateInput = Utils.el('input', {
      class: 'form__input', type: 'date', value: logDate,
      onChange: (e) => { if (e.target.value) logDate = e.target.value; },
    });

    const logBtn = Utils.el('button', {
      class: 'btn btn--primary', type: 'button',
      onClick: async () => {
        await logDayToDate(userId, dayNumber, daySlots, products, logDate);
        Utils.toast(`Day ${dayNumber} logged to ${Utils.formatDate(logDate)}. See Diet & Nutrition or Daily Tracking.`, 'success');
        await renderInner(container);
      },
    }, 'Log this day to my diary');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Log This Day')),
      Utils.el('p', { class: 'card__footnote' }, 'Writes every item above into your Meal System / Daily Tracking for the date you choose, using the same Food Entry logic as the rest of the app.'),
      Utils.el('div', { class: 'form__grid' }, [
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Date to log'), dateInput]),
      ]),
      Utils.el('div', { class: 'form__actions' }, [logBtn]),
    ]);
  }

  async function logDayToDate(userId, dayNumber, daySlots, products, date) {
    for (const slotKey of MealCalendarData.SLOT_ORDER) {
      const items = daySlots[slotKey] || [];
      for (const item of items) {
        let result;
        if (item.sourceType === 'generic') {
          const prep = FoodDatabase.findPreparation(item.foodCategory, item.foodItemKey, item.preparationKey);
          result = FoodCalc.computeEntryNutrition({
            sourceType: 'generic', per100g: prep ? prep.per100g : null, quantity: item.quantity, unit: item.unit,
          });
        } else if (item.sourceType === 'product') {
          const product = products.find(p => p.productId === item.productId);
          result = FoodCalc.computeEntryNutrition({ sourceType: 'product', product, quantity: item.quantity, unit: item.unit });
        } else {
          result = { computed: item.computedNutrition, nutritionSource: item.nutritionSource || 'user_entered' };
        }

        await DataService.mealItems.create(Models.createMealItem(userId, {
          date, mealType: slotKey,
          sourceType: item.sourceType, nutritionSource: result.nutritionSource,
          foodCategory: item.foodCategory, foodItemKey: item.foodItemKey, preparationKey: item.preparationKey,
          preparationLabel: item.preparationLabel, productId: item.productId,
          foodLabel: item.foodLabel, brand: item.brand,
          quantity: item.quantity, unit: item.unit, customUnitLabel: '',
          preparation: item.preparation, measurementBasis: item.measurementBasis || 'after_cooking',
          cookingOilG: item.cookingOilG, cookingOilLabel: item.cookingOilLabel,
          notes: `${item.notes || ''}${item.notes ? ' · ' : ''}From ${MealCalendarData.PROGRAM_NAME} Day ${dayNumber}`.trim(),
          computedNutrition: result.computed,
        }));
      }
    }
  }

  // -------------------------------------------------------------------
  // PERSISTENCE
  // -------------------------------------------------------------------

  async function persistDay(userId, dayNumber, slots) {
    const existing = (await DataService.mealCalendarPlans.list(
      p => p.userId === userId && p.programType === MealCalendarData.PROGRAM_TYPE && p.dayNumber === dayNumber
    ))[0];
    if (existing) {
      await DataService.mealCalendarPlans.update(existing.mealCalendarPlanId, { slots });
    } else {
      await DataService.mealCalendarPlans.create(Models.createMealCalendarPlan(userId, { dayNumber, slots }));
    }
  }

  // -------------------------------------------------------------------
  // FIELD HELPERS
  // -------------------------------------------------------------------

  function selectField(label, value, options, onChange) {
    const id = `mc-field-${Math.random().toString(36).slice(2, 6)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('select', { class: 'form__input', id, onChange: (e) => onChange(e.target.value) }, options.map(o => {
        const opt = Utils.el('option', { value: o.value }, o.label);
        if (value === o.value) opt.setAttribute('selected', 'selected');
        return opt;
      })),
    ]);
  }

  function textField(label, value, onInput) {
    const id = `mc-field-${Math.random().toString(36).slice(2, 6)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('input', { class: 'form__input', id, type: 'text', value, onInput: (e) => onInput(e.target.value) }),
    ]);
  }

  function numberField(label, value, onInput) {
    const id = `mc-field-${Math.random().toString(36).slice(2, 6)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('input', { class: 'form__input', id, type: 'number', min: 0, step: '0.01', value: value ?? '', onInput: (e) => onInput(e.target.value) }),
    ]);
  }

  return { render };
})();
