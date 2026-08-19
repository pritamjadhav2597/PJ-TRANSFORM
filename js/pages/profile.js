/**
 * pages/profile.js — create/edit the user profile. Persists through
 * DataService only. Validates inputs before saving.
 */

const PageProfile = (() => {

  const FIELD_GROUPS = [
    {
      title: 'Basics',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'mobileNumber', label: 'Mobile Number', type: 'tel', placeholder: 'e.g. +91 98765 43210' },
        { key: 'age', label: 'Age', type: 'number', min: 10, max: 100, required: true },
        { key: 'sex', label: 'Sex', type: 'select', options: ['male', 'female', 'other'], required: true },
        { key: 'heightCm', label: 'Height (cm)', type: 'number', min: 100, max: 250, required: true },
      ],
    },
    {
      title: 'Weight & Goal',
      fields: [
        { key: 'currentWeightKg', label: 'Current weight (kg)', type: 'number', min: 30, max: 300, step: '0.01', required: true },
        { key: 'targetWeightKg', label: 'Target weight (kg)', type: 'number', min: 30, max: 300, step: '0.01' },
        { key: 'primaryGoal', label: 'Primary goal (description)', type: 'text' },
        { key: 'goalType', label: 'Goal type', type: 'select', options: ['fat_loss', 'maintenance', 'muscle_gain', 'body_recomposition', 'general_fitness'], required: true },
        { key: 'desiredWeeklyChangePercent', label: 'Desired weekly rate (% bodyweight, optional)', type: 'number', min: 0, max: 1.5, step: '0.05' },
        { key: 'programPreference', label: 'Program preference (default: 60-Day Transformation)', type: 'select', options: ['60_day', '100_day_bollywood', '1_year', 'custom'], defaultValue: '60_day' },
        { key: 'programStartDate', label: 'Program start date', type: 'date' },
      ],
    },
    {
      title: 'Activity & Lifestyle',
      fields: [
        { key: 'activityLevelSource', label: 'Activity level calculation', type: 'select', options: ['auto', 'manual'] },
        { key: 'activityLevel', label: 'Activity level (used only when calculation is "manual")', type: 'select', options: ['sedentary', 'light', 'moderate', 'active', 'very_active'] },
        { key: 'occupationType', label: 'Occupation / activity type', type: 'select', options: ['mostly_sitting', 'mostly_standing', 'physical'], required: true },
        { key: 'averageDailySteps', label: 'Average daily steps', type: 'number', min: 0, max: 60000 },
        { key: 'trainingFrequencyPerWeek', label: 'Training frequency (days/week)', type: 'number', min: 0, max: 14 },
        { key: 'dietaryPreference', label: 'Dietary preference', type: 'select', options: ['vegetarian', 'vegan', 'pescatarian', 'omnivore', 'other'] },
        { key: 'climate', label: 'Climate (affects water target)', type: 'select', options: ['temperate', 'hot', 'cold'] },
      ],
    },
    {
      title: 'Optional details',
      collapsible: true,
      fields: [
        { key: 'bodyFatPercent', label: 'Body-fat %', type: 'number', min: 3, max: 60, step: '0.1' },
        { key: 'waistCm', label: 'Waist (cm)', type: 'number', min: 30, max: 200 },
        { key: 'chestCm', label: 'Chest (cm)', type: 'number', min: 30, max: 200 },
        { key: 'hipCm', label: 'Hip (cm)', type: 'number', min: 30, max: 200 },
        { key: 'armCm', label: 'Arm (cm)', type: 'number', min: 10, max: 80 },
        { key: 'thighCm', label: 'Thigh (cm)', type: 'number', min: 20, max: 120 },
        { key: 'typicalSleepHours', label: 'Typical sleep duration (hrs)', type: 'number', min: 0, max: 16, step: '0.1' },
        { key: 'exerciseDurationMinutes', label: 'Typical exercise duration (min)', type: 'number', min: 0, max: 400 },
        { key: 'exerciseIntensity', label: 'Typical exercise intensity', type: 'select', options: ['low', 'moderate', 'high'] },
      ],
    },
  ];

  // Keys of every field marked required: true above — the fields the rest
  // of the app (BMR/TDEE, step target, workout & diet recommendations)
  // actually needs to produce real numbers instead of blanks/zeros.
  const MANDATORY_KEYS = FIELD_GROUPS.flatMap(g => g.fields).filter(f => f.required).map(f => f.key);

  /** Whether a profile has every mandatory field filled in. Used by the
   *  router to gate the rest of the app behind onboarding for a brand-new
   *  or still-incomplete profile. */
  function isComplete(profile) {
    if (!profile) return false;
    return MANDATORY_KEYS.every(key => {
      const v = profile[key];
      return v !== null && v !== undefined && String(v).trim() !== '';
    });
  }

  async function render(container) {
    let userId = DataService.getCurrentUserId();
    let profile = userId ? (await DataService.profiles.list(p => p.userId === userId))[0] : null;

    if (!userId) {
      const user = await DataService.users.create(Models.createUser({ name: 'New User' }));
      userId = user.userId;
      DataService.setCurrentUserId(userId);
    }
    if (!profile) {
      profile = await DataService.profiles.create(Models.createProfile(userId));
    }

    const programs = await DataService.programs.list(p => p.userId === userId);
    const activeProgram = programs.find(p => p.status === 'active') || null;
    const activePhases = activeProgram ? await DataService.programPhases.list(ph => ph.programId === activeProgram.programId) : [];
    const activeCurrentPhase = activePhases.length ? Calculations.getCurrentPhase(activePhases) : null;
    const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
    const targets = Calculations.calculateAllTargets(profile, { weightEntries, program: activeProgram, phase: activeCurrentPhase });

    const form = Utils.el('form', { class: 'form', id: 'profile-form' });
    const errorsHost = Utils.el('div', { class: 'form__errors', id: 'profile-errors' });

    FIELD_GROUPS.forEach(group => {
      form.appendChild(Utils.el('h3', { class: 'form__group-title' }, group.title));
      const grid = Utils.el('div', { class: 'form__grid' });
      group.fields.forEach(field => grid.appendChild(renderField(field, profile[field.key])));
      form.appendChild(grid);
    });

    const actions = Utils.el('div', { class: 'form__actions' }, [
      Utils.el('button', { class: 'btn btn--primary', type: 'submit' }, 'Save profile'),
      Utils.el('span', { class: 'form__saved-indicator', id: 'saved-indicator' }, ''),
    ]);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleSave(form, profile, errorsHost, container);
    });

    if (!isComplete(profile)) {
      container.appendChild(Utils.el('div', { class: 'card card--onboarding' }, [
        Utils.el('h3', { class: 'card__title' }, '\u{1F44B} Welcome — let\u2019s set up your profile'),
        Utils.el('p', {}, 'Fill in the fields marked with * below. They drive every calculated target in the app — calories, macros, water, and step goals — so nothing else can be personalized until they\u2019re filled in.'),
      ]));
    }

    container.appendChild(renderProfileHero(profile, activeProgram, activeCurrentPhase));
    container.appendChild(Utils.el('div', { class: 'card card--form', id: 'profile-form-card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Your Profile'),
        Utils.el('p', { class: 'card__subtitle' }, 'This information drives every calculated target across the app.'),
      ]),
      errorsHost,
      form,
    ]));
    container.appendChild(renderCalculationPreviewCard(targets, profile));
    container.appendChild(await renderProgramSettingsCard(userId));
    container.appendChild(renderTrackingSettingsCard(profile));
    container.appendChild(renderMealSplitCard(profile, container));

    UIFx.animateIn(container);
  }

  // -------------------------------------------------------------------
  // MEAL SPLIT — how the ONE daily target (calories/protein/carbs/fat/
  // fibre from Calculations.calculateAllTargets) is divided across meals
  // on the Nutrition page. This is the only input to DietEngine's
  // per-meal targets — editing it here is the one place that changes
  // "Lunch target: 620 kcal" anywhere in the app. Percentages are
  // auto-normalized to 100% on save so meal targets always add up to
  // exactly the full daily target, never more or less.
  // -------------------------------------------------------------------

  const MEAL_SPLIT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', pre_workout: 'Pre-workout', dinner: 'Dinner', snack: 'Snack', other: 'Other' };

  function renderMealSplitCard(profile, container) {
    const raw = profile.mealSplitPercent || DietEngine.MEAL_SPLIT_DEFAULT;
    const keys = DietEngine.MEAL_SPLIT_KEYS;
    const inputs = {};

    const grid = Utils.el('div', { class: 'form__grid' }, keys.map(k => {
      const id = `mealsplit-${k}`;
      const input = Utils.el('input', {
        class: 'form__input', id, type: 'number', min: 0, max: 100, step: 1,
        value: raw[k] ?? 0,
        onInput: updateSumLabel,
      });
      inputs[k] = input;
      return Utils.el('div', { class: 'form__field' }, [
        Utils.el('label', { class: 'form__label', for: id }, `${MEAL_SPLIT_LABELS[k]} (%)`),
        input,
      ]);
    }));

    const sumLabel = Utils.el('p', { class: 'card__footnote' }, '');
    function updateSumLabel() {
      const sum = keys.reduce((s, k) => s + (Number(inputs[k].value) || 0), 0);
      sumLabel.textContent = sum === 100
        ? 'Totals 100% — exact.'
        : `Totals ${sum}% — will be auto-normalized to 100% on save so meal targets always add up to your full daily target.`;
    }
    updateSumLabel();

    const saveBtn = Utils.el('button', {
      class: 'btn btn--primary', type: 'button',
      onClick: async () => {
        const patch = {};
        keys.forEach(k => { patch[k] = Math.max(0, Number(inputs[k].value) || 0); });
        await DataService.profiles.update(profile.profileId, { mealSplitPercent: patch });
        Utils.toast('Meal split saved.', 'success');
        await render(container);
      },
    }, 'Save Meal Split');

    const resetBtn = Utils.el('button', {
      class: 'btn btn--secondary', type: 'button',
      onClick: async () => {
        await DataService.profiles.update(profile.profileId, { mealSplitPercent: null });
        Utils.toast('Meal split reset to default.', 'success');
        await render(container);
      },
    }, 'Reset to Default');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Meal Split'),
          Utils.el('p', { class: 'card__subtitle' },
            'How your daily calorie/protein/carb/fat/fibre target is divided across meals on the Nutrition page — e.g. Lunch at 30% gets 30% of every target, not just calories.'),
        ]),
      ]),
      grid,
      sumLabel,
      Utils.el('div', { class: 'form__actions' }, [saveBtn, resetBtn]),
    ]);
  }

  // -------------------------------------------------------------------
  // CALCULATION PREVIEW — BMI/calories/protein/water/other targets,
  // recalculated live from Calculations.calculateAllTargets after every
  // save. This never computes anything itself — it only displays what
  // that one shared function already produces everywhere else in the app.
  // -------------------------------------------------------------------

  function renderCalculationPreviewCard(targets, profile) {
    if (!targets) {
      return Utils.el('section', { class: 'card', id: 'calculation-preview' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Calculated Targets')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }
    const rows = [
      ['BMI', targets.bmi != null ? `${targets.bmi}` : null],
      ['BMR', Utils.fmt(targets.bmr, ' kcal')],
      ['TDEE', Utils.fmt(targets.tdee, ' kcal')],
      ['Calorie target', Utils.fmt(targets.calorieTarget, ' kcal')],
      ['Protein target', Utils.fmt(targets.proteinTargetG, ' g')],
      ['Fat target', Utils.fmt(targets.fatTargetG, ' g')],
      ['Carb target', Utils.fmt(targets.carbTargetG, ' g')],
      ['Fibre target', Utils.fmt(targets.fibreTargetG, ' g')],
      ['Water target', Utils.fmt(targets.waterTargetMl, ' ml')],
      ['Step target', Utils.fmt(targets.stepTarget, '')],
    ];
    return Utils.el('section', { class: 'card', id: 'calculation-preview' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Calculated Targets'),
        Utils.el('p', { class: 'card__subtitle' }, 'Recalculated live from your profile — the exact same values used everywhere else in the app.'),
      ]),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v ?? 'No data entered')])),
    ]);
  }

  // -------------------------------------------------------------------
  // PROGRAM SETTINGS — 60-Day and 100-Day programs, each with its own
  // real status, current phase, start date, and progress. Mirrors the
  // Dashboard's Program Journey card's logic (same underlying
  // Calculations.getProgramDayCounters / getCurrentPhase, no new math).
  // -------------------------------------------------------------------

  const PROGRAM_STATUS_LABELS = { active: 'In Progress', paused: 'Paused', completed: 'Completed', draft: 'Not Started', future: 'Scheduled' };

  async function renderProgramSettingsCard(userId) {
    const programs = await DataService.programs.list(p => p.userId === userId);
    const sixtyDay = programs.find(p => p.programType === '60_day') || null;
    const hundredDay = programs.find(p => p.programType === BollywoodProgramData.PROGRAM_TYPE) || null;

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Program Settings'),
        Utils.el('p', { class: 'card__subtitle' }, 'Your real status in each program.' ),
      ]),
      await renderProgramSettingsRow(sixtyDay, '60-Day Program', '#/programs'),
      await renderProgramSettingsRow(hundredDay, '100-Day Program', '#/program-bollywood'),
    ]);
  }

  async function renderProgramSettingsRow(program, label, href) {
    if (!program) {
      return Utils.el('div', { class: 'journey-row' }, [
        Utils.el('div', { class: 'journey-row__main' }, [
          Utils.el('div', { class: 'journey-row__name' }, label),
          Utils.el('div', { class: 'journey-row__meta' }, 'Not started'),
        ]),
        Utils.el('a', { class: 'btn btn--secondary btn--row', href: '#/programs' }, 'Start'),
      ]);
    }
    const counters = Calculations.getProgramDayCounters(program);
    const phases = await DataService.programPhases.list(ph => ph.programId === program.programId);
    const currentPhase = phases.length ? Calculations.getCurrentPhase(phases) : null;
    const statusLabel = PROGRAM_STATUS_LABELS[program.status] || program.status;
    const pct = counters?.totalDays ? Math.round((counters.day / counters.totalDays) * 100) : null;

    return Utils.el('div', { class: 'journey-row' }, [
      Utils.el('div', { class: 'journey-row__main' }, [
        Utils.el('div', { class: 'journey-row__name' }, [
          program.name || label,
          Utils.el('span', { class: `badge journey-row__badge journey-row__badge--${program.status}` }, statusLabel),
        ]),
        Utils.el('div', { class: 'journey-row__meta' }, [
          counters ? `Day ${counters.day} of ${counters.totalDays}` : 'No data entered',
          currentPhase ? ` \u00b7 ${currentPhase.name}` : '',
          program.startDate ? ` \u00b7 Started ${Utils.formatDate(program.startDate)}` : '',
          pct != null ? ` \u00b7 ${pct}% complete` : '',
        ].join('')),
      ]),
      Utils.el('a', { class: 'btn btn--secondary btn--row', href }, 'View'),
    ]);
  }

  // -------------------------------------------------------------------
  // TRACKING SETTINGS — links to the real, already-existing preference
  // controls elsewhere in the app (never a second copy of the same
  // setting). No units/notifications system exists in this app yet, so
  // none is fabricated here — only what's genuinely there is surfaced.
  // -------------------------------------------------------------------

  function renderTrackingSettingsCard(profile) {
    const rows = [
      ['Sidebar order', 'Drag to reorder in the sidebar, or reset it', '#/settings'],
      ['Sexual Wellbeing on Dashboard', profile?.wellbeingDashboardVisible ? 'Shown (you turned this on)' : 'Hidden (private by default)', '#/wellbeing'],
      ['Meal split across the day', 'Set below \u2014 how your daily targets divide across meals', '#profile-form-card'],
    ];
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Tracking Settings'),
        Utils.el('p', { class: 'card__subtitle' }, 'Your existing tracking preferences, in one place.'),
      ]),
      Utils.el('div', { class: 'entry-list' }, rows.map(([label, val, href]) => Utils.el('a', { class: 'journey-row', href, style: 'text-decoration:none;color:inherit;' }, [
        Utils.el('div', { class: 'journey-row__main' }, [
          Utils.el('div', { class: 'journey-row__name' }, label),
          Utils.el('div', { class: 'journey-row__meta' }, val),
        ]),
      ]))),
    ]);
  }

  function renderProfileHero(profile, activeProgram, currentPhase) {
    const allFields = FIELD_GROUPS.flatMap(g => g.fields);
    const filled = allFields.filter(f => {
      const v = profile[f.key];
      return v !== null && v !== undefined && v !== '';
    }).length;
    const pct = allFields.length ? Math.round((filled / allFields.length) * 100) : 0;
    const counters = activeProgram ? Calculations.getProgramDayCounters(activeProgram) : null;

    const hero = UIFx.hero({
      theme: 'transformation',
      icon: '\uD83D\uDC64',
      eyebrow: 'Profile',
      title: profile?.name ? `${profile.name}\u2019s Profile` : 'Your Profile',
      subtitle: `${filled} of ${allFields.length} fields completed. A fuller profile means more accurate calculated targets.`,
      stats: [],
      ring: { pct, number: `${pct}%`, of: 'complete' },
    });

    const statPairs = [
      ['Name', profile?.name || 'No data entered'],
      ['Age', Utils.fmt(profile?.age, '') || 'No data entered'],
      ['Height', Utils.fmt(profile?.heightCm, ' cm') || 'No data entered'],
      ['Weight', Utils.fmt(profile?.currentWeightKg, ' kg') || 'No data entered'],
      ['Goal', profile?.primaryGoal || (profile?.goalType ? profile.goalType.replace(/_/g, ' ') : 'No data entered')],
      ['Current program', activeProgram?.name || 'No data entered'],
      ['Current day', counters ? `Day ${counters.day} of ${counters.totalDays}${currentPhase ? ` \u00b7 ${currentPhase.name}` : ''}` : 'No data entered'],
    ];
    const inner = hero.querySelector('.hero__inner');
    inner.appendChild(Utils.el('div', { class: 'hero__stats', style: 'flex-wrap:wrap;row-gap:12px;' },
      statPairs.map(([label, val]) => Utils.el('div', { class: 'hero__stat' }, [
        Utils.el('div', { class: 'hero__stat-value' }, val),
        Utils.el('div', { class: 'hero__stat-label' }, label),
      ]))));

    hero.appendChild(Utils.el('div', { class: 'row-actions', style: 'position:relative;z-index:1;margin-top:16px;' }, [
      Utils.el('a', {
        class: 'btn btn--primary', href: '#profile-form-card',
        onClick: (e) => {
          const target = document.getElementById('profile-form-card');
          if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        },
      }, 'EDIT PROFILE'),
    ]));

    return hero;
  }

  function renderField(field, value) {
    const id = `field-${field.key}`;
    const label = Utils.el('label', { class: 'form__label', for: id },
      field.required ? [field.label, Utils.el('span', { class: 'form__required', 'aria-hidden': 'true', title: 'Required' }, ' *')] : field.label);
    // For a brand-new profile with nothing chosen yet, pre-select a sane
    // default in the UI only — nothing is written to storage until the
    // person actually saves the form (see IMPORTANT: default program is
    // the 60-Day Transformation, but nothing forces it).
    const effectiveValue = (value === null || value === undefined || value === '') && field.defaultValue ? field.defaultValue : value;
    let input;
    if (field.type === 'select') {
      input = Utils.el('select', { class: 'form__input', id, name: field.key, required: field.required || undefined }, [
        Utils.el('option', { value: '' }, '— Select —'),
        ...field.options.map(opt => {
          const o = Utils.el('option', { value: opt }, opt.replace(/_/g, ' '));
          if (effectiveValue === opt) o.setAttribute('selected', 'selected');
          return o;
        }),
      ]);
    } else {
      input = Utils.el('input', {
        class: 'form__input', id, name: field.key, type: field.type,
        min: field.min, max: field.max, step: field.step,
        value: effectiveValue ?? '',
        required: field.required || undefined,
        placeholder: field.placeholder || undefined,
      });
    }
    return Utils.el('div', { class: `form__field${field.required ? ' form__field--required' : ''}` }, [label, input]);
  }

  async function handleSave(form, profile, errorsHost, container) {
    const formData = new FormData(form);
    const patch = {};
    const errors = [];

    FIELD_GROUPS.flatMap(g => g.fields).forEach(field => {
      let raw = formData.get(field.key);
      if (field.required) {
        const reqErr = Utils.Validate.required(raw, field.label);
        if (reqErr) errors.push(reqErr);
      }
      if (field.type === 'number') {
        const err = Utils.Validate.range(raw, field.min, field.max, field.label);
        if (err) errors.push(err);
        patch[field.key] = raw === '' ? null : Number(raw);
      } else if (field.type === 'date') {
        const err = Utils.Validate.dateNotFuture(raw, field.label);
        if (err) errors.push(err);
        patch[field.key] = raw || null;
      } else {
        patch[field.key] = raw || '';
      }
    });

    if (patch.currentWeightKg && patch.targetWeightKg && patch.heightCm) {
      // sanity check: target weight within a plausible human range relative to height is
      // already covered by field min/max; nothing further required here.
    }

    errorsHost.innerHTML = '';
    if (errors.length) {
      errorsHost.appendChild(Utils.el('ul', { class: 'error-list' },
        errors.map(msg => Utils.el('li', {}, msg))));
      Utils.toast('Please fix the highlighted errors.', 'error');
      return;
    }

    const updatedProfile = await DataService.profiles.update(profile.profileId, patch);

    // Keep the mobile-number-to-email sign-in lookup in sync with whatever
    // was just saved. Deliberately re-attempts the link on every save, even
    // if the number itself didn't change — this makes it self-healing: if
    // the one-time Supabase SQL setup (supabase-setup-phone-lookup.sql)
    // hadn't been run yet the first time someone saved their number, that
    // link silently failed, and without this it would stay silently
    // missing forever. Best-effort either way: doesn't block the save or
    // show its own errors, since email+password sign-in works regardless.
    const newMobile = Utils.normalizeMobile(patch.mobileNumber);
    const oldMobile = Utils.normalizeMobile(profile.mobileNumber);
    if (newMobile) {
      AuthService.linkMobileNumber(newMobile);
      if (oldMobile && oldMobile !== newMobile) AuthService.unlinkMobileNumber(oldMobile);
    } else if (oldMobile) {
      AuthService.unlinkMobileNumber(oldMobile);
    }

    const indicator = document.getElementById('saved-indicator');
    if (indicator) {
      indicator.textContent = 'Saved just now';
      setTimeout(() => { if (indicator) indicator.textContent = ''; }, 2500);
    }

    // Recalculate targets off the fresh profile and log any change to target history.
    const program = (await DataService.programs.list(p => p.userId === profile.userId && p.status === 'active'))[0] || null;
    const phases = program ? await DataService.programPhases.list(ph => ph.programId === program.programId) : [];
    const phase = phases.length ? Calculations.getCurrentPhase(phases) : null;
    const weightEntries = await DataService.weightEntries.list(w => w.userId === profile.userId);
    const targets = Calculations.calculateAllTargets(updatedProfile, { weightEntries, program, phase });
    await Calculations.recordTargetChangesIfNeeded(profile.userId, targets, 'profile_update');

    // If this save just finished onboarding (profile went from incomplete
    // to complete), move straight into the app instead of leaving the
    // person parked on the profile form.
    const justCompletedOnboarding = !isComplete(profile) && isComplete(updatedProfile);
    if (justCompletedOnboarding) {
      Utils.toast('Profile complete — welcome aboard!', 'success');
      Router.navigate('dashboard');
      return;
    }

    Utils.toast('Profile saved.', 'success');

    // Saving must update every connected calculation/display immediately —
    // re-render in place rather than leaving the old preview/hero stale.
    if (container) { container.innerHTML = ''; await render(container); }
  }

  return { render, isComplete };
})();
