/**
 * pages/water.js — Water tracking, brought up to the Workout page's
 * interaction standard (see 00_MASTER_UX_STANDARD): a real hero with a
 * trend snapshot, a focused quick-add interaction, a same-day timeline
 * (not just a flat list), and a progress view with a trend chart + streak
 * — instead of a gauge and a table.
 *
 * One source of truth preserved throughout: target comes straight from
 * Calculations.calculateAllTargets() (waterTargetMl) and consumed totals
 * reuse DailyTrackingEngine.sumWaterMl — nothing here recomputes either.
 */

const PageWater = (() => {

  const PRESETS_ML = [200, 250, 500, 750, 1000];
  const MAX_STREAK_LOOKBACK_DAYS = 365;

  let selectedDate = Models.todayIso();
  let justReachedGoalAt = null; // waterEntryId that pushed the total over target, for a one-time gauge pulse

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
    const targetMl = targets?.waterTargetMl ?? null;

    const waterEntries = await DataService.waterEntries.list(w => w.userId === userId);

    const ctx = { userId, targetMl, waterEntries, container };

    container.appendChild(renderWaterHero(ctx));
    container.appendChild(renderQuickAddCard(ctx));
    container.appendChild(renderTimelineCard(ctx));
    container.appendChild(renderProgressCard(ctx));

    UIFx.animateIn(container);
  }

  // =====================================================================
  // Shared derivations
  // =====================================================================

  function computeStreak(waterEntries, targetMl, endDate) {
    if (targetMl == null) return 0;
    let streak = 0;
    let d = endDate;
    for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS; i++) {
      const total = DailyTrackingEngine.sumWaterMl(waterEntries, d);
      if (total >= targetMl) { streak++; d = ProgramTemplates.addDays(d, -1); } else break;
    }
    return streak;
  }

  // =====================================================================
  // HERO — today's fill gauge, this week at a glance, and a streak chip.
  // Mirrors the Workout hero's "gauge + trend" layout so Water reads at
  // the same level of polish, adapted to hydration's own data.
  // =====================================================================

  function renderWaterHero(ctx) {
    const { targetMl, waterEntries } = ctx;
    const today = Models.todayIso();
    const consumedToday = DailyTrackingEngine.sumWaterMl(waterEntries, today);
    const pct = targetMl ? Math.round((consumedToday / targetMl) * 100) : 0;
    const remainingMl = targetMl != null ? Math.max(0, targetMl - consumedToday) : null;
    const reachedToday = targetMl != null && consumedToday >= targetMl;
    const streak = computeStreak(waterEntries, targetMl, today);

    const days = [];
    for (let i = 6; i >= 0; i--) days.push(ProgramTemplates.addDays(today, -i));
    const trendSeries = [{
      label: 'Water',
      color: 'var(--water)',
      points: days.map(d => ({ x: d, y: DailyTrackingEngine.sumWaterMl(waterEntries, d) })),
    }];
    const lineSvg = ChartUtils.buildLineChartSVG(trendSeries, {
      width: 320, height: 110, yUnit: ' ml', yDecimals: 0,
      targetY: targetMl ?? undefined, targetLabel: targetMl ? 'Goal' : undefined,
    });

    const hero = UIFx.hero({
      theme: 'hydration',
      icon: '\uD83D\uDCA7',
      eyebrow: 'Hydration',
      title: 'Water Tracking',
      subtitle: targetMl
        ? `${consumedToday} ml of your ${targetMl} ml goal so far today${reachedToday ? ' — goal reached.' : '.'}`
        : 'No target yet — add a profile to calculate a daily water target.',
      stats: [],
    });
    hero.classList.add('card--hero--compact', 'card--accent-water');

    const row = Utils.el('div', { class: 'hero__stats', style: 'flex:1 1 auto;align-items:center;gap:24px;' });

    const gauge = UIFx.liquidGauge({
      pct,
      label: `${pct}%`,
      sublabel: targetMl ? `${consumedToday} / ${targetMl} ml` : `${consumedToday} ml logged`,
    });
    if (justReachedGoalAt) { gauge.classList.add('liquid-gauge--reached'); justReachedGoalAt = null; }
    row.appendChild(gauge);

    const statPairs = [
      ['Consumed', `${consumedToday} ml`],
      ['Target', targetMl != null ? `${targetMl} ml` : 'No data entered'],
      ['Remaining', remainingMl != null ? `${remainingMl} ml` : 'No data entered'],
      ['Percentage', targetMl != null ? `${pct}%` : 'No data entered'],
    ];
    row.appendChild(Utils.el('div', { class: 'hero__stats', style: 'flex-wrap:wrap;row-gap:10px;' },
      statPairs.map(([label, val]) => Utils.el('div', { class: 'hero__stat' }, [
        Utils.el('div', { class: 'hero__stat-value' }, val),
        Utils.el('div', { class: 'hero__stat-label' }, label),
      ]))));

    if (lineSvg) {
      const chartWrap = Utils.el('div', { style: 'flex:1 1 220px;min-width:200px;' });
      chartWrap.innerHTML = `<div class="hero__ring-of" style="margin-bottom:4px;">Last 7 days — ml logged</div>${lineSvg}`;
      row.appendChild(chartWrap);
    }
    hero.querySelector('.hero__inner').appendChild(row);

    if (streak >= 2) {
      const chipRow = Utils.el('div', { style: 'position:relative;z-index:1;margin-top:14px;' }, [
        Utils.el('span', { class: 'streak-chip' }, [
          Utils.el('span', { class: 'streak-chip__flame' }, '\uD83D\uDD25'),
          `${streak}-day goal streak`,
        ]),
      ]);
      hero.querySelector('.hero__inner').appendChild(chipRow);
    }

    hero.appendChild(Utils.el('div', { class: 'row-actions', style: 'position:relative;z-index:1;margin-top:16px;' }, [
      Utils.el('a', { class: 'btn btn--primary', href: '#water-quick-add' }, 'ADD WATER'),
    ]));

    return hero;
  }

  // =====================================================================
  // QUICK ADD — goal → quick add → custom amount, plus an immediate undo
  // for the most recent entry so a mis-tap is never a trip to History.
  // =====================================================================

  function renderQuickAddCard(ctx) {
    const { userId, targetMl, waterEntries, container } = ctx;
    const consumedToday = DailyTrackingEngine.sumWaterMl(waterEntries, selectedDate);

    const dateBar = Utils.el('div', { class: 'row-actions' }, [
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, -1); renderInner(container); } }, '← Prev day'),
      Utils.el('input', { class: 'form__input', type: 'date', value: selectedDate, onChange: (e) => { if (e.target.value) { selectedDate = e.target.value; renderInner(container); } } }),
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, 1); renderInner(container); } }, 'Next day →'),
    ]);

    const quickAdd = async (amountMl) => {
      const before = DailyTrackingEngine.sumWaterMl(waterEntries, selectedDate);
      const entry = await DataService.waterEntries.create(Models.createWaterEntry(userId, selectedDate, { amountMl, source: 'manual' }));
      const after = before + amountMl;
      if (targetMl != null && before < targetMl && after >= targetMl && selectedDate === Models.todayIso()) {
        justReachedGoalAt = entry.waterEntryId;
        Utils.toast(`\uD83C\uDF89 +${amountMl} ml logged — daily goal reached!`, 'success');
      } else {
        Utils.toast(`+${amountMl} ml logged.`, 'success');
      }
      await renderInner(container);
    };

    const presetChips = Utils.el('div', { class: 'chip-row' },
      PRESETS_ML.map(ml => Utils.el('button', { class: 'chip', type: 'button', onClick: () => quickAdd(ml) }, `+${ml} mL`)));

    const customInput = Utils.el('input', { class: 'form__input', type: 'number', min: 1, placeholder: 'Custom mL', style: 'width:120px;' });
    const customBtn = Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button' }, 'Add Custom');
    customBtn.addEventListener('click', () => {
      const ml = Number(customInput.value);
      if (!ml || ml <= 0) { Utils.toast('Enter an amount in mL.', 'error'); return; }
      customInput.value = '';
      quickAdd(ml);
    });
    customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') customBtn.click(); });

    const lastEntry = [...waterEntries].filter(w => w.date === selectedDate).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] || null;
    const undoBtn = Utils.el('button', {
      class: `btn btn--secondary btn--row${lastEntry ? '' : ' btn--disabled'}`, type: 'button',
      title: lastEntry ? `Remove the last entry (${lastEntry.amountMl} ml)` : 'No entries yet today',
      onClick: async () => {
        if (!lastEntry) return;
        await DataService.waterEntries.delete(lastEntry.waterEntryId);
        Utils.toast(`Removed last entry (${lastEntry.amountMl} ml).`, 'info');
        await renderInner(container);
      },
    }, '↩ Undo Last Entry');

    return Utils.el('section', { class: 'card', id: 'water-quick-add' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [Utils.el('h2', { class: 'card__title' }, 'Quick Add'), Utils.el('p', { class: 'card__subtitle' }, Utils.formatDate(selectedDate))]),
        dateBar,
      ]),
      Utils.el('p', { class: 'card__footnote' }, 'Target is calculated from your profile (bodyweight, training, climate) — see Calculated Targets on the Dashboard.'),
      Utils.el('dl', { class: 'stat-list' }, [
        Utils.el('dt', {}, 'Logged so far'), Utils.el('dd', {}, `${consumedToday} ml`),
        Utils.el('dt', {}, 'Goal'), Utils.el('dd', {}, targetMl != null ? `${targetMl} ml` : 'No data entered'),
      ]),
      presetChips,
      Utils.el('div', { class: 'quick-add', style: 'flex-wrap:wrap;' }, [customInput, customBtn, undoBtn]),
    ]);
  }

  // =====================================================================
  // TIMELINE — when during the day it happened, not just how much.
  // =====================================================================

  function renderTimelineCard(ctx) {
    const { waterEntries, container } = ctx;
    const dayEntries = [...waterEntries].filter(w => w.date === selectedDate).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    let timelineBody;
    if (!dayEntries.length) {
      timelineBody = Utils.el('p', { class: 'card__footnote' }, 'No data entered');
    } else {
      const amounts = dayEntries.map(e => e.amountMl || 0);
      const maxAmount = Math.max(...amounts, 1);
      const track = Utils.el('div', { class: 'water-timeline__track' });

      const isToday = selectedDate === Models.todayIso();
      if (isToday) {
        const now = new Date();
        const nowPct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
        track.appendChild(Utils.el('div', { class: 'water-timeline__now-line', style: `left:${nowPct}%;` }));
        track.appendChild(Utils.el('div', { class: 'water-timeline__now-label', style: `left:${nowPct}%;` }, 'Now'));
      }

      dayEntries.forEach(entry => {
        const dt = entry.createdAt ? new Date(entry.createdAt) : null;
        const pct = dt ? ((dt.getHours() * 60 + dt.getMinutes()) / 1440) * 100 : 50;
        const size = Math.round(14 + (entry.amountMl || 0) / maxAmount * 18);
        const marker = Utils.el('div', {
          class: 'water-timeline__marker',
          style: `left:${pct}%; width:${size}px; height:${size}px;`,
          title: `${entry.amountMl} ml${dt ? ` at ${dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`,
        });
        track.appendChild(marker);
      });

      const hourLabels = Utils.el('div', { class: 'water-timeline__hours' },
        ['12am', '6am', '12pm', '6pm', '12am'].map(h => Utils.el('span', {}, h)));

      timelineBody = Utils.el('div', { class: 'water-timeline' }, [track, hourLabels]);
    }

    const entryList = dayEntries.length
      ? Utils.el('div', { class: 'entry-list' }, dayEntries.map(w => Utils.el('div', { class: 'entry-row' }, [
          Utils.el('div', { class: 'entry-row__main' }, [
            Utils.el('div', { class: 'entry-row__name' }, `${w.amountMl} ml`),
            Utils.el('div', { class: 'entry-row__meta' }, w.createdAt ? Utils.formatDateTime(w.createdAt) : ''),
          ]),
          Utils.el('div', { class: 'row-actions' }, [
            Utils.el('button', {
              class: 'btn btn--danger btn--row', type: 'button',
              onClick: async () => { await DataService.waterEntries.delete(w.waterEntryId); await renderInner(container); },
            }, 'Delete'),
          ]),
        ])))
      : null;

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [Utils.el('h2', { class: 'card__title' }, 'Timeline'), Utils.el('p', { class: 'card__subtitle' }, `When you drank, ${Utils.formatDate(selectedDate)}`)]),
      ]),
      timelineBody,
      ...(entryList ? [Utils.el('h3', { class: 'form__group-title' }, 'Entries'), entryList] : []),
    ]);
  }

  // =====================================================================
  // PROGRESS — 14-day trend against the goal line, plus the daily totals.
  // =====================================================================

  function renderProgressCard(ctx) {
    const { targetMl, waterEntries } = ctx;

    const days = [];
    for (let i = 13; i >= 0; i--) days.push(ProgramTemplates.addDays(selectedDate, -i));
    const dailyTotals = days.map(d => ({ date: d, total: DailyTrackingEngine.sumWaterMl(waterEntries, d) }));

    const loggedDays = dailyTotals.filter(d => d.total > 0);
    const avgMl = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.total, 0) / loggedDays.length) : null;
    const daysGoalMet = targetMl != null ? dailyTotals.filter(d => d.total >= targetMl).length : null;
    const streakEndingSelected = computeStreak(waterEntries, targetMl, selectedDate);

    const trendSeries = [{ label: 'Water', color: 'var(--water)', points: dailyTotals.map(d => ({ x: d.date, y: d.total })) }];
    const lineSvg = ChartUtils.buildLineChartSVG(trendSeries, {
      width: 640, height: 200, yUnit: ' ml', yDecimals: 0,
      targetY: targetMl ?? undefined, targetLabel: targetMl ? 'Goal' : undefined,
    });

    const chartWrap = Utils.el('div', { style: 'margin:8px 0 4px;' });
    chartWrap.innerHTML = lineSvg || '';

    const summaryRows = [
      ['14-day average', avgMl != null ? `${avgMl} ml/day` : 'No data entered'],
      ['Days goal met (last 14)', daysGoalMet != null ? `${daysGoalMet} / 14` : 'No data entered'],
      ['Current streak', streakEndingSelected > 0 ? `${streakEndingSelected} day${streakEndingSelected === 1 ? '' : 's'}` : 'No data entered'],
    ];

    const historyTable = Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
      Utils.el('thead', {}, Utils.el('tr', {}, ['Date', 'Total', 'vs. Goal'].map(h => Utils.el('th', {}, h)))),
      Utils.el('tbody', {}, dailyTotals.map(d => {
        const met = targetMl != null ? d.total >= targetMl : null;
        return Utils.el('tr', {}, [
          Utils.el('td', {}, Utils.formatDate(d.date)),
          Utils.el('td', {}, d.total ? `${d.total} ml` : 'No data entered'),
          Utils.el('td', {}, met == null ? '—' : (met ? Utils.el('span', { class: 'badge badge--water' }, 'Met') : (d.total ? 'Under' : '—'))),
        ]);
      })),
    ]));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Progress')),
      lineSvg ? chartWrap : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
      Utils.el('dl', { class: 'stat-list' }, summaryRows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
      Utils.el('h3', { class: 'form__group-title' }, 'Last 14 Days'),
      historyTable,
    ]);
  }

  return { render };
})();
