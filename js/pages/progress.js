/**
 * pages/progress.js — the Progress module. Weight metrics are pulled
 * straight from Calculations.calculateAllTargets() (never recomputed);
 * measurement/milestone logic comes from ProgressEngine; charts are built
 * by ChartUtils. This page only assembles those into cards.
 */

const PageProgress = (() => {

  const ANGLES = [{ value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }, { value: 'back', label: 'Back' }];

  let selectedProgramId = null;
  let weightChartFilter = 'ALL';       // '7' | '30' | '60' | '100' | 'ALL'
  let historyGranularity = 'daily';      // 'daily' | 'weekly' | 'monthly' | 'program'
  let adherenceMonth = null;              // 'YYYY-MM' — defaults to current month on first render
  let selectedAdherenceDate = null;
  let comparisonView = 'starting_vs_current'; // 'starting_vs_current' | 'previous_vs_current' | 'target_vs_actual'
  let transformBeforeDate = '';        // slider comparison "before" photo date
  let transformAfterDate = '';           // slider comparison "current" photo date
  let sliderPosition = 50;                // % reveal position for the before/after slider
  let timelineSelectedDate = '';           // which date's photo the Timeline is showing

  async function render(container) {
    // Reset to sensible defaults (earliest vs. latest photo) on every fresh
    // navigation to this page; in-session dropdown/chip choices still call
    // renderInner directly and are preserved while browsing.
    transformBeforeDate = '';
    transformAfterDate = '';
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
    const programs = await DataService.programs.list(p => p.userId === userId);
    const runnable = programs.filter(p => p.startDate && p.durationDays);
    if (!selectedProgramId || !runnable.some(p => p.programId === selectedProgramId)) {
      selectedProgramId = (runnable.find(p => p.status === 'active') || runnable[0] || {}).programId || null;
    }
    const program = runnable.find(p => p.programId === selectedProgramId) || null;
    const activeProgram = runnable.find(p => p.status === 'active') || program;

    const phases = activeProgram ? await DataService.programPhases.list(ph => ph.programId === activeProgram.programId) : [];
    const currentPhase = phases.length ? Calculations.getCurrentPhase(phases) : null;
    const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
    const targets = profile ? Calculations.calculateAllTargets(profile, { weightEntries, program: activeProgram, phase: currentPhase }) : null;

    const measurementEntries = await DataService.measurementEntries.list(m => m.userId === userId);
    const progressPhotos = await DataService.progressPhotos.list(p => p.userId === userId);
    const milestones = program ? await DataService.milestones.list(m => m.programId === program.programId) : [];

    const mealItems = await DataService.mealItems.list(e => e.userId === userId);
    const waterEntries = await DataService.waterEntries.list(w => w.userId === userId);
    const stepEntries = await DataService.stepEntries.list(s => s.userId === userId);
    const sleepEntries = await DataService.sleepEntries.list(s => s.userId === userId);
    const workouts = await DataService.workouts.list(w => w.userId === userId);
    const workoutIds = new Set(workouts.map(w => w.workoutId));
    const workoutExercises = await DataService.workoutExercises.list(e => workoutIds.has(e.workoutId));
    const exerciseIds = new Set(workoutExercises.map(e => e.workoutExerciseId));
    const workoutSets = await DataService.workoutSets.list(s => exerciseIds.has(s.workoutExerciseId));
    const dailyChecklists = await DataService.dailyChecklists.list(c => c.userId === userId);
    const checklistsByDate = Object.fromEntries(dailyChecklists.map(c => [c.date, c.checks || {}]));

    const data = {
      userId, profile, programs: runnable, program, activeProgram, targets,
      weightEntries, measurementEntries, progressPhotos, milestones,
      mealItems, waterEntries, stepEntries, sleepEntries, workouts, workoutExercises, workoutSets, checklistsByDate,
    };
    // DailyTrackingEngine/ReportsEngine expect `entries` (meal items) as the
    // key name, and ReportsEngine also wants recovery/wellbeing arrays even
    // when unused here — these adapters avoid re-fetching data progress.js
    // doesn't otherwise need, while still reusing those engines' real logic.
    const dailyData = { ...data, entries: mealItems };
    const reportsData = { ...dailyData, recoveryEntries: [], sexualWellbeingEntries: [] };

    container.appendChild(renderProgressHero(data, dailyData, container));
    container.appendChild(renderWeightCard(data, container));
    container.appendChild(renderStrengthCard(data, container));
    container.appendChild(renderNutritionCard(data, reportsData, container));
    container.appendChild(renderMilestonesCard(data, container));
    container.appendChild(renderMeasurementsCard(data, container));
    container.appendChild(renderAdherenceCard(data, dailyData, container));
    container.appendChild(renderComparisonCard(data, reportsData, container));
    container.appendChild(renderHistoryGranularityCard(data, container));
    container.appendChild(renderTransformationHeroCard(data));
    container.appendChild(renderTransformationCard(data, container));
    container.appendChild(renderChartsCard(data, container));

    UIFx.animateIn(container);
  }

  // =====================================================================
  // HERO — a gold progress ring showing how far the current weight has
  // moved from the program's starting weight toward the target weight.
  // =====================================================================

  function renderProgressHero(data, dailyData, container) {
    const { profile, activeProgram, targets } = data;
    const start = activeProgram?.startingWeightKg ?? null;
    const current = profile?.currentWeightKg ?? null;
    const target = activeProgram?.targetWeightKg ?? profile?.targetWeightKg ?? null;

    let pct = 0, number = '\u2013', of = 'to goal';
    if (start != null && current != null && target != null && start !== target) {
      const planned = target - start;
      const achieved = current - start;
      pct = Math.max(0, Math.min(100, Math.round((achieved / planned) * 100)));
      number = `${pct}%`;
      of = 'to goal';
    }

    const counters = activeProgram ? Calculations.getProgramDayCounters(activeProgram) : null;
    const streak = ProgressEngine.computeAdherenceStreak(dailyData, Models.todayIso());

    const hero = UIFx.hero({
      theme: 'progress',
      icon: '\uD83D\uDCC8',
      eyebrow: 'Progress',
      title: 'Transformation Progress',
      subtitle: (targets && targets.weightDifferenceKg != null)
        ? `${formatSigned(targets.weightDifferenceKg, ' kg')} since the program started${targets.weeklyWeightTrendKg != null ? ` · ${formatSigned(targets.weeklyWeightTrendKg, ' kg')} this week` : ''}.`
        : 'Log your weight to start tracking movement toward your goal.',
      stats: [],
    });
    hero.classList.add('card--hero--compact');
    const inner = hero.querySelector('.hero__inner');
    inner.appendChild(UIFx.ringNode({ pct, number, of, colorFrom: 'var(--gold-soft)', colorTo: 'var(--gold)', size: 132, stroke: 9 }));

    const statPairs = [
      ['Current Weight', Utils.fmt(current, ' kg')],
      ['Weight Change', targets ? (formatSigned(targets.weightDifferenceKg, ' kg') ?? 'No data entered') : 'No data entered'],
      ['Program Day', counters ? `Day ${counters.day} of ${counters.totalDays}` : 'No data entered'],
      ['Program %', counters && counters.totalDays ? `${Math.round((counters.day / counters.totalDays) * 100)}%` : 'No data entered'],
      ['Streak', streak > 0 ? `${streak} day${streak === 1 ? '' : 's'}` : 'No data entered'],
    ];
    inner.appendChild(Utils.el('div', { class: 'hero__stats', style: 'flex-wrap:wrap;row-gap:14px;' },
      statPairs.map(([label, val]) => Utils.el('div', { class: 'hero__stat' }, [
        Utils.el('div', { class: 'hero__stat-value' }, val),
        Utils.el('div', { class: 'hero__stat-label' }, label),
      ]))));

    hero.appendChild(Utils.el('div', { class: 'row-actions', style: 'margin-top:16px;' }, [
      Utils.el('a', { class: 'btn btn--primary', href: '#weight-card' }, 'VIEW FULL PROGRESS'),
    ]));

    return hero;
  }

  // =====================================================================
  // WEIGHT
  // =====================================================================

  function renderWeightCard(data, container) {
    const { profile, activeProgram, targets, weightEntries, userId } = data;

    const rows = [
      ['Current', Utils.fmt(profile?.currentWeightKg, ' kg')],
      ['Starting', Utils.fmt(activeProgram?.startingWeightKg, ' kg')],
      ['Target', Utils.fmt(activeProgram?.targetWeightKg ?? profile?.targetWeightKg, ' kg')],
      ['Change', targets ? formatSigned(targets.weightDifferenceKg, ' kg') : null],
      ['% change', targets && targets.percentWeightChangeSinceStart != null ? `${targets.percentWeightChangeSinceStart > 0 ? '+' : ''}${targets.percentWeightChangeSinceStart}%` : null],
      ['Remaining to target', targets ? formatSigned(targets.targetWeightDifferenceKg, ' kg') : null],
      ['7-day average', targets ? Utils.fmt(targets.sevenDayAverageWeightKg, ' kg') : null],
      ['Weekly trend', targets ? formatSigned(targets.weeklyWeightTrendKg, ' kg') : null],
      ['4-week trend', targets ? formatSigned(targets.fourWeekWeightTrendKg, ' kg') : null],
    ];

    const weightInput = Utils.el('input', { class: 'form__input', type: 'number', step: '0.01', min: 30, max: 300, placeholder: 'kg', style: 'width:100px;' });
    const logBtn = Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button' }, 'Log Weight');
    logBtn.addEventListener('click', async () => {
      const raw = weightInput.value;
      const err = Utils.Validate.range(raw, 30, 300, 'Weight');
      if (!raw || err) { Utils.toast(err || 'Enter a weight in kg.', 'error'); return; }
      const weightKg = Number(raw);
      const today = Models.todayIso();
      const existing = (await DataService.weightEntries.list(w => w.userId === userId && w.date === today))[0];
      if (existing) await DataService.weightEntries.update(existing.weightEntryId, { weightKg });
      else await DataService.weightEntries.create(Models.createWeightEntry(userId, today, { weightKg }));
      if (profile) await DataService.profiles.update(profile.profileId, { currentWeightKg: weightKg });
      Utils.toast('Weight logged.', 'success');
      await renderInner(container);
    });

    const chartSvg = buildWeightChart(weightEntries, activeProgram);

    const filterRow = Utils.el('div', { class: 'chip-row' }, ['7', '30', '60', '100', 'ALL'].map(f =>
      Utils.el('button', {
        class: `chip${weightChartFilter === f ? ' chip--active' : ''}`, type: 'button',
        onClick: () => { weightChartFilter = f; renderInner(container); },
      }, f === 'ALL' ? 'All Time' : `${f}D`)));

    return Utils.el('section', { class: 'card', id: 'weight-card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Weight'),
        Utils.el('div', { class: 'row-actions' }, [weightInput, logBtn]),
      ]),
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, ProgressEngine.FLUCTUATION_NOTE),
      profile
        ? Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v ?? 'No data entered')]))
        : Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      filterRow,
      chartSvg ? svgHost(chartSvg) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ]);
  }

  function buildWeightChart(weightEntries, program) {
    const today = Models.todayIso();
    const windowDays = weightChartFilter === 'ALL' ? 'ALL' : Number(weightChartFilter);
    const windowed = ProgressEngine.filterEntriesByWindow(weightEntries, windowDays, today);
    const points = [...windowed].filter(w => w.weightKg != null).sort((a, b) => a.date.localeCompare(b.date)).map(w => ({ x: w.date, y: w.weightKg }));
    if (!points.length) return null;
    // Native SVG <title> tooltips on every point (see ChartUtils.buildLineChartSVG)
    // already show the exact date/value on hover or tap — no extra JS needed.
    return ChartUtils.buildLineChartSVG(
      [{ label: 'Weight', color: ChartUtils.COLORS[0], points }],
      { yUnit: ' kg', targetY: program?.targetWeightKg ?? null, targetLabel: 'Target' },
    );
  }

  // =====================================================================
  // STRENGTH — Previous / Current / Best / Change for every exercise
  // the person has actually logged. Entirely reuses WorkoutEngine; no
  // new performance math lives here.
  // =====================================================================

  function renderStrengthCard(data, container) {
    const { workouts, workoutExercises, workoutSets } = data;
    const exerciseNames = [...new Set(workoutExercises.filter(e => !e.isCardio).map(e => e.exerciseName).filter(Boolean))].sort();

    if (!exerciseNames.length) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Strength')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }

    const rows = exerciseNames.map(name => {
      const history = WorkoutEngine.getExerciseHistory(name, workouts, workoutExercises, workoutSets)
        .filter(h => h.sets.some(s => s.completed && s.weightKg != null))
        .sort((a, b) => (a.workout.date || '').localeCompare(b.workout.date || ''));
      if (!history.length) return null;

      const topSetOf = (sets) => sets.filter(s => s.completed && s.weightKg != null)
        .reduce((best, s) => (!best || WorkoutEngine.estimateOneRepMax(s.weightKg, s.reps) > WorkoutEngine.estimateOneRepMax(best.weightKg, best.reps)) ? s : best, null);

      const current = topSetOf(history[history.length - 1].sets);
      const previous = history.length >= 2 ? topSetOf(history[history.length - 2].sets) : null;
      const best = WorkoutEngine.getBestPerformance(name, workouts, workoutExercises, workoutSets);

      const currentE1RM = current ? WorkoutEngine.estimateOneRepMax(current.weightKg, current.reps) : null;
      const previousE1RM = previous ? WorkoutEngine.estimateOneRepMax(previous.weightKg, previous.reps) : null;
      const change = (currentE1RM != null && previousE1RM != null) ? Math.round((currentE1RM - previousE1RM) * 10) / 10 : null;

      return Utils.el('div', { class: 'entry-row' }, [
        Utils.el('div', { class: 'entry-row__main' }, [
          Utils.el('div', { class: 'entry-row__name' }, name),
          Utils.el('div', { class: 'entry-row__meta' }, [
            `Previous: ${previous ? `${previous.weightKg} kg \u00d7 ${previous.reps}` : 'No data entered'}`,
            `Current: ${current ? `${current.weightKg} kg \u00d7 ${current.reps}` : 'No data entered'}`,
            `Best: ${best ? `${best.weightKg} kg \u00d7 ${best.reps} (est. 1RM ${best.estOneRepMax} kg)` : 'No data entered'}`,
          ].join(' \u00b7 ')),
        ]),
        Utils.el('span', { class: `badge${change != null && change > 0 ? '' : ''}` }, change != null ? `${change >= 0 ? '+' : ''}${change} kg est. 1RM` : 'No data entered'),
      ]);
    }).filter(Boolean);

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Strength'),
        Utils.el('p', { class: 'card__subtitle' }, 'Previous vs. current session, and your all-time best, per exercise.'),
      ]),
      rows.length ? Utils.el('div', {}, rows) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ]);
  }

  // =====================================================================
  // NUTRITION — target vs actual, trailing 7 days. Reuses ReportsEngine's
  // weekly aggregate (the exact same averaging used on the Reports page)
  // rather than recomputing anything here.
  // =====================================================================

  function renderNutritionCard(data, reportsData, container) {
    const { targets } = data;
    const report = ReportsEngine.computeWeeklyReport(Models.todayIso(), reportsData);

    const rows = [
      ['Calories', report.avgCalories, targets?.calorieTarget, ' kcal'],
      ['Protein', report.avgProtein, targets?.proteinTargetG, ' g'],
      ['Carbs', report.avgCarbs, targets?.carbTargetG, ' g'],
      ['Fat', report.avgFat, targets?.fatTargetG, ' g'],
      ['Fibre', report.avgFibre, targets?.fibreTargetG, ' g'],
      ['Water', report.avgWaterMl, targets?.waterTargetMl, ' ml'],
      ['Calcium', report.avgCalcium, null, ' mg'],
      ['Potassium', report.avgPotassium, null, ' mg'],
      ['Magnesium', report.avgMagnesium, null, ' mg'],
      ['Iron', report.avgIron, null, ' mg'],
      ['Zinc', report.avgZinc, null, ' mg'],
    ];

    const tableRows = rows.map(([label, actual, target, unit]) => Utils.el('tr', {}, [
      Utils.el('td', {}, label),
      Utils.el('td', {}, actual != null ? `${actual}${unit}` : 'No data entered'),
      Utils.el('td', {}, target != null ? `${target}${unit}` : 'No data entered'),
      Utils.el('td', {}, (actual != null && target != null) ? `${Math.round((actual / target) * 100)}%` : '\u2014'),
    ]));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Nutrition'),
        Utils.el('p', { class: 'card__subtitle' }, 'Target vs. actual, averaged over the last 7 days.'),
      ]),
      Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
        Utils.el('thead', {}, Utils.el('tr', {}, ['Nutrient', 'Actual', 'Target', '% of Target'].map(h => Utils.el('th', {}, h)))),
        Utils.el('tbody', {}, tableRows),
      ])),
    ]);
  }

  const MILESTONE_STATUS_LABEL = {
    within_range: 'Within guideline range',
    below_range: 'Below guideline range (more change than guided — not a bad thing)',
    above_range: 'Above guideline range',
    no_data: 'No weight logged near this date',
  };

  function renderMilestonesCard(data, container) {
    const { program, milestones, weightEntries, programs } = data;

    const programSelect = programs.length > 1 ? Utils.el('select', { class: 'form__input', style: 'max-width:260px;' },
      programs.map(p => {
        const opt = Utils.el('option', { value: p.programId }, p.name || 'Untitled Program');
        if (program && p.programId === program.programId) opt.setAttribute('selected', 'selected');
        return opt;
      })) : null;
    if (programSelect) programSelect.addEventListener('change', (e) => { selectedProgramId = e.target.value; renderInner(container); });

    if (!program) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Milestones')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }

    const rows = [...milestones].sort((a, b) => a.dayNumber - b.dayNumber).map(m => {
      const evalResult = ProgressEngine.evaluateMilestone(m, program, weightEntries);
      const rangeLabel = (m.weightMinKg != null && m.weightMaxKg != null)
        ? (m.weightMinKg === m.weightMaxKg ? `${m.weightMinKg} kg` : `approximately ${m.weightMinKg}\u2013${m.weightMaxKg} kg`)
        : 'No data entered';

      const deleteBtn = Utils.el('button', {
        class: 'btn btn--danger btn--row', type: 'button',
        onClick: async () => { await DataService.milestones.delete(m.milestoneId); await renderInner(container); },
      }, 'Delete');

      return Utils.el('div', { class: 'entry-row' }, [
        Utils.el('div', { class: 'entry-row__main' }, [
          Utils.el('div', { class: 'entry-row__title-line' }, [
            Utils.el('span', { class: 'entry-row__name' }, `${m.label || `Day ${m.dayNumber}`} — ${Utils.formatDate(evalResult.targetDate)}`),
            Utils.el('span', { class: `badge${evalResult.status === 'no_data' ? ' badge--draft' : ''}` }, MILESTONE_STATUS_LABEL[evalResult.status]),
          ]),
          Utils.el('div', { class: 'entry-row__meta' }, `Guideline: ${rangeLabel}${evalResult.closestEntry ? ` · Logged: ${evalResult.closestEntry.weightKg} kg on ${Utils.formatDate(evalResult.closestEntry.date)}` : ''}`),
        ]),
        Utils.el('div', { class: 'row-actions' }, [deleteBtn]),
      ]);
    });

    const addForm = renderAddMilestoneForm(program, container);

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Milestones'),
          Utils.el('p', { class: 'card__subtitle' }, `${program.name || 'Program'} — ${program.durationDays} days`),
        ]),
        programSelect,
      ]),
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, ProgressEngine.MILESTONE_DISCLAIMER),
      rows.length ? Utils.el('div', {}, rows) : Utils.el('p', { class: 'card__footnote' }, 'No milestones set for this program yet.'),
      addForm,
    ]);
  }

  function renderAddMilestoneForm(program, container) {
    const dayInput = Utils.el('input', { class: 'form__input', type: 'number', min: 1, max: program.durationDays, placeholder: 'Day #', style: 'width:90px;' });
    const minInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, placeholder: 'Min kg', style: 'width:100px;' });
    const maxInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, placeholder: 'Max kg', style: 'width:100px;' });
    const addBtn = Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button' }, '+ Add Milestone');
    addBtn.addEventListener('click', async () => {
      const day = Number(dayInput.value);
      if (!day || day < 1) { Utils.toast('Enter a valid day number.', 'error'); return; }
      const min = dayInput.value ? Number(minInput.value) : null;
      const max = maxInput.value ? Number(maxInput.value) : null;
      await DataService.milestones.create(Models.createMilestone(program.programId, {
        dayNumber: day, label: `Day ${day}`, weightMinKg: minInput.value === '' ? null : min, weightMaxKg: maxInput.value === '' ? null : max,
      }));
      Utils.toast('Milestone added.', 'success');
      await renderInner(container);
    });
    return Utils.el('div', { class: 'quick-add', style: 'flex-wrap:wrap;margin-top:10px;' }, [dayInput, minInput, maxInput, addBtn]);
  }

  // =====================================================================
  // BODY MEASUREMENTS
  // =====================================================================

  function renderMeasurementsCard(data, container) {
    const { userId, measurementEntries, program } = data;
    const checkpoints = program ? ProgressEngine.computeMeasurementCheckpoints(program) : [];
    const loggedDates = new Set(measurementEntries.map(m => m.date));

    const checkpointChips = checkpoints.length
      ? Utils.el('div', { class: 'chip-row' }, checkpoints.map(cp =>
          Utils.el('span', { class: `chip${loggedDates.has(cp.date) ? ' chip--active' : ''}` }, `${cp.label} · ${Utils.formatDate(cp.date)}${loggedDates.has(cp.date) ? ' \u2713' : ''}`)))
      : null;

    const form = renderMeasurementForm(userId, container);

    const sorted = [...measurementEntries].sort((a, b) => b.date.localeCompare(a.date));
    const rows = sorted.map(m => renderMeasurementRow(m, container));

    const changeSummary = Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
      Utils.el('thead', {}, Utils.el('tr', {}, ['Measurement', 'Starting', 'Current', 'Change', 'Trend'].map(h => Utils.el('th', {}, h)))),
      Utils.el('tbody', {}, ProgressEngine.MEASUREMENT_FIELDS.map(f => {
        const c = ProgressEngine.computeMeasurementChange(measurementEntries, f.key);
        const trend = ProgressEngine.computeMeasurementTrend(measurementEntries, f.key);
        const trendLabel = { increasing: '\u2191 Increasing', decreasing: '\u2193 Decreasing', stable: '\u2192 Stable', no_data: 'No data entered' }[trend];
        return Utils.el('tr', {}, [
          Utils.el('td', {}, f.label),
          Utils.el('td', {}, c.first != null ? `${c.first} ${f.unit}` : 'No data entered'),
          Utils.el('td', {}, c.last != null ? `${c.last} ${f.unit}` : 'No data entered'),
          Utils.el('td', {}, c.changeAbs != null ? `${c.changeAbs >= 0 ? '+' : ''}${c.changeAbs} ${f.unit} (${c.changePercent >= 0 ? '+' : ''}${c.changePercent}%)` : 'No data entered'),
          Utils.el('td', {}, trendLabel),
        ]);
      })),
    ]));

    const waistChart = buildMeasurementChart(measurementEntries, ['waistCm']);
    const allChart = buildMeasurementChart(measurementEntries, ProgressEngine.MEASUREMENT_FIELDS.map(f => f.key));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Body Measurements'),
        Utils.el('p', { class: 'card__subtitle' }, 'Waist, Chest, Hip, Arm, Thigh.'),
      ]),
      checkpointChips,
      form,
      Utils.el('h3', { class: 'form__group-title' }, 'Starting / Current / Change / Trend'),
      changeSummary,
      Utils.el('h3', { class: 'form__group-title' }, 'Waist'),
      waistChart ? svgHost(waistChart) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
      Utils.el('h3', { class: 'form__group-title' }, 'All Measurements'),
      allChart ? svgHost(allChart) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
      Utils.el('h3', { class: 'form__group-title' }, `Entries (${sorted.length})`),
      rows.length ? Utils.el('div', { class: 'entry-list' }, rows) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ].filter(Boolean));
  }

  function renderMeasurementForm(userId, container) {
    const dateInput = Utils.el('input', { class: 'form__input', type: 'date', value: Models.todayIso() });
    const fields = ProgressEngine.MEASUREMENT_FIELDS.map(f => ({ f, input: Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, placeholder: `${f.label} (${f.unit})` }) }));
    const notesInput = Utils.el('input', { class: 'form__input', type: 'text', placeholder: 'Notes (optional)' });

    const saveBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button' }, 'Save Measurement');
    saveBtn.addEventListener('click', async () => {
      const patch = { notes: notesInput.value };
      let any = false;
      fields.forEach(({ f, input }) => { if (input.value !== '') { patch[f.key] = Number(input.value); any = true; } });
      if (!any) { Utils.toast('Enter at least one measurement.', 'error'); return; }
      const date = dateInput.value || Models.todayIso();
      const existing = (await DataService.measurementEntries.list(m => m.userId === userId && m.date === date))[0];
      if (existing) await DataService.measurementEntries.update(existing.measurementEntryId, patch);
      else await DataService.measurementEntries.create(Models.createMeasurementEntry(userId, date, patch));
      Utils.toast('Measurement saved.', 'success');
      await renderInner(container);
    });

    return Utils.el('div', { class: 'form__grid' }, [
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Date'), dateInput]),
      ...fields.map(({ f, input }) => Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, f.label), input])),
      Utils.el('div', { class: 'form__field form__field--wide' }, [Utils.el('label', { class: 'form__label' }, 'Notes'), notesInput]),
      saveBtn,
    ]);
  }

  function renderMeasurementRow(m, container) {
    const parts = ProgressEngine.MEASUREMENT_FIELDS.filter(f => m[f.key] != null).map(f => `${f.label}: ${m[f.key]} ${f.unit}`).join(' · ');
    const deleteBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => { await DataService.measurementEntries.delete(m.measurementEntryId); await renderInner(container); },
    }, 'Delete');
    return Utils.el('div', { class: 'entry-row' }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__name' }, Utils.formatDate(m.date)),
        Utils.el('div', { class: 'entry-row__meta' }, parts || 'No data entered'),
        m.notes ? Utils.el('div', { class: 'entry-row__notes' }, m.notes) : null,
      ].filter(Boolean)),
      Utils.el('div', { class: 'row-actions' }, [deleteBtn]),
    ]);
  }

  function buildMeasurementChart(entries, fieldKeys) {
    const fieldDefs = ProgressEngine.MEASUREMENT_FIELDS.filter(f => fieldKeys.includes(f.key));
    const series = fieldDefs.map((f, i) => ({
      label: f.label, color: ChartUtils.COLORS[i % ChartUtils.COLORS.length],
      points: ProgressEngine.getMeasurementSeries(entries, f.key).map(p => ({ x: p.date, y: p.value })),
    })).filter(s => s.points.length);
    if (!series.length) return null;
    return ChartUtils.buildLineChartSVG(series, { yUnit: ' cm' });
  }

  // =====================================================================
  // TRANSFORMATION HERO — the specific stat set Section 7 asks for,
  // distinct from the main Progress Hero above.
  // =====================================================================

  function renderTransformationHeroCard(data) {
    const { activeProgram, profile, measurementEntries, targets } = data;
    const counters = activeProgram ? Calculations.getProgramDayCounters(activeProgram) : null;
    const waistChange = ProgressEngine.computeMeasurementChange(measurementEntries, 'waistCm');

    const hero = UIFx.hero({
      theme: 'transformation',
      icon: '\uD83D\uDCF7', eyebrow: 'Transformation', title: 'Your Transformation',
      subtitle: 'Photos and measurements, checkpoint by checkpoint.',
      stats: [],
    });
    hero.classList.add('card--hero--compact');
    const inner = hero.querySelector('.hero__inner');

    const rows = [
      ['Starting Weight', Utils.fmt(activeProgram?.startingWeightKg, ' kg')],
      ['Current Weight', Utils.fmt(profile?.currentWeightKg, ' kg')],
      ['Weight Change', targets ? (formatSigned(targets.weightDifferenceKg, ' kg') ?? 'No data entered') : 'No data entered'],
      ['Waist Change', waistChange.changeAbs != null ? `${waistChange.changeAbs >= 0 ? '+' : ''}${waistChange.changeAbs} cm` : 'No data entered'],
      ['Program Days', counters ? `Day ${counters.day} of ${counters.totalDays}` : 'No data entered'],
    ];
    inner.appendChild(Utils.el('div', { class: 'hero__stats', style: 'flex-wrap:wrap;row-gap:14px;' },
      rows.map(([l, v]) => Utils.el('div', { class: 'hero__stat' }, [
        Utils.el('div', { class: 'hero__stat-value' }, v),
        Utils.el('div', { class: 'hero__stat-label' }, l),
      ]))));

    hero.appendChild(Utils.el('div', { class: 'row-actions', style: 'margin-top:16px;' }, [
      Utils.el('a', { class: 'btn btn--primary', href: '#photo-upload-form' }, 'ADD PROGRESS PHOTO'),
    ]));

    return hero;
  }

  // =====================================================================
  // TRANSFORMATION — photo upload, checkpoint-based before/current slider
  // comparison, photo timeline, transformation story, and gallery.
  // =====================================================================

  function renderTransformationCard(data, container) {
    const { userId, progressPhotos } = data;

    const uploadForm = renderPhotoUploadForm(userId, container);
    const dates = [...new Set(progressPhotos.map(p => p.date))].sort((a, b) => b.localeCompare(a));

    const gallery = dates.map(date => Utils.el('div', { class: 'photo-date-group' }, [
      Utils.el('h4', { class: 'photo-date-group__title' }, Utils.formatDate(date)),
      Utils.el('div', { class: 'photo-row' }, ANGLES.map(a => renderPhotoThumb(a.label, progressPhotos.find(p => p.date === date && p.angle === a.value), container))),
    ]));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Transformation'),
        Utils.el('p', { class: 'card__subtitle' }, 'Front, side, back — with date and notes.'),
      ]),
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, 'Your progress photos are private to this device\u2019s local storage \u2014 they are never uploaded anywhere or shown to anyone else.'),
      uploadForm,
      Utils.el('h3', { class: 'form__group-title' }, 'Photo Comparison'),
      renderPhotoSliderComparison(data, container),
      Utils.el('h3', { class: 'form__group-title' }, 'Photo Timeline'),
      renderPhotoTimeline(data, container),
      Utils.el('h3', { class: 'form__group-title' }, 'Transformation Story'),
      renderTransformationStory(data),
      Utils.el('h3', { class: 'form__group-title' }, 'Gallery'),
      gallery.length ? Utils.el('div', {}, gallery) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ]);
  }

  /** Interactive before/current slider — a single <input type="range">
   *  drives a clip-path reveal, which is native, touch-friendly, and
   *  works identically with mouse drag, touch drag, and keyboard arrows. */
  function renderPhotoSliderComparison(data, container) {
    const { progressPhotos, program } = data;
    const dates = [...new Set(progressPhotos.map(p => p.date))].sort((a, b) => a.localeCompare(b));

    if (dates.length < 1) {
      return Utils.el('p', { class: 'card__footnote' }, 'No data entered');
    }

    if (!transformBeforeDate || !dates.includes(transformBeforeDate)) transformBeforeDate = dates[0];
    if (!transformAfterDate || !dates.includes(transformAfterDate)) transformAfterDate = dates[dates.length - 1];

    const checkpoints = program ? ProgressEngine.computeMeasurementCheckpoints(program) : [];
    const checkpointsWithPhotos = checkpoints.filter(cp => dates.includes(cp.date));
    const checkpointChips = checkpointsWithPhotos.length
      ? Utils.el('div', { class: 'chip-row' }, checkpointsWithPhotos.map(cp =>
          Utils.el('button', {
            class: `chip${transformBeforeDate === cp.date ? ' chip--active' : ''}`, type: 'button',
            onClick: () => { transformBeforeDate = cp.date; renderInner(container); },
          }, cp.label)))
      : null;

    const beforeSelect = photoDateSelect(dates, transformBeforeDate, v => { transformBeforeDate = v; renderInner(container); });
    const afterSelect = photoDateSelect(dates, transformAfterDate, v => { transformAfterDate = v; renderInner(container); });

    const pickAngle = (date) => progressPhotos.find(p => p.date === date && p.angle === 'front') || progressPhotos.find(p => p.date === date);
    const beforePhoto = pickAngle(transformBeforeDate);
    const afterPhoto = pickAngle(transformAfterDate);

    const selectors = Utils.el('div', { class: 'form__grid' }, [
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Before'), beforeSelect]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Current'), afterSelect]),
    ]);

    if (!beforePhoto || !afterPhoto) {
      return Utils.el('div', {}, [selectors, checkpointChips, Utils.el('p', { class: 'card__footnote' }, 'No data entered')].filter(Boolean));
    }

    return Utils.el('div', {}, [selectors, checkpointChips, buildBeforeAfterSlider(beforePhoto, afterPhoto, transformBeforeDate, transformAfterDate)].filter(Boolean));
  }

  function buildBeforeAfterSlider(beforePhoto, afterPhoto, dateA, dateB) {
    const beforeImg = Utils.el('img', { src: beforePhoto.imageDataUrl, class: 'photo-slider__img', alt: 'Before' });
    const afterImg = Utils.el('img', { src: afterPhoto.imageDataUrl, class: 'photo-slider__img', alt: 'Current' });
    const afterLayer = Utils.el('div', { class: 'photo-slider__after-layer', style: `clip-path: inset(0 0 0 ${sliderPosition}%);` }, afterImg);
    const handle = Utils.el('div', { class: 'photo-slider__handle', style: `left:${sliderPosition}%;` });
    const beforeLabel = Utils.el('span', { class: 'photo-slider__label photo-slider__label--before' }, `Before \u00b7 ${Utils.formatDate(dateA)}`);
    const afterLabel = Utils.el('span', { class: 'photo-slider__label photo-slider__label--after' }, `Current \u00b7 ${Utils.formatDate(dateB)}`);
    const stage = Utils.el('div', { class: 'photo-slider__stage' }, [beforeImg, afterLayer, handle, beforeLabel, afterLabel]);

    const range = Utils.el('input', { class: 'photo-slider__range', type: 'range', min: 0, max: 100, value: sliderPosition });
    range.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      sliderPosition = v;
      afterLayer.style.clipPath = `inset(0 0 0 ${v}%)`;
      handle.style.left = `${v}%`;
    });

    return Utils.el('div', { class: 'photo-slider' }, [stage, range]);
  }

  /** Select a date to view (and, via the upload form above, replace or
   *  delete) that date's photos — permissions match exactly what the
   *  gallery/upload form already support, nothing new is added here. */
  function renderPhotoTimeline(data, container) {
    const { progressPhotos } = data;
    const dates = [...new Set(progressPhotos.map(p => p.date))].sort((a, b) => b.localeCompare(a));
    if (!dates.length) return Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    if (!timelineSelectedDate || !dates.includes(timelineSelectedDate)) timelineSelectedDate = dates[0];

    const dateChips = Utils.el('div', { class: 'chip-row', style: 'flex-wrap:wrap;' }, dates.map(d =>
      Utils.el('button', {
        class: `chip${d === timelineSelectedDate ? ' chip--active' : ''}`, type: 'button',
        onClick: () => { timelineSelectedDate = d; renderInner(container); },
      }, Utils.formatDate(d))));

    const thumbs = ANGLES.map(a => renderPhotoThumb(a.label, progressPhotos.find(p => p.date === timelineSelectedDate && p.angle === a.value), container));

    return Utils.el('div', {}, [dateChips, Utils.el('div', { class: 'photo-row' }, thumbs)]);
  }

  /** Anchors real logged data to the program's own checkpoint days (the
   *  same ones used for Milestones) and reports only what actually exists
   *  — a checkpoint with nothing logged near it is simply left out. */
  function renderTransformationStory(data) {
    const { program, weightEntries, measurementEntries, progressPhotos } = data;
    if (!program) return Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    const checkpoints = ProgressEngine.computeMeasurementCheckpoints(program);
    const anchored = ProgressEngine.buildTransformationCheckpoints(checkpoints, weightEntries, measurementEntries, progressPhotos);
    if (!anchored.length) return Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    const lines = anchored.map(cp => {
      const parts = [];
      if (cp.weightKg != null) parts.push(`${cp.weightKg} kg`);
      if (cp.waistCm != null) parts.push(`waist ${cp.waistCm} cm`);
      if (cp.hasPhoto) parts.push('photo logged');
      return `${cp.label} (${Utils.formatDate(cp.date)}): ${parts.join(', ')}`;
    });

    let summary = null;
    if (anchored.length >= 2) {
      const first = anchored[0], last = anchored[anchored.length - 1];
      const bits = [];
      if (first.weightKg != null && last.weightKg != null) {
        const diff = Math.round((last.weightKg - first.weightKg) * 10) / 10;
        bits.push(`weight ${diff >= 0 ? '+' : ''}${diff} kg`);
      }
      if (first.waistCm != null && last.waistCm != null) {
        const diff = Math.round((last.waistCm - first.waistCm) * 10) / 10;
        bits.push(`waist ${diff >= 0 ? '+' : ''}${diff} cm`);
      }
      if (bits.length) summary = `From ${first.label} to ${last.label}: ${bits.join(', ')}.`;
    }

    return Utils.el('div', {}, [
      summary ? Utils.el('p', {}, summary) : null,
      Utils.el('ul', { class: 'error-list' }, lines.map(s => Utils.el('li', {}, s))),
    ].filter(Boolean));
  }

  function photoDateSelect(dates, value, onChange) {
    const select = Utils.el('select', { class: 'form__input' }, [
      Utils.el('option', { value: '' }, '\u2014 Select \u2014'),
      ...dates.map(d => { const o = Utils.el('option', { value: d }, Utils.formatDate(d)); if (d === value) o.setAttribute('selected', 'selected'); return o; }),
    ]);
    select.addEventListener('change', (e) => onChange(e.target.value));
    return select;
  }

  function renderPhotoUploadForm(userId, container) {
    const dateInput = Utils.el('input', { class: 'form__input', type: 'date', value: Models.todayIso() });
    const angleSelect = Utils.el('select', { class: 'form__input' }, ANGLES.map(a => Utils.el('option', { value: a.value }, a.label)));
    const notesInput = Utils.el('input', { class: 'form__input', type: 'text', placeholder: 'Notes (optional)' });
    const fileInput = Utils.el('input', { class: 'form__input', type: 'file', accept: 'image/*' });

    const saveBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button' }, 'Save Photo');
    saveBtn.addEventListener('click', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) { Utils.toast('Choose an image file.', 'error'); return; }
      const dataUrl = await readFileAsDataUrl(file);
      const date = dateInput.value || Models.todayIso();
      const angle = angleSelect.value;
      // Replace, don't duplicate: a second upload for the same date+angle
      // updates that photo instead of creating a second one alongside it.
      const existing = (await DataService.progressPhotos.list(p => p.userId === userId && p.date === date && p.angle === angle))[0];
      if (existing) {
        await DataService.progressPhotos.update(existing.progressPhotoId, { imageDataUrl: dataUrl, notes: notesInput.value });
        Utils.toast('Photo replaced.', 'success');
      } else {
        await DataService.progressPhotos.create(Models.createProgressPhoto(userId, date, { angle, imageDataUrl: dataUrl, notes: notesInput.value }));
        Utils.toast('Photo saved.', 'success');
      }
      await renderInner(container);
    });

    return Utils.el('div', { class: 'form__grid', id: 'photo-upload-form' }, [
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Date'), dateInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Angle'), angleSelect]),
      Utils.el('div', { class: 'form__field form__field--wide' }, [Utils.el('label', { class: 'form__label' }, 'Notes'), notesInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Photo'), fileInput]),
      saveBtn,
    ]);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderPhotoThumb(label, photo, container) {
    const img = photo && photo.imageDataUrl
      ? Utils.el('img', { src: photo.imageDataUrl, class: 'photo-thumb__img', alt: label })
      : Utils.el('div', { class: 'photo-thumb__placeholder' }, 'No data entered');
    const deleteBtn = photo ? Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => { await DataService.progressPhotos.delete(photo.progressPhotoId); await renderInner(container); },
    }, 'Delete') : null;
    return Utils.el('div', { class: 'photo-thumb' }, [
      Utils.el('div', { class: 'photo-thumb__label' }, label),
      img,
      photo && photo.notes ? Utils.el('div', { class: 'photo-thumb__notes' }, photo.notes) : null,
      deleteBtn,
    ].filter(Boolean));
  }

  // =====================================================================
  // ADHERENCE — a calendar heatmap of DailyTrackingEngine's daily score.
  // Clicking a day inspects that day's workout/nutrition/water/steps/sleep
  // (all from the same single computeDaySummary call Reports/Dashboard use).
  // =====================================================================

  function renderAdherenceCard(data, dailyData, container) {
    if (!adherenceMonth) {
      adherenceMonth = (data.activeProgram?.startDate || Models.todayIso()).slice(0, 7);
    }
    const [year, month] = adherenceMonth.split('-').map(Number);
    const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7; // Monday-first grid

    const cells = [];
    for (let i = 0; i < leadingBlanks; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push(dateStr);
    }

    const today = Models.todayIso();
    const heatmapCells = cells.map(dateStr => {
      if (!dateStr) return Utils.el('div', { class: 'adherence-cell adherence-cell--blank' });
      if (dateStr > today) return Utils.el('div', { class: 'adherence-cell adherence-cell--future' }, String(Number(dateStr.slice(-2))));
      const score = DailyTrackingEngine.computeDailyScore(dateStr, dailyData, dailyData.checklistsByDate?.[dateStr] || {});
      const pct = score.overall;
      const level = pct == null ? 'none' : pct >= 80 ? '4' : pct >= 60 ? '3' : pct >= 30 ? '2' : pct > 0 ? '1' : 'none';
      const cell = Utils.el('button', {
        class: `adherence-cell adherence-cell--${level}${dateStr === selectedAdherenceDate ? ' adherence-cell--selected' : ''}`,
        type: 'button', title: pct != null ? `${dateStr}: ${pct}%` : `${dateStr}: No data entered`,
        onClick: () => { selectedAdherenceDate = dateStr; renderInner(container); },
      }, String(Number(dateStr.slice(-2))));
      return cell;
    });

    const prevBtn = Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { adherenceMonth = shiftMonth(adherenceMonth, -1); renderInner(container); } }, '\u2190');
    const nextBtn = Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { adherenceMonth = shiftMonth(adherenceMonth, 1); renderInner(container); } }, '\u2192');
    const monthLabel = firstOfMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const detail = selectedAdherenceDate ? renderAdherenceDetail(selectedAdherenceDate, dailyData) : null;

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Adherence'),
          Utils.el('p', { class: 'card__subtitle' }, monthLabel),
        ]),
        Utils.el('div', { class: 'row-actions' }, [prevBtn, nextBtn]),
      ]),
      Utils.el('div', { class: 'adherence-grid' }, heatmapCells),
      Utils.el('p', { class: 'card__footnote' }, 'Click a day to see its workout, nutrition, water, steps, and sleep.'),
      detail,
    ].filter(Boolean));
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function renderAdherenceDetail(dateStr, dailyData) {
    const summary = DailyTrackingEngine.computeDaySummary(dateStr, dailyData);
    const rows = [
      ['Workout', summary.workout.done ? `${summary.workout.count} session${summary.workout.count === 1 ? '' : 's'}${summary.workout.minutes ? `, ${summary.workout.minutes} min` : ''}` : 'No data entered'],
      ['Calories', summary.calories.consumed != null ? `${summary.calories.consumed} kcal${summary.calories.target != null ? ` / ${summary.calories.target} kcal` : ''}` : 'No data entered'],
      ['Protein', summary.protein.consumed != null ? `${summary.protein.consumed} g${summary.protein.target != null ? ` / ${summary.protein.target} g` : ''}` : 'No data entered'],
      ['Water', summary.water.consumedMl != null ? `${summary.water.consumedMl} ml${summary.water.targetMl != null ? ` / ${summary.water.targetMl} ml` : ''}` : 'No data entered'],
      ['Steps', summary.steps.consumed != null ? `${summary.steps.consumed}${summary.steps.target != null ? ` / ${summary.steps.target}` : ''}` : 'No data entered'],
      ['Sleep', summary.sleep.hoursSlept != null ? `${summary.sleep.hoursSlept} h${summary.sleep.targetHours != null ? ` / ${summary.sleep.targetHours} h` : ''}` : 'No data entered'],
    ];
    return Utils.el('div', { class: 'card', style: 'margin-top:12px;background:var(--surface-alt);' }, [
      Utils.el('h3', { class: 'form__group-title', style: 'margin-top:0;' }, Utils.formatDate(dateStr)),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
    ]);
  }

  // =====================================================================
  // COMPARISON — Starting vs Current / Previous Period vs Current /
  // Target vs Actual. The latter two reuse ReportsEngine's weekly
  // aggregation (same math as the Reports page), just for two different
  // week-ending dates to diff them.
  // =====================================================================

  function renderComparisonCard(data, reportsData, container) {
    const tabs = [
      ['starting_vs_current', 'Starting vs. Current'],
      ['previous_vs_current', 'Previous Period vs. Current'],
      ['target_vs_actual', 'Target vs. Actual'],
    ];
    const tabRow = Utils.el('div', { class: 'chip-row' }, tabs.map(([key, label]) =>
      Utils.el('button', { class: `chip${comparisonView === key ? ' chip--active' : ''}`, type: 'button', onClick: () => { comparisonView = key; renderInner(container); } }, label)));

    let body;
    if (comparisonView === 'starting_vs_current') {
      body = renderStartingVsCurrent(data);
    } else if (comparisonView === 'previous_vs_current') {
      body = renderPreviousVsCurrent(reportsData);
    } else {
      body = renderTargetVsActual(data, reportsData);
    }

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Comparison')),
      tabRow,
      body,
    ]);
  }

  function renderStartingVsCurrent(data) {
    const { profile, activeProgram, targets, measurementEntries } = data;
    const rows = [
      ['Weight', Utils.fmt(activeProgram?.startingWeightKg, ' kg'), Utils.fmt(profile?.currentWeightKg, ' kg'), targets ? (formatSigned(targets.weightDifferenceKg, ' kg') ?? 'No data entered') : 'No data entered'],
      ...ProgressEngine.MEASUREMENT_FIELDS.map(f => {
        const c = ProgressEngine.computeMeasurementChange(measurementEntries, f.key);
        return [f.label, c.first != null ? `${c.first} ${f.unit}` : 'No data entered', c.last != null ? `${c.last} ${f.unit}` : 'No data entered', c.changeAbs != null ? `${c.changeAbs >= 0 ? '+' : ''}${c.changeAbs} ${f.unit}` : 'No data entered'];
      }),
    ];
    return comparisonTable(['Metric', 'Starting', 'Current', 'Change'], rows);
  }

  function renderPreviousVsCurrent(reportsData) {
    const today = Models.todayIso();
    const thisWeek = ReportsEngine.computeWeeklyReport(today, reportsData);
    const lastWeek = ReportsEngine.computeWeeklyReport(ProgramTemplates.addDays(today, -7), reportsData);
    const rows = [
      ['Avg. Calories', lastWeek.avgCalories, thisWeek.avgCalories, ' kcal'],
      ['Avg. Protein', lastWeek.avgProtein, thisWeek.avgProtein, ' g'],
      ['Avg. Steps', lastWeek.avgSteps, thisWeek.avgSteps, ''],
      ['Avg. Water', lastWeek.avgWaterMl, thisWeek.avgWaterMl, ' ml'],
      ['Workout Completion', lastWeek.avgWorkoutCompletion, thisWeek.avgWorkoutCompletion, '%'],
    ].map(([label, prev, cur, unit]) => [
      label, prev != null ? `${prev}${unit}` : 'No data entered', cur != null ? `${cur}${unit}` : 'No data entered',
      (prev != null && cur != null) ? formatSigned(Math.round((cur - prev) * 10) / 10, unit) : 'No data entered',
    ]);
    return comparisonTable(['Metric', 'Previous Week', 'This Week', 'Change'], rows);
  }

  function renderTargetVsActual(data, reportsData) {
    const { targets } = data;
    const report = ReportsEngine.computeWeeklyReport(Models.todayIso(), reportsData);
    const rows = [
      ['Calories', report.avgCalories, targets?.calorieTarget, ' kcal'],
      ['Protein', report.avgProtein, targets?.proteinTargetG, ' g'],
      ['Water', report.avgWaterMl, targets?.waterTargetMl, ' ml'],
      ['Steps', report.avgSteps, targets?.stepTarget, ''],
    ].map(([label, actual, target, unit]) => [
      label, actual != null ? `${actual}${unit}` : 'No data entered', target != null ? `${target}${unit}` : 'No data entered',
      (actual != null && target != null) ? `${Math.round((actual / target) * 100)}%` : 'No data entered',
    ]);
    return comparisonTable(['Metric', 'Actual (7-day avg)', 'Target', '% of Target'], rows);
  }

  function comparisonTable(headers, rows) {
    return Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
      Utils.el('thead', {}, Utils.el('tr', {}, headers.map(h => Utils.el('th', {}, h)))),
      Utils.el('tbody', {}, rows.map(r => Utils.el('tr', {}, r.map(c => Utils.el('td', {}, c))))),
    ]));
  }

  // =====================================================================
  // HISTORY — daily / weekly / monthly / program views of weight.
  // =====================================================================

  function renderHistoryGranularityCard(data, container) {
    const { weightEntries, activeProgram, targets } = data;
    const tabs = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['program', 'Program']];
    const tabRow = Utils.el('div', { class: 'chip-row' }, tabs.map(([key, label]) =>
      Utils.el('button', { class: `chip${historyGranularity === key ? ' chip--active' : ''}`, type: 'button', onClick: () => { historyGranularity = key; renderInner(container); } }, label)));

    let body;
    if (historyGranularity === 'daily') {
      const sorted = [...weightEntries].filter(w => w.weightKg != null).sort((a, b) => b.date.localeCompare(a.date));
      body = sorted.length ? comparisonTable(['Date', 'Weight'], sorted.map(w => [Utils.formatDate(w.date), `${w.weightKg} kg`]))
        : Utils.el('p', { class: 'card__footnote' }, 'No data entered');
    } else if (historyGranularity === 'weekly' || historyGranularity === 'monthly') {
      const groups = ProgressEngine.groupWeightBy(weightEntries, historyGranularity).sort((a, b) => b.key.localeCompare(a.key));
      body = groups.length ? comparisonTable([historyGranularity === 'weekly' ? 'Week' : 'Month', 'Avg. Weight', 'Entries'], groups.map(g => [g.key, `${g.avgKg} kg`, `${g.count}`]))
        : Utils.el('p', { class: 'card__footnote' }, 'No data entered');
    } else {
      const rows = [
        ['Program', activeProgram?.name ?? 'No data entered'],
        ['Starting weight', Utils.fmt(activeProgram?.startingWeightKg, ' kg')],
        ['Current weight', Utils.fmt(data.profile?.currentWeightKg, ' kg')],
        ['Total change', targets ? (formatSigned(targets.weightDifferenceKg, ' kg') ?? 'No data entered') : 'No data entered'],
        ['% change', targets && targets.percentWeightChangeSinceStart != null ? `${targets.percentWeightChangeSinceStart > 0 ? '+' : ''}${targets.percentWeightChangeSinceStart}%` : 'No data entered'],
      ];
      body = Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)]));
    }

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'History')),
      tabRow,
      body,
    ]);
  }

  // =====================================================================
  // CHARTS — Calories / Protein / Steps / Water / Workout completion
  // =====================================================================

  function renderChartsCard(data, container) {
    const { program, targets, mealItems, waterEntries, stepEntries, workouts, workoutExercises, workoutSets } = data;

    const range = buildDateRange(program);
    if (!range.length) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Charts')),
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'No data entered'),
          Utils.el('a', { class: 'btn btn--secondary', href: '#/programs' }, 'Set up a program to see charts over its timeline'),
        ]),
      ]);
    }

    const caloriePoints = [], proteinPoints = [], stepsPoints = [], waterPoints = [], workoutPoints = [];
    range.forEach(date => {
      const dayEntries = mealItems.filter(e => e.date === date);
      const summary = DietEngine.computeDailySummary(dayEntries, targets);
      const cal = summary.find(r => r.key === 'calories');
      const pro = summary.find(r => r.key === 'proteinG');
      if (cal.consumed != null) caloriePoints.push({ x: date, y: cal.consumed });
      if (pro.consumed != null) proteinPoints.push({ x: date, y: pro.consumed });
      const steps = DailyTrackingEngine.sumSteps(stepEntries, date);
      if (steps) stepsPoints.push({ x: date, y: steps });
      const water = DailyTrackingEngine.sumWaterMl(waterEntries, date);
      if (water) waterPoints.push({ x: date, y: water });
      const completion = WorkoutEngine.computeDailyWorkoutCompletion(date, workouts, workoutExercises, workoutSets);
      if (completion != null) workoutPoints.push({ x: date, y: completion });
    });

    const charts = [
      ['Calories', caloriePoints, ' kcal', targets?.calorieTarget],
      ['Protein', proteinPoints, ' g', targets?.proteinTargetG],
      ['Steps', stepsPoints, '', targets?.stepTarget],
      ['Water', waterPoints, ' ml', targets?.waterTargetMl],
    ].map(([label, points, unit, targetY]) => {
      const svg = points.length ? ChartUtils.buildLineChartSVG([{ label, points }], { yUnit: unit, targetY: targetY ?? null, targetLabel: 'Target', yDecimals: 0 }) : null;
      return Utils.el('div', {}, [
        Utils.el('h3', { class: 'form__group-title' }, label),
        svg ? svgHost(svg) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
      ]);
    });

    const workoutSvg = workoutPoints.length ? ChartUtils.buildBarChartSVG(workoutPoints) : null;
    charts.push(Utils.el('div', {}, [
      Utils.el('h3', { class: 'form__group-title' }, 'Workout Completion'),
      workoutSvg ? svgHost(workoutSvg) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ]));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Charts'),
        Utils.el('p', { class: 'card__subtitle' }, program ? `${program.name} — ${Utils.formatDate(range[0])} to ${Utils.formatDate(range[range.length - 1])}` : ''),
      ]),
      ...charts,
    ]);
  }

  function buildDateRange(program) {
    if (!program || !program.startDate || !program.durationDays) return [];
    const days = [];
    for (let i = 0; i < program.durationDays; i++) days.push(ProgramTemplates.addDays(program.startDate, i));
    return days;
  }

  // =====================================================================
  // HELPERS
  // =====================================================================

  function svgHost(svgString) {
    const div = Utils.el('div', { class: 'chart-host' });
    div.innerHTML = svgString;
    return div;
  }

  function formatSigned(val, suffix) {
    if (val === null || val === undefined) return null;
    const sign = val > 0 ? '+' : '';
    return `${sign}${val}${suffix}`;
  }

  return { render };
})();
