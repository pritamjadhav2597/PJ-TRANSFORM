/**
 * pages/steps.js — Steps tracking. Target comes from
 * Calculations.calculateAllTargets() (stepTarget). Data source is provided
 * by DeviceIntegration — only "Manual entry" is active today, but the
 * provider selector and StepEntry.source field are already in place for a
 * future device (see device-integration.js).
 */

const PageSteps = (() => {

  let selectedDate = Models.todayIso();
  let selectedProvider = 'manual';
  let historyView = 'daily'; // 'daily' | 'weekly'

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

    const stepEntries = await DataService.stepEntries.list(s => s.userId === userId);
    const dailyChecklist = (await DataService.dailyChecklists.list(c => c.userId === userId && c.date === selectedDate))[0] || null;

    container.appendChild(renderStepsHero(targets, stepEntries));
    container.appendChild(renderStatsCard(userId, targets, stepEntries, dailyChecklist, container));
    container.appendChild(renderDeviceCard(userId, stepEntries, container));
    container.appendChild(renderHistoryCard(stepEntries, container));

    UIFx.animateIn(container);
  }

  function renderStepsHero(targets, stepEntries) {
    const current = DailyTrackingEngine.sumSteps(stepEntries, selectedDate);
    const target = targets?.stepTarget ?? null;
    const pct = target ? Math.round((current / target) * 100) : 0;

    const hero = UIFx.hero({
      theme: 'steps',
      icon: '\uD83D\uDC5F',
      eyebrow: 'Movement',
      title: 'Steps',
      subtitle: target
        ? `${current.toLocaleString()} of ${target.toLocaleString()} steps today.`
        : `${current.toLocaleString()} steps logged today — add a profile for a calculated target.`,
      stats: [],
    });
    hero.classList.add('card--hero--compact', 'card--accent-steps');
    hero.querySelector('.hero__inner').appendChild(
      UIFx.arcGauge({ pct, number: current.toLocaleString(), sublabel: target ? `of ${target.toLocaleString()}` : 'steps', colorFrom: 'var(--steps-soft)', colorTo: 'var(--steps)' })
    );
    return hero;
  }

  function renderStatsCard(userId, targets, stepEntries, dailyChecklist, container) {
    const current = DailyTrackingEngine.sumSteps(stepEntries, selectedDate);
    const target = targets?.stepTarget ?? null;
    const percent = target ? Math.round((current / target) * 100) : null;

    const weeklyAvg = computeWeeklyStepAverage(stepEntries, selectedDate);

    const dateBar = Utils.el('div', { class: 'row-actions' }, [
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, -1); renderInner(container); } }, '← Prev day'),
      Utils.el('input', { class: 'form__input', type: 'date', value: selectedDate, onChange: (e) => { if (e.target.value) { selectedDate = e.target.value; renderInner(container); } } }),
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, 1); renderInner(container); } }, 'Next day →'),
    ]);

    const walkDone = !!(dailyChecklist?.checks?.morning_walk);
    const walkBtn = Utils.el('button', {
      class: `chip${walkDone ? ' chip--active' : ''}`, type: 'button',
      onClick: async () => {
        const checks = { ...(dailyChecklist?.checks || {}), morning_walk: !walkDone };
        if (dailyChecklist) await DataService.dailyChecklists.update(dailyChecklist.dailyChecklistId, { checks });
        else await DataService.dailyChecklists.create(Models.createDailyChecklist(userId, selectedDate, { checks }));
        await renderInner(container);
      },
    }, walkDone ? '✓ Morning walk done' : 'Mark morning walk done');

    const eveningWalkDone = !!(dailyChecklist?.checks?.evening_walk);
    const eveningWalkBtn = Utils.el('button', {
      class: `chip${eveningWalkDone ? ' chip--active' : ''}`, type: 'button',
      onClick: async () => {
        const checks = { ...(dailyChecklist?.checks || {}), evening_walk: !eveningWalkDone };
        if (dailyChecklist) await DataService.dailyChecklists.update(dailyChecklist.dailyChecklistId, { checks });
        else await DataService.dailyChecklists.create(Models.createDailyChecklist(userId, selectedDate, { checks }));
        await renderInner(container);
      },
    }, eveningWalkDone ? '✓ Evening walk done' : 'Mark evening walk done');

    const entryInput = Utils.el('input', { class: 'form__input', type: 'number', min: 0, placeholder: 'Total steps', style: 'width:130px;' });
    const existing = stepEntries.find(s => s.date === selectedDate);
    if (existing?.steps != null) entryInput.value = existing.steps;
    const saveBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button' }, 'Save Steps');
    saveBtn.addEventListener('click', async () => {
      const steps = Number(entryInput.value);
      if (entryInput.value === '' || steps < 0) { Utils.toast('Enter a step count.', 'error'); return; }
      if (existing) await DataService.stepEntries.update(existing.stepEntryId, { steps, source: 'manual' });
      else await DataService.stepEntries.create(Models.createStepEntry(userId, selectedDate, { steps, source: 'manual' }));
      Utils.toast('Steps saved.', 'success');
      await renderInner(container);
    });

    const rows = [
      ['Current (daily total)', `${current}`],
      ['Target', target != null ? `${target}` : 'No data entered'],
      ['Remaining', target != null ? `${Math.max(0, target - current)}` : 'No data entered'],
      ['Percentage', percent != null ? `${percent}%` : 'No data entered'],
      ['Weekly average', weeklyAvg != null ? `${weeklyAvg}` : 'No data entered'],
    ];

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [Utils.el('h2', { class: 'card__title' }, 'Steps'), Utils.el('p', { class: 'card__subtitle' }, Utils.formatDate(selectedDate))]),
        dateBar,
      ]),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
      Utils.el('div', { class: 'chip-row' }, [walkBtn, eveningWalkBtn]),
      Utils.el('h3', { class: 'form__group-title' }, 'Manual Entry'),
      Utils.el('div', { class: 'quick-add', style: 'flex-wrap:wrap;' }, [entryInput, saveBtn]),
    ]);
  }

  function computeWeeklyStepAverage(stepEntries, endDate) {
    const days = [];
    for (let i = 0; i < 7; i++) days.push(ProgramTemplates.addDays(endDate, -i));
    const totals = days.map(d => DailyTrackingEngine.sumSteps(stepEntries, d)).filter(t => t > 0);
    if (!totals.length) return null;
    return Math.round(totals.reduce((s, v) => s + v, 0) / totals.length);
  }

  function renderDeviceCard(userId, stepEntries, container) {
    const providers = DeviceIntegration.listProviders();
    const select = Utils.el('select', { class: 'form__input', style: 'max-width:280px;' }, providers.map(p => {
      const opt = Utils.el('option', { value: p.key }, `${p.label}${p.isDevice && !p.available ? ' — not connected' : ''}`);
      if (p.key === selectedProvider) opt.setAttribute('selected', 'selected');
      if (p.isDevice && !p.available) opt.setAttribute('disabled', 'disabled');
      return opt;
    }));
    select.addEventListener('change', (e) => { selectedProvider = e.target.value; renderInner(container); });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Data Source'),
        Utils.el('p', { class: 'card__subtitle' }, 'Architecture is ready for a future step-tracking device — only manual entry is active today.'),
      ]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Source'), select]),
      Utils.el('p', { class: 'card__footnote' }, 'When a device integration ships, connecting it here will auto-fill daily steps — no other part of this page will need to change.'),
      Utils.el('p', { class: 'card__footnote' }, 'Distance and calorie estimates from steps aren\u2019t shown because no connected source provides real data for them yet — we don\u2019t estimate these from step count alone.'),
    ]);
  }

  function renderHistoryCard(stepEntries, container) {
    const dailySorted = [...stepEntries].filter(s => s.steps != null).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

    const toggleRow = Utils.el('div', { class: 'chip-row' }, [
      Utils.el('button', { class: `chip${historyView === 'daily' ? ' chip--active' : ''}`, type: 'button', onClick: () => { historyView = 'daily'; renderInner(container); } }, 'Daily'),
      Utils.el('button', { class: `chip${historyView === 'weekly' ? ' chip--active' : ''}`, type: 'button', onClick: () => { historyView = 'weekly'; renderInner(container); } }, 'Weekly'),
    ]);

    let body;
    if (historyView === 'weekly') {
      const weeks = groupStepsByWeek(stepEntries);
      body = weeks.length
        ? Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
            Utils.el('thead', {}, Utils.el('tr', {}, ['Week', 'Avg. Steps/Day', 'Days Logged'].map(h => Utils.el('th', {}, h)))),
            Utils.el('tbody', {}, weeks.map(w => Utils.el('tr', {}, [
              Utils.el('td', {}, w.key), Utils.el('td', {}, `${w.avgSteps}`), Utils.el('td', {}, `${w.count}`),
            ]))),
          ]))
        : Utils.el('p', { class: 'card__footnote' }, 'No data entered');
    } else {
      const rows = dailySorted.map(s => Utils.el('div', { class: 'entry-row' }, [
        Utils.el('div', { class: 'entry-row__main' }, [
          Utils.el('div', { class: 'entry-row__name' }, Utils.formatDate(s.date)),
          Utils.el('div', { class: 'entry-row__meta' }, `${s.steps} steps · ${s.source === 'manual' ? 'Manual entry' : DeviceIntegration.getProvider(s.source).label}`),
        ]),
        Utils.el('div', { class: 'row-actions' }, [
          Utils.el('button', { class: 'btn btn--danger btn--row', type: 'button', onClick: async () => { await DataService.stepEntries.delete(s.stepEntryId); await renderInner(container); } }, 'Delete'),
        ]),
      ]));
      body = rows.length ? Utils.el('div', { class: 'entry-list' }, rows) : Utils.el('p', { class: 'card__footnote' }, 'No data entered');
    }

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'History')),
      toggleRow,
      body,
    ]);
  }

  /** Weekly averages, real logged days only — an empty week never shows
   *  as a zero, it's simply omitted (same principle as Progress's weight
   *  weekly grouping). */
  function groupStepsByWeek(stepEntries) {
    const groups = new Map();
    [...stepEntries].filter(s => s.steps != null).sort((a, b) => a.date.localeCompare(b.date)).forEach(s => {
      const d = new Date(s.date + 'T00:00:00');
      const target = new Date(d.valueOf());
      const dayNr = (d.getUTCDay() + 6) % 7;
      target.setUTCDate(target.getUTCDate() - dayNr + 3);
      const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
      const weekNumber = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
      const key = `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s.steps);
    });
    return [...groups.entries()]
      .map(([key, values]) => ({ key, avgSteps: Math.round(values.reduce((a, b) => a + b, 0) / values.length), count: values.length }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  return { render };
})();
