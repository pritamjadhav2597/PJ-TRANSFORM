/**
 * pages/calendar.js — Day 1..N calendar for a program, dynamically sized to
 * that program's durationDays (not hardcoded to 60). Every per-day figure
 * reuses DailyTrackingEngine (which itself reuses DietEngine/Calculations)
 * — this page only lays the days out in a grid and fetches each
 * collection once for the whole range instead of once per day.
 */

const PageCalendar = (() => {

  let selectedProgramId = null;
  let expandedDay = null;

  async function render(container) {
    container.innerHTML = '';

    const userId = DataService.getCurrentUserId();
    if (!userId) {
      container.appendChild(Utils.el('section', { class: 'card' }, Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered'))));
      return;
    }

    const programs = await DataService.programs.list(p => p.userId === userId);
    const runnable = programs.filter(p => p.startDate && p.durationDays);
    if (!runnable.length) {
      container.appendChild(Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Calendar')),
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'No data entered'),
          Utils.el('a', { class: 'btn btn--secondary', href: '#/programs' }, 'Set up a program'),
        ]),
      ]));
      return;
    }

    if (!selectedProgramId || !runnable.some(p => p.programId === selectedProgramId)) {
      selectedProgramId = (runnable.find(p => p.status === 'active') || runnable[0]).programId;
    }
    const program = runnable.find(p => p.programId === selectedProgramId);

    const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
    const phases = await DataService.programPhases.list(ph => ph.programId === program.programId);
    const currentPhase = phases.length ? Calculations.getCurrentPhase(phases) : null;
    const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
    const targets = profile ? Calculations.calculateAllTargets(profile, { weightEntries, program, phase: currentPhase }) : null;

    const entries = await DataService.mealItems.list(e => e.userId === userId);
    const waterEntries = await DataService.waterEntries.list(w => w.userId === userId);
    const stepEntries = await DataService.stepEntries.list(s => s.userId === userId);
    const workouts = await DataService.workouts.list(w => w.userId === userId);
    const sleepEntries = await DataService.sleepEntries.list(s => s.userId === userId);
    const dailyChecklists = await DataService.dailyChecklists.list(c => c.userId === userId);

    const trackingData = { entries, waterEntries, stepEntries, workouts, sleepEntries, weightEntries, targets, profile };

    const days = [];
    for (let i = 1; i <= program.durationDays; i++) {
      const date = ProgramTemplates.addDays(program.startDate, i - 1);
      const manualChecks = (dailyChecklists.find(c => c.date === date) || {}).checks || {};
      const daySummary = DailyTrackingEngine.computeDaySummary(date, trackingData);
      const dailyScore = DailyTrackingEngine.computeDailyScore(date, trackingData, manualChecks);
      days.push({ dayNumber: i, date, daySummary, dailyScore });
    }

    container.appendChild(renderHeaderCard(runnable, program, container));
    container.appendChild(renderCalendarHero(days, program));

    container.appendChild(renderCalendarGrid(days, container));

    UIFx.animateIn(container);
  }

  function renderCalendarHero(days, program) {
    const scored = days.filter(d => d.dailyScore.overall != null);
    const avg = scored.length ? Math.round(scored.reduce((s, d) => s + d.dailyScore.overall, 0) / scored.length) : 0;
    const barSvg = scored.length
      ? ChartUtils.buildBarChartSVG(days.map(d => ({ x: d.date, y: d.dailyScore.overall ?? 0 })), { width: 360, height: 110, color: 'var(--gold)' })
      : null;

    const hero = UIFx.hero({
      theme: 'program',
      icon: '\uD83D\uDDD3\uFE0F',
      eyebrow: 'Calendar',
      title: `${program.durationDays}-Day Overview`,
      subtitle: scored.length
        ? `${avg}% average daily completion across ${scored.length} logged day${scored.length === 1 ? '' : 's'}.`
        : 'No days logged yet — tap any day below to see its detail.',
      stats: [],
    });
    hero.classList.add('card--hero--compact');
    const row = Utils.el('div', { class: 'hero__stats', style: 'flex:1 1 auto;align-items:center;gap:24px;' }, [
      UIFx.ringNode({ pct: avg, number: `${avg}%`, of: 'avg', size: 110, stroke: 9 }),
    ]);
    if (barSvg) {
      const chartWrap = Utils.el('div', { style: 'flex:1 1 240px;min-width:220px;' });
      chartWrap.innerHTML = `<div class="hero__ring-of" style="margin-bottom:4px;">Daily completion, day by day</div>${barSvg}`;
      row.appendChild(chartWrap);
    }
    hero.querySelector('.hero__inner').appendChild(row);
    return hero;
  }

  function renderHeaderCard(programs, program, container) {
    const select = Utils.el('select', { class: 'form__input', style: 'max-width:320px;' },
      programs.map(p => {
        const opt = Utils.el('option', { value: p.programId }, `${p.name || 'Untitled Program'} (${p.durationDays} days)`);
        if (p.programId === program.programId) opt.setAttribute('selected', 'selected');
        return opt;
      }));
    select.addEventListener('change', (e) => { selectedProgramId = e.target.value; expandedDay = null; render(container); });

    const counters = Calculations.getProgramDayCounters(program);

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, `${program.durationDays}-Day Calendar`),
          Utils.el('p', { class: 'card__subtitle' },
            `${Utils.formatDate(program.startDate)} → ${Utils.formatDate(program.endDate)}${counters ? ` · Day ${counters.day} of ${counters.totalDays}` : ''}`),
        ]),
        select,
      ]),
    ]);
  }

  function renderCalendarGrid(days, container) {
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'calendar-grid' }, days.map(d => renderDayCell(d, container))),
    ]);
  }

  function renderDayCell(d, container) {
    const isExpanded = expandedDay === d.dayNumber;
    const score = d.dailyScore.overall;

    const cell = Utils.el('button', {
      class: `calendar-cell calendar-cell--${scoreTier(score)}${isExpanded ? ' calendar-cell--expanded' : ''}`,
      type: 'button',
      onClick: () => { expandedDay = isExpanded ? null : d.dayNumber; render(container); },
    }, [
      Utils.el('div', { class: 'calendar-cell__day' }, `Day ${d.dayNumber}`),
      Utils.el('div', { class: 'calendar-cell__date' }, Utils.formatDate(d.date, { day: '2-digit', month: 'short' })),
      Utils.el('div', { class: 'calendar-cell__score' }, score == null ? '—' : `${score}%`),
    ]);

    if (!isExpanded) return cell;

    const detail = Utils.el('div', { class: 'calendar-cell__detail' }, [
      statLine('Weight', d.daySummary.weightKg != null ? `${d.daySummary.weightKg} kg` : null),
      statLine('Calories', fmtNutrient(d.daySummary.calories, ' kcal')),
      statLine('Protein', fmtNutrient(d.daySummary.protein, ' g')),
      statLine('Water', d.daySummary.water.consumedMl != null ? `${d.daySummary.water.consumedMl} ml` : null),
      statLine('Steps', d.daySummary.steps.consumed != null ? `${d.daySummary.steps.consumed}` : null),
      statLine('Workout', d.daySummary.workout.done ? 'Done' : 'Not logged'),
      statLine('Sleep', d.daySummary.sleep.hoursSlept != null ? `${d.daySummary.sleep.hoursSlept} h` : null),
      statLine('Completion', d.dailyScore.overall != null ? `${d.dailyScore.overall}%` : null),
    ]);

    const dayLinks = Utils.el('div', { class: 'quick-links', style: 'margin-top:10px;' }, [
      ['workout', 'Workout'], ['nutrition', 'Nutrition'], ['water', 'Water'],
      ['steps', 'Steps'], ['sleep', 'Sleep'], ['progress', 'Progress'],
    ].map(([path, label]) => Utils.el('a', { class: 'quick-links__item', href: `#/${path}` }, label)));

    return Utils.el('div', { class: 'calendar-cell-wrap' }, [cell, Utils.el('div', {}, [detail, dayLinks])]);
  }

  function statLine(label, value) {
    return Utils.el('div', { class: 'calendar-cell__stat' }, [
      Utils.el('span', {}, label), Utils.el('span', {}, value ?? 'No data entered'),
    ]);
  }

  function fmtNutrient(d, unit) {
    return d.consumed == null ? null : `${d.consumed}${unit}`;
  }

  function scoreTier(score) {
    if (score == null) return 'none';
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    return 'attention';
  }

  return { render };
})();
