/**
 * pages/program-bollywood.js — the "100 Day Body Program" landing
 * page. Content comes entirely from BollywoodProgramData (Phase 1-3) and the
 * program's own ProgramPhase records (dates, comingSoon flags) — this page
 * never invents workout/nutrition content and never computes a personal
 * target itself (Calculations.calculateAllTargets is the only source for
 * that, exactly as everywhere else in the app).
 *
 * This page does NOT duplicate the Workout/Diet/Water/Steps/Sleep/Recovery
 * trackers — every "today" section links into those existing pages, which
 * already read this program's phase-scoped WorkoutTemplates/MealTemplates
 * (via programId) alongside the 60-Day program's own unscoped ones.
 */

const PageProgramBollywood = (() => {

  let expandedPhaseKey = null;
  let expandedDayNumber = null; // day currently drilled into (within whichever phase is expanded)

  async function render(container) {
    expandedPhaseKey = null;
    expandedDayNumber = null;
    await renderInner(container);
  }

  /** "Continue Program" (hero) / "Continue Phase" (phase card) both land on
   *  the same place: today's Day Detail, expanded in place. If today falls
   *  outside every phase (program not started / already finished), this
   *  falls back to opening the given phase's first day so there's always
   *  somewhere for the CTA to land. */
  function jumpToDay(phaseKey, dayNumber, container) {
    expandedPhaseKey = phaseKey;
    expandedDayNumber = dayNumber;
    renderInner(container).then(() => {
      const target = document.getElementById(`day-detail-${dayNumber}`) || document.getElementById(`phase-card-${phaseKey}`);
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function renderInner(container) {
    container.innerHTML = '';

    let userId = DataService.getCurrentUserId();
    if (!userId) {
      const user = await DataService.users.create(Models.createUser({ name: 'New User' }));
      userId = user.userId;
      DataService.setCurrentUserId(userId);
    }

    const programs = await DataService.programs.list(p => p.userId === userId && p.programType === BollywoodProgramData.PROGRAM_TYPE);
    if (!programs.length) {
      container.appendChild(Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, BollywoodProgramData.PROGRAM_NAME)),
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'No data entered'),
          Utils.el('a', { class: 'btn btn--secondary', href: '#/programs' }, 'Start this program'),
        ]),
      ]));
      return;
    }
    const program = programs.find(p => p.status === 'active') || programs.find(p => p.status === 'paused') || programs[0];

    const phases = (await DataService.programPhases.list(p => p.programId === program.programId)).sort((a, b) => a.order - b.order);
    const counters = Calculations.getProgramDayCounters(program);
    const currentDay = counters ? counters.day : 0;
    const currentPhase = currentDay > 0 ? phases.find(p => currentDay >= p.startDay && currentDay <= p.endDay) : null;

    const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
    const workouts = await DataService.workouts.list(w => w.userId === userId && w.programId === program.programId);
    const workoutIds = new Set(workouts.map(w => w.workoutId));
    const workoutExercises = await DataService.workoutExercises.list(e => workoutIds.has(e.workoutId));
    const exerciseIds = new Set(workoutExercises.map(e => e.workoutExerciseId));
    const workoutSets = await DataService.workoutSets.list(s => exerciseIds.has(s.workoutExerciseId));
    const mealItems = await DataService.mealItems.list(e => e.userId === userId && e.date >= program.startDate && e.date <= program.endDate);
    // The actual SAVED templates (not just the static reference data) — needed so
    // "Start This Workout" can reference a real workoutTemplateId (see WorkoutActions).
    const workoutTemplates = await DataService.workoutTemplates.list(t => t.programId === program.programId);

    // Everything Day Detail needs (Workout / Nutrition / Water / Steps / Sleep /
    // Recovery / Completion) — reuses DailyTrackingEngine exactly as the
    // Dashboard and 60-Day Calendar do, so per-day numbers are never
    // re-derived here, only looked up for whichever date was clicked.
    const allWorkouts = await DataService.workouts.list(w => w.userId === userId);
    const waterEntries = await DataService.waterEntries.list(w => w.userId === userId);
    const stepEntries = await DataService.stepEntries.list(s => s.userId === userId);
    const sleepEntries = await DataService.sleepEntries.list(s => s.userId === userId);
    const recoveryEntries = await DataService.recoveryEntries.list(r => r.userId === userId);
    const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
    const dailyChecklists = await DataService.dailyChecklists.list(c => c.userId === userId);
    const targets = profile ? Calculations.calculateAllTargets(profile, { weightEntries, program, phase: currentPhase }) : null;
    const milestones = await DataService.milestones.list(m => m.programId === program.programId);

    const trackingData = { entries: mealItems, waterEntries, stepEntries, workouts: allWorkouts, sleepEntries, weightEntries, targets, profile };
    const overallCompletion = computeOverallCompletion(program, phases, trackingData, dailyChecklists);

    container.appendChild(renderBollywoodHero(program, counters, currentPhase, currentDay, phases, overallCompletion, container));
    container.appendChild(renderIntroCard(program, phases, counters, currentPhase, container));
    container.appendChild(renderTodayCard(program, currentDay, currentPhase, workoutTemplates, userId, container));
    container.appendChild(renderPhaseListCard(program, phases, currentDay, currentPhase, workouts, workoutExercises, workoutSets, mealItems, workoutTemplates, userId, profile, milestones, trackingData, dailyChecklists, recoveryEntries, container));

    UIFx.animateIn(container);
  }

  // =====================================================================
  // DAY STATE — the shared source of truth for calendar coloring, DAY
  // COMPLETE, and overall/phase completion %. A day is one of six states:
  // locked (phase content not supplied), today, upcoming, rest, completed,
  // missed. Never fabricates future content — locked/upcoming days never
  // get a completion verdict, only real logged data does.
  // =====================================================================

  /** Whether `dayInPhase` has no workout scheduled per the phase's own
   *  weekly split (reuses BollywoodProgramData's own schedule logic —
   *  never re-derives which days are rest days). */
  function isRestDay(phase, dayInPhase) {
    return !BollywoodProgramData.getTodayWorkoutCategory(phase, dayInPhase);
  }

  /** A day "counts" as complete only once every activity that actually
   *  applies to it has real logged data — rest days don't require a
   *  workout, everything else (nutrition/water/steps/sleep) still does. */
  function computeDayCompletion(daySummary, rest) {
    const checks = [
      rest ? null : daySummary.workout.done,
      daySummary.calories?.consumed != null,
      daySummary.water.consumedMl != null,
      daySummary.steps.consumed != null,
      daySummary.sleep.hoursSlept != null,
    ].filter(v => v !== null);
    const doneCount = checks.filter(Boolean).length;
    return { complete: checks.length > 0 && doneCount === checks.length, doneCount, total: checks.length };
  }

  function computeDayState(program, phase, dayNumber, trackingData, dailyChecklists) {
    const date = ProgramTemplates.addDays(program.startDate, dayNumber - 1);
    const todayIso = Models.todayIso();
    if (phase.comingSoon) return { date, state: 'locked', rest: false };

    const dayInPhase = dayNumber - phase.startDay + 1;
    const rest = isRestDay(phase, dayInPhase);
    const manualChecks = (dailyChecklists.find(c => c.date === date) || {}).checks || {};
    const daySummary = DailyTrackingEngine.computeDaySummary(date, trackingData);
    const dailyScore = DailyTrackingEngine.computeDailyScore(date, trackingData, manualChecks);
    const completion = computeDayCompletion(daySummary, rest);

    let state;
    if (date === todayIso) state = 'today';
    else if (date > todayIso) state = 'upcoming';
    else if (rest) state = 'rest';
    else state = completion.complete ? 'completed' : 'missed';

    return { date, state, rest, daySummary, dailyScore, completion };
  }

  const DAY_STATE_LABEL = {
    locked: 'Locked', today: 'Today', upcoming: 'Upcoming', rest: 'Rest', completed: 'Completed', missed: 'Missed',
  };

  /** Overall completion across the whole 100 days: of every day that's
   *  already happened (today included) in a phase whose content actually
   *  exists, what fraction are rest days or fully logged? Days in a
   *  Coming Soon phase, or that haven't happened yet, are excluded from
   *  both sides of the fraction — never fabricated, never counted against. */
  function computeOverallCompletion(program, phases, trackingData, dailyChecklists) {
    const todayIso = Models.todayIso();
    let elapsed = 0;
    let satisfied = 0;
    phases.forEach(phase => {
      if (phase.comingSoon) return;
      for (let d = phase.startDay; d <= phase.endDay; d++) {
        const date = ProgramTemplates.addDays(program.startDate, d - 1);
        if (date > todayIso) continue;
        elapsed++;
        const dayInPhase = d - phase.startDay + 1;
        const rest = isRestDay(phase, dayInPhase);
        if (rest) { satisfied++; continue; }
        const manualChecks = (dailyChecklists.find(c => c.date === date) || {}).checks || {};
        const daySummary = DailyTrackingEngine.computeDaySummary(date, trackingData);
        if (computeDayCompletion(daySummary, rest).complete) satisfied++;
      }
    });
    return elapsed ? Math.round((satisfied / elapsed) * 100) : null;
  }

  function renderBollywoodHero(program, counters, currentPhase, currentDay, phases, overallCompletion, container) {
    const day = counters?.day ?? null;
    const total = counters?.totalDays ?? BollywoodProgramData.TOTAL_DAYS;
    const pct = total ? Math.min(100, Math.round(((day ?? 0) / total) * 100)) : 0;

    const hero = UIFx.hero({
      theme: 'program',
      icon: '\uD83C\uDF1F',
      eyebrow: `${BollywoodProgramData.TOTAL_DAYS} DAYS \u00b7 ${BollywoodProgramData.PROGRAM_NAME}`,
      title: currentPhase ? currentPhase.name : program.name,
      subtitle: day
        ? `Day ${day} of ${total}${counters?.daysRemaining != null ? ` \u2014 ${counters.daysRemaining} days remaining` : ''}. Started ${Utils.formatDate(program.startDate)}, expected completion ${Utils.formatDate(program.endDate)}.`
        : 'Your program hasn\u2019t started yet.',
      stats: [
        ['Start date', Utils.formatDate(program.startDate)],
        ['Expected completion', Utils.formatDate(program.endDate)],
        ['Phase', currentPhase ? `${currentPhase.order} / ${phases.length}` : `\u2013 / ${phases.length}`],
        ['Overall completion', overallCompletion != null ? `${overallCompletion}%` : 'No data entered', true],
      ],
      ring: { pct, number: `${day ?? '\u2013'}`, of: `of ${total} days` },
    });

    if (day > 0 && currentPhase) {
      const continueBtn = Utils.el('button', {
        class: 'btn btn--primary btn--row day-cta--sticky', type: 'button', style: 'margin-top:14px;',
        onClick: () => jumpToDay(currentPhase.phaseKey, day, container),
      }, 'Continue Program \u2192');
      hero.querySelector('.hero__inner').appendChild(continueBtn);
    }

    return hero;
  }

  // =====================================================================
  // INTRODUCTION
  // =====================================================================

  function renderIntroCard(program, phases, counters, currentPhase, container) {
    const completionPercent = counters && counters.totalDays ? Math.round((counters.day / counters.totalDays) * 100) : null;

    const rows = [
      ['Total days', `${BollywoodProgramData.TOTAL_DAYS}`],
      ['Phases', `${phases.length}`],
      ['Current day', counters ? `Day ${counters.day} of ${counters.totalDays}` : 'No data entered'],
      ['Current phase', currentPhase ? currentPhase.name : (counters && counters.day > 0 ? 'No data entered' : 'Not started yet')],
      ['Program completion %', completionPercent != null ? `${completionPercent}%` : 'No data entered'],
      ['Start date', Utils.formatDate(program.startDate)],
      ['Expected end date', Utils.formatDate(program.endDate)],
      ['Days remaining', counters?.daysRemaining != null ? `${counters.daysRemaining}` : 'No data entered'],
      ['Program status', program.status],
    ];

    const pauseControls = renderPauseControls(program, container);

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, BollywoodProgramData.PROGRAM_NAME),
          Utils.el('p', { class: 'card__subtitle' }, 'Foundation \u2192 Base Building \u2192 Muscle Building \u2192 Shredding \u2192 Peak Week, over 100 fixed days.'),
        ]),
        pauseControls,
      ]),
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, BollywoodProgramData.DISCLAIMER),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
    ]);
  }

  function renderPauseControls(program, container) {
    if (program.status === 'active') {
      const pauseBtn = Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button' }, 'Pause Program');
      pauseBtn.addEventListener('click', async () => {
        const reason = window.prompt('Reason for pausing (optional):', '') || '';
        await DataService.programs.update(program.programId, { status: 'paused', pausedAt: Models.nowIso(), pauseReason: reason });
        Utils.toast('Program paused. Your history is kept.', 'success');
        await renderInner(container);
      });
      return pauseBtn;
    }
    if (program.status === 'paused') {
      const resumeBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button' }, 'Resume Program');
      resumeBtn.addEventListener('click', async () => {
        const others = await DataService.programs.list(p => p.userId === program.userId && p.status === 'active');
        for (const other of others) await DataService.programs.update(other.programId, { status: 'paused' });
        await DataService.programs.update(program.programId, { status: 'active', resumedAt: Models.nowIso() });
        Utils.toast('Program resumed.', 'success');
        await renderInner(container);
      });
      return Utils.el('div', {}, [
        resumeBtn,
        program.pauseReason ? Utils.el('p', { class: 'card__footnote' }, `Paused: ${program.pauseReason}`) : null,
      ].filter(Boolean));
    }
    return null;
  }

  // =====================================================================
  // TODAY
  // =====================================================================

  function renderTodayCard(program, currentDay, currentPhase, workoutTemplates, userId, container) {
    if (!currentPhase) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, "Today's Plan")),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }
    const phaseMeta = BollywoodProgramData.findPhaseMeta(currentPhase.phaseKey);
    const dayInPhase = currentDay - currentPhase.startDay + 1;

    const otherLinks = [
      ['Today\u2019s Nutrition', '#/diet'], ['Today\u2019s Water', '#/water'],
      ['Today\u2019s Steps', '#/steps'], ['Today\u2019s Sleep', '#/sleep'], ['Today\u2019s Recovery', '#/recovery'],
    ];

    let workoutSection;
    if (phaseMeta?.comingSoon) {
      workoutSection = Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, 'This phase\u2019s content hasn\u2019t been supplied yet \u2014 nothing is invented here. Check back once it\u2019s defined.');
    } else {
      const todayCategory = BollywoodProgramData.getTodayWorkoutCategory(currentPhase, dayInPhase);
      if (!todayCategory) {
        workoutSection = Utils.el('p', { class: 'card__footnote' }, 'Today is a rest day \u2014 no workout scheduled.');
      } else {
        const template = workoutTemplates.find(t => t.phaseId === currentPhase.phaseId && t.category === todayCategory);
        workoutSection = template
          ? Utils.el('div', {}, [
              Utils.el('p', {}, `Today\u2019s workout: ${todayCategory}`),
              renderStartWorkoutButton(template, userId, container),
            ])
          : Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' },
              `Today\u2019s workout (${todayCategory}) hasn\u2019t been supplied in the source material yet \u2014 nothing is invented here.`);
      }
    }

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, "Today's Plan"),
          Utils.el('p', { class: 'card__subtitle' }, `Day ${currentDay} \u00b7 ${currentPhase.name} \u2014 Day ${dayInPhase} of that phase${phaseMeta?.comingSoon ? ' (Coming Soon)' : ''}`),
        ]),
      ]),
      workoutSection,
      Utils.el('div', { class: 'quick-links' }, otherLinks.map(([label, href]) => Utils.el('a', { class: 'quick-links__item', href }, label))),
    ]);
  }

  // =====================================================================
  // PHASE LIST
  // =====================================================================

  function renderPhaseListCard(program, phases, currentDay, currentPhase, workouts, workoutExercises, workoutSets, mealItems, workoutTemplates, userId, profile, milestones, trackingData, dailyChecklists, recoveryEntries, container) {
    const rows = phases.map(phase => renderPhaseCard(program, phase, currentDay, currentPhase, workouts, workoutExercises, workoutSets, mealItems, workoutTemplates, userId, profile, milestones, trackingData, dailyChecklists, recoveryEntries, container));
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Five-Phase Journey'),
          Utils.el('p', { class: 'card__subtitle' }, 'Tap a phase to open its detail, then tap any day for that day\u2019s plan.'),
        ]),
      ]),
      renderPhaseTimelineNav(phases, currentPhase, container),
      Utils.el('div', { class: 'entry-list' }, rows),
    ]);
  }

  /** Quick phase-to-phase nav strip — the "select a phase, then a day"
   *  timeline. Horizontally scrollable/swipeable on mobile (see .phase-nav
   *  in styles.css), a plain wrapping chip row on desktop. */
  function renderPhaseTimelineNav(phases, currentPhase, container) {
    const chips = phases.map(phase => {
      const isCurrent = currentPhase && phase.phaseKey === currentPhase.phaseKey;
      const isSelected = expandedPhaseKey === phase.phaseKey;
      const label = `Phase ${phase.order}${phase.comingSoon ? ' \uD83D\uDD12' : ''}${isCurrent ? ' \u2605' : ''}`;
      return Utils.el('button', {
        class: `chip phase-nav__chip${isSelected ? ' chip--active' : ''}`, type: 'button',
        onClick: () => { expandedPhaseKey = isSelected ? null : phase.phaseKey; expandedDayNumber = null; renderInner(container); },
      }, label);
    });
    return Utils.el('div', { class: 'chip-row phase-nav' }, chips);
  }

  function phaseStatus(phase, currentDay) {
    if (phase.comingSoon) return 'coming_soon';
    if (currentDay <= 0) return 'not_started';
    if (currentDay >= phase.startDay && currentDay <= phase.endDay) return 'current';
    if (currentDay > phase.endDay) return 'completed';
    return 'upcoming';
  }
  const STATUS_LABEL = {
    coming_soon: 'Coming Soon', not_started: 'Not started', current: 'Current Phase', completed: 'Completed', upcoming: 'Locked \u2014 upcoming',
  };

  function computePhaseCompletion(phase, currentDay, workouts, mealItems) {
    if (phase.comingSoon) return null;
    const totalDays = phase.endDay - phase.startDay + 1;
    const daysReached = Math.max(0, Math.min(currentDay, phase.endDay) - phase.startDay + 1);
    if (daysReached <= 0) return 0;
    // A day "counts" toward completion if either a workout or a meal was logged that calendar day within the phase.
    let loggedDays = 0;
    for (let d = phase.startDay; d <= Math.min(currentDay, phase.endDay); d++) {
      const date = ProgramTemplates.addDays(phase.startDate, d - phase.startDay);
      const hasWorkout = workouts.some(w => w.date === date);
      const hasMeal = mealItems.some(m => m.date === date);
      if (hasWorkout || hasMeal) loggedDays++;
    }
    return Math.round((loggedDays / totalDays) * 100);
  }

  function renderPhaseCard(program, phase, currentDay, currentPhase, workouts, workoutExercises, workoutSets, mealItems, workoutTemplates, userId, profile, milestones, trackingData, dailyChecklists, recoveryEntries, container) {
    const status = phaseStatus(phase, currentDay);
    const completion = computePhaseCompletion(phase, currentDay, workouts, mealItems);
    const isExpanded = expandedPhaseKey === phase.phaseKey;
    const duration = `${phase.endDay - phase.startDay + 1} days`;

    const toggleBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => { expandedPhaseKey = isExpanded ? null : phase.phaseKey; expandedDayNumber = null; renderInner(container); },
    }, isExpanded ? 'Collapse' : 'Expand');

    const header = Utils.el('div', { class: 'entry-row', id: `phase-card-${phase.phaseKey}` }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__title-line' }, [
          Utils.el('span', { class: 'entry-row__name' }, `Phase ${phase.order} | ${phase.name.toUpperCase()} | Day ${phase.startDay}\u2013${phase.endDay}`),
          Utils.el('span', { class: `badge${status === 'coming_soon' || status === 'upcoming' ? ' badge--draft' : ''}` }, STATUS_LABEL[status]),
        ]),
        Utils.el('div', { class: 'entry-row__meta' }, [
          duration,
          phase.notes ? ` \u00b7 ${phase.notes}` : '',
          completion != null ? ` \u00b7 ${completion}% complete` : '',
          status === 'current' ? ' \u00b7 \u2605 Current phase' : '',
        ].join('')),
      ]),
      Utils.el('div', { class: 'row-actions' }, [toggleBtn]),
    ]);

    if (!isExpanded) return header;

    const templatesForPhase = workoutTemplates.filter(t => t.phaseId === phase.phaseId);
    const detail = Utils.el('div', { style: 'padding:8px 4px 16px;' }, [
      renderPhaseDetailHero(phase, completion, status),
      ...renderPhaseDetail(phase, profile, templatesForPhase, userId, container),
      renderMilestonesSection(phase, milestones),
      renderDayByDayGrid(program, phase, currentDay, trackingData, dailyChecklists, recoveryEntries, workoutTemplates, userId, container),
      renderContinuePhaseButton(phase, currentDay, container),
    ]);
    return Utils.el('div', {}, [header, detail]);
  }

  /** Phase Detail's own mini-hero: Goal-adjacent header, Day range, Duration, Progress. */
  function renderPhaseDetailHero(phase, completion, status) {
    return Utils.el('dl', { class: 'stat-list' }, [
      Utils.el('dt', {}, 'Day range'), Utils.el('dd', {}, `Day ${phase.startDay}\u2013${phase.endDay}`),
      Utils.el('dt', {}, 'Duration'), Utils.el('dd', {}, `${phase.endDay - phase.startDay + 1} days`),
      Utils.el('dt', {}, 'Progress'), Utils.el('dd', {}, completion != null ? `${completion}%` : 'No data entered'),
      Utils.el('dt', {}, 'Status'), Utils.el('dd', {}, STATUS_LABEL[status]),
    ]);
  }

  function renderMilestonesSection(phase, milestones) {
    const forPhase = (milestones || []).filter(m => m.dayNumber != null && m.dayNumber >= phase.startDay && m.dayNumber <= phase.endDay)
      .sort((a, b) => a.dayNumber - b.dayNumber);
    const body = forPhase.length
      ? Utils.el('dl', { class: 'stat-list' }, forPhase.flatMap(m => [
          Utils.el('dt', {}, `Day ${m.dayNumber}${m.label ? ` \u2014 ${m.label}` : ''}`),
          Utils.el('dd', {}, (m.weightMinKg != null || m.weightMaxKg != null)
            ? `${m.weightMinKg ?? '\u2013'}\u2013${m.weightMaxKg ?? '\u2013'} kg${m.notes ? ` \u00b7 ${m.notes}` : ''}`
            : (m.notes || 'No data entered')),
        ]))
      : Utils.el('p', { class: 'card__footnote' }, 'No data entered');
    return Utils.el('div', {}, [Utils.el('h3', { class: 'form__group-title' }, 'Milestones'), body]);
  }

  /** Continue Phase — same "land on today's Day Detail" behavior as the hero's
   *  Continue Program CTA, scoped to this phase. For a phase that hasn't
   *  started yet or is already finished, it opens that phase's first day
   *  instead, since there's no "today" inside it. */
  function renderContinuePhaseButton(phase, currentDay, container) {
    if (phase.comingSoon) return null;
    const landingDay = (currentDay >= phase.startDay && currentDay <= phase.endDay) ? currentDay : phase.startDay;
    return Utils.el('button', {
      class: 'btn btn--primary btn--row day-cta--sticky', type: 'button', style: 'margin-top:12px;',
      onClick: () => jumpToDay(phase.phaseKey, landingDay, container),
    }, 'Continue Phase \u2192');
  }

  // =====================================================================
  // PHASE DETAIL — dispatches by phaseKey
  // =====================================================================

  function renderPhaseDetail(phase, profile, templatesForPhase, userId, container) {
    if (phase.comingSoon) {
      return [Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' },
        `${phase.name} content hasn't been supplied yet. Per program rules, nothing is invented here \u2014 this phase unlocks once exact source data is provided.`)];
    }
    if (phase.phaseKey === 'foundation_week') return renderPhase1Detail(templatesForPhase, userId, container);
    if (phase.phaseKey === 'building_the_base') return renderPhase2Detail(profile, templatesForPhase, userId, container);
    if (phase.phaseKey === 'muscle_building_mode') return renderPhase3Detail(profile, templatesForPhase, userId, container);
    return [Utils.el('p', { class: 'card__footnote' }, 'No data entered')];
  }

  // =====================================================================
  // DAY DETAIL — one row per day in the phase; click to expand.
  // =====================================================================

  function renderDayByDayGrid(program, phase, currentDay, trackingData, dailyChecklists, recoveryEntries, workoutTemplates, userId, container) {
    const days = [];
    for (let d = phase.startDay; d <= phase.endDay; d++) days.push(d);

    const cells = days.map(dayNumber => renderDayCell(program, phase, dayNumber, currentDay, trackingData, dailyChecklists, recoveryEntries, workoutTemplates, userId, container));

    return Utils.el('div', {}, [
      Utils.el('h3', { class: 'form__group-title' }, 'Day by Day'),
      phase.comingSoon
        ? Utils.el('p', { class: 'card__footnote' }, 'No data entered')
        : Utils.el('div', { class: 'calendar-grid day-timeline' }, cells),
    ]);
  }

  function renderDayCell(program, phase, dayNumber, currentDay, trackingData, dailyChecklists, recoveryEntries, workoutTemplates, userId, container) {
    const { date, state, rest, daySummary, dailyScore, completion } = computeDayState(program, phase, dayNumber, trackingData, dailyChecklists);
    const isExpanded = expandedDayNumber === dayNumber;

    const cell = Utils.el('button', {
      class: `calendar-cell daycell daycell--${state}${isExpanded ? ' calendar-cell--expanded' : ''}`,
      type: 'button', id: `day-detail-${dayNumber}`,
      onClick: () => { expandedDayNumber = isExpanded ? null : dayNumber; renderInner(container); },
    }, [
      Utils.el('div', { class: 'calendar-cell__day' }, `Day ${dayNumber}`),
      Utils.el('div', { class: 'calendar-cell__date' }, Utils.formatDate(date, { day: '2-digit', month: 'short' })),
      Utils.el('div', { class: 'calendar-cell__score' }, DAY_STATE_LABEL[state]),
    ]);

    if (!isExpanded) return cell;

    const recovery = recoveryEntries.find(r => r.date === date) || null;
    const lines = [
      ['Day number/date', `Day ${dayNumber} \u00b7 ${Utils.formatDate(date)}`],
      ['Phase', phase.name],
      ['Workout', rest ? 'Rest day \u2014 no workout scheduled' : (daySummary.workout.done ? `Done${daySummary.workout.minutes ? ` \u2014 ${daySummary.workout.minutes} min` : ''}` : 'Not logged')],
      ['Nutrition', daySummary.calories?.consumed != null ? `${daySummary.calories.consumed} kcal \u00b7 ${daySummary.protein?.consumed ?? '\u2013'} g protein` : 'No data entered'],
      ['Water', daySummary.water.consumedMl != null ? `${daySummary.water.consumedMl} ml` : 'No data entered'],
      ['Steps', daySummary.steps.consumed != null ? `${daySummary.steps.consumed}` : 'No data entered'],
      ['Sleep', daySummary.sleep.hoursSlept != null ? `${daySummary.sleep.hoursSlept} h` : 'No data entered'],
      ['Recovery', recovery?.recoveryScore != null ? `${recovery.recoveryScore}/5` : 'No data entered'],
      ['Completion', dailyScore.overall != null ? `${dailyScore.overall}%` : 'No data entered'],
    ];

    const detail = Utils.el('div', { class: 'calendar-cell__detail' }, lines.map(([l, v]) => statLine(l, v)));

    const children = [cell, detail];

    // DAY COMPLETE — only ever shown once every applicable activity for
    // that specific day has real logged data (see computeDayCompletion);
    // never shown for locked/upcoming days since there's nothing to judge yet.
    if ((state === 'completed' || (state === 'today' && !rest && completion.complete)) ) {
      children.push(Utils.el('div', { class: 'daycell__complete-banner' }, '\u2713 DAY COMPLETE'));
    }

    if (state === 'today') {
      const dayInPhase = dayNumber - phase.startDay + 1;
      const todayCategory = BollywoodProgramData.getTodayWorkoutCategory(phase, dayInPhase);
      const template = todayCategory ? workoutTemplates.find(t => t.phaseId === phase.phaseId && t.category === todayCategory) : null;
      const cta = template
        ? renderStartWorkoutButton(template, userId, container)
        : (rest
            ? Utils.el('p', { class: 'card__footnote' }, 'Rest day \u2014 no workout to start today.')
            : Utils.el('a', { class: 'btn btn--primary btn--row day-cta--sticky', href: '#/diet', style: 'margin-top:8px;' }, 'START TODAY \u2192'));
      children.push(cta);
    } else if (state === 'locked') {
      children.push(Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, 'This day\u2019s content hasn\u2019t been supplied yet \u2014 nothing is invented here.'));
    }

    return Utils.el('div', { class: 'calendar-cell-wrap' }, children);
  }

  function statLine(label, value) {
    return Utils.el('div', { class: 'calendar-cell__stat' }, [
      Utils.el('span', {}, label), Utils.el('span', {}, value ?? 'No data entered'),
    ]);
  }

  function renderPhase1Detail(templatesForPhase, userId, container) {
    const schedule = Utils.el('div', { class: 'chip-row' }, BollywoodProgramData.PHASE1_WEEKLY_SCHEDULE.map(d =>
      Utils.el('span', { class: `chip${d.label === 'Rest' ? '' : ' chip--active'}` }, `Day ${d.day}: ${d.label}`)));

    const workoutBlock = renderWorkoutDayBlock(templatesForPhase, 'Full Body', userId, container);

    const removeList = Utils.el('div', { class: 'quick-links' }, BollywoodProgramData.PHASE1_REMOVE_FOODS.map(f => Utils.el('span', { class: 'badge' }, f)));
    const recommended = BollywoodProgramData.PHASE1_RECOMMENDED_FOODS;
    const recList = Utils.el('dl', { class: 'stat-list' }, [
      Utils.el('dt', {}, 'Proteins'), Utils.el('dd', {}, recommended.proteins.join(', ')),
      Utils.el('dt', {}, 'Carbohydrates'), Utils.el('dd', {}, recommended.carbohydrates.join(', ')),
      Utils.el('dt', {}, 'Vegetables'), Utils.el('dd', {}, recommended.vegetables.join(', ')),
      Utils.el('dt', {}, 'Healthy fats'), Utils.el('dd', {}, recommended.healthyFats.join(', ')),
      Utils.el('dt', {}, 'Fruits'), Utils.el('dd', {}, recommended.fruits.join(', ')),
    ]);

    return [
      Utils.el('h3', { class: 'form__group-title' }, 'Goal'),
      Utils.el('p', {}, 'Build training habits, learn exercise form and controlled movement, before progressing to a split. Priority: form over everything else. Use light-to-moderate weights, don\u2019t add exercises, don\u2019t chase heavy weights. If form breaks, the weight is too heavy.'),
      Utils.el('h3', { class: 'form__group-title' }, 'Weekly Schedule'),
      schedule,
      Utils.el('h3', { class: 'form__group-title' }, 'Full Body Workout (rest 60\u201390 sec between sets)'),
      workoutBlock,
      Utils.el('h3', { class: 'form__group-title' }, 'Nutrition \u2014 Remove for This Week'),
      removeList,
      Utils.el('h3', { class: 'form__group-title' }, 'Nutrition \u2014 Recommended Foods'),
      recList,
      Utils.el('p', { class: 'card__footnote' }, 'Water guideline: minimum 3 L/day (source). Your actual personalized target is on the Water page.'),
    ];
  }

  function renderPhase2Detail(profile, templatesForPhase, userId, container) {
    const schedule = Utils.el('div', { class: 'chip-row' }, BollywoodProgramData.PHASE2_WEEKLY_SCHEDULE.map(d =>
      Utils.el('span', { class: `chip${d.label === 'Rest' ? '' : ' chip--active'}` }, `Day ${d.day}: ${d.label}`)));

    const pushBlock = renderWorkoutDayBlock(templatesForPhase, 'Push', userId, container);
    const pullBlock = renderWorkoutDayBlock(templatesForPhase, 'Pull', userId, container);
    const legsBlock = renderWorkoutDayBlock(templatesForPhase, 'Legs', userId, container);

    const absRotation = Utils.el('div', {}, BollywoodProgramData.PHASE2_ABS_ROTATION.map(d =>
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' },
        `Day ${d.day} \u2014 ${d.title}: ${d.exercises.map(([n, s]) => `${n} (${s})`).join(', ') || 'Rest'}`)));

    const fasting = BollywoodProgramData.PHASE2_FASTING;
    const fastingCard = Utils.el('dl', { class: 'stat-list' }, [
      Utils.el('dt', {}, 'Fasting window'), Utils.el('dd', {}, fasting.window),
      Utils.el('dt', {}, 'Eating window'), Utils.el('dd', {}, fasting.eatingWindow),
      Utils.el('dt', {}, 'Meals'), Utils.el('dd', {}, fasting.meals),
      Utils.el('dt', {}, 'During fasting'), Utils.el('dd', {}, fasting.duringFasting.join(', ')),
    ]);

    const exampleWeight = profile?.currentWeightKg ?? 80;
    const macros = BollywoodProgramData.phase2ExampleMacros(exampleWeight);
    const macroNote = Utils.el('div', {}, [
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' },
        `Source formula example at ${exampleWeight} kg: maintenance ${macros.maintenance} kcal \u2212 500 = ${macros.calorieTarget} kcal, protein ${macros.proteinG} g, fat ${macros.fatG} g, carbs \u2248${macros.carbG} g.`),
      Utils.el('p', { class: 'card__footnote' }, 'This is the source program\u2019s worked example only \u2014 your real target is on Profile \u2192 Calculated Targets, personalized to you.'),
    ]);

    const proteinFoods = Utils.el('div', { class: 'quick-links' }, BollywoodProgramData.PHASE2_VEGETARIAN_PROTEIN_FOODS.map(f => Utils.el('span', { class: 'badge' }, f)));

    return [
      Utils.el('h3', { class: 'form__group-title' }, 'Progression from Phase 1'),
      Utils.el('p', {}, 'Full body \u2192 Push/Pull/Legs. Same workout \u2192 different workouts. Light/moderate \u2192 progressive overload. Learning form \u2192 building muscle + fat loss. 10 exercises \u2192 7\u20138 focused exercises.'),
      Utils.el('h3', { class: 'form__group-title' }, 'Weekly Schedule'),
      schedule,
      Utils.el('h3', { class: 'form__group-title' }, 'Push (compound rest 90s, isolation rest 60s)'),
      pushBlock,
      Utils.el('h3', { class: 'form__group-title' }, 'Pull'),
      pullBlock,
      Utils.el('h3', { class: 'form__group-title' }, 'Legs'),
      legsBlock,
      Utils.el('h3', { class: 'form__group-title' }, 'Abs (after main workout, before cardio, 5\u20138 min, 30s rest)'),
      absRotation,
      Utils.el('h3', { class: 'form__group-title' }, 'Nutrition \u2014 Fat Burning Mode (16:8 Fasting)'),
      fastingCard,
      macroNote,
      Utils.el('h3', { class: 'form__group-title' }, 'Vegetarian Protein Reference Foods'),
      proteinFoods,
      Utils.el('p', { class: 'card__footnote' }, 'Sample meal options (Option A / Option B) are saved as Meal Templates \u2014 open Diet \u2192 Meal Templates to log them; nutrition is always computed from the real food database, not the numbers quoted in the source program.'),
      Utils.el('a', { class: 'btn btn--secondary', href: '#/diet' }, 'Open Diet \u2192'),
    ];
  }

  function renderPhase3Detail(profile, templatesForPhase, userId, container) {
    const schedule = Utils.el('div', { class: 'chip-row' }, BollywoodProgramData.PHASE3_WEEKLY_SCHEDULE.map(d =>
      Utils.el('span', { class: `chip${d.label === 'Rest' ? '' : ' chip--active'}` }, `Day ${d.day}: ${d.label}`)));

    const pushPlaceholder = Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' },
      'Day 1 \u2014 Push: exact exercise list wasn\u2019t included in the supplied source material (unlike Days 2/3/5/6). Nothing is invented here \u2014 this day will be added once the source data is supplied.');

    const pullBlock = renderWorkoutDayBlock(templatesForPhase, 'Pull', userId, container);
    const legsBlock = renderWorkoutDayBlock(templatesForPhase, 'Legs', userId, container);
    const chestBackBlock = renderWorkoutDayBlock(templatesForPhase, 'Chest + Back', userId, container);
    const armsDeltsBlock = renderWorkoutDayBlock(templatesForPhase, 'Arms + Delts', userId, container);

    const rest = BollywoodProgramData.PHASE3_REST_DAY_GUIDANCE;
    const restCard = Utils.el('dl', { class: 'stat-list' }, [
      Utils.el('dt', {}, 'Sleep'), Utils.el('dd', {}, rest.sleepHours),
      Utils.el('dt', {}, 'Nutrition'), Utils.el('dd', {}, rest.nutrition),
      Utils.el('dt', {}, 'Hydration'), Utils.el('dd', {}, rest.hydration),
      Utils.el('dt', {}, 'Stretching'), Utils.el('dd', {}, rest.stretching),
      Utils.el('dt', {}, 'Walking'), Utils.el('dd', {}, rest.walking),
    ]);

    const exampleWeight = profile?.currentWeightKg ?? 80;
    const macros = BollywoodProgramData.phase3ExampleMacros(exampleWeight);
    const macroNote = Utils.el('div', {}, [
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' },
        `Source formula example at ${exampleWeight} kg: maintenance ${macros.maintenance} kcal \u2212 300 = ${macros.calorieTarget} kcal, protein ${macros.proteinG} g, fat ${macros.fatG} g, carbs \u2248${macros.carbG} g (extra ~200 kcal vs. Phase 2, mostly from carbs around training).`),
      Utils.el('p', { class: 'card__footnote' }, 'Again \u2014 this is the source program\u2019s worked example, not your target. Your real target is on Profile \u2192 Calculated Targets.'),
    ]);

    return [
      Utils.el('h3', { class: 'form__group-title' }, 'Purpose'),
      Utils.el('p', {}, 'Fat loss + muscle building / body recomposition. Calorie deficit eases from \u2212500 (Phase 2) to \u2212300. 16:8 fasting continues (8 PM \u2192 12 PM, 2 meals + 1 snack).'),
      Utils.el('h3', { class: 'form__group-title' }, 'Weekly Structure'),
      schedule,
      Utils.el('h3', { class: 'form__group-title' }, 'Day 1 \u2014 Push'),
      pushPlaceholder,
      Utils.el('h3', { class: 'form__group-title' }, 'Day 2 \u2014 Pull'),
      pullBlock,
      Utils.el('h3', { class: 'form__group-title' }, 'Day 3 \u2014 Legs'),
      legsBlock,
      Utils.el('h3', { class: 'form__group-title' }, 'Day 4 \u2014 Rest'),
      restCard,
      Utils.el('h3', { class: 'form__group-title' }, 'Day 5 \u2014 Chest + Back (Giant Sets)'),
      chestBackBlock,
      Utils.el('h3', { class: 'form__group-title' }, 'Day 6 \u2014 Arms + Delts (Supersets)'),
      armsDeltsBlock,
      Utils.el('h3', { class: 'form__group-title' }, 'Day 7 \u2014 Rest'),
      Utils.el('p', { class: 'card__footnote' }, 'No weight training.'),
      Utils.el('h3', { class: 'form__group-title' }, 'Weekly Progression Rule'),
      Utils.el('p', {}, BollywoodProgramData.PHASE3_WEEKLY_RULE),
      Utils.el('h3', { class: 'form__group-title' }, 'Nutrition'),
      macroNote,
    ];
  }

  /**
   * Renders one workout day's exercise table PLUS a "Start This Workout"
   * button, using the actual saved WorkoutTemplate record for `category`
   * (not the static reference data) so the button has a real
   * workoutTemplateId to start from — this is what makes clicking through
   * land on Today's Workout showing THIS exact phase's exercises, instead
   * of the generic Weekly Split view.
   */
  function renderWorkoutDayBlock(templatesForPhase, category, userId, container) {
    const template = templatesForPhase.find(t => t.category === category);
    if (!template) {
      return Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, 'No data entered');
    }
    const table = renderExerciseTable(template.exercises);
    const startBtn = renderStartWorkoutButton(template, userId, container);
    return Utils.el('div', {}, [table, startBtn]);
  }

  function renderStartWorkoutButton(template, userId, container) {
    const today = Models.todayIso();
    const btn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button', style: 'margin:10px 0 4px;' }, 'Checking\u2026');
    (async () => {
      const existing = await WorkoutActions.findExistingWorkout(userId, today, template);
      btn.textContent = existing ? 'Continue This Workout \u2192' : 'Start This Workout \u2192';
    })();
    btn.addEventListener('click', async () => {
      const existing = await WorkoutActions.findExistingWorkout(userId, today, template);
      if (!existing) {
        await WorkoutActions.startWorkoutFromTemplate(userId, today, template);
        Utils.toast(`"${template.name}" started for today.`, 'success');
      }
      // Navigate into the Workout page SCOPED to this program (see PageWorkout's
      // handling of the ?program= query param) — this is what keeps the 60-Day
      // program's split, other phases, and any custom workouts out of the way
      // when arriving here from the program, per the program's own scoped path.
      const scopedPath = `workout?program=${template.programId}`;
      if (window.Router && window.Router.navigate) window.Router.navigate(scopedPath);
      else window.location.hash = `#/${scopedPath}`;
    });
    return btn;
  }

  /** Renders a read-only exercise table that makes the advanced set
   *  structure (superset/drop-set/giant-set/rounds) visually explicit,
   *  even though the actual logging UI lives in pages/workout.js. */
  function renderExerciseTable(exercises) {
    if (!exercises || !exercises.length) return Utils.el('p', { class: 'card__footnote' }, 'No data entered');
    return Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
      Utils.el('thead', {}, Utils.el('tr', {}, ['Exercise', 'Group', 'Sets \u00d7 Reps', 'Rest', 'Notes'].map(h => Utils.el('th', {}, h)))),
      Utils.el('tbody', {}, exercises.map(e => {
        const groupLabel = e.groupId
          ? `${e.groupType.replace('_', ' ')} ${e.groupLabel}${e.groupOrder ? e.groupOrder : ''}${e.totalRounds ? ` \u00d7 ${e.totalRounds} rounds` : ''}`
          : (e.dropPercentage ? `Drop set (\u2212${e.dropPercentage}%)` : '\u2014');
        const setsReps = e.isCardio
          ? (e.cardioMode === 'sprint' ? `${e.sprintRounds ?? '?'} \u00d7 ${e.sprintDistanceM ?? '?'} m` : `${e.targetDurationMinutes ?? '?'} min`)
          : `${e.targetSets ?? '?'} \u00d7 ${e.toFailure ? 'to failure' : `${e.targetRepsMin ?? '?'}${e.targetRepsMax && e.targetRepsMax !== e.targetRepsMin ? `\u2013${e.targetRepsMax}` : ''}`}`;
        const rest = e.restAfterGroupSeconds != null ? `${e.restAfterGroupSeconds}s after group` : (e.restSeconds ? `${e.restSeconds}s` : '\u2014');
        return Utils.el('tr', {}, [
          Utils.el('td', {}, e.exerciseName),
          Utils.el('td', {}, groupLabel),
          Utils.el('td', {}, setsReps),
          Utils.el('td', {}, rest),
          Utils.el('td', {}, e.notes || e.formNotes || '\u2014'),
        ]);
      })),
    ]));
  }

  return { render };
})();
