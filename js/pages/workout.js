/**
 * pages/workout.js — the Workout module. Uses the existing user/program
 * system (DataService.workouts/workoutExercises/workoutSets, plus the new
 * workoutTemplates collection for the editable weekly split) and the new
 * WorkoutEngine for all previous/best-performance and progression logic —
 * nothing here computes that math itself.
 */

const PageWorkout = (() => {

  const DAYS = [
    { key: 'monday', label: 'Monday' }, { key: 'tuesday', label: 'Tuesday' }, { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' }, { key: 'friday', label: 'Friday' }, { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' },
  ];
  const DIFFICULTY_OPTIONS = [
    { value: '', label: '— Difficulty —' }, { value: 'easy', label: 'Easy' }, { value: 'moderate', label: 'Moderate' },
    { value: 'hard', label: 'Hard' }, { value: 'very_hard', label: 'Very hard' },
  ];
  const FORM_OPTIONS = [
    { value: '', label: '— Form —' }, { value: 'good', label: 'Good' },
    { value: 'minor_breakdown', label: 'Minor breakdown' }, { value: 'poor', label: 'Poor' },
  ];

  let selectedDate = Models.todayIso();
  let templateView = 'list';       // 'list' | 'builder'
  let editingTemplateId = null;
  let templateBuilder = null;
  let addExercisePanelOpenForWorkout = false;
  let newExercise = blankNewExercise();
  let historyExerciseName = '';
  let expandedCompletedWorkoutId = null; // a completed workout collapses by default; this un-collapses one for review

  function blankNewExercise() {
    return {
      groupKey: '', locationKey: 'any', exerciseName: '', customName: '', isCardio: false, exerciseType: 'compound',
      targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRIR: 2, restSeconds: 90,
      cardioDurationMinutes: '', cardioSpeed: '', cardioIncline: '', cardioDistance: '',
    };
  }

  /** The small circular (?) button that opens the floating video panel for
   *  a given exercise name — used next to the picker's selected exercise,
   *  and next to every exercise already added to a workout. */
  function videoHelpButton(exerciseName) {
    return Utils.el('button', {
      class: 'video-help-btn', type: 'button', title: `Watch ${exerciseName} demo`,
      onClick: (e) => { e.preventDefault(); VideoModal.open(exerciseName); },
    }, '?');
  }

  function blankTemplateBuilder() {
    return { name: '', dayOfWeek: '', category: '', isFavorite: false, exercises: [] };
  }

  async function render(container) {
    await renderInner(container);
    // Plays once per real navigation to this page (not on the internal
    // re-renders triggered by logging a set, switching days, etc., since
    // those call renderInner directly) — the "opening the workout app"
    // moment, dumbbells tumbling in like a splash screen.
    UIFx.weightSplash(container);
  }

  async function renderInner(container) {
    container.innerHTML = '';
    container.classList.add('page--workout');

    let userId = DataService.getCurrentUserId();
    if (!userId) {
      const user = await DataService.users.create(Models.createUser({ name: 'New User' }));
      userId = user.userId;
      DataService.setCurrentUserId(userId);
    }

    // Arriving via a program's own "Start This Workout" button uses
    // #/workout?program=<id> — see pages/program-bollywood.js. That scopes
    // this whole page to ONLY that program's current-phase schedule, so the
    // 60-Day split, other phases, and other programs' workouts don't show
    // up in the middle of a program someone is actively following. Plain
    // #/workout (the sidebar link) never carries this param, so direct
    // access always shows everything, unscoped, exactly as before.
    const scopeProgramId = (typeof Router !== 'undefined' && Router.currentQuery) ? (Router.currentQuery().program || null) : null;
    const scopeProgram = scopeProgramId ? (await DataService.programs.list(p => p.userId === userId && p.programId === scopeProgramId))[0] || null : null;

    if (scopeProgram) {
      await renderScopedInner(container, userId, scopeProgram);
      return;
    }

    const activeProgram = (await DataService.programs.list(p => p.userId === userId && p.status === 'active'))[0] || null;
    const allTemplates = await DataService.workoutTemplates.list(t => t.userId === userId);
    // Program-specific templates (programId set) only show while that program is active;
    // unscoped templates (programId null — e.g. the 60-Day program's own split) always show.
    const templates = allTemplates.filter(t => !t.programId || t.programId === activeProgram?.programId);
    const workouts = await DataService.workouts.list(w => w.userId === userId);
    const workoutIds = new Set(workouts.map(w => w.workoutId));
    const workoutExercises = await DataService.workoutExercises.list(ex => workoutIds.has(ex.workoutId));
    const exerciseIds = new Set(workoutExercises.map(e => e.workoutExerciseId));
    const workoutSets = await DataService.workoutSets.list(s => exerciseIds.has(s.workoutExerciseId));

    const data = { userId, templates, workouts, workoutExercises, workoutSets };

    if (templateView === 'builder') {
      container.appendChild(renderTemplateBuilderCard(data, container));
      return;
    }

    container.appendChild(renderWorkoutHero(data));
    container.appendChild(renderWeeklySplitCard(data, container));
    container.appendChild(renderTodayWorkoutCard(data, container));
    container.appendChild(renderHistoryCard(data, container));

    UIFx.animateIn(container);
  }

  // =====================================================================
  // HERO — today's set-completion gauge, plus the last 7 days as a bar
  // chart so a whole week of training effort is visible at a glance.
  // =====================================================================

  function renderWorkoutHero(data) {
    const { workouts, workoutExercises, workoutSets } = data;
    const today = Models.todayIso();
    const pct = WorkoutEngine.computeDailyWorkoutCompletion(today, workouts, workoutExercises, workoutSets) ?? 0;
    const streak = WorkoutEngine.computeWorkoutStreak(workouts, today);

    const days = [];
    for (let i = 6; i >= 0; i--) days.push(ProgramTemplates.addDays(today, -i));
    const barPoints = days.map(d => ({ x: d, y: WorkoutEngine.computeDailyWorkoutCompletion(d, workouts, workoutExercises, workoutSets) ?? 0 }));
    const barSvg = ChartUtils.buildBarChartSVG(barPoints, { width: 320, height: 110, color: 'var(--ember)' });

    const hero = UIFx.hero({
      theme: 'training',
      icon: '\uD83D\uDCAA',
      eyebrow: 'Training',
      title: 'Workout',
      subtitle: workouts.some(w => w.date === today)
        ? `${pct}% of today\u2019s sets completed.`
        : 'No workout logged yet today.',
      stats: [],
    });
    hero.classList.add('card--hero--compact', 'card--accent-workout');
    const row = Utils.el('div', { class: 'hero__stats', style: 'flex:1 1 auto;align-items:center;gap:24px;' }, [
      UIFx.arcGauge({ pct, number: `${pct}%`, sublabel: 'today', colorFrom: 'var(--ember-tint)', colorTo: 'var(--ember)' }),
    ]);
    if (streak >= 2) {
      row.appendChild(Utils.el('div', { class: 'streak-chip' }, [
        Utils.el('span', { class: 'streak-chip__flame' }, '\uD83D\uDD25'),
        `${streak}-day streak`,
      ]));
    }
    if (barSvg) {
      const chartWrap = Utils.el('div', { style: 'flex:1 1 220px;min-width:200px;' });
      chartWrap.innerHTML = `<div class="hero__ring-of" style="margin-bottom:4px;">Last 7 days — set completion</div>${barSvg}`;
      row.appendChild(chartWrap);
    }
    hero.querySelector('.hero__inner').appendChild(row);
    return hero;
  }

  /**
   * The program-scoped view: only the current phase's scheduled workout
   * type(s) and only this program's own logged history — nothing from
   * other programs or unscoped templates leaks in here.
   */
  async function renderScopedInner(container, userId, program) {
    const phases = (await DataService.programPhases.list(p => p.programId === program.programId)).sort((a, b) => a.order - b.order);
    const counters = Calculations.getProgramDayCounters(program);
    const currentDay = counters ? counters.day : 0;
    const currentPhase = currentDay > 0 ? phases.find(p => currentDay >= p.startDay && currentDay <= p.endDay) : null;

    const allTemplates = await DataService.workoutTemplates.list(t => t.programId === program.programId);
    const templates = currentPhase ? allTemplates.filter(t => t.phaseId === currentPhase.phaseId) : [];

    const workouts = await DataService.workouts.list(w => w.userId === userId && w.programId === program.programId);
    const workoutIds = new Set(workouts.map(w => w.workoutId));
    const workoutExercises = await DataService.workoutExercises.list(ex => workoutIds.has(ex.workoutId));
    const exerciseIds = new Set(workoutExercises.map(e => e.workoutExerciseId));
    const workoutSets = await DataService.workoutSets.list(s => exerciseIds.has(s.workoutExerciseId));

    const data = { userId, templates, workouts, workoutExercises, workoutSets };

    if (templateView === 'builder') {
      container.appendChild(renderTemplateBuilderCard(data, container));
      return;
    }

    container.appendChild(renderWorkoutHero(data));
    container.appendChild(renderScopeBannerCard(program, currentPhase, currentDay));
    container.appendChild(renderWeeklySplitCard(data, container, { scoped: true, phase: currentPhase }));
    container.appendChild(renderTodayWorkoutCard(data, container));
    container.appendChild(renderHistoryCard(data, container));

    UIFx.animateIn(container);
  }

  function renderScopeBannerCard(program, currentPhase, currentDay) {
    const dayInPhase = currentPhase ? currentDay - currentPhase.startDay + 1 : null;
    return Utils.el('section', { class: 'card', style: 'background:var(--surface-alt);' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;margin:0 0 2px;' }, 'Program view \u2014 scoped to:'),
          Utils.el('h2', { class: 'card__title', style: 'font-size:16px;' },
            currentPhase ? `${program.name} \u2014 ${currentPhase.name}, Day ${dayInPhase}` : program.name),
        ]),
        Utils.el('a', { class: 'btn btn--secondary btn--row', href: '#/workout' }, 'Exit Program View \u2192'),
      ]),
    ]);
  }

  // =====================================================================
  // WEEKLY SPLIT (Creator Workout + custom templates)
  // =====================================================================

  function renderWeeklySplitCard(data, container, opts = {}) {
    const { templates } = data;
    const scoped = !!opts.scoped;

    if (scoped) {
      // Program-scoped: just this phase's workout day(s), flat — no day-of-week
      // grouping (these templates follow the phase's own cycle, not a fixed
      // weekday) and no "+ New Custom Workout" (keep this view focused on the
      // program's own schedule, not general template management).
      const rows = templates.length
        ? templates.map(t => renderTemplateRow(t, data, container))
        : [Utils.el('p', { class: 'card__footnote' }, 'No data entered')];
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, [
          Utils.el('div', {}, [
            Utils.el('h2', { class: 'card__title' }, opts.phase ? `${opts.phase.name} \u2014 Workout Schedule` : 'Program Workout Schedule'),
            Utils.el('p', { class: 'card__subtitle' }, 'Only this phase\u2019s scheduled workout(s) \u2014 see Exit Program View above for everything else.'),
          ]),
        ]),
        Utils.el('div', { class: 'entry-list' }, rows),
      ]);
    }

    const newBtn = Utils.el('button', {
      class: 'btn btn--primary', type: 'button',
      onClick: () => { templateBuilder = blankTemplateBuilder(); editingTemplateId = null; templateView = 'builder'; renderInner(container); },
    }, '+ New Custom Workout');

    const dayRows = DAYS.map(day => {
      const dayTemplates = templates.filter(t => t.dayOfWeek === day.key);
      return Utils.el('div', { class: 'meal-group' }, [
        Utils.el('h3', { class: 'meal-group__title' }, day.label),
        dayTemplates.length
          ? Utils.el('div', {}, dayTemplates.map(t => renderTemplateRow(t, data, container)))
          : Utils.el('p', { class: 'card__footnote' }, 'No workout planned.'),
      ]);
    });

    const unassigned = templates.filter(t => !t.dayOfWeek);
    if (unassigned.length) {
      dayRows.push(Utils.el('div', { class: 'meal-group' }, [
        Utils.el('h3', { class: 'meal-group__title' }, 'Custom (unassigned)'),
        ...unassigned.map(t => renderTemplateRow(t, data, container)),
      ]));
    }

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Weekly Split'),
          Utils.el('p', { class: 'card__subtitle' }, "The creator's initial split — fully editable."),
        ]),
        newBtn,
      ]),
      Utils.el('div', { class: 'entry-list' }, dayRows),
    ]);
  }

  function renderTemplateRow(template, data, container) {
    const preview = template.exercises.map(e => `${e.exerciseName} (${e.isCardio ? `${e.targetDurationMinutes ?? '—'} min` : `${e.targetSets ?? '—'}×${e.targetRepsMin ?? '—'}-${e.targetRepsMax ?? '—'}`})`).join(' · ');

    const alreadyStarted = data.workouts.some(w => w.date === selectedDate && w.templateId === template.workoutTemplateId);
    const startBtn = Utils.el('button', {
      class: `btn btn--primary btn--row${alreadyStarted ? ' btn--disabled' : ''}`, type: 'button',
      title: alreadyStarted ? 'Already started for the selected date.' : '',
      onClick: () => { if (!alreadyStarted) startWorkoutFromTemplate(template, data, container); },
    }, alreadyStarted ? 'Started' : 'Start Workout');

    const editBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => {
        templateBuilder = {
          name: template.name, dayOfWeek: template.dayOfWeek, category: template.category, isFavorite: template.isFavorite,
          exercises: template.exercises.map(e => ({ ...e })),
        };
        editingTemplateId = template.workoutTemplateId;
        templateView = 'builder';
        renderInner(container);
      },
    }, 'Edit');

    const duplicateBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        await DataService.workoutTemplates.create(Models.createWorkoutTemplate(data.userId, {
          name: `${template.name} (Copy)`, dayOfWeek: template.dayOfWeek, category: template.category,
          exercises: template.exercises.map(e => Models.createWorkoutTemplateExercise({ ...e, itemId: undefined })),
        }));
        Utils.toast('Workout template duplicated.', 'success');
        await renderInner(container);
      },
    }, 'Duplicate');

    const deleteBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => {
        if (!window.confirm(`Delete "${template.name}"? This cannot be undone.`)) return;
        await DataService.workoutTemplates.delete(template.workoutTemplateId);
        Utils.toast('Workout template deleted.', 'success');
        await renderInner(container);
      },
    }, 'Delete');

    return Utils.el('div', { class: 'entry-row' }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__title-line' }, [
          Utils.el('span', { class: 'entry-row__name' }, template.category || template.name),
          Utils.el('span', { class: 'badge' }, `${template.exercises.length} exercise${template.exercises.length === 1 ? '' : 's'}`),
        ]),
        Utils.el('div', { class: 'entry-row__meta' }, preview || 'No exercises yet.'),
      ]),
      Utils.el('div', { class: 'row-actions' }, [startBtn, editBtn, duplicateBtn, deleteBtn]),
    ]);
  }

  /** Launches the immersive Workout Mode overlay (workout-session.js) for
   *  a given logged workout — the live tracker for an in-progress session,
   *  or a read-only completion/detail view for one already finished. */
  function openWorkoutMode(workoutId, data, container) {
    WorkoutSession.open(data.userId, workoutId, data, () => renderInner(container));
  }

  async function startWorkoutFromTemplate(template, data, container) {
    // Shared with pages/program-bollywood.js's "Start This Workout" — see
    // workout-actions.js — so a workout started from either page is identical.
    await WorkoutActions.startWorkoutFromTemplate(data.userId, selectedDate, template);
    Utils.toast(`"${template.name}" started for ${Utils.formatDate(selectedDate)}.`, 'success');
    await renderInner(container);
  }

  // =====================================================================
  // TEMPLATE BUILDER (Add/Edit/Delete/Duplicate exercises within a plan)
  // =====================================================================

  function renderTemplateBuilderCard(data, container) {
    const refresh = () => {
      const card = renderTemplateBuilderCard(data, container);
      const old = document.getElementById('workout-template-builder');
      if (old) old.replaceWith(card);
    };

    const form = Utils.el('form', { class: 'form', id: 'workout-template-form' });
    const errorsHost = Utils.el('div', { class: 'form__errors' });

    form.appendChild(Utils.el('div', { class: 'form__grid' }, [
      textField('Workout name', templateBuilder.name, v => { templateBuilder.name = v; }),
      textField('Category (e.g. "Chest + Triceps")', templateBuilder.category, v => { templateBuilder.category = v; }),
      selectField('Day of week', templateBuilder.dayOfWeek,
        [{ value: '', label: 'Unassigned / custom' }, ...DAYS.map(d => ({ value: d.key, label: d.label }))],
        v => { templateBuilder.dayOfWeek = v; }),
    ]));

    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, `Exercises (${templateBuilder.exercises.length})`));
    if (templateBuilder.exercises.length) {
      form.appendChild(Utils.el('div', { class: 'item-list' }, templateBuilder.exercises.map((ex, idx) => Utils.el('div', { class: 'entry-row' }, [
        Utils.el('div', { class: 'entry-row__main' }, [
          Utils.el('div', { style: 'display:flex;align-items:center;gap:6px;' }, [
            Utils.el('div', { class: 'entry-row__name' }, ex.exerciseName),
            videoHelpButton(ex.exerciseName),
          ]),
          Utils.el('div', { class: 'entry-row__meta' }, ex.isCardio ? `Target ${ex.targetDurationMinutes ?? '—'} min` : `${ex.targetSets ?? '—'} sets × ${ex.targetRepsMin ?? '—'}-${ex.targetRepsMax ?? '—'} reps, RIR ${ex.targetRIR ?? '—'}, rest ${ex.restSeconds ?? '—'}s`),
        ]),
        Utils.el('div', { class: 'row-actions' }, [
          Utils.el('button', { class: 'btn btn--danger btn--row', type: 'button', onClick: () => { templateBuilder.exercises.splice(idx, 1); refresh(); } }, 'Remove'),
        ]),
      ]))));
    } else {
      form.appendChild(Utils.el('p', { class: 'card__footnote' }, 'No exercises added yet.'));
    }

    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, 'Add an exercise'));
    form.appendChild(renderExercisePicker(refresh, (built) => { templateBuilder.exercises.push(built); refresh(); }));

    const actions = Utils.el('div', { class: 'form__actions' }, [
      Utils.el('button', { class: 'btn btn--primary', type: 'submit' }, editingTemplateId ? 'Save changes' : 'Save workout'),
      Utils.el('button', { class: 'btn btn--secondary', type: 'button', onClick: () => { templateView = 'list'; templateBuilder = null; editingTemplateId = null; renderInner(container); } }, 'Cancel'),
    ]);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errors = [];
      if (!templateBuilder.name.trim()) errors.push('Workout name is required.');
      if (!templateBuilder.exercises.length) errors.push('Add at least one exercise.');
      errorsHost.innerHTML = '';
      if (errors.length) {
        errorsHost.appendChild(Utils.el('ul', { class: 'error-list' }, errors.map(m => Utils.el('li', {}, m))));
        Utils.toast('Please fix the highlighted errors.', 'error');
        return;
      }
      const patch = { name: templateBuilder.name.trim(), category: templateBuilder.category.trim(), dayOfWeek: templateBuilder.dayOfWeek, isFavorite: templateBuilder.isFavorite, exercises: templateBuilder.exercises };
      if (editingTemplateId) { await DataService.workoutTemplates.update(editingTemplateId, patch); Utils.toast('Workout template updated.', 'success'); }
      else { await DataService.workoutTemplates.create(Models.createWorkoutTemplate(data.userId, patch)); Utils.toast('Workout template saved.', 'success'); }
      templateView = 'list'; templateBuilder = null; editingTemplateId = null;
      await renderInner(container);
    });

    return Utils.el('section', { class: 'card card--form', id: 'workout-template-builder' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, editingTemplateId ? 'Edit Workout' : 'New Custom Workout')),
      errorsHost, form,
    ]);
  }

  /** Shared exercise picker: muscle group -> exercise (or custom name) +
   *  target sets/reps/RIR/rest, or cardio targets. Used by the template
   *  builder AND when adding an exercise to today's live session. */
  function renderExercisePicker(refresh, onAdd) {
    const ne = newExercise;
    const wrap = Utils.el('div', {}, []);

    wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
      selectField('Muscle group', ne.groupKey,
        [{ value: '', label: '— Select —' }, ...ExerciseLibrary.MUSCLE_GROUPS.map(g => ({ value: g.key, label: g.label })), { value: 'custom', label: 'Custom exercise' }],
        v => { ne.groupKey = v; ne.exerciseName = ''; ne.isCardio = v === 'cardio'; ne.exerciseType = v === 'cardio' ? 'cardio' : ne.exerciseType; refresh(); }),
      ne.groupKey && ne.groupKey !== 'custom'
        ? selectField('Where', ne.locationKey,
            [{ value: 'any', label: 'Any' }, ...ExerciseLibrary.LOCATIONS.map(l => ({ value: l.key, label: l.label }))],
            v => { ne.locationKey = v; ne.exerciseName = ''; refresh(); })
        : null,
    ].filter(Boolean)));

    if (ne.groupKey === 'custom') {
      wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
        textField('Exercise name', ne.customName, v => { ne.customName = v; ne.exerciseName = v; }),
        selectField('Type', ne.exerciseType, [{ value: 'compound', label: 'Compound' }, { value: 'isolation', label: 'Isolation' }, { value: 'cardio', label: 'Cardio' }],
          v => { ne.exerciseType = v; ne.isCardio = v === 'cardio'; refresh(); }),
      ]));
    } else if (ne.groupKey) {
      const options = ExerciseLibrary.filterByLocation(ne.groupKey, ne.locationKey);
      const exerciseSelectRow = Utils.el('div', { class: 'form__grid' }, [
        selectField('Exercise', ne.exerciseName, [{ value: '', label: '— Select —' }, ...options.map(e => ({ value: e.name, label: e.name }))],
          v => { ne.exerciseName = v; const found = options.find(e => e.name === v); if (found) { ne.exerciseType = found.type; ne.isCardio = !!found.isCardio; } refresh(); }),
      ]);
      wrap.appendChild(exerciseSelectRow);
      if (ne.exerciseName) {
        exerciseSelectRow.appendChild(Utils.el('div', { style: 'align-self:flex-end;padding-bottom:9px;' }, videoHelpButton(ne.exerciseName)));
      }
      if (!options.length) {
        wrap.appendChild(Utils.el('p', { class: 'card__footnote' }, 'No exercises for this muscle group at that location yet — try "Any", or add it as a custom exercise.'));
      }
    }

    if (ne.isCardio) {
      wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
        numField('Target duration (min)', ne.cardioDurationMinutes, v => { ne.cardioDurationMinutes = v; }),
        numField('Target speed (km/h)', ne.cardioSpeed, v => { ne.cardioSpeed = v; }),
        numField('Target incline (%)', ne.cardioIncline, v => { ne.cardioIncline = v; }),
        numField('Target distance (km)', ne.cardioDistance, v => { ne.cardioDistance = v; }),
      ]));
    } else {
      wrap.appendChild(Utils.el('div', { class: 'form__grid' }, [
        numField('Sets', ne.targetSets, v => { ne.targetSets = v; }),
        numField('Reps min', ne.targetRepsMin, v => { ne.targetRepsMin = v; }),
        numField('Reps max', ne.targetRepsMax, v => { ne.targetRepsMax = v; }),
        numField('Target RIR', ne.targetRIR, v => { ne.targetRIR = v; }),
        numField('Rest (sec)', ne.restSeconds, v => { ne.restSeconds = v; }),
      ]));
    }

    wrap.appendChild(Utils.el('button', {
      class: 'btn btn--secondary', type: 'button',
      onClick: () => {
        if (!ne.exerciseName.trim()) { Utils.toast('Choose or name an exercise.', 'error'); return; }
        const built = Models.createWorkoutTemplateExercise({
          exerciseName: ne.exerciseName.trim(),
          muscleGroup: ne.groupKey === 'custom' ? '' : ne.groupKey,
          exerciseType: ne.exerciseType, isCardio: ne.isCardio,
          targetSets: ne.isCardio ? null : numOrNull(ne.targetSets),
          targetRepsMin: ne.isCardio ? null : numOrNull(ne.targetRepsMin),
          targetRepsMax: ne.isCardio ? null : numOrNull(ne.targetRepsMax),
          targetRIR: ne.isCardio ? null : numOrNull(ne.targetRIR),
          restSeconds: ne.isCardio ? null : numOrNull(ne.restSeconds),
          targetDurationMinutes: ne.isCardio ? numOrNull(ne.cardioDurationMinutes) : null,
          targetSpeed: ne.isCardio ? numOrNull(ne.cardioSpeed) : null,
          targetIncline: ne.isCardio ? numOrNull(ne.cardioIncline) : null,
          targetDistance: ne.isCardio ? numOrNull(ne.cardioDistance) : null,
        });
        newExercise = blankNewExercise();
        onAdd(built);
      },
    }, '+ Add Exercise'));

    return wrap;
  }

  // =====================================================================
  // TODAY'S WORKOUT — live tracking
  // =====================================================================

  function renderTodayWorkoutCard(data, container) {
    const todayWorkout = data.workouts.find(w => w.date === selectedDate) || null;

    const dateBar = Utils.el('div', { class: 'row-actions' }, [
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, -1); renderInner(container); } }, '← Prev day'),
      Utils.el('input', { class: 'form__input', type: 'date', value: selectedDate, onChange: (e) => { if (e.target.value) { selectedDate = e.target.value; renderInner(container); } } }),
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, 1); renderInner(container); } }, 'Next day →'),
    ]);

    if (!todayWorkout) {
      return Utils.el('section', { class: 'card', id: 'today-workout-card' }, [
        Utils.el('div', { class: 'card__header' }, [
          Utils.el('div', {}, [Utils.el('h2', { class: 'card__title' }, "Today's Workout"), Utils.el('p', { class: 'card__subtitle' }, Utils.formatDate(selectedDate))]),
          dateBar,
        ]),
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'No workout logged for this date yet.'),
          Utils.el('p', { class: 'card__footnote' }, 'Start one from the Weekly Split above, or add a blank custom workout below.'),
          Utils.el('button', {
            class: 'btn btn--secondary', type: 'button',
            onClick: async () => {
              await DataService.workouts.create(Models.createWorkout(data.userId, { date: selectedDate, name: 'Custom Workout', status: 'in_progress' }));
              await renderInner(container);
            },
          }, '+ Start Blank Workout'),
        ]),
      ]);
    }

    const exercises = data.workoutExercises.filter(e => e.workoutId === todayWorkout.workoutId).sort((a, b) => a.order - b.order);

    const workoutModeBtn = exercises.length ? Utils.el('button', {
      class: 'btn btn--primary btn--row', type: 'button',
      onClick: () => openWorkoutMode(todayWorkout.workoutId, data, container),
    }, todayWorkout.status === 'completed' ? '\u25b6 View Workout' : '\u25b6 Enter Workout Mode') : null;

    const finishBtn = Utils.el('button', {
      class: 'btn btn--primary btn--row', type: 'button',
      onClick: async () => {
        const nowCompleted = todayWorkout.status !== 'completed';
        await DataService.workouts.update(todayWorkout.workoutId, { status: nowCompleted ? 'completed' : 'in_progress' });
        // Finishing collapses the card into a summary; reopening always shows the full log.
        expandedCompletedWorkoutId = nowCompleted ? null : todayWorkout.workoutId;
        Utils.toast(nowCompleted ? 'Workout finished — logged for today.' : 'Workout reopened.', 'success');
        await renderInner(container);
      },
    }, todayWorkout.status === 'completed' ? 'Reopen' : 'Finish Workout');

    const deleteWorkoutBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => {
        if (!window.confirm('Delete this workout session and all its logged sets? This cannot be undone.')) return;
        const exIds = exercises.map(e => e.workoutExerciseId);
        const sets = data.workoutSets.filter(s => exIds.includes(s.workoutExerciseId));
        for (const s of sets) await DataService.workoutSets.delete(s.workoutSetId);
        for (const e of exercises) await DataService.workoutExercises.delete(e.workoutExerciseId);
        await DataService.workouts.delete(todayWorkout.workoutId);
        Utils.toast('Workout deleted.', 'success');
        await renderInner(container);
      },
    }, 'Delete Workout');

    // A completed workout collapses into a compact summary by default — the
    // full editable log is still one click away via "View Details", and
    // "Reopen" always expands it (you can't review/edit a collapsed log).
    if (todayWorkout.status === 'completed' && expandedCompletedWorkoutId !== todayWorkout.workoutId) {
      return renderCompletedWorkoutSummary(todayWorkout, exercises, data, dateBar, finishBtn, deleteWorkoutBtn, workoutModeBtn, container);
    }

    const exerciseCards = exercises.map(ex => renderExerciseCard(ex, todayWorkout, data, container));

    const addExercisePanel = addExercisePanelOpenForWorkout === todayWorkout.workoutId
      ? Utils.el('div', { class: 'card card--form', style: 'margin-top:14px;background:var(--surface-alt);' }, [
          Utils.el('h3', { class: 'form__group-title' }, 'Add an exercise to this workout'),
          renderExercisePicker(
            () => { const c = renderTodayWorkoutCard(data, container); const old = document.getElementById('today-workout-card'); if (old) old.replaceWith(c); },
            async (built) => {
              const created = await DataService.workoutExercises.create(Models.createWorkoutExercise(todayWorkout.workoutId, {
                exerciseName: built.exerciseName, muscleGroup: built.muscleGroup, exerciseType: built.exerciseType, isCardio: built.isCardio,
                order: exercises.length + 1, targetSets: built.targetSets, targetRepsMin: built.targetRepsMin, targetRepsMax: built.targetRepsMax,
                targetRIR: built.targetRIR, restSeconds: built.restSeconds,
              }));
              if (!built.isCardio && built.targetSets) {
                for (let s = 1; s <= built.targetSets; s++) await DataService.workoutSets.create(Models.createWorkoutSet(created.workoutExerciseId, { setNumber: s }));
              }
              addExercisePanelOpenForWorkout = false;
              Utils.toast('Exercise added.', 'success');
              await renderInner(container);
            }),
        ])
      : null;

    const addExerciseToggle = Utils.el('button', {
      class: 'btn btn--secondary', type: 'button',
      onClick: () => { addExercisePanelOpenForWorkout = addExercisePanelOpenForWorkout === todayWorkout.workoutId ? false : todayWorkout.workoutId; renderInner(container); },
    }, addExercisePanelOpenForWorkout === todayWorkout.workoutId ? 'Cancel' : '+ Add Exercise');

    const collapseBtn = (todayWorkout.status === 'completed' && expandedCompletedWorkoutId === todayWorkout.workoutId)
      ? Utils.el('button', {
          class: 'btn btn--secondary btn--row', type: 'button',
          onClick: () => { expandedCompletedWorkoutId = null; renderInner(container); },
        }, 'Collapse')
      : null;

    return Utils.el('section', { class: 'card', id: 'today-workout-card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, todayWorkout.name || 'Workout'),
          Utils.el('p', { class: 'card__subtitle' }, `${Utils.formatDate(selectedDate)} · ${todayWorkout.status === 'completed' ? 'Completed' : 'In progress'}`),
        ]),
        dateBar,
      ]),
      Utils.el('div', { class: 'row-actions', style: 'margin-bottom:14px;' }, [workoutModeBtn, finishBtn, collapseBtn, deleteWorkoutBtn].filter(Boolean)),
      exercises.length ? Utils.el('div', {}, exerciseCards) : Utils.el('p', { class: 'card__footnote' }, 'No exercises yet — add one below.'),
      addExerciseToggle,
      addExercisePanel,
    ].filter(Boolean));
  }

  /**
   * The collapsed view of a finished workout — a compact log entry
   * confirming the session was stored, instead of the full editable set-
   * by-set interface. "View Details" un-collapses it for review/editing.
   */
  function renderCompletedWorkoutSummary(todayWorkout, exercises, data, dateBar, finishBtn, deleteWorkoutBtn, workoutModeBtn, container) {
    const exIds = exercises.map(e => e.workoutExerciseId);
    const sets = data.workoutSets.filter(s => exIds.includes(s.workoutExerciseId));
    const completedSets = sets.filter(s => s.completed);
    const totalVolumeKg = completedSets.reduce((sum, s) => sum + (s.weightKg || 0) * (s.reps || 0), 0);

    const exerciseList = exercises.map(e => {
      const label = e.isCardio
        ? `${e.exerciseName} (${e.cardioDurationMinutes ?? '?'} min)`
        : `${e.exerciseName} (${e.targetSets ?? '?'}\u00d7${e.targetRepsMin ?? '?'}${e.targetRepsMax && e.targetRepsMax !== e.targetRepsMin ? `-${e.targetRepsMax}` : ''})`;
      return label;
    }).join(' \u00b7 ');

    const viewDetailsBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => { expandedCompletedWorkoutId = todayWorkout.workoutId; renderInner(container); },
    }, 'View Details');

    return Utils.el('section', { class: 'card', id: 'today-workout-card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('div', { class: 'entry-row__title-line' }, [
            Utils.el('h2', { class: 'card__title' }, todayWorkout.name || 'Workout'),
            Utils.el('span', { class: 'badge' }, '\u2713 Logged for today'),
          ]),
          Utils.el('p', { class: 'card__subtitle' }, `${Utils.formatDate(selectedDate)} \u00b7 Completed`),
        ]),
        dateBar,
      ]),
      Utils.el('p', { class: 'entry-row__meta' }, exerciseList || 'No exercises logged.'),
      Utils.el('dl', { class: 'stat-list stat-list--mono', style: 'margin:10px 0;' }, [
        Utils.el('dt', {}, 'Sets completed'), Utils.el('dd', {}, `${completedSets.length} / ${sets.length}`),
        Utils.el('dt', {}, 'Total volume'), Utils.el('dd', {}, totalVolumeKg > 0 ? `${Utils.fmt(Math.round(totalVolumeKg))} kg` : 'No data entered'),
      ]),
      Utils.el('div', { class: 'row-actions' }, [workoutModeBtn, viewDetailsBtn, finishBtn, deleteWorkoutBtn].filter(Boolean)),
    ]);
  }

  function renderExerciseCard(exercise, workout, data, container) {
    const sets = data.workoutSets.filter(s => s.workoutExerciseId === exercise.workoutExerciseId).sort((a, b) => a.setNumber - b.setNumber);
    const previous = WorkoutEngine.getPreviousPerformance(exercise.exerciseName, data.workouts, data.workoutExercises, data.workoutSets, workout.workoutId);
    const best = WorkoutEngine.getBestPerformance(exercise.exerciseName, data.workouts, data.workoutExercises, data.workoutSets);

    const removeExerciseBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => {
        for (const s of sets) await DataService.workoutSets.delete(s.workoutSetId);
        await DataService.workoutExercises.delete(exercise.workoutExerciseId);
        Utils.toast('Exercise removed.', 'success');
        await renderInner(container);
      },
    }, 'Remove exercise');

    const perfLine = Utils.el('div', { class: 'stat-list stat-list--mono', style: 'margin:6px 0 10px;' }, [
      Utils.el('dt', {}, 'Previous'),
      Utils.el('dd', {}, previous && previous.topSet ? `${previous.topSet.weightKg} kg × ${previous.topSet.reps}${previous.topSet.rir != null ? ` (RIR ${previous.topSet.rir})` : ''} — ${Utils.formatDate(previous.date)}` : 'No data entered'),
      Utils.el('dt', {}, 'Best'),
      Utils.el('dd', {}, best ? `${best.weightKg} kg × ${best.reps} (est. 1RM ${best.estOneRepMax} kg) — ${Utils.formatDate(best.date)}` : 'No data entered'),
    ]);

    const header = Utils.el('div', { class: 'card__header' }, [
      Utils.el('div', {}, [
        Utils.el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [
          Utils.el('h3', { class: 'card__title', style: 'font-size:16px;' }, exercise.exerciseName),
          videoHelpButton(exercise.exerciseName),
        ]),
        Utils.el('p', { class: 'card__subtitle' }, exercise.isCardio ? 'Cardio' : `${exercise.exerciseType} · Target ${exercise.targetSets ?? '—'}×${exercise.targetRepsMin ?? '—'}-${exercise.targetRepsMax ?? '—'}, RIR ${exercise.targetRIR ?? '—'}, rest ${exercise.restSeconds ?? '—'}s`),
      ]),
      removeExerciseBtn,
    ]);

    const body = exercise.isCardio
      ? renderCardioFields(exercise, container)
      : renderSetsTable(exercise, sets, workout, data, container);

    const progression = !exercise.isCardio
      ? renderProgressionNote(exercise, previous)
      : null;

    const meta = renderExerciseMetaFields(exercise, container);

    return Utils.el('div', { class: 'card', style: 'margin-bottom:14px;background:var(--surface-alt);' }, [header, perfLine, body, progression, meta].filter(Boolean));
  }

  function renderProgressionNote(exercise, previous) {
    const suggestion = WorkoutEngine.suggestProgression({
      exerciseType: exercise.exerciseType, targetRepsMin: exercise.targetRepsMin, targetRepsMax: exercise.targetRepsMax,
      targetRIR: exercise.targetRIR, previous,
    });
    return Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, `Progression: ${suggestion.message}`);
  }

  function renderSetsTable(exercise, sets, workout, data, container) {
    const rows = sets.map((set, idx) => renderSetRow(set, idx, exercise, container));
    const addSetBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        await DataService.workoutSets.create(Models.createWorkoutSet(exercise.workoutExerciseId, { setNumber: sets.length + 1 }));
        await renderInner(container);
      },
    }, '+ Add Set');

    return Utils.el('div', { class: 'table-wrap' }, [
      Utils.el('table', { class: 'table' }, [
        Utils.el('thead', {}, Utils.el('tr', {}, ['Set', 'Weight (kg)', 'Reps', 'RIR', 'Done', ''].map(h => Utils.el('th', {}, h)))),
        Utils.el('tbody', {}, rows),
      ]),
      addSetBtn,
    ]);
  }

  function renderSetRow(set, idx, exercise, container) {
    const weightInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: set.weightKg ?? '', style: 'width:80px;' });
    const repsInput = Utils.el('input', { class: 'form__input', type: 'number', min: 0, value: set.reps ?? '', style: 'width:70px;' });
    const rirInput = Utils.el('input', { class: 'form__input', type: 'number', min: 0, max: 10, value: set.rir ?? '', style: 'width:70px;' });
    const completedCheckbox = Utils.el('input', { type: 'checkbox' });
    if (set.completed) completedCheckbox.setAttribute('checked', 'checked');

    const saveBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        await DataService.workoutSets.update(set.workoutSetId, {
          weightKg: numOrNull(weightInput.value), reps: numOrNull(repsInput.value), rir: numOrNull(rirInput.value),
          completed: completedCheckbox.checked,
        });
        Utils.toast('Set saved.', 'success');
        await renderInner(container);
      },
    }, 'Save');

    const removeBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => { await DataService.workoutSets.delete(set.workoutSetId); await renderInner(container); },
    }, '×');

    return Utils.el('tr', {}, [
      Utils.el('td', {}, `${idx + 1}`),
      Utils.el('td', {}, weightInput),
      Utils.el('td', {}, repsInput),
      Utils.el('td', {}, rirInput),
      Utils.el('td', {}, completedCheckbox),
      Utils.el('td', {}, Utils.el('div', { class: 'row-actions' }, [saveBtn, removeBtn])),
    ]);
  }

  function renderCardioFields(exercise, container) {
    const durInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: exercise.cardioDurationMinutes ?? '', style: 'width:90px;' });
    const speedInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: exercise.cardioSpeed ?? '', style: 'width:90px;' });
    const inclineInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: exercise.cardioIncline ?? '', style: 'width:90px;' });
    const distInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: exercise.cardioDistance ?? '', style: 'width:90px;' });
    const calInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: exercise.cardioCaloriesEstimated ?? '', style: 'width:90px;' });

    const saveBtn = Utils.el('button', {
      class: 'btn btn--secondary', type: 'button',
      onClick: async () => {
        await DataService.workoutExercises.update(exercise.workoutExerciseId, {
          cardioDurationMinutes: numOrNull(durInput.value), cardioSpeed: numOrNull(speedInput.value),
          cardioIncline: numOrNull(inclineInput.value), cardioDistance: numOrNull(distInput.value),
          cardioCaloriesEstimated: numOrNull(calInput.value),
        });
        Utils.toast('Cardio logged.', 'success');
        await renderInner(container);
      },
    }, 'Save Cardio');

    return Utils.el('div', {}, [
      Utils.el('div', { class: 'form__grid' }, [
        labeledInput('Duration (min)', durInput), labeledInput('Speed (km/h)', speedInput), labeledInput('Incline (%)', inclineInput),
        labeledInput('Distance (km)', distInput), labeledInput('Calories (if available)', calInput),
      ]),
      Utils.el('p', { class: 'card__footnote' }, "Machine calorie estimates aren't exact — treat this figure as a rough guide, not a precise count."),
      saveBtn,
    ]);
  }

  function renderExerciseMetaFields(exercise, container) {
    const difficultySelect = Utils.el('select', { class: 'form__input' }, DIFFICULTY_OPTIONS.map(o => {
      const opt = Utils.el('option', { value: o.value }, o.label);
      if (exercise.difficulty === o.value) opt.setAttribute('selected', 'selected');
      return opt;
    }));
    difficultySelect.addEventListener('change', async (e) => {
      await DataService.workoutExercises.update(exercise.workoutExerciseId, { difficulty: e.target.value });
      await renderInner(container);
    });

    const formSelect = Utils.el('select', { class: 'form__input' }, FORM_OPTIONS.map(o => {
      const opt = Utils.el('option', { value: o.value }, o.label);
      if (exercise.formRating === o.value) opt.setAttribute('selected', 'selected');
      return opt;
    }));
    formSelect.addEventListener('change', async (e) => {
      await DataService.workoutExercises.update(exercise.workoutExerciseId, { formRating: e.target.value });
      await renderInner(container);
    });

    const notesInput = Utils.el('textarea', { class: 'form__input', rows: 2, value: exercise.notes || '' }, exercise.notes || '');
    const notesSaveBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => { await DataService.workoutExercises.update(exercise.workoutExerciseId, { notes: notesInput.value }); Utils.toast('Notes saved.', 'success'); },
    }, 'Save Notes');

    return Utils.el('div', { class: 'form__grid', style: 'margin-top:10px;' }, [
      labeledInput('Difficulty', difficultySelect), labeledInput('Form', formSelect),
      Utils.el('div', { class: 'form__field form__field--wide' }, [Utils.el('label', { class: 'form__label' }, 'Notes'), notesInput, notesSaveBtn]),
    ]);
  }

  // =====================================================================
  // WORKOUT HISTORY — previous / current / progress / PRs / exercise history
  // =====================================================================

  function renderHistoryCard(data, container) {
    const completed = [...data.workouts].filter(w => w.status === 'completed' || w.date !== selectedDate).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const previousWorkout = completed.find(w => w.date < selectedDate) || completed[0] || null;
    const currentWorkout = data.workouts.find(w => w.date === selectedDate) || null;

    const summaryRows = [
      ['Previous workout', previousWorkout ? `${previousWorkout.name || 'Workout'} — ${Utils.formatDate(previousWorkout.date)}` : null],
      ['Current workout', currentWorkout ? `${currentWorkout.name || 'Workout'} — ${currentWorkout.status === 'completed' ? 'Completed' : 'In progress'}` : null],
    ];

    const bests = WorkoutEngine.getPersonalBests(data.workouts, data.workoutExercises, data.workoutSets);
    const bestsTable = bests.length
      ? Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
          Utils.el('thead', {}, Utils.el('tr', {}, ['Exercise', 'Best', 'Est. 1RM', 'Date'].map(h => Utils.el('th', {}, h)))),
          Utils.el('tbody', {}, bests.slice(0, 15).map(b => Utils.el('tr', {}, [
            Utils.el('td', {}, b.exerciseName),
            Utils.el('td', {}, `${b.best.weightKg} kg × ${b.best.reps}`),
            Utils.el('td', {}, `${b.best.estOneRepMax} kg`),
            Utils.el('td', {}, Utils.formatDate(b.best.date)),
          ]))),
        ]))
      : Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    const exerciseNames = [...new Set(data.workoutExercises.map(e => e.exerciseName).filter(Boolean))].sort();
    if (!historyExerciseName && exerciseNames.length) historyExerciseName = exerciseNames[0];

    const exerciseSelect = Utils.el('select', { class: 'form__input', style: 'max-width:280px;' },
      exerciseNames.map(name => {
        const opt = Utils.el('option', { value: name }, name);
        if (name === historyExerciseName) opt.setAttribute('selected', 'selected');
        return opt;
      }));
    exerciseSelect.addEventListener('change', (e) => { historyExerciseName = e.target.value; renderInner(container); });

    const history = historyExerciseName ? WorkoutEngine.getExerciseHistory(historyExerciseName, data.workouts, data.workoutExercises, data.workoutSets) : [];
    const historyTable = history.length
      ? Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
          Utils.el('thead', {}, Utils.el('tr', {}, ['Date', 'Sets logged', 'Top set', 'Difficulty', 'Form'].map(h => Utils.el('th', {}, h)))),
          Utils.el('tbody', {}, history.slice(0, 20).map(h => {
            const completedSets = h.sets.filter(s => s.completed && s.weightKg != null);
            const top = completedSets.reduce((b, s) => (!b || (WorkoutEngine.estimateOneRepMax(s.weightKg, s.reps) || 0) > (WorkoutEngine.estimateOneRepMax(b.weightKg, b.reps) || 0)) ? s : b, null);
            return Utils.el('tr', {}, [
              Utils.el('td', {}, Utils.formatDate(h.workout.date)),
              Utils.el('td', {}, `${completedSets.length}`),
              Utils.el('td', {}, top ? `${top.weightKg} kg × ${top.reps}${top.rir != null ? ` (RIR ${top.rir})` : ''}` : 'No data entered'),
              Utils.el('td', {}, h.exercise.difficulty || '—'),
              Utils.el('td', {}, h.exercise.formRating ? h.exercise.formRating.replace('_', ' ') : '—'),
            ]);
          })),
        ]))
      : Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    const recentWorkouts = [...data.workouts].filter(w => w.status === 'completed').sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
    const recentList = recentWorkouts.length
      ? Utils.el('div', { class: 'entry-list' }, recentWorkouts.map(w => {
          const exCount = data.workoutExercises.filter(e => e.workoutId === w.workoutId).length;
          return Utils.el('div', { class: 'entry-row' }, [
            Utils.el('div', { class: 'entry-row__main' }, [
              Utils.el('div', { class: 'entry-row__name' }, w.name || 'Workout'),
              Utils.el('div', { class: 'entry-row__meta' }, `${Utils.formatDate(w.date)} \u00b7 ${exCount} exercise${exCount === 1 ? '' : 's'}${w.durationMinutes ? ` \u00b7 ${w.durationMinutes} min` : ''}`),
            ]),
            Utils.el('div', { class: 'row-actions' }, [
              Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => openWorkoutMode(w.workoutId, data, container) }, 'View'),
            ]),
          ]);
        }))
      : Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Workout History')),
      Utils.el('dl', { class: 'stat-list' }, summaryRows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v ?? 'No data entered')])),
      Utils.el('h3', { class: 'form__group-title' }, 'Recent Workouts'),
      recentList,
      Utils.el('h3', { class: 'form__group-title' }, 'Personal Bests'),
      bestsTable,
      Utils.el('h3', { class: 'form__group-title' }, 'Exercise History'),
      exerciseNames.length ? Utils.el('div', { class: 'form__grid' }, [exerciseSelect]) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
      historyTable,
    ]);
  }

  // =====================================================================
  // FIELD HELPERS
  // =====================================================================

  function textField(label, value, onInput) {
    const id = `wf-${Math.random().toString(36).slice(2, 7)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('input', { class: 'form__input', id, type: 'text', value, onInput: (e) => onInput(e.target.value) }),
    ]);
  }
  function numField(label, value, onInput) {
    const id = `wf-${Math.random().toString(36).slice(2, 7)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('input', { class: 'form__input', id, type: 'number', step: 'any', min: 0, value: value ?? '', onInput: (e) => onInput(e.target.value) }),
    ]);
  }
  function selectField(label, value, options, onChange) {
    const id = `wf-${Math.random().toString(36).slice(2, 7)}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('select', { class: 'form__input', id, onChange: (e) => onChange(e.target.value) }, options.map(o => {
        const opt = Utils.el('option', { value: o.value }, o.label);
        if (value === o.value) opt.setAttribute('selected', 'selected');
        return opt;
      })),
    ]);
  }
  function labeledInput(label, inputNode) {
    return Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, label), inputNode]);
  }
  function numOrNull(raw) {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  return { render };
})();
