/**
 * pages/craving.js -- "I Have a Craving" guided protocol. The steps
 * themselves come from CravingEngine.PROTOCOL_STEPS / HUNGER_FOODS (fixed,
 * never reordered here). Frequency detection reuses
 * CravingEngine.detectFrequentCravings.
 */

const PageCraving = (() => {

  let activeEventId = null;
  let stepIndex = 0;

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

    const events = await DataService.cravingEvents.list(e => e.userId === userId);
    const today = Models.todayIso();
    const frequency = CravingEngine.detectFrequentCravings(events, today);

    container.appendChild(renderCravingHero(events, today));
    if (frequency.flagged) container.appendChild(renderFrequencyBanner(frequency));

    const activeEvent = activeEventId ? events.find(e => e.cravingEventId === activeEventId) : null;
    container.appendChild(activeEvent ? renderProtocolCard(userId, activeEvent, container) : renderStartCard(userId, container));
    container.appendChild(renderHistoryCard(events, container));

    UIFx.animateIn(container);
  }

  function renderCravingHero(events, today) {
    const last30 = [];
    for (let i = 29; i >= 0; i--) last30.push(ProgramTemplates.addDays(today, -i));
    const inWindow = events.filter(e => e.outcome && last30.includes(e.date));
    const resolved = inWindow.filter(e => e.outcome === 'resolved_without_food').length;
    const pct = inWindow.length ? Math.round((resolved / inWindow.length) * 100) : 0;
    const todayCount = events.filter(e => e.date === today).length;

    const hero = UIFx.hero({
      theme: 'craving',
      icon: '\uD83E\uDDE0',
      eyebrow: 'Craving Control',
      title: 'Resisted Without Food',
      subtitle: inWindow.length
        ? `${resolved} of ${inWindow.length} cravings passed without eating, over the last 30 days.`
        : `${todayCount ? `${todayCount} craving${todayCount === 1 ? '' : 's'} logged today.` : 'No cravings logged yet — the protocol below walks you through one.'}`,
      stats: [],
    });
    hero.classList.add('card--hero--compact', 'card--accent-craving');
    hero.querySelector('.hero__inner').appendChild(
      UIFx.arcGauge({ pct, number: `${pct}%`, sublabel: '30-day rate', colorFrom: 'var(--craving-soft)', colorTo: 'var(--craving)' })
    );
    return hero;
  }

  function renderFrequencyBanner(frequency) {
    return Utils.el('section', { class: 'card', style: 'border:1px solid var(--ember);background:var(--ember-tint);' }, [
      Utils.el('h2', { class: 'card__title' }, 'Cravings have been frequent'),
      Utils.el('p', {}, frequency.message),
      Utils.el('a', { class: 'btn btn--secondary', href: '#/diet' }, 'Review your Diet'),
    ]);
  }

  function renderStartCard(userId, container) {
    const startBtn = Utils.el('button', { class: 'btn btn--primary', type: 'button' }, 'I Have a Craving');
    startBtn.addEventListener('click', async () => {
      const event = await DataService.cravingEvents.create(Models.createCravingEvent(userId, {}));
      activeEventId = event.cravingEventId;
      stepIndex = 0;
      await renderInner(container);
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Craving Control'),
        Utils.el('p', { class: 'card__subtitle' }, 'A short, consistent protocol before reaching for food.'),
      ]),
      startBtn,
    ]);
  }

  function renderProtocolCard(userId, event, container) {
    const steps = CravingEngine.PROTOCOL_STEPS;

    if (stepIndex < steps.length) {
      const step = steps[stepIndex];
      const nextBtn = Utils.el('button', { class: 'btn btn--primary', type: 'button' }, stepIndex === steps.length - 1 ? 'Done \u2014 Check In' : 'Next Step');
      nextBtn.addEventListener('click', async () => {
        const stepsCompleted = [...(event.stepsCompleted || []), step.key];
        await DataService.cravingEvents.update(event.cravingEventId, { stepsCompleted });
        stepIndex += 1;
        await renderInner(container);
      });
      const cancelBtn = Utils.el('button', { class: 'btn btn--secondary', type: 'button' }, 'Cancel');
      cancelBtn.addEventListener('click', async () => { await finish(event, 'abandoned', '', container); });

      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, [
          Utils.el('h2', { class: 'card__title' }, `Step ${stepIndex + 1} of ${steps.length}`),
          Utils.el('p', { class: 'card__subtitle' }, step.label),
        ]),
        Utils.el('p', {}, step.detail),
        Utils.el('div', { class: 'form__actions' }, [nextBtn, cancelBtn]),
      ]);
    }

    if (stepIndex === steps.length) {
      const stillHungryBtn = Utils.el('button', { class: 'btn btn--secondary', type: 'button' }, 'Still hungry');
      stillHungryBtn.addEventListener('click', () => { stepIndex += 1; renderInner(container); });
      const resolvedBtn = Utils.el('button', { class: 'btn btn--primary', type: 'button' }, 'Craving passed');
      resolvedBtn.addEventListener('click', async () => { await finish(event, 'resolved_without_food', '', container); });

      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Still hungry?')),
        Utils.el('p', {}, "You've been through water, a short wait, unsweetened tea/coffee, and a walk. How do you feel?"),
        Utils.el('div', { class: 'form__actions' }, [resolvedBtn, stillHungryBtn]),
      ]);
    }

    const foodButtons = CravingEngine.HUNGER_FOODS.map(f => {
      const btn = Utils.el('button', { class: 'chip', type: 'button' }, f.label);
      btn.addEventListener('click', async () => { await finish(event, 'ate_suggested_food', f.key, container); });
      return btn;
    });
    const somethingElseBtn = Utils.el('button', { class: 'btn btn--secondary', type: 'button' }, 'I ate something else');
    somethingElseBtn.addEventListener('click', async () => { await finish(event, 'ate_something_else', '', container); });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, "If you're genuinely hungry"),
        Utils.el('p', { class: 'card__subtitle' }, 'Reach for one of these first.'),
      ]),
      Utils.el('div', { class: 'chip-row' }, foodButtons),
      Utils.el('div', { class: 'form__actions' }, [somethingElseBtn]),
      Utils.el('a', { class: 'link', href: '#/nutrition' }, 'Log it in Food Entry \u2192'),
    ]);
  }

  async function finish(event, outcome, suggestedFoodChosen, container) {
    await DataService.cravingEvents.update(event.cravingEventId, { outcome, suggestedFoodChosen });
    Utils.toast('Logged.', 'success');
    activeEventId = null;
    stepIndex = 0;
    await renderInner(container);
  }

  function renderHistoryCard(events, container) {
    const sorted = [...events].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')).slice(0, 30);
    const rows = sorted.map(e => Utils.el('div', { class: 'entry-row' }, [
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__name' }, Utils.formatDate(e.date)),
        Utils.el('div', { class: 'entry-row__meta' }, outcomeLabel(e)),
      ]),
      Utils.el('div', { class: 'row-actions' }, [
        Utils.el('button', { class: 'btn btn--danger btn--row', type: 'button', onClick: async () => { await DataService.cravingEvents.delete(e.cravingEventId); await renderInner(container); } }, 'Delete'),
      ]),
    ]));

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'History')),
      rows.length ? Utils.el('div', { class: 'entry-list' }, rows) : Utils.el('p', { class: 'card__footnote' }, 'No data entered'),
    ]);
  }

  function outcomeLabel(e) {
    if (!e.outcome) return 'In progress';
    if (e.outcome === 'resolved_without_food') return 'Craving passed — no food needed';
    if (e.outcome === 'ate_suggested_food') return `Had ${CravingEngine.HUNGER_FOODS.find(f => f.key === e.suggestedFoodChosen)?.label || e.suggestedFoodChosen}`;
    if (e.outcome === 'ate_something_else') return 'Ate something else';
    if (e.outcome === 'abandoned') return 'Cancelled';
    return e.outcome;
  }

  return { render };
})();
