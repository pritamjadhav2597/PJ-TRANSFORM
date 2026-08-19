/**
 * pages/reports.js — Reports & Analytics. Every number comes from
 * ReportsEngine, which itself only reuses Calculations/DietEngine/
 * DailyTrackingEngine/WorkoutEngine/RecoveryEngine/ProgressEngine — this
 * page never computes a statistic itself and never fabricates one when
 * data is missing ("No data entered" throughout).
 */

const PageReports = (() => {

  let weekEndDate = Models.todayIso();
  let selectedProgramId = null;
  let chartsScope = 'week'; // 'week' | 'program'

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
    const programs = await DataService.programs.list(p => p.userId === userId);
    const runnable = programs.filter(p => p.startDate && p.durationDays);
    if (!selectedProgramId || !runnable.some(p => p.programId === selectedProgramId)) {
      selectedProgramId = (runnable.find(p => p.status === 'active') || runnable[0] || {}).programId || null;
    }
    const selectedProgram = runnable.find(p => p.programId === selectedProgramId) || null;
    const activeProgram = runnable.find(p => p.status === 'active') || selectedProgram;

    const phases = activeProgram ? await DataService.programPhases.list(ph => ph.programId === activeProgram.programId) : [];
    const currentPhase = phases.length ? Calculations.getCurrentPhase(phases) : null;
    const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
    const targets = profile ? Calculations.calculateAllTargets(profile, { weightEntries, program: activeProgram, phase: currentPhase }) : null;

    const measurementEntries = await DataService.measurementEntries.list(m => m.userId === userId);
    const recoveryEntries = await DataService.recoveryEntries.list(r => r.userId === userId);
    const sexualWellbeingEntries = profile?.wellbeingDashboardVisible ? await DataService.sexualWellbeingEntries.list(e => e.userId === userId) : [];
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
    const targetHistory = await DataService.targetHistory.list(h => h.userId === userId);

    const data = {
      entries: mealItems, waterEntries, stepEntries, workouts, workoutExercises, workoutSets, sleepEntries,
      weightEntries, measurementEntries, recoveryEntries, sexualWellbeingEntries, targets, profile, checklistsByDate,
    };

    const weeklyReport = ReportsEngine.computeWeeklyReport(weekEndDate, data);
    const insights = ReportsEngine.generateWeeklyInsights(weeklyReport, targets, profile);
    const programReport = selectedProgram ? ReportsEngine.computeProgramReport(selectedProgram, data) : null;

    container.appendChild(renderReportsHero(weeklyReport));
    container.appendChild(renderWeeklyReportCard(weeklyReport, profile, container));
    container.appendChild(renderInsightsCard(insights));
    container.appendChild(renderProgramReportCard(runnable, selectedProgram, programReport, profile, container));
    container.appendChild(renderTargetHistoryCard(targetHistory));
    container.appendChild(renderChartsCard(weeklyReport, programReport, data, container));

    UIFx.animateIn(container);
  }

  // =====================================================================
  // HERO — the week's overall daily-completion score as a ring, plus
  // workout completion and recovery as quick side stats.
  // =====================================================================

  function renderReportsHero(report) {
    const pct = report.avgDailyCompletion ?? 0;
    const hero = UIFx.hero({
      theme: 'progress',
      icon: '\uD83D\uDCCA',
      eyebrow: 'Weekly Report',
      title: 'This Week at a Glance',
      subtitle: report.avgDailyCompletion != null
        ? `Averaging ${report.avgDailyCompletion}% daily completion for the 7 days ending ${Utils.formatDate(weekEndDate)}.`
        : 'No tracking data yet for this week.',
      stats: [
        ['Workout completion', report.avgWorkoutCompletion != null ? `${report.avgWorkoutCompletion}%` : 'No data entered', false],
        ['Recovery', report.recoveryAvg != null ? `${report.recoveryAvg} / 5` : 'No data entered', false],
        ['Weight change', report.weightChange != null ? signed(report.weightChange, ' kg') : 'No data entered', true],
      ],
      ring: { pct, number: report.avgDailyCompletion != null ? `${report.avgDailyCompletion}%` : '\u2013', of: 'daily avg' },
    });
    return hero;
  }

  // =====================================================================
  // WEEKLY REPORT
  // =====================================================================

  function renderWeeklyReportCard(report, profile, container) {
    const dateBar = Utils.el('input', {
      class: 'form__input', type: 'date', value: weekEndDate,
      onChange: (e) => { if (e.target.value) { weekEndDate = e.target.value; renderInner(container); } },
    });

    const rows = [
      ['Starting weight', Utils.fmt(report.startingWeight, ' kg')],
      ['Current weight', Utils.fmt(report.finalWeight, ' kg')],
      ['7-day average', Utils.fmt(report.sevenDayAverageWeightKg, ' kg')],
      ['Weight change', signed(report.weightChange, ' kg')],
      ['Waist change', signed(report.waistChange, ' cm')],
      ['Average calories', Utils.fmt(report.avgCalories, ' kcal')],
      ['Average protein', Utils.fmt(report.avgProtein, ' g')],
      ['Average carbs', Utils.fmt(report.avgCarbs, ' g')],
      ['Average fat', Utils.fmt(report.avgFat, ' g')],
      ['Average fibre', Utils.fmt(report.avgFibre, ' g')],
      ['Calcium', Utils.fmt(report.avgCalcium, ' mg')],
      ['Potassium', Utils.fmt(report.avgPotassium, ' mg')],
      ['Magnesium', Utils.fmt(report.avgMagnesium, ' mg')],
      ['Iron', Utils.fmt(report.avgIron, ' mg')],
      ['Zinc', Utils.fmt(report.avgZinc, ' mg')],
      ['Average steps', Utils.fmt(report.avgSteps)],
      ['Water', Utils.fmt(report.avgWaterMl, ' ml')],
      ['Sleep', Utils.fmt(report.avgSleepHours, ' h')],
      ['Workout completion', Utils.fmt(report.avgWorkoutCompletion, '%')],
      ['Recovery', Utils.fmt(report.recoveryAvg, ' / 5')],
      ['Energy', Utils.fmt(report.energyAvg, ' / 5')],
      ['Stress', Utils.fmt(report.stressAvg, ' / 5')],
      ['Daily completion %', Utils.fmt(report.avgDailyCompletion, '%')],
    ];
    if (profile?.wellbeingDashboardVisible) rows.push(['Libido (private)', Utils.fmt(report.libidoAvg, ' / 5')]);

    const strengthList = report.strengthProgression.length
      ? Utils.el('ul', { class: 'error-list' }, report.strengthProgression.slice(0, 6).map(s =>
          Utils.el('li', {}, `${s.exerciseName}: ${s.firstE1RM} kg \u2192 ${s.lastE1RM} kg est. 1RM (${s.changeKg >= 0 ? '+' : ''}${s.changeKg} kg)`)))
      : Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [Utils.el('h2', { class: 'card__title' }, 'Weekly Report'), Utils.el('p', { class: 'card__subtitle' }, `${Utils.formatDate(report.rangeStart)} \u2013 ${Utils.formatDate(report.rangeEnd)}`)]),
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Week ending'), dateBar]),
      ]),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
      Utils.el('h3', { class: 'form__group-title' }, 'Strength Progression'),
      strengthList,
    ]);
  }

  // =====================================================================
  // INSIGHTS
  // =====================================================================

  function renderInsightsCard(insights) {
    const section = (title, items, emptyText) => Utils.el('div', {}, [
      Utils.el('h3', { class: 'form__group-title' }, title),
      items.length ? Utils.el('ul', { class: 'error-list' }, items.map(i => Utils.el('li', {}, i))) : Utils.el('p', { class: 'card__footnote' }, emptyText),
    ]);

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Insights'),
        Utils.el('p', { class: 'card__subtitle' }, 'Generated from your actual logged data for the week above.'),
      ]),
      section('What Went Well', insights.wentWell, 'No data entered'),
      section('What Needs Improvement', insights.needsImprovement, 'No data entered'),
      section("Next Week's Focus", insights.nextWeekFocus, 'No data entered'),
    ]);
  }

  // =====================================================================
  // PROGRAM REPORT
  // =====================================================================

  function renderProgramReportCard(programs, selectedProgram, report, profile, container) {
    if (!selectedProgram || !report) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Program Report')),
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'No data entered'),
          Utils.el('a', { class: 'btn btn--secondary', href: '#/programs' }, 'Set up a program'),
        ]),
      ]);
    }

    const programSelect = programs.length > 1 ? Utils.el('select', { class: 'form__input', style: 'max-width:260px;' },
      programs.map(p => {
        const opt = Utils.el('option', { value: p.programId }, p.name || 'Untitled Program');
        if (p.programId === selectedProgram.programId) opt.setAttribute('selected', 'selected');
        return opt;
      })) : null;
    if (programSelect) programSelect.addEventListener('change', (e) => { selectedProgramId = e.target.value; renderInner(container); });

    const rows = [
      ['Starting weight', Utils.fmt(report.startingWeight, ' kg')],
      ['Final weight', Utils.fmt(report.finalWeight, ' kg')],
      ['Total weight change', signed(report.weightChange, ' kg')],
      ['Percentage change', report.percentWeightChange != null ? `${report.percentWeightChange > 0 ? '+' : ''}${report.percentWeightChange}%` : 'No data entered'],
      ['Waist change', signed(report.waistChange, ' cm')],
      ['Average calories', Utils.fmt(report.avgCalories, ' kcal')],
      ['Average protein', Utils.fmt(report.avgProtein, ' g')],
      ['Average carbs', Utils.fmt(report.avgCarbs, ' g')],
      ['Average fat', Utils.fmt(report.avgFat, ' g')],
      ['Average fibre', Utils.fmt(report.avgFibre, ' g')],
      ['Calcium', Utils.fmt(report.avgCalcium, ' mg')],
      ['Potassium', Utils.fmt(report.avgPotassium, ' mg')],
      ['Magnesium', Utils.fmt(report.avgMagnesium, ' mg')],
      ['Iron', Utils.fmt(report.avgIron, ' mg')],
      ['Zinc', Utils.fmt(report.avgZinc, ' mg')],
      ['Average steps', Utils.fmt(report.avgSteps)],
      ['Water', Utils.fmt(report.avgWaterMl, ' ml')],
      ['Sleep', Utils.fmt(report.avgSleepHours, ' h')],
      ['Workout completion', Utils.fmt(report.avgWorkoutCompletion, '%')],
      ['Recovery', Utils.fmt(report.recoveryAvg, ' / 5')],
      ['Energy', Utils.fmt(report.energyAvg, ' / 5')],
    ];
    if (profile?.wellbeingDashboardVisible) rows.push(['Sexual wellbeing (private)', Utils.fmt(report.libidoAvg, ' / 5 libido')]);

    const measurementRows = report.measurementChanges.flatMap(m => [
      m.label, m.changeAbs != null ? `${m.changeAbs >= 0 ? '+' : ''}${m.changeAbs} ${m.unit}` : 'No data entered',
    ]);

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Program Report'),
          Utils.el('p', { class: 'card__subtitle' }, `${report.programName || 'Program'} \u2014 ${Utils.formatDate(report.rangeStart)} \u2013 ${Utils.formatDate(report.rangeEnd)}${report.isComplete ? ' (complete)' : ' (in progress)'}`),
        ]),
        programSelect,
      ]),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
      Utils.el('h3', { class: 'form__group-title' }, 'Measurements'),
      Utils.el('dl', { class: 'stat-list' }, measurementRows.map((v, i) => (i % 2 === 0 ? Utils.el('dt', {}, v) : Utils.el('dd', {}, v)))),
    ]);
  }

  // =====================================================================
  // TARGET HISTORY
  // =====================================================================

  function renderTargetHistoryCard(targetHistory) {
    const rows = ReportsEngine.buildTargetHistoryRows(targetHistory);
    const body = rows.length
      ? Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
          Utils.el('thead', {}, Utils.el('tr', {}, ['Field', 'Old Value', 'New Value', 'Date', 'Reason'].map(h => Utils.el('th', {}, h)))),
          Utils.el('tbody', {}, rows.map(r => Utils.el('tr', {}, [
            Utils.el('td', {}, r.field),
            Utils.el('td', {}, r.oldValue != null ? `${r.oldValue}${r.unit}` : 'No data entered'),
            Utils.el('td', {}, r.newValue != null ? `${r.newValue}${r.unit}` : 'No data entered'),
            Utils.el('td', {}, Utils.formatDate(r.date)),
            Utils.el('td', {}, r.reason ? r.reason.replace(/_/g, ' ') : '\u2014'),
          ]))),
        ]))
      : Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Target History'),
        Utils.el('p', { class: 'card__subtitle' }, 'Every recalculation that actually changed a target.'),
      ]),
      body,
    ]);
  }

  // =====================================================================
  // CHARTS
  // =====================================================================

  function renderChartsCard(weeklyReport, programReport, data, container) {
    const scopeToggle = Utils.el('div', { class: 'chip-row' }, [
      Utils.el('button', { class: `chip${chartsScope === 'week' ? ' chip--active' : ''}`, type: 'button', onClick: () => { chartsScope = 'week'; renderInner(container); } }, 'This Week'),
      Utils.el('button', { class: `chip${chartsScope === 'program' ? ' chip--active' : ''}`, type: 'button', onClick: () => { chartsScope = 'program'; renderInner(container); } }, 'Full Program'),
    ]);

    const range = (chartsScope === 'program' && programReport)
      ? ReportsEngine.buildDateRangeBetween(programReport.rangeStart, programReport.rangeEnd)
      : ReportsEngine.buildTrailingDateRange(weeklyReport.rangeEnd, 7);

    if (!range.length) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Charts')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }

    const daySummaries = range.map(d => DailyTrackingEngine.computeDaySummary(d, data));

    const lineChart = (label, points, unit, targetY) => {
      const svg = points.length ? ChartUtils.buildLineChartSVG([{ label, points }], { yUnit: unit, targetY: targetY ?? null, targetLabel: 'Target', yDecimals: unit === ' kg' ? 1 : 0 }) : null;
      return Utils.el('div', {}, [
        Utils.el('h3', { class: 'form__group-title' }, label),
        svg ? svgHost(svg) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
      ]);
    };

    const weightPoints = data.weightEntries.filter(w => range.includes(w.date) && w.weightKg != null).map(w => ({ x: w.date, y: w.weightKg }));
    const caloriePoints = daySummaries.filter(d => d.calories.consumed != null).map(d => ({ x: d.date, y: d.calories.consumed }));
    const proteinPoints = daySummaries.filter(d => d.protein.consumed != null).map(d => ({ x: d.date, y: d.protein.consumed }));
    const stepPoints = daySummaries.filter(d => d.steps.consumed != null).map(d => ({ x: d.date, y: d.steps.consumed }));
    const waterPoints = daySummaries.filter(d => d.water.consumedMl != null).map(d => ({ x: d.date, y: d.water.consumedMl }));
    const sleepPoints = daySummaries.filter(d => d.sleep.hoursSlept != null).map(d => ({ x: d.date, y: d.sleep.hoursSlept }));
    const workoutPoints = range
      .map(d => ({ x: d, y: WorkoutEngine.computeDailyWorkoutCompletion(d, data.workouts, data.workoutExercises, data.workoutSets) }))
      .filter(p => p.y != null);

    const measurementEntriesInRange = data.measurementEntries.filter(m => range.includes(m.date));
    const measurementSeries = ProgressEngine.MEASUREMENT_FIELDS.map((f, i) => ({
      label: f.label, color: ChartUtils.COLORS[i % ChartUtils.COLORS.length],
      points: ProgressEngine.getMeasurementSeries(measurementEntriesInRange, f.key).map(p => ({ x: p.date, y: p.value })),
    })).filter(s => s.points.length);
    const measurementSvg = measurementSeries.length ? ChartUtils.buildLineChartSVG(measurementSeries, { yUnit: ' cm' }) : null;

    const workoutSvg = workoutPoints.length ? ChartUtils.buildBarChartSVG(workoutPoints) : null;

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Charts'),
        scopeToggle,
      ]),
      lineChart('Weight Trend', weightPoints, ' kg', null),
      lineChart('Calorie Trend', caloriePoints, ' kcal', data.targets?.calorieTarget),
      lineChart('Protein Trend', proteinPoints, ' g', data.targets?.proteinTargetG),
      lineChart('Step Trend', stepPoints, '', data.targets?.stepTarget),
      lineChart('Water Trend', waterPoints, ' ml', data.targets?.waterTargetMl),
      lineChart('Sleep Trend', sleepPoints, ' h', data.profile?.typicalSleepHours),
      Utils.el('div', {}, [
        Utils.el('h3', { class: 'form__group-title' }, 'Workout Completion'),
        workoutSvg ? svgHost(workoutSvg) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
      ]),
      Utils.el('div', {}, [
        Utils.el('h3', { class: 'form__group-title' }, 'Measurement Changes'),
        measurementSvg ? svgHost(measurementSvg) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
      ]),
    ]);
  }

  // =====================================================================
  // HELPERS
  // =====================================================================

  function svgHost(svgString) {
    const div = Utils.el('div', { class: 'chart-host' });
    div.innerHTML = svgString;
    return div;
  }

  function signed(val, suffix) {
    if (val === null || val === undefined) return 'No data entered';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val}${suffix}`;
  }

  return { render };
})();
