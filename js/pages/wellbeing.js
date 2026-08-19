/**
 * pages/wellbeing.js -- Sexual Wellbeing (private). Weekly trends reuse
 * RecoveryEngine.computeWeeklyTrend (same 1-5 scale as Recovery). This
 * page never diagnoses anything and never claims a food directly raises
 * testosterone or sexual performance -- see the disclaimers below, always
 * shown alongside the tracked data.
 */

const PageWellbeing = (() => {

  const FIELDS = [
    { key: 'libidoLevel', label: 'Libido' },
    { key: 'energyLevel', label: 'Energy' },
    { key: 'stressLevel', label: 'Stress' },
    { key: 'sleepQuality', label: 'Sleep Quality' },
    { key: 'recoveryLevel', label: 'Recovery' },
  ];

  const PRIVACY_NOTE = "This section is private. Nothing you log here appears anywhere else in the app — including the Dashboard — unless you turn the toggle below on.";
  const NON_DIAGNOSTIC_NOTE = "This is general wellness tracking, not a diagnostic tool. It does not assess or diagnose sexual dysfunction. If you have ongoing concerns, consider speaking with a healthcare professional.";
  const FOOD_CLAIM_NOTE = "No single food directly raises testosterone or sexual performance. The factors below are what broadly supports overall wellbeing, not a supplement or diet hack.";

  const FOCUS_AREAS = [
    { label: 'Fitness', link: '#/workout' },
    { label: 'Cardiovascular health', link: '#/workout' },
    { label: 'Healthy body composition', link: '#/progress' },
    { label: 'Resistance training', link: '#/workout' },
    { label: 'Adequate nutrition', link: '#/diet' },
    { label: 'Protein', link: '#/diet' },
    { label: 'Healthy fats', link: '#/diet' },
    { label: 'Micronutrients', link: '#/diet' },
    { label: 'Sleep', link: '#/sleep' },
    { label: 'Stress management', link: '#/recovery' },
    { label: 'Recovery', link: '#/recovery' },
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

    const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
    const entries = await DataService.sexualWellbeingEntries.list(e => e.userId === userId);
    const existing = entries.find(e => e.date === selectedDate) || null;
    draft = existing ? { ...existing } : {};

    container.appendChild(renderWellbeingHero(existing));
    container.appendChild(renderPrivacyCard(userId, profile, container));
    container.appendChild(renderEntryCard(userId, existing, container));
    container.appendChild(renderTrendsCard(entries));
    container.appendChild(renderFocusAreasCard());
    container.appendChild(renderHistoryCard(entries, container));

    UIFx.animateIn(container);
  }

  function renderWellbeingHero(existing) {
    const vals = FIELDS.map(f => existing?.[f.key]).filter(v => v != null);
    const avg = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
    const pct = avg != null ? avg * 20 : 0;

    const hero = UIFx.hero({
      theme: 'wellbeing',
      icon: '\u2728',
      eyebrow: 'Wellbeing',
      title: 'Check-in Summary',
      subtitle: avg != null ? `Today\u2019s average across ${vals.length} logged factor${vals.length === 1 ? '' : 's'}.` : 'No check-in logged yet today.',
      stats: [],
    });
    hero.classList.add('card--hero--compact', 'card--accent-wellbeing');
    hero.querySelector('.hero__inner').appendChild(
      UIFx.ringNode({ pct, number: avg != null ? `${avg}` : '\u2013', of: '/ 5', colorFrom: 'var(--wellbeing-soft)', colorTo: 'var(--wellbeing)', size: 110, stroke: 8 })
    );
    return hero;
  }

  function renderPrivacyCard(userId, profile, container) {
    const visible = !!profile?.wellbeingDashboardVisible;
    const toggleBtn = Utils.el('button', {
      class: `chip${visible ? ' chip--active' : ''}`, type: 'button',
      onClick: async () => {
        if (!profile) { Utils.toast('Set up your profile first.', 'error'); return; }
        await DataService.profiles.update(profile.profileId, { wellbeingDashboardVisible: !visible });
        Utils.toast(visible ? 'Removed from Dashboard.' : 'A private summary will now show on your Dashboard.', 'success');
        await renderInner(container);
      },
    }, visible ? '\u2713 Shown on Dashboard' : 'Show summary on Dashboard');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Privacy')),
      Utils.el('p', {}, PRIVACY_NOTE),
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, NON_DIAGNOSTIC_NOTE),
      Utils.el('div', { class: 'chip-row' }, [toggleBtn]),
    ]);
  }

  function renderEntryCard(userId, existing, container) {
    const dateBar = Utils.el('div', { class: 'row-actions' }, [
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, -1); renderInner(container); } }, '\u2190 Prev day'),
      Utils.el('input', { class: 'form__input', type: 'date', value: selectedDate, onChange: (e) => { if (e.target.value) { selectedDate = e.target.value; renderInner(container); } } }),
      Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button', onClick: () => { selectedDate = ProgramTemplates.addDays(selectedDate, 1); renderInner(container); } }, 'Next day \u2192'),
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

    const saveBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button' }, existing ? 'Save changes' : 'Save Entry');
    saveBtn.addEventListener('click', async () => {
      const patch = { notes: notesInput.value };
      FIELDS.forEach(f => { patch[f.key] = draft[f.key] ?? null; });
      if (existing) await DataService.sexualWellbeingEntries.update(existing.sexualWellbeingEntryId, patch);
      else await DataService.sexualWellbeingEntries.create(Models.createSexualWellbeingEntry(userId, selectedDate, patch));
      Utils.toast('Saved.', 'success');
      await renderInner(container);
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [Utils.el('h2', { class: 'card__title' }, 'Check-in'), Utils.el('p', { class: 'card__subtitle' }, Utils.formatDate(selectedDate))]),
        dateBar,
      ]),
      Utils.el('p', { class: 'card__footnote' }, 'Rate each 1 (low) to 5 (high). Stress: higher means more stressed.'),
      Utils.el('div', {}, fieldRows),
      Utils.el('div', { class: 'form__field form__field--wide' }, [Utils.el('label', { class: 'form__label' }, 'Notes'), notesInput]),
      Utils.el('div', { class: 'form__actions' }, [saveBtn]),
    ]);
  }

  function renderTrendsCard(entries) {
    const endDate = new Date(selectedDate + 'T00:00:00');
    const rows = FIELDS.map(f => {
      const trend = RecoveryEngine.computeWeeklyTrend(entries, f.key, endDate);
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

  function renderFocusAreasCard() {
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'What Actually Helps')),
      Utils.el('p', { class: 'card__footnote', style: 'font-style:normal;' }, FOOD_CLAIM_NOTE),
      Utils.el('div', { class: 'quick-links' }, FOCUS_AREAS.map(f => Utils.el('a', { class: 'quick-links__item', href: f.link }, f.label))),
    ]);
  }

  function renderHistoryCard(entries, container) {
    const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    const rows = sorted.map(e => Utils.el('div', { class: 'entry-row' }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__name' }, Utils.formatDate(e.date)),
        Utils.el('div', { class: 'entry-row__meta' }, FIELDS.map(f => `${f.label}: ${e[f.key] ?? '—'}`).join(' · ')),
        e.notes ? Utils.el('div', { class: 'entry-row__notes' }, e.notes) : null,
      ].filter(Boolean)),
      Utils.el('div', { class: 'row-actions' }, [
        Utils.el('button', { class: 'btn btn--danger btn--row', type: 'button', onClick: async () => { await DataService.sexualWellbeingEntries.delete(e.sexualWellbeingEntryId); await renderInner(container); } }, 'Delete'),
      ]),
    ]));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'History')),
      rows.length ? Utils.el('div', { class: 'entry-list' }, rows) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ]);
  }

  return { render, PRIVACY_NOTE, NON_DIAGNOSTIC_NOTE, FOOD_CLAIM_NOTE };
})();
