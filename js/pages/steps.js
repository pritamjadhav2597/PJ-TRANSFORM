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

  // --- Live (in-app, foreground) step tracking session state ---------
  // Deliberately module-level, not per-render: a re-render (e.g. after
  // saving a manual entry) must not interrupt an active tracking session.
  let liveActive = false;
  let liveBaselineSteps = 0;   // steps already saved for today before this session started
  let liveSessionSteps = 0;    // steps counted during this session only
  let liveFlushTimer = null;
  let liveHashListener = null;
  let liveVisibilityListener = null;
  let liveCounterEl = null;    // direct DOM ref so ticks don't need a full re-render
  let liveUserId = null;

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
    container.appendChild(renderLiveTrackingCard(userId, stepEntries, container));
    container.appendChild(renderStatsCard(userId, targets, stepEntries, dailyChecklist, container));
    container.appendChild(renderDeviceCard(userId, stepEntries, container));
    container.appendChild(renderHistoryCard(stepEntries, container));

    UIFx.animateIn(container);
  }

  function renderLiveTrackingCard(userId, stepEntries, container) {
    const today = Models.todayIso();
    const isToday = selectedDate === today;

    if (!isToday) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, [
          Utils.el('h2', { class: 'card__title' }, 'Live Tracking'),
        ]),
        Utils.el('p', { class: 'card__footnote' }, 'Live tracking only works for today \u2014 switch to today\u2019s date to start it.'),
      ]);
    }

    if (!StepCounter.isSupported()) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, [
          Utils.el('h2', { class: 'card__title' }, 'Live Tracking'),
        ]),
        Utils.el('p', { class: 'card__footnote' }, 'This device/browser doesn\u2019t support motion sensing, so live step tracking isn\u2019t available here \u2014 use manual entry below instead.'),
      ]);
    }

    const todayEntry = stepEntries.find(s => s.date === today);
    const savedToday = todayEntry?.steps ?? 0;

    const countDisplay = Utils.el('div', { class: 'live-steps__count' }, `${liveActive ? liveBaselineSteps + liveSessionSteps : savedToday}`);
    liveCounterEl = liveActive ? countDisplay : null;

    const statusRow = liveActive
      ? Utils.el('div', { class: 'live-steps__status' }, [
          Utils.el('span', { class: 'live-dot' }),
          Utils.el('span', {}, `Live \u2014 +${liveSessionSteps} this session`),
        ])
      : Utils.el('p', { class: 'card__footnote' }, 'Counts steps from your phone\u2019s motion sensor while this page is open on screen. It stops if you switch apps or lock the screen \u2014 that\u2019s a browser limitation, not a bug. Estimated, not lab-precise.');

    const toggleBtn = Utils.el('button', {
      class: `btn ${liveActive ? 'btn--danger' : 'btn--primary'} btn--row`, type: 'button',
      onClick: async () => {
        if (liveActive) {
          await stopLiveTracking(container);
        } else {
          await startLiveTracking(userId, container);
        }
      },
    }, liveActive ? 'Stop Live Tracking' : 'Start Live Tracking');

    return Utils.el('section', { class: `card${liveActive ? ' card--live' : ''}` }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Live Tracking'),
          Utils.el('p', { class: 'card__subtitle' }, 'Steps counted automatically from your phone, right in the app.'),
        ]),
      ]),
      countDisplay,
      statusRow,
      Utils.el('div', { class: 'row-actions', style: 'margin-top:10px;' }, [toggleBtn]),
    ]);
  }

  async function startLiveTracking(userId, container) {
    if (StepCounter.needsPermission()) {
      const granted = await StepCounter.requestPermission();
      if (!granted) {
        Utils.toast('Motion access was denied \u2014 enable it in your browser/phone settings to use live tracking.', 'error');
        return;
      }
    }

    const today = Models.todayIso();
    const existing = (await DataService.stepEntries.list(s => s.userId === userId && s.date === today))[0] || null;
    liveBaselineSteps = existing?.steps ?? 0;
    liveSessionSteps = 0;
    liveUserId = userId;

    const started = StepCounter.start(() => {
      liveSessionSteps += 1;
      if (liveCounterEl) liveCounterEl.textContent = `${liveBaselineSteps + liveSessionSteps}`;
      if (liveSessionSteps % 5 === 0) flushLiveSteps();
    });

    if (!started) {
      Utils.toast('Live tracking isn\u2019t available on this device.', 'error');
      return;
    }

    liveActive = true;
    liveFlushTimer = setInterval(flushLiveSteps, 8000);

    // Auto-stop (with a final flush) if the person navigates away from this
    // page entirely, so a session never keeps "running" invisibly forever.
    liveHashListener = () => { stopLiveTracking(null); };
    window.addEventListener('hashchange', liveHashListener, { once: true });

    // Flush promptly (but don't auto-stop) if the tab is backgrounded —
    // devicemotion pauses on its own there, this just avoids losing the
    // last few unsynced steps if the person doesn't come straight back.
    liveVisibilityListener = () => { if (document.hidden) flushLiveSteps(); };
    document.addEventListener('visibilitychange', liveVisibilityListener);

    await renderInner(container);
  }

  async function stopLiveTracking(container) {
    StepCounter.stop();
    await flushLiveSteps();

    if (liveFlushTimer) clearInterval(liveFlushTimer);
    liveFlushTimer = null;
    if (liveHashListener) window.removeEventListener('hashchange', liveHashListener);
    liveHashListener = null;
    if (liveVisibilityListener) document.removeEventListener('visibilitychange', liveVisibilityListener);
    liveVisibilityListener = null;

    liveActive = false;
    liveCounterEl = null;
    liveSessionSteps = 0;

    if (container) await renderInner(container);
  }

  async function flushLiveSteps() {
    if (!liveUserId) return;
    const today = Models.todayIso();
    const total = liveBaselineSteps + liveSessionSteps;
    const existing = (await DataService.stepEntries.list(s => s.userId === liveUserId && s.date === today))[0] || null;
    if (existing) await DataService.stepEntries.update(existing.stepEntryId, { steps: total, source: 'live_device' });
    else await DataService.stepEntries.create(Models.createStepEntry(liveUserId, today, { steps: total, source: 'live_device' }));
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

    const entryInput = Utils.el('input', { class: 'form__input', type: 'number', min: 0, placeholder: 'Total steps', style: 'width:130px;', disabled: liveActive || undefined });
    const existing = stepEntries.find(s => s.date === selectedDate);
    if (existing?.steps != null) entryInput.value = existing.steps;
    const saveBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button', disabled: liveActive || undefined }, 'Save Steps');
    saveBtn.addEventListener('click', async () => {
      if (liveActive) { Utils.toast('Stop live tracking to enter steps manually.', 'info'); return; }
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
