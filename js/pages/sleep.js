/**
 * pages/sleep.js — Sleep tracking. Duration is derived from bedtime/wake
 * time via RecoveryEngine.computeSleepDurationHours (or can be entered
 * directly). Target comes straight from profile.typicalSleepHours.
 */

const PageSleep = (() => {

  let selectedDate = Models.todayIso();

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
    const sleepEntries = await DataService.sleepEntries.list(s => s.userId === userId);

    container.appendChild(renderSleepHero(profile, sleepEntries));
    container.appendChild(renderEntryCard(userId, profile, sleepEntries, container));
    container.appendChild(renderHistoryCard(sleepEntries, container));

    UIFx.animateIn(container);
  }

  function renderSleepHero(profile, sleepEntries) {
    const existing = sleepEntries.find(s => s.date === selectedDate) || null;
    const targetHours = profile?.typicalSleepHours ?? null;
    const hours = existing?.hoursSlept ?? null;
    const pct = targetHours && hours != null ? Math.min(100, Math.round((hours / targetHours) * 100)) : 0;

    const hero = UIFx.hero({
      theme: 'sleep',
      icon: '\uD83C\uDF19',
      eyebrow: 'Sleep',
      title: 'Rest & Recovery',
      subtitle: hours != null
        ? `${hours} h logged${targetHours ? ` against a ${targetHours} h target` : ''}${existing?.quality != null ? ` · quality ${existing.quality}/5` : ''}.`
        : 'No sleep logged yet for this date.',
      stats: [],
    });
    hero.classList.add('card--hero--compact', 'card--accent-sleep');
    hero.querySelector('.hero__inner').appendChild(
      UIFx.ringNode({
        pct, number: hours != null ? `${hours}h` : '—', of: targetHours ? `of ${targetHours}h` : '',
        colorFrom: 'var(--sleep-soft)', colorTo: 'var(--sleep)', size: 132, stroke: 9,
        wrapClass: 'hero__ring-wrap', svgClass: 'hero__ring-svg',
      })
    );
    hero.appendChild(Utils.el('div', { class: 'row-actions', style: 'position:relative;z-index:1;margin-top:16px;' }, [
      Utils.el('a', { class: 'btn btn--primary', href: '#sleep-entry-form' }, 'LOG SLEEP'),
    ]));
    return hero;
  }

  function renderEntryCard(userId, profile, sleepEntries, container) {
    const existing = sleepEntries.find(s => s.date === selectedDate) || null;
    const targetHours = profile?.typicalSleepHours ?? null;

    const dateBar = Utils.el('div', { class: 'row-actions' }, [
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, -1); renderInner(container); } }, '← Prev day'),
      Utils.el('input', { class: 'form__input', type: 'date', value: selectedDate, onChange: (e) => { if (e.target.value) { selectedDate = e.target.value; renderInner(container); } } }),
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, 1); renderInner(container); } }, 'Next day →'),
    ]);

    const bedtimeInput = Utils.el('input', { class: 'form__input', type: 'time', value: existing?.bedtime || '' });
    const wakeInput = Utils.el('input', { class: 'form__input', type: 'time', value: existing?.wakeTime || '' });
    const durationInput = Utils.el('input', {
      class: 'form__input', type: 'number', step: '0.1', min: 0, max: 16,
      value: existing?.hoursSlept ?? '',
      placeholder: 'Hours',
    });

    const recomputeBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => {
        const computed = RecoveryEngine.computeSleepDurationHours(bedtimeInput.value, wakeInput.value);
        if (computed == null) { Utils.toast('Enter both bedtime and wake time first.', 'error'); return; }
        durationInput.value = computed;
      },
    }, 'Compute from times');

    let qualitySelected = existing?.quality ?? null;
    const qualityRow = Utils.el('div', { class: 'chip-row' }, [1, 2, 3, 4, 5].map(n =>
      Utils.el('button', {
        class: `chip${qualitySelected === n ? ' chip--active' : ''}`, type: 'button',
        onClick: (e) => {
          qualitySelected = n;
          e.currentTarget.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
          e.currentTarget.classList.add('chip--active');
        },
      }, `${n}`)));

    const saveBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button' }, existing ? 'Save changes' : 'Save Sleep');
    saveBtn.addEventListener('click', async () => {
      const hoursSlept = durationInput.value !== '' ? Number(durationInput.value) : null;
      const patch = { bedtime: bedtimeInput.value, wakeTime: wakeInput.value, hoursSlept, quality: qualitySelected };
      if (existing) await DataService.sleepEntries.update(existing.sleepEntryId, patch);
      else await DataService.sleepEntries.create(Models.createSleepEntry(userId, selectedDate, patch));
      Utils.toast('Sleep logged.', 'success');
      await renderInner(container);
    });

    const weeklyDurationTrend = RecoveryEngine.computeWeeklyTrend(sleepEntries, 'hoursSlept', new Date(selectedDate + 'T00:00:00'));
    const weeklyQualityTrend = RecoveryEngine.computeWeeklyTrend(sleepEntries, 'quality', new Date(selectedDate + 'T00:00:00'));

    const statRows = [
      ['Target', targetHours != null ? `${targetHours} h` : 'No data entered'],
      ['This week — avg duration', weeklyDurationTrend.thisWeekAvg != null ? `${weeklyDurationTrend.thisWeekAvg} h` : 'No data entered'],
      ['Weekly trend (duration)', formatSigned(weeklyDurationTrend.change, ' h')],
      ['This week — avg quality', weeklyQualityTrend.thisWeekAvg != null ? `${weeklyQualityTrend.thisWeekAvg} / 5` : 'No data entered'],
    ];

    return Utils.el('section', { class: 'card', id: 'sleep-entry-form' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [Utils.el('h2', { class: 'card__title' }, 'Sleep'), Utils.el('p', { class: 'card__subtitle' }, Utils.formatDate(selectedDate))]),
        dateBar,
      ]),
      Utils.el('div', { class: 'form__grid' }, [
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Bedtime'), bedtimeInput]),
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Wake time'), wakeInput]),
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Duration (hours)'), durationInput]),
      ]),
      recomputeBtn,
      Utils.el('h3', { class: 'form__group-title' }, 'Quality (1–5)'),
      qualityRow,
      Utils.el('div', { class: 'form__actions' }, [saveBtn]),
      Utils.el('h3', { class: 'form__group-title' }, 'Summary'),
      Utils.el('dl', { class: 'stat-list' }, statRows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v ?? 'No data entered')])),
    ]);
  }

  function renderHistoryCard(sleepEntries, container) {
    const sorted = [...sleepEntries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    const rows = sorted.map(s => Utils.el('div', { class: 'entry-row' }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__name' }, Utils.formatDate(s.date)),
        Utils.el('div', { class: 'entry-row__meta' }, [
          s.bedtime && s.wakeTime ? `${s.bedtime} → ${s.wakeTime}` : '',
          s.hoursSlept != null ? `${s.hoursSlept} h` : 'No duration',
          s.quality != null ? `Quality ${s.quality}/5` : '',
        ].filter(Boolean).join(' · ')),
      ]),
      Utils.el('div', { class: 'row-actions' }, [
        Utils.el('button', { class: 'btn btn--danger btn--row', type: 'button', onClick: async () => { await DataService.sleepEntries.delete(s.sleepEntryId); await renderInner(container); } }, 'Delete'),
      ]),
    ]));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'History')),
      rows.length ? Utils.el('div', { class: 'entry-list' }, rows) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ]);
  }

  function formatSigned(val, suffix) {
    if (val === null || val === undefined) return null;
    const sign = val > 0 ? '+' : '';
    return `${sign}${val}${suffix}`;
  }

  return { render };
})();
