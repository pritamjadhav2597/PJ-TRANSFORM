/**
 * pages/nutrition.js — the Nutrition module (Section 2A of the UX spec).
 * Same house pattern as Workout: a hero with the day's headline
 * completion + per-macro rings, a Daily Targets breakdown, then
 * interactive per-meal cards (Breakfast / Lunch / Pre-workout / Dinner /
 * other supported meals) each with a VIEW MEAL action that opens a food-
 * level detail view (edit / replace / delete). The actual logging form
 * — generic FoodDatabase, a saved Product, or a hand-typed custom food —
 * is unchanged: every entry still records its own measurement basis and
 * nutrition source, nothing is silently converted or guessed (see
 * food-calculations.js). Nothing here fabricates a number: targets come
 * from Calculations.calculateAllTargets, sums come from FoodCalc, and the
 * nutrition-completion score comes from DietEngine.computeNutritionQuality.
 */

const PageNutrition = (() => {

  const MEAL_TYPES = [
    { value: 'breakfast', label: 'Breakfast' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'pre_workout', label: 'Pre-workout' },
    { value: 'dinner', label: 'Dinner' },
    { value: 'snack', label: 'Snack' },
    { value: 'other', label: 'Other' },
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

  const UNIT_LABELS = { g: 'grams (g)', ml: 'millilitres (ml)', serving: 'serving(s)', piece: 'piece(s)', custom: 'custom unit' };

  const MANUAL_MACRO_FIELDS = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'proteinG', label: 'Protein', unit: 'g' },
    { key: 'carbsG', label: 'Carbohydrates', unit: 'g' },
    { key: 'fatG', label: 'Fat', unit: 'g' },
    { key: 'fibreG', label: 'Fibre', unit: 'g' },
    { key: 'sugarG', label: 'Sugar', unit: 'g' },
  ];

  const OIL_PRESETS_G = [1, 5, 10];

  const SOURCE_BADGE = {
    generic_estimate: 'Generic estimate',
    product_label: 'Product label',
    user_entered: 'User entered',
  };

  const MOBILE_QUERY = '(max-width: 880px)';
  const isMobile = () => !!(window.matchMedia && window.matchMedia(MOBILE_QUERY).matches);

  const HISTORY_PERIODS = [
    { value: 'daily', label: 'Daily', count: 14 },
    { value: 'weekly', label: 'Weekly', count: 8 },
    { value: 'monthly', label: 'Monthly', count: 6 },
  ];

  let selectedDate = Models.todayIso();
  let editingEntryId = null;
  let draft = blankDraft();
  let expandedMealType = null;     // which meal card's "VIEW MEAL" detail is open (desktop inline expand)
  let expandedDetailEntryId = null; // which single food row's micronutrient detail is open (desktop inline expand)
  let historyPeriod = 'daily';

  function blankDraft() {
    return {
      mealType: 'breakfast',
      sourceType: 'generic',
      foodCategory: '', foodItemKey: '', preparationKey: '',
      productId: '',
      customFoodName: '',
      manualNutrients: { calories: null, proteinG: null, carbsG: null, fatG: null, fibreG: null, sugarG: null },
      quantity: '', unit: 'g', customUnitLabel: '',
      preparationText: '',
      measurementBasis: '',
      cookingOilPreset: '', cookingOilG: '', cookingOilLabel: '',
      notes: '',
    };
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

    const products = await DataService.foodProducts.list(p => p.userId === userId);
    const entries = await DataService.mealItems.list(e => e.userId === userId && e.date === selectedDate);
    const allEntries = await DataService.mealItems.list(e => e.userId === userId);
    const waterEntries = await DataService.waterEntries.list(w => w.userId === userId && w.date === selectedDate);
    const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
    const targets = profile ? Calculations.calculateAllTargets(profile) : null;
    const quality = DietEngine.computeNutritionQuality(entries, targets);

    container.appendChild(renderNutritionHero(entries, targets, waterEntries, quality));
    container.appendChild(renderDateBar(container));
    container.appendChild(renderDailyTargetsCard(entries, targets));
    container.appendChild(renderMealSwiper(entries, container, userId, products, targets, profile));
    container.appendChild(renderHistoryCard(allEntries, targets));
    container.appendChild(renderFormCard(userId, products, container));

    UIFx.animateIn(container);
  }

  function formatTime(isoTimestamp) {
    if (!isoTimestamp) return null;
    const d = new Date(isoTimestamp);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function scrollToLogForm() {
    const target = document.getElementById('food-entry-card');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // -------------------------------------------------------------------
  // BOTTOM SHEET — the mobile presentation for "full-screen food
  // details". Desktop keeps the inline VIEW MEAL / Nutrition detail
  // expansion already in renderMealCard/renderFoodDetailRow; on mobile
  // (see MOBILE_QUERY) those same actions open this sheet instead, so a
  // small screen never has to scroll a whole meal's detail into an
  // already-tall page. The sheet renders on top of `document.body`
  // (outside the router's page outlet) so re-rendering the page behind
  // it never yanks it away mid-interaction; callers close it explicitly
  // before triggering a full page render (edit/replace/delete/add).
  // -------------------------------------------------------------------

  let currentSheet = null;

  function closeSheet() {
    if (!currentSheet) return;
    currentSheet.backdrop.remove();
    currentSheet.sheet.remove();
    currentSheet = null;
  }

  function openSheet(titleText, contentBuilder) {
    closeSheet();
    const body = Utils.el('div', { class: 'sheet__body' });
    const refresh = () => { body.innerHTML = ''; body.appendChild(contentBuilder(refresh)); };
    refresh();
    const backdrop = Utils.el('div', { class: 'sheet-backdrop', onClick: closeSheet });
    const sheet = Utils.el('div', { class: 'sheet' }, [
      Utils.el('div', { class: 'sheet__grabber' }),
      Utils.el('div', { class: 'sheet__header' }, [
        Utils.el('h3', { class: 'sheet__title' }, titleText),
        Utils.el('button', { class: 'sheet__close', type: 'button', 'aria-label': 'Close', onClick: closeSheet }, '\u2715'),
      ]),
      body,
    ]);
    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    currentSheet = { backdrop, sheet };
  }

  function openMealSheet(meta, items, container, userId, products) {
    openSheet(meta.label, (refreshSheet) => {
      const list = items.length
        ? Utils.el('div', { class: 'entry-list' }, items.map(entry => renderFoodDetailRow(entry, container, userId, products, refreshSheet)))
        : Utils.el('p', { class: 'card__footnote' }, 'Nothing logged for this meal yet \u2014 add one below.');
      const addBtn = Utils.el('button', {
        class: 'btn btn--primary', type: 'button', style: 'width:100%;margin-top:14px;',
        onClick: () => {
          closeSheet();
          editingEntryId = null; draft = blankDraft(); draft.mealType = meta.value;
          renderInner(container); scrollToLogForm();
        },
      }, `+ Add food to ${meta.label}`);
      return Utils.el('div', {}, [list, addBtn]);
    });
  }

  // -------------------------------------------------------------------
  // HERO — today's calories/protein/carbs/fat/fibre/water rings, plus a
  // headline "nutrition completion" arc (DietEngine.computeNutritionQuality
  // — a real 0-100 score from 7 factors, not a fabricated number). Primary
  // CTA scrolls to the logging form below.
  // -------------------------------------------------------------------

  function renderNutritionHero(entries, targets, waterEntries, quality) {
    const totals = entries.length ? FoodCalc.sumEntries(entries.map(e => e.computedNutrition)) : null;
    const waterMl = DailyTrackingEngine.sumWaterMl(waterEntries, selectedDate);

    const macro = (value, target, unit) => {
      const v = value ?? 0;
      const pct = target ? Math.min(100, Math.round((v / target) * 100)) : (v > 0 ? 100 : 0);
      return { pct, number: Utils.fmt(v, ''), of: target ? `of ${Utils.fmt(target, unit)}` : unit };
    };

    const cal = macro(totals?.calories, targets?.calorieTarget, ' kcal');
    const pro = macro(totals?.proteinG, targets?.proteinTargetG, 'g');
    const carb = macro(totals?.carbsG, targets?.carbTargetG, 'g');
    const fat = macro(totals?.fatG, targets?.fatTargetG, 'g');
    const fibre = macro(totals?.fibreG, targets?.fibreTargetG, 'g');
    const water = macro(waterMl, targets?.waterTargetMl, ' ml');

    const hero = UIFx.hero({
      theme: 'nutrition',
      icon: '\uD83C\uDF7D\uFE0F',
      eyebrow: 'Nutrition',
      title: 'Today\u2019s Nutrition',
      subtitle: quality.score != null
        ? `${quality.label} day \u2014 ${quality.score}% nutrition completion.`
        : (totals
            ? `Logged ${entries.length} item${entries.length === 1 ? '' : 's'} across today\u2019s meals.`
            : 'No food logged yet today \u2014 log your first meal below.'),
      stats: [],
    });
    hero.classList.add('card--hero--compact');

    const row = Utils.el('div', { class: 'hero__stats', style: 'flex:1 1 auto;align-items:center;gap:24px;flex-wrap:wrap;' }, [
      UIFx.arcGauge({
        pct: quality.score ?? 0,
        number: quality.score != null ? `${quality.score}%` : '\u2014',
        sublabel: 'nutrition completion',
      }),
      Utils.el('div', { style: 'flex:1 1 360px;min-width:280px;' }, [
        UIFx.ringRow([
          { label: 'Calories', ...cal, colorFrom: 'var(--gold-soft)', colorTo: 'var(--gold)' },
          { label: 'Protein', ...pro, colorFrom: 'var(--moss-tint)', colorTo: 'var(--moss)' },
          { label: 'Carbs', ...carb, colorFrom: 'var(--ember-tint)', colorTo: 'var(--ember)' },
          { label: 'Fat', ...fat, colorFrom: '#DCE3F5', colorTo: 'var(--sleep)' },
          { label: 'Fibre', ...fibre, colorFrom: '#E7E0F7', colorTo: '#8B6FD9' },
          { label: 'Water', ...water, colorFrom: 'var(--water-soft)', colorTo: 'var(--water)' },
        ]),
      ]),
    ]);
    hero.querySelector('.hero__inner').appendChild(row);

    hero.querySelector('.hero__inner').appendChild(
      Utils.el('div', { style: 'flex:1 1 100%;display:flex;justify-content:flex-end;margin-top:4px;' }, [
        Utils.el('button', { class: 'btn btn--primary', type: 'button', onClick: scrollToLogForm }, '+ LOG FOOD'),
      ])
    );
    return hero;
  }

  // -------------------------------------------------------------------
  // DAILY TARGETS — Consumed / Target / Remaining / % for calories,
  // protein, carbs, fat and fibre. Straight from DietEngine, which reads
  // the same Calculations.calculateAllTargets() bundle used everywhere
  // else in the app (never a fixed number).
  // -------------------------------------------------------------------

  function renderDailyTargetsCard(entries, targets) {
    if (!targets) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Daily Targets')),
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'Complete your profile to see personalized targets.'),
          Utils.el('a', { class: 'btn btn--secondary', href: '#/profile' }, 'Go to Profile'),
        ]),
      ]);
    }

    const rows = DietEngine.computeDailySummary(entries, targets)
      .filter(r => ['calories', 'proteinG', 'carbsG', 'fatG', 'fibreG'].includes(r.key));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Daily Targets'),
        Utils.el('p', { class: 'card__subtitle' }, 'Consumed vs. your personalized target.'),
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
  // MEAL CARDS — Breakfast / Lunch / Pre-workout / Dinner / Snack / Other.
  // Each shows time (of the first item logged), foods + quantities, and
  // a Consumed/Target/Remaining/% row per macro for THIS meal's own slice
  // of the day (DietEngine.computeMealSummary — see the meal-split note
  // there). "Completion" is that meal's real % of its own calorie target
  // when a profile/target exists; with no profile it falls back to a
  // plain Logged/Not-logged badge rather than fabricating a percentage.
  // VIEW MEAL expands the full food-level detail (edit / replace /
  // delete) for that meal.
  // -------------------------------------------------------------------

  // -------------------------------------------------------------------
  // MEAL SWIPER — wraps the per-meal cards. On desktop this renders as
  // the normal stacked list (CSS makes .meal-swiper a plain flex column
  // above 880px). On mobile it becomes a horizontally swipeable,
  // scroll-snapped row (one meal card per "page") with a dot stepper
  // underneath, so a thumb-swipe moves Breakfast -> Lunch -> ... without
  // vertical scrolling past every card. Tapping a dot scrolls straight
  // to that meal. Nothing about the meal cards themselves changes.
  // -------------------------------------------------------------------

  function renderMealSwiper(entries, container, userId, products, targets, profile) {
    const track = Utils.el('div', { class: 'meal-swiper' },
      MEAL_TYPES.map(mt => renderMealCard(mt, entries.filter(e => e.mealType === mt.value), container, userId, products, targets, profile)));

    const dots = Utils.el('div', { class: 'meal-swiper__dots' }, MEAL_TYPES.map((mt, i) =>
      Utils.el('button', {
        class: `meal-swiper__dot${i === 0 ? ' meal-swiper__dot--active' : ''}`, type: 'button',
        'aria-label': `Go to ${mt.label}`,
        onClick: () => {
          const slide = track.children[i];
          if (slide) slide.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        },
      }, ''))
    );

    let scrollTimer = null;
    track.addEventListener('scroll', () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const slideWidth = track.children[0] ? track.children[0].getBoundingClientRect().width + 14 : 1;
        const idx = Math.max(0, Math.min(MEAL_TYPES.length - 1, Math.round(track.scrollLeft / slideWidth)));
        Array.from(dots.children).forEach((d, i) => d.classList.toggle('meal-swiper__dot--active', i === idx));
      }, 80);
    }, { passive: true });

    return Utils.el('div', {}, [track, dots]);
  }

  function renderMealCard(meta, items, container, userId, products, targets, profile) {
    const isExpanded = expandedMealType === meta.value;
    const firstTime = items.map(e => e.createdAt).filter(Boolean).sort()[0];
    const timeLabel = formatTime(firstTime);
    const summary = DietEngine.computeMealSummary(items, meta.value, targets, profile);
    const calorieRow = summary.rows.find(r => r.key === 'calories');

    const completionBadge = calorieRow && calorieRow.percent != null
      ? Utils.el('span', { class: `badge ${calorieRow.percent >= 100 ? 'badge--completed' : 'badge--draft'}` }, `${calorieRow.percent}% of meal target`)
      : (items.length
          ? Utils.el('span', { class: 'badge badge--completed' }, '\u2713 Logged')
          : Utils.el('span', { class: 'badge badge--draft' }, 'Not logged'));

    const viewBtn = Utils.el('button', {
      class: 'btn btn--primary btn--row', type: 'button',
      onClick: () => {
        if (isMobile()) { openMealSheet(meta, items, container, userId, products); return; }
        expandedMealType = isExpanded ? null : meta.value; expandedDetailEntryId = null; renderInner(container);
      },
    }, isExpanded ? 'Hide Meal' : 'VIEW MEAL');

    const addBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => { editingEntryId = null; draft = blankDraft(); draft.mealType = meta.value; renderInner(container); scrollToLogForm(); },
    }, '+ Add food');

    const foodsLine = items.length
      ? items.map(e => `${e.foodLabel || 'Untitled'} (${e.quantity} ${UNIT_LABELS[e.unit] || e.unit})`).join(' \u00b7 ')
      : 'No foods logged for this meal yet.';

    const targetsTable = summary.mealTarget ? Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
      Utils.el('thead', {}, Utils.el('tr', {}, ['Nutrient', 'Consumed', 'Meal target', 'Remaining', '%'].map(h => Utils.el('th', {}, h)))),
      Utils.el('tbody', {}, summary.rows.map(r => Utils.el('tr', {}, [
        Utils.el('td', {}, r.label),
        Utils.el('td', {}, Utils.fmt(r.consumed, r.consumed != null ? ` ${r.unit}` : '')),
        Utils.el('td', {}, Utils.fmt(r.target, r.target != null ? ` ${r.unit}` : '')),
        Utils.el('td', {}, r.remaining == null ? 'No data entered' : `${r.remaining >= 0 ? '' : '+'}${Math.abs(r.remaining)} ${r.unit}${r.remaining < 0 ? ' over' : ' left'}`),
        Utils.el('td', {}, r.percent == null ? 'No data entered' : `${r.percent}%`),
      ]))),
    ])) : Utils.el('p', { class: 'card__footnote' },
      targets ? 'This meal has a 0% share of your meal split — set one in Profile → Meal Split to get a target here.'
              : 'Complete your profile to get a calorie/macro target for this meal.');

    const detail = isExpanded
      ? Utils.el('div', { class: 'entry-list', style: 'margin-top:14px;' }, items.length
          ? items.map(entry => renderFoodDetailRow(entry, container, userId, products))
          : [Utils.el('p', { class: 'card__footnote' }, 'Nothing logged for this meal yet — add one below.')])
      : null;

    return Utils.el('section', { class: 'card', id: `meal-card-${meta.value}` }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('div', { class: 'entry-row__title-line' }, [
            Utils.el('h2', { class: 'card__title' }, meta.label),
            completionBadge,
            summary.mealTarget ? Utils.el('span', { class: 'badge' }, `${summary.mealTarget.percent}% of day`) : null,
          ].filter(Boolean)),
          Utils.el('p', { class: 'card__subtitle' }, timeLabel ? `First logged at ${timeLabel}` : 'Not logged yet'),
        ]),
        Utils.el('div', { class: 'row-actions' }, [viewBtn, addBtn]),
      ]),
      Utils.el('p', { class: 'card__footnote' }, foodsLine),
      targetsTable,
      detail,
    ].filter(Boolean));
  }

  // -------------------------------------------------------------------
  // FOOD DETAIL ROW — inside an expanded meal card. Shows food, brand,
  // quantity, measurement type (unit), the 5 headline macros inline, and
  // a "Nutrition detail" toggle for the full micronutrient breakdown.
  // Edit / Replace / Delete act on the same underlying entry:
  //   - Edit loads it into the form fully as-is.
  //   - Replace loads it into the form but clears just the food selection
  //     (category/item/preparation, product, or custom name) so the
  //     person picks a different food while keeping the meal, quantity,
  //     unit, and basis they already entered.
  //   - Delete removes it after confirmation, same as before.
  // -------------------------------------------------------------------

  function renderFoodDetailRow(entry, container, userId, products, sheetRefresh) {
    const n = entry.computedNutrition || {};
    const basisMeta = BASIS_OPTIONS.find(b => b.value === entry.measurementBasis);
    const isDetailOpen = expandedDetailEntryId === entry.mealItemId;

    const detailToggle = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => {
        expandedDetailEntryId = isDetailOpen ? null : entry.mealItemId;
        if (sheetRefresh) sheetRefresh(); else renderInner(container);
      },
    }, isDetailOpen ? 'Hide detail' : 'Nutrition detail');

    const editBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => {
        if (sheetRefresh) closeSheet();
        loadEntryIntoDraft(entry); renderInner(container); scrollToLogForm();
      },
    }, 'Edit');

    const replaceBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => {
        if (sheetRefresh) closeSheet();
        loadEntryIntoDraft(entry);
        draft.foodCategory = ''; draft.foodItemKey = ''; draft.preparationKey = '';
        draft.productId = ''; draft.customFoodName = '';
        renderInner(container);
        scrollToLogForm();
        Utils.toast('Pick a replacement food below \u2014 meal, quantity and unit are kept.', 'info');
      },
    }, 'Replace');

    const deleteBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => {
        const confirmed = window.confirm(`Delete "${entry.foodLabel || 'this entry'}"? This cannot be undone.`);
        if (!confirmed) return;
        await DataService.mealItems.delete(entry.mealItemId);
        Utils.toast('Food entry deleted.', 'success');
        if (sheetRefresh) closeSheet();
        await renderInner(container);
      },
    }, 'Delete');

    const rows = [
      Utils.el('div', { class: 'entry-row__title-line' }, [
        Utils.el('span', { class: 'entry-row__name' }, entry.foodLabel || 'Untitled'),
        entry.brand ? Utils.el('span', { class: 'entry-row__brand' }, ` \u00b7 ${entry.brand}`) : null,
        Utils.el('span', { class: 'badge' }, SOURCE_BADGE[entry.nutritionSource] || entry.nutritionSource),
      ].filter(Boolean)),
      Utils.el('div', { class: 'entry-row__meta' }, [
        `${entry.quantity} ${UNIT_LABELS[entry.unit] || entry.unit}`,
        entry.preparation ? ` \u00b7 ${entry.preparation}` : '',
        basisMeta ? ` \u00b7 ${basisMeta.label}` : '',
        entry.cookingOilG ? ` \u00b7 +${entry.cookingOilG} g oil` : '',
      ].join('')),
      entry.notes ? Utils.el('div', { class: 'entry-row__notes' }, entry.notes) : null,
    ].filter(Boolean);

    const wrap = Utils.el('div', { class: 'entry-row', style: 'flex-direction:column;align-items:stretch;gap:8px;' }, [
      Utils.el('div', { class: 'entry-row__main' }, rows),
      Utils.el('div', { class: 'entry-row__macros' }, [
        Utils.fmt(n.calories, ' kcal'), ' \u00b7 P ', Utils.fmt(n.proteinG, 'g'), ' \u00b7 C ', Utils.fmt(n.carbsG, 'g'),
        ' \u00b7 F ', Utils.fmt(n.fatG, 'g'), ' \u00b7 Fibre ', Utils.fmt(n.fibreG, 'g'),
      ].join('')),
      Utils.el('div', { class: 'row-actions' }, [detailToggle, editBtn, replaceBtn, deleteBtn]),
      isDetailOpen ? nutritionPreview(n, 'Full nutrition for this entry (as logged)') : null,
    ].filter(Boolean));
    return wrap;
  }

  // -------------------------------------------------------------------
  // HISTORY — daily / weekly / monthly nutrition history with a real
  // target-vs-actual view, not just a log. Consumed totals are the same
  // FoodCalc.sumEntries() used everywhere else; targets are the same
  // Calculations bundle, scaled by how many days a bucket covers (a
  // week's target is 7x the daily target, etc.) — never a separately
  // invented number. Buckets with nothing logged show "No data entered"
  // rather than a misleading 0%.
  // -------------------------------------------------------------------

  function bucketRange(period, endDate, count) {
    const buckets = [];
    if (period === 'daily') {
      for (let i = count - 1; i >= 0; i--) {
        const date = ProgramTemplates.addDays(endDate, -i);
        buckets.push({ key: date, label: Utils.formatDate(date, { day: '2-digit', month: 'short' }), from: date, to: date, days: 1 });
      }
    } else if (period === 'weekly') {
      for (let i = count - 1; i >= 0; i--) {
        const to = ProgramTemplates.addDays(endDate, -7 * i);
        const from = ProgramTemplates.addDays(to, -6);
        buckets.push({ key: from, label: `${Utils.formatDate(from, { day: '2-digit', month: 'short' })}\u2013${Utils.formatDate(to, { day: '2-digit', month: 'short' })}`, from, to, days: 7 });
      }
    } else { // monthly
      const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const end = new Date(endDate + 'T00:00:00');
      for (let i = count - 1; i >= 0; i--) {
        const y = end.getFullYear(), m = end.getMonth() - i;
        const first = new Date(y, m, 1);
        const lastOfMonth = new Date(y, m + 1, 0);
        const last = lastOfMonth > end && i === 0 ? end : lastOfMonth;
        const from = toIso(first);
        const to = toIso(last);
        const days = Math.round((last - first) / 86400000) + 1;
        buckets.push({ key: from, label: first.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), from, to, days });
      }
    }
    return buckets;
  }

  function computeHistoryBuckets(entries, targets, period, endDate, count) {
    const buckets = bucketRange(period, endDate, count);
    return buckets.map(b => {
      const items = entries.filter(e => e.date >= b.from && e.date <= b.to);
      const totals = items.length ? FoodCalc.sumEntries(items.map(e => e.computedNutrition)) : null;
      const calorieTarget = targets?.calorieTarget != null ? FoodCalc.round2(targets.calorieTarget * b.days) : null;
      const proteinTarget = targets?.proteinTargetG != null ? FoodCalc.round2(targets.proteinTargetG * b.days) : null;
      const consumedCal = totals?.calories ?? null;
      const percent = (consumedCal != null && calorieTarget) ? Math.round((consumedCal / calorieTarget) * 100) : null;
      return {
        ...b, logged: items.length > 0,
        consumedCalories: consumedCal, calorieTarget,
        consumedProteinG: totals?.proteinG ?? null, proteinTarget,
        percent,
      };
    });
  }

  function renderHistoryCard(allEntries, targets) {
    const periodMeta = HISTORY_PERIODS.find(p => p.value === historyPeriod);
    const buckets = computeHistoryBuckets(allEntries, targets, historyPeriod, selectedDate, periodMeta.count);

    const chartSeries = [
      { label: 'Consumed', color: 'var(--gold)', points: buckets.map(b => ({ x: b.key, y: b.consumedCalories ?? 0 })) },
    ];
    if (targets?.calorieTarget != null) {
      chartSeries.push({ label: 'Target', color: 'var(--ink-faint)', points: buckets.map(b => ({ x: b.key, y: b.calorieTarget })) });
    }
    const lineSvg = ChartUtils.buildLineChartSVG(chartSeries, { width: 640, height: 200, yUnit: ' kcal', yDecimals: 0 });

    const logged = buckets.filter(b => b.logged);
    const avgCal = logged.length ? Math.round(logged.reduce((s, b) => s + (b.consumedCalories || 0), 0) / logged.length) : null;
    const metCount = targets?.calorieTarget != null
      ? buckets.filter(b => b.logged && b.percent != null && b.percent >= 90 && b.percent <= 110).length
      : null;

    const periodToggle = Utils.el('div', { class: 'chip-row' }, HISTORY_PERIODS.map(p =>
      Utils.el('button', {
        class: `chip${historyPeriod === p.value ? ' chip--active' : ''}`, type: 'button',
        onClick: () => { historyPeriod = p.value; const card = renderHistoryCard(allEntries, targets); document.getElementById('nutrition-history-card').replaceWith(card); },
      }, p.label)
    ));

    const chartWrap = Utils.el('div', { style: 'margin:8px 0 4px;' });
    chartWrap.innerHTML = lineSvg || '';

    const table = Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
      Utils.el('thead', {}, Utils.el('tr', {}, [{ daily: 'Date', weekly: 'Week', monthly: 'Month' }[historyPeriod], 'Calories', 'Target', '%', 'Protein'].map(h => Utils.el('th', {}, h)))),
      Utils.el('tbody', {}, buckets.map(b => Utils.el('tr', {}, [
        Utils.el('td', {}, b.label),
        Utils.el('td', {}, b.logged ? Utils.fmt(b.consumedCalories, ' kcal') : 'No data entered'),
        Utils.el('td', {}, b.calorieTarget != null ? Utils.fmt(b.calorieTarget, ' kcal') : 'No data entered'),
        Utils.el('td', {}, b.percent != null ? `${b.percent}%` : '\u2014'),
        Utils.el('td', {}, b.logged ? Utils.fmt(b.consumedProteinG, ' g') : 'No data entered'),
      ]))),
    ]));

    return Utils.el('section', { class: 'card', id: 'nutrition-history-card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Nutrition History'),
          Utils.el('p', { class: 'card__subtitle' }, 'Target vs. actual over time.'),
        ]),
        periodToggle,
      ]),
      lineSvg ? chartWrap : Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      Utils.el('dl', { class: 'stat-list' }, [
        Utils.el('dt', {}, `${periodMeta.label} average`), Utils.el('dd', {}, avgCal != null ? `${avgCal} kcal` : 'No data entered'),
        Utils.el('dt', {}, 'Within 10% of target'), Utils.el('dd', {}, metCount != null ? `${metCount} / ${buckets.length}` : 'No data entered'),
      ]),
      Utils.el('h3', { class: 'form__group-title' }, `Last ${buckets.length} ${periodMeta.label.toLowerCase()} period${buckets.length === 1 ? '' : 's'}`),
      table,
    ]);
  }

  // -------------------------------------------------------------------
  // DATE BAR
  // -------------------------------------------------------------------

  function renderDateBar(container) {
    const shift = (days) => { selectedDate = ProgramTemplates.addDays(selectedDate, days); renderInner(container); };
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Food Entry'),
          Utils.el('p', { class: 'card__subtitle' }, Utils.formatDate(selectedDate)),
        ]),
        Utils.el('div', { class: 'row-actions' }, [
          Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => shift(-1) }, '← Prev day'),
          Utils.el('input', {
            class: 'form__input', type: 'date', value: selectedDate,
            onChange: (e) => { if (e.target.value) { selectedDate = e.target.value; renderInner(container); } },
          }),
          Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => shift(1) }, 'Next day →'),
        ]),
      ]),
    ]);
  }

  // -------------------------------------------------------------------
  // FORM
  // -------------------------------------------------------------------

  function renderFormCard(userId, products, container) {
    const refresh = () => {
      const card = renderFormCard(userId, products, container);
      const old = document.getElementById('food-entry-card');
      if (old) old.replaceWith(card);
      return card;
    };

    const form = Utils.el('form', { class: 'form', id: 'entry-form' });
    const errorsHost = Utils.el('div', { class: 'form__errors' });

    // Search — finds a generic food, a saved product, or offers to log a
    // custom food, and pre-fills the rest of the form below.
    form.appendChild(renderFoodSearchBox(products, refresh));
    form.appendChild(Utils.el('p', { class: 'card__footnote' }, 'Or pick manually:'));

    // Meal + source type
    const topGrid = Utils.el('div', { class: 'form__grid' }, [
      selectField('mealType', 'Meal', draft.mealType, MEAL_TYPES, (v) => { draft.mealType = v; }),
      selectField('sourceType', 'Food source', draft.sourceType, SOURCE_TYPES, (v) => {
        draft.sourceType = v;
        draft.foodCategory = ''; draft.foodItemKey = ''; draft.preparationKey = '';
        draft.productId = ''; draft.customFoodName = '';
        draft.unit = 'g';
        refresh();
      }),
    ]);
    form.appendChild(topGrid);

    // Source-specific section
    form.appendChild(renderSourceSection(products, refresh));

    // Quantity + unit
    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, 'Quantity'));
    form.appendChild(renderQuantitySection(products, refresh));

    // Preparation free-text (product / custom only — generic uses the preparation picker above)
    if (draft.sourceType !== 'generic') {
      form.appendChild(Utils.el('div', { class: 'form__grid' }, [
        textField('preparationText', 'Preparation (optional)', draft.preparationText, (v) => { draft.preparationText = v; }),
      ]));
    }

    // Measurement basis
    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, 'Measurement basis'));
    form.appendChild(Utils.el('p', { class: 'card__footnote' }, 'Required. The app never silently converts between raw and cooked weight.'));
    form.appendChild(renderBasisRadios(refresh));

    // Cooking oil
    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, 'Cooking oil (tracked separately)'));
    form.appendChild(renderOilSection(refresh));

    // Notes
    form.appendChild(Utils.el('div', { class: 'form__field form__field--wide' }, [
      Utils.el('label', { class: 'form__label', for: 'field-entry-notes' }, 'Notes'),
      Utils.el('textarea', {
        class: 'form__input', id: 'field-entry-notes', rows: 2, value: draft.notes,
        onInput: (e) => { draft.notes = e.target.value; },
      }, draft.notes),
    ]));

    const actions = Utils.el('div', { class: 'form__actions' }, [
      Utils.el('button', { class: 'btn btn--primary', type: 'submit' }, editingEntryId ? 'Save changes' : 'Save entry'),
      editingEntryId ? Utils.el('button', {
        class: 'btn btn--secondary', type: 'button',
        onClick: () => { editingEntryId = null; draft = blankDraft(); renderInner(container); },
      }, 'Cancel edit') : null,
    ].filter(Boolean));
    form.appendChild(actions);

    form.addEventListener('submit', (e) => handleSave(e, userId, products, container));

    return Utils.el('section', { class: 'card card--form', id: 'food-entry-card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, editingEntryId ? 'Edit Food Entry' : 'Log a Food'),
      ]),
      errorsHost,
      form,
    ]);
  }

  // -------------------------------------------------------------------
  // SEARCH — a single box over the generic food database, saved
  // products, AND a "log this as a custom food" fallback, per the spec's
  // "[ADD FOOD] should support search, saved food, custom food, quantity
  // and preparation." Picking a result sets the draft's source fields;
  // quantity/preparation are still entered below exactly as before —
  // search only shortcuts finding the food, it never invents its
  // nutrition. The results list is updated locally (not via the form's
  // full refresh) so the input never loses focus mid-keystroke.
  // -------------------------------------------------------------------

  function searchFoodMatches(query, products) {
    const q = query.trim().toLowerCase();
    if (!q) return { generic: [], products: [] };
    const generic = [];
    FoodDatabase.CATEGORIES.forEach(cat => {
      cat.items.forEach(item => {
        if (item.label.toLowerCase().includes(q)) {
          generic.push({ categoryKey: cat.key, categoryLabel: cat.label, itemKey: item.key, itemLabel: item.label });
        }
      });
    });
    const prod = products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q));
    return { generic: generic.slice(0, 8), products: prod.slice(0, 8) };
  }

  function renderFoodSearchBox(products, refresh) {
    const resultsHost = Utils.el('div', { class: 'search-results' });

    function pick(applyToDraft) {
      applyToDraft();
      input.value = '';
      resultsHost.innerHTML = '';
      resultsHost.classList.remove('search-results--open');
      refresh();
    }

    function updateResults(query) {
      resultsHost.innerHTML = '';
      if (!query.trim()) { resultsHost.classList.remove('search-results--open'); return; }
      resultsHost.classList.add('search-results--open');
      const matches = searchFoodMatches(query, products);
      const rows = [];

      matches.generic.forEach(m => rows.push(Utils.el('button', {
        class: 'search-result', type: 'button',
        onClick: () => pick(() => {
          draft.sourceType = 'generic'; draft.foodCategory = m.categoryKey; draft.foodItemKey = m.itemKey; draft.preparationKey = '';
          draft.productId = ''; draft.customFoodName = ''; draft.unit = 'g';
        }),
      }, [
        Utils.el('span', { class: 'search-result__name' }, m.itemLabel),
        Utils.el('span', { class: 'search-result__meta' }, `${m.categoryLabel} \u00b7 generic database`),
      ])));

      matches.products.forEach(p => rows.push(Utils.el('button', {
        class: 'search-result', type: 'button',
        onClick: () => pick(() => {
          draft.sourceType = 'product'; draft.productId = p.productId;
          draft.foodCategory = ''; draft.foodItemKey = ''; draft.preparationKey = ''; draft.customFoodName = '';
          draft.unit = FoodCalc.validUnitsForProduct(p)[0] || 'g';
        }),
      }, [
        Utils.el('span', { class: 'search-result__name' }, p.name || 'Untitled product'),
        Utils.el('span', { class: 'search-result__meta' }, `${p.brand ? p.brand + ' \u00b7 ' : ''}saved product`),
      ])));

      if (!matches.generic.length && !matches.products.length) {
        rows.push(Utils.el('p', { class: 'search-results__empty' }, 'No saved food or product matches.'));
      }

      const trimmed = query.trim();
      rows.push(Utils.el('button', {
        class: 'search-result search-result--custom', type: 'button',
        onClick: () => pick(() => {
          draft.sourceType = 'custom'; draft.customFoodName = trimmed;
          draft.foodCategory = ''; draft.foodItemKey = ''; draft.preparationKey = ''; draft.productId = '';
        }),
      }, [
        Utils.el('span', { class: 'search-result__name' }, `Log "${trimmed}" as a custom food`),
        Utils.el('span', { class: 'search-result__meta' }, 'You\u2019ll enter its nutrition manually'),
      ]));

      rows.forEach(r => resultsHost.appendChild(r));
    }

    const input = Utils.el('input', {
      class: 'form__input', type: 'search', placeholder: 'Search foods, saved products, or type your own\u2026',
      onInput: (e) => updateResults(e.target.value),
    });

    return Utils.el('div', { class: 'form__field form__field--wide search-box' }, [
      Utils.el('label', { class: 'form__label' }, 'Search'),
      input,
      resultsHost,
    ]);
  }

  function renderSourceSection(products, refresh) {
    if (draft.sourceType === 'generic') return renderGenericSection(refresh);
    if (draft.sourceType === 'product') return renderProductSection(products, refresh);
    return renderCustomSection(refresh);
  }

  function renderGenericSection(refresh) {
    const grid = Utils.el('div', { class: 'form__grid' }, [
      selectField('foodCategory', 'Category', draft.foodCategory,
        [{ value: '', label: '— Select —' }, ...FoodDatabase.CATEGORIES.map(c => ({ value: c.key, label: c.label }))],
        (v) => { draft.foodCategory = v; draft.foodItemKey = ''; draft.preparationKey = ''; refresh(); }),
    ]);

    const category = FoodDatabase.findCategory(draft.foodCategory);
    if (category) {
      grid.appendChild(selectField('foodItemKey', 'Food', draft.foodItemKey,
        [{ value: '', label: '— Select —' }, ...category.items.map(i => ({ value: i.key, label: i.label }))],
        (v) => { draft.foodItemKey = v; draft.preparationKey = ''; refresh(); }));
    }
    const item = category ? FoodDatabase.findItem(draft.foodCategory, draft.foodItemKey) : null;
    if (item) {
      grid.appendChild(selectField('preparationKey', 'Preparation', draft.preparationKey,
        [{ value: '', label: '— Select —' }, ...item.preparations.map(p => ({ value: p.key, label: p.label }))],
        (v) => { draft.preparationKey = v; refresh(); }));
    }

    const wrap = Utils.el('div', {}, [grid]);
    const prep = item ? FoodDatabase.findPreparation(draft.foodCategory, draft.foodItemKey, draft.preparationKey) : null;
    if (prep && prep.per100g) {
      wrap.appendChild(nutritionPreview(prep.per100g, 'Generic estimate — per 100 g'));
    } else if (prep && !prep.per100g) {
      wrap.appendChild(Utils.el('p', { class: 'card__footnote' },
        'No generic figure for this preparation. Enter the nutrition for this entry manually:'));
      wrap.appendChild(manualMacroGrid());
    }
    return wrap;
  }

  function renderProductSection(products, refresh) {
    const grid = Utils.el('div', { class: 'form__grid' }, [
      selectField('productId', 'Saved product', draft.productId,
        [{ value: '', label: '— Select —' }, ...products.map(p => ({ value: p.productId, label: `${p.brand ? p.brand + ' — ' : ''}${p.name}` }))],
        (v) => {
          draft.productId = v;
          const product = products.find(p => p.productId === v);
          const units = FoodCalc.validUnitsForProduct(product);
          draft.unit = units[0] || 'g';
          refresh();
        }),
    ]);
    const wrap = Utils.el('div', {}, [grid]);
    if (!products.length) {
      wrap.appendChild(Utils.el('p', { class: 'card__footnote' }, 'No saved products yet — add one on the Products page first.'));
    }
    const product = products.find(p => p.productId === draft.productId);
    if (product) {
      wrap.appendChild(nutritionPreview(product.nutrients, `Product label — ${basisLabel(product)}`));
    }
    return wrap;
  }

  function renderCustomSection(refresh) {
    return Utils.el('div', {}, [
      Utils.el('div', { class: 'form__grid' }, [
        textField('customFoodName', 'Food name', draft.customFoodName, (v) => { draft.customFoodName = v; }),
      ]),
      Utils.el('p', { class: 'card__footnote' }, 'Enter the nutrition for exactly the quantity you log below:'),
      manualMacroGrid(),
    ]);
  }

  function manualMacroGrid() {
    return Utils.el('div', { class: 'form__grid' }, MANUAL_MACRO_FIELDS.map(f => Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label' }, `${f.label} (${f.unit})`),
      Utils.el('input', {
        class: 'form__input', type: 'number', step: 'any', min: 0,
        value: draft.manualNutrients[f.key] ?? '',
        onInput: (e) => { draft.manualNutrients[f.key] = e.target.value === '' ? null : Number(e.target.value); },
      }),
    ])));
  }

  function nutritionPreview(values, caption) {
    const rows = FoodCalc.NUTRIENT_FIELDS
      .filter(f => values && values[f.key] !== null && values[f.key] !== undefined)
      .map(f => Utils.el('div', {}, [
        Utils.el('dt', {}, f.label), Utils.el('dd', {}, `${values[f.key]} ${f.unit}`),
      ]));
    return Utils.el('div', { class: 'nutrition-preview' }, [
      Utils.el('p', { class: 'card__footnote' }, caption),
      rows.length
        ? Utils.el('dl', { class: 'stat-list stat-list--mono' }, rows)
        : Utils.el('p', { class: 'card__footnote' }, 'No values entered for this source yet.'),
    ]);
  }

  function basisLabel(product) {
    const map = { per_100g: 'per 100 g', per_serving: `per serving${product.servingSizeLabel ? ' (' + product.servingSizeLabel + ')' : ''}`, per_piece: `per piece${product.pieceLabel ? ' (' + product.pieceLabel + ')' : ''}`, custom: `per ${product.customUnitLabel || 'custom unit'}` };
    return map[product.labelBasis] || product.labelBasis;
  }

  function renderQuantitySection(products, refresh) {
    let units;
    if (draft.sourceType === 'generic') units = ['g', 'ml'];
    else if (draft.sourceType === 'product') {
      const product = products.find(p => p.productId === draft.productId);
      units = FoodCalc.validUnitsForProduct(product);
    } else units = ['g', 'ml', 'piece', 'serving', 'custom'];

    const grid = Utils.el('div', { class: 'form__grid' }, [
      Utils.el('div', { class: 'form__field' }, [
        Utils.el('label', { class: 'form__label' }, 'Quantity'),
        Utils.el('input', {
          class: 'form__input', type: 'number', step: 'any', min: 0, value: draft.quantity,
          onInput: (e) => { draft.quantity = e.target.value; },
        }),
      ]),
      selectField('unit', 'Unit', draft.unit, units.map(u => ({ value: u, label: UNIT_LABELS[u] || u })),
        (v) => { draft.unit = v; refresh(); }),
    ]);
    if (draft.unit === 'custom') {
      grid.appendChild(textField('customUnitLabel', 'Custom unit label', draft.customUnitLabel, (v) => { draft.customUnitLabel = v; }));
    }
    return grid;
  }

  function renderBasisRadios(refresh) {
    return Utils.el('div', { class: 'chip-row' }, BASIS_OPTIONS.map(opt =>
      Utils.el('button', {
        class: `chip${draft.measurementBasis === opt.value ? ' chip--active' : ''}`, type: 'button',
        onClick: () => { draft.measurementBasis = opt.value; refresh(); },
      }, opt.label)
    ));
  }

  function renderOilSection(refresh) {
    const wrap = Utils.el('div', {}, []);
    const chipRow = Utils.el('div', { class: 'chip-row' }, [
      ...OIL_PRESETS_G.map(g => Utils.el('button', {
        class: `chip${String(draft.cookingOilPreset) === String(g) ? ' chip--active' : ''}`, type: 'button',
        onClick: () => { draft.cookingOilPreset = g; draft.cookingOilG = g; refresh(); },
      }, `${g} g`)),
      Utils.el('button', {
        class: `chip${draft.cookingOilPreset === 'custom' ? ' chip--active' : ''}`, type: 'button',
        onClick: () => { draft.cookingOilPreset = 'custom'; if (!draft.cookingOilG) draft.cookingOilG = ''; refresh(); },
      }, 'Custom'),
      Utils.el('button', {
        class: `chip${draft.cookingOilPreset === '' ? ' chip--active' : ''}`, type: 'button',
        onClick: () => { draft.cookingOilPreset = ''; draft.cookingOilG = ''; refresh(); },
      }, 'None'),
    ]);
    wrap.appendChild(chipRow);

    if (draft.cookingOilPreset === 'custom') {
      wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
        Utils.el('div', { class: 'form__field' }, [
          Utils.el('label', { class: 'form__label' }, 'Oil amount (g)'),
          Utils.el('input', {
            class: 'form__input', type: 'number', step: 'any', min: 0, value: draft.cookingOilG,
            onInput: (e) => { draft.cookingOilG = e.target.value; },
          }),
        ]),
        textField('cookingOilLabel', 'Oil type (optional)', draft.cookingOilLabel, (v) => { draft.cookingOilLabel = v; }),
      ]));
    } else if (draft.cookingOilPreset) {
      wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
        textField('cookingOilLabel', 'Oil type (optional)', draft.cookingOilLabel, (v) => { draft.cookingOilLabel = v; }),
      ]));
      const oil = FoodCalc.computeOilNutrition(draft.cookingOilG);
      if (oil) wrap.appendChild(Utils.el('p', { class: 'card__footnote' }, `≈ ${oil.calories} kcal, ${oil.fatG} g fat (generic estimate)`));
    }
    return wrap;
  }

  function selectField(name, label, value, options, onChange) {
    const id = `field-${name}-${Math.random().toString(36).slice(2, 6)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('select', {
        class: 'form__input', id, name,
        onChange: (e) => onChange(e.target.value),
      }, options.map(o => {
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
      Utils.el('input', { class: 'form__input', id, name, type: 'text', value, onInput: (e) => onInput(e.target.value) }),
    ]);
  }

  // -------------------------------------------------------------------
  // SAVE
  // -------------------------------------------------------------------

  async function handleSave(e, userId, products, container) {
    e.preventDefault();
    const errors = [];

    if (!draft.mealType) errors.push('Meal is required.');
    if (!draft.measurementBasis) errors.push('Measurement basis is required.');
    const qty = Number(draft.quantity);
    if (draft.quantity === '' || Number.isNaN(qty) || qty <= 0) errors.push('Quantity must be a number greater than 0.');

    let foodLabel = '', brand = '', preparation = '', nutritionSource = '', computed = null, productId = null;
    let foodCategory = '', foodItemKey = '', preparationKey = '';

    if (draft.sourceType === 'generic') {
      if (!draft.foodCategory || !draft.foodItemKey || !draft.preparationKey) {
        errors.push('Select a category, food, and preparation.');
      } else {
        const item = FoodDatabase.findItem(draft.foodCategory, draft.foodItemKey);
        const prep = FoodDatabase.findPreparation(draft.foodCategory, draft.foodItemKey, draft.preparationKey);
        foodLabel = item ? item.label : '';
        preparation = prep ? prep.label : '';
        foodCategory = draft.foodCategory; foodItemKey = draft.foodItemKey; preparationKey = draft.preparationKey;
        const result = FoodCalc.computeEntryNutrition({
          sourceType: 'generic', per100g: prep ? prep.per100g : null,
          manualNutrients: draft.manualNutrients, quantity: qty, unit: draft.unit, cookingOilG: draft.cookingOilG,
        });
        computed = result.computed; nutritionSource = result.nutritionSource;
        if (prep && prep.per100g && !FoodCalc.computeGenericNutrition(prep.per100g, qty, draft.unit)) {
          errors.push('Generic foods can only be logged in grams or millilitres.');
        }
      }
    } else if (draft.sourceType === 'product') {
      if (!draft.productId) {
        errors.push('Select a saved product.');
      } else {
        const product = products.find(p => p.productId === draft.productId);
        foodLabel = product.name; brand = product.brand; productId = product.productId;
        preparation = draft.preparationText || '';
        const result = FoodCalc.computeEntryNutrition({
          sourceType: 'product', product, quantity: qty, unit: draft.unit, cookingOilG: draft.cookingOilG,
        });
        computed = result.computed; nutritionSource = result.nutritionSource;
        if (!FoodCalc.computeProductNutrition(product, qty, draft.unit)) {
          errors.push("This quantity/unit can't be scaled from the product's label — check the unit, or edit the product to add its gram weight.");
        }
      }
    } else {
      if (!draft.customFoodName.trim()) errors.push('Enter a food name.');
      foodLabel = draft.customFoodName.trim();
      preparation = draft.preparationText || '';
      const result = FoodCalc.computeEntryNutrition({
        sourceType: 'custom', manualNutrients: draft.manualNutrients, cookingOilG: draft.cookingOilG,
      });
      computed = result.computed; nutritionSource = result.nutritionSource;
    }

    const card = document.getElementById('food-entry-card');
    const errorsHost = card ? card.querySelector('.form__errors') : null;
    if (errorsHost) errorsHost.innerHTML = '';
    if (errors.length) {
      if (errorsHost) errorsHost.appendChild(Utils.el('ul', { class: 'error-list' }, errors.map(msg => Utils.el('li', {}, msg))));
      Utils.toast('Please fix the highlighted errors.', 'error');
      return;
    }

    const record = {
      date: selectedDate,
      mealType: draft.mealType,
      sourceType: draft.sourceType,
      nutritionSource,
      foodCategory, foodItemKey, preparationKey,
      preparationLabel: preparation,
      productId,
      foodLabel, brand,
      quantity: qty,
      unit: draft.unit,
      customUnitLabel: draft.customUnitLabel,
      preparation,
      measurementBasis: draft.measurementBasis,
      cookingOilG: draft.cookingOilG ? Number(draft.cookingOilG) : null,
      cookingOilLabel: draft.cookingOilLabel,
      notes: draft.notes,
      computedNutrition: computed,
    };

    if (editingEntryId) {
      await DataService.mealItems.update(editingEntryId, record);
      Utils.toast('Food entry updated.', 'success');
    } else {
      await DataService.mealItems.create(Models.createMealItem(userId, record));
      Utils.toast('Food entry saved.', 'success');
    }

    editingEntryId = null;
    draft = blankDraft();
    await renderInner(container);
  }

  // Note: the flat "Logged Today" list + per-row edit/delete that used to
  // live here is superseded by the per-meal cards above (renderMealCard /
  // renderFoodDetailRow), which group the same entries by meal and add
  // the VIEW MEAL / Replace / Nutrition-detail interactions from the spec.

  function loadEntryIntoDraft(entry) {
    editingEntryId = entry.mealItemId;
    draft = {
      mealType: entry.mealType,
      sourceType: entry.sourceType,
      foodCategory: entry.foodCategory || '', foodItemKey: entry.foodItemKey || '', preparationKey: entry.preparationKey || '',
      productId: entry.productId || '',
      customFoodName: entry.sourceType === 'custom' ? entry.foodLabel : '',
      manualNutrients: entry.nutritionSource === 'user_entered' && entry.computedNutrition
        ? {
            calories: entry.computedNutrition.calories, proteinG: entry.computedNutrition.proteinG,
            carbsG: entry.computedNutrition.carbsG, fatG: entry.computedNutrition.fatG,
            fibreG: entry.computedNutrition.fibreG, sugarG: entry.computedNutrition.sugarG,
          }
        : { calories: null, proteinG: null, carbsG: null, fatG: null, fibreG: null, sugarG: null },
      quantity: entry.quantity, unit: entry.unit, customUnitLabel: entry.customUnitLabel || '',
      preparationText: entry.sourceType !== 'generic' ? (entry.preparation || '') : '',
      measurementBasis: entry.measurementBasis,
      cookingOilPreset: entry.cookingOilG ? (OIL_PRESETS_G.includes(entry.cookingOilG) ? entry.cookingOilG : 'custom') : '',
      cookingOilG: entry.cookingOilG || '',
      cookingOilLabel: entry.cookingOilLabel || '',
      notes: entry.notes || '',
    };
  }

  return { render };
})();
