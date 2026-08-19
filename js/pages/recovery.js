/**
 * pages/recovery.js — Recovery tracking. Weekly trends and the
 * persistent-poor-recovery nudge come from RecoveryEngine; this page
 * never diagnoses anything -- see RecoveryEngine.NON_DIAGNOSTIC_NOTE,
 * always shown alongside the recommendation.
 */

const PageRecovery = (() => {

  const FIELDS = [
    { key: 'energyLevel', label: 'Energy' },
    { key: 'stressLevel', label: 'Stress' },
    { key: 'sorenessLevel', label: 'Muscle Soreness' },
    { key: 'recoveryScore', label: 'Recovery' },
    { key: 'workoutPerformanceRating', label: 'Workout Performance' },
  ];

  let selectedDate = Models.todayIso();
  let draft = {};

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

    const recoveryEntries = await DataService.recoveryEntries.list(r => r.userId === userId);
    const existing = recoveryEntries.find(r => r.date === selectedDate) || null;
    draft = existing ? { ...existing } : {};

    const sleepEntries = await DataService.sleepEntries.list(s => s.userId === userId);
    const workouts = await DataService.workouts.list(w => w.userId === userId);
    const stepEntries = await DataService.stepEntries.list(s => s.userId === userId);

    container.appendChild(renderRecoveryHero(existing, recoveryEntries));
    container.appendChild(renderPoorRecoveryBanner(recoveryEntries));
    container.appendChild(renderRecoverySummaryCard(sleepEntries, workouts, stepEntries));
    container.appendChild(renderEntryCard(userId, existing, recoveryEntries, container));
    container.appendChild(renderTrendsCard(recoveryEntries));
    container.appendChild(renderHistoryCard(recoveryEntries, container));

    UIFx.animateIn(container);
  }

  function renderRecoveryHero(existing, recoveryEntries) {
    const score = existing?.recoveryScore ?? null;
    const pct = score != null ? score * 20 : 0;
    const trend = RecoveryEngine.computeWeeklyTrend(recoveryEntries, 'recoveryScore', new Date(selectedDate + 'T00:00:00'));

    const hero = UIFx.hero({
      theme: 'recovery',
      icon: '\u267B\uFE0F',
      eyebrow: 'Recovery',
      title: 'How you\u2019re recovering',
      subtitle: trend.thisWeekAvg != null
        ? `This week\u2019s average recovery: ${trend.thisWeekAvg} / 5${trend.change != null ? ` (${trend.change >= 0 ? '+' : ''}${trend.change} vs. prior week)` : ''}.`
        : 'Log today\u2019s check-in to start tracking recovery trends.',
      stats: [],
    });
    hero.classList.add('card--hero--compact', 'card--accent-recovery');
    hero.querySelector('.hero__inner').appendChild(
      UIFx.arcGauge({ pct, number: score != null ? `${score}/5` : '\u2013', sublabel: 'today', colorFrom: 'var(--recovery-soft)', colorTo: 'var(--recovery)' })
    );
    return hero;
  }

  function renderPoorRecoveryBanner(recoveryEntries) {
    const result = RecoveryEngine.detectPersistentPoorRecovery(recoveryEntries, new Date(selectedDate + 'T00:00:00'));
    if (!result.flagged) return Utils.el('div', {});
    return Utils.el('section', { class: 'card', style: 'border:1px solid var(--danger);background:var(--danger-tint);' }, [
      Utils.el('h2', { class: 'card__title' }, 'Recovery has been low lately'),
      Utils.el('p', {}, result.message),
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, RecoveryEngine.NON_DIAGNOSTIC_NOTE),
    ]);
  }

  /**
   * A cross-tracker summary — sleep, recent training load, steps, and
   * whether today is a rest day — pulled from each tracker's own real
   * data (nothing recomputed or estimated). Purely descriptive: never a
   * medical claim, never a diagnosis, always paired with the same
   * NON_DIAGNOSTIC_NOTE used elsewhere in this module.
   */
  function renderRecoverySummaryCard(sleepEntries, workouts, stepEntries) {
    const lastNight = sleepEntries.find(s => s.date === selectedDate) || null;
    const sevenDaysAgo = ProgramTemplates.addDays(selectedDate, -6);
    const recentWorkouts = workouts.filter(w => w.date >= sevenDaysAgo && w.date <= selectedDate && w.status === 'completed');
    const isRestDay = !workouts.some(w => w.date === selectedDate);
    const workoutStreak = WorkoutEngine.computeWorkoutStreak(workouts, selectedDate);

    const recentStepDays = [];
    for (let i = 0; i < 7; i++) recentStepDays.push(ProgramTemplates.addDays(selectedDate, -i));
    const stepTotals = recentStepDays.map(d => DailyTrackingEngine.sumSteps(stepEntries, d)).filter(t => t > 0);
    const avgSteps = stepTotals.length ? Math.round(stepTotals.reduce((a, b) => a + b, 0) / stepTotals.length) : null;

    const rows = [
      ['Last night\u2019s sleep', lastNight?.hoursSlept != null ? `${lastNight.hoursSlept} h${lastNight.quality != null ? `, quality ${lastNight.quality}/5` : ''}` : 'No data entered'],
      ['Training load (last 7 days)', `${recentWorkouts.length} session${recentWorkouts.length === 1 ? '' : 's'}${workoutStreak > 0 ? ` \u00b7 ${workoutStreak}-day streak` : ''}`],
      ['Today', isRestDay ? 'Rest day (no workout logged)' : 'Training day'],
      ['Steps (7-day average)', avgSteps != null ? `${avgSteps.toLocaleString()}` : 'No data entered'],
    ];

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Recovery Summary'),
        Utils.el('p', { class: 'card__subtitle' }, 'What your other trackers show, at a glance.'),
      ]),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, RecoveryEngine.NON_DIAGNOSTIC_NOTE),
    ]);
  }

  function renderEntryCard(userId, existing, recoveryEntries, container) {
    const dateBar = Utils.el('div', { class: 'row-actions' }, [
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, -1); renderInner(container); } }, '← Prev day'),
      Utils.el('input', { class: 'form__input', type: 'date', value: selectedDate, onChange: (e) => { if (e.target.value) { selectedDate = e.target.value; renderInner(container); } } }),
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, 1); renderInner(container); } }, 'Next day →'),
    ]);

    const fieldRows = FIELDS.map(f => {
      const row = Utils.el('div', { class: 'chip-row' }, [1, 2, 3, 4, 5].map(n =>
        Utils.el('button', {
          class: `chip${draft[f.key] === n ? ' chip--active' : ''}`, type: 'button',
          onClick: (e) => {
            draft[f.key] = n;
            e.currentTarget.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
            e.currentTarget.classList.add('chip--active');
          },
        }, `${n}`)));
      return Utils.el('div', { class: 'form__field form__field--wide' }, [Utils.el('label', { class: 'form__label' }, f.label), row]);
    });

    const notesInput = Utils.el('textarea', { class: 'form__input', rows: 2, value: draft.notes || '' }, draft.notes || '');

    const saveBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button' }, existing ? 'Save changes' : 'Save Recovery');
    saveBtn.addEventListener('click', async () => {
      const patch = { notes: notesInput.value };
      FIELDS.forEach(f => { patch[f.key] = draft[f.key] ?? null; });
      if (existing) await DataService.recoveryEntries.update(existing.recoveryEntryId, patch);
      else await DataService.recoveryEntries.create(Models.createRecoveryEntry(userId, selectedDate, patch));
      Utils.toast('Recovery logged.', 'success');
      await renderInner(container);
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [Utils.el('h2', { class: 'card__title' }, 'Recovery Check-in'), Utils.el('p', { class: 'card__subtitle' }, Utils.formatDate(selectedDate))]),
        dateBar,
      ]),
      Utils.el('p', { class: 'card__footnote' }, 'Rate each 1 (low) to 5 (high). Stress and soreness: higher means more stressed / more sore.'),
      Utils.el('div', {}, fieldRows),
      Utils.el('div', { class: 'form__field form__field--wide' }, [Utils.el('label', { class: 'form__label' }, 'Notes'), notesInput]),
      Utils.el('div', { class: 'form__actions' }, [saveBtn]),
    ]);
  }

  function renderTrendsCard(recoveryEntries) {
    const endDate = new Date(selectedDate + 'T00:00:00');
    const rows = FIELDS.map(f => {
      const trend = RecoveryEngine.computeWeeklyTrend(recoveryEntries, f.key, endDate);
      const val = trend.thisWeekAvg != null
        ? `${trend.thisWeekAvg} / 5${trend.change != null ? ` (${trend.change >= 0 ? '+' : ''}${trend.change} vs. prior week)` : ''}`
        : 'No data entered';
      return [f.label, val];
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Weekly Trends'),
        Utils.el('p', { class: 'card__subtitle' }, "This week's average vs. the week before."),
      ]),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
    ]);
  }

  function renderHistoryCard(recoveryEntries, container) {
    const sorted = [...recoveryEntries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    const rows = sorted.map(r => Utils.el('div', { class: 'entry-row' }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__name' }, Utils.formatDate(r.date)),
        Utils.el('div', { class: 'entry-row__meta' }, FIELDS.map(f => `${f.label}: ${r[f.key] ?? '—'}`).join(' · ')),
        r.notes ? Utils.el('div', { class: 'entry-row__notes' }, r.notes) : null,
      ].filter(Boolean)),
      Utils.el('div', { class: 'row-actions' }, [
        Utils.el('button', { class: 'btn btn--danger btn--row', type: 'button', onClick: async () => { await DataService.recoveryEntries.delete(r.recoveryEntryId); await renderInner(container); } }, 'Delete'),
      ]),
    ]));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'History')),
      rows.length ? Utils.el('div', { class: 'entry-list' }, rows) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ]);
  }

  return { render };
})();
