/**
 * pages/dashboard.js — landing page: profile snapshot, active program ring,
 * full calculated-target bundle, weight progress/trends, and micronutrient
 * references. Shows "No data entered" wherever a value is missing; never
 * fabricates numbers. All numbers come from Calculations — this page never
 * computes anything itself.
 */

const PageDashboard = (() => {

  let expandedScheduleItemId = null; // which Schedule row is showing its edit form; null = all collapsed (compact list)

  async function render(container) {
    container.innerHTML = '';
    const userId = DataService.getCurrentUserId();
    const profile = userId ? (await DataService.profiles.list(p => p.userId === userId))[0] : null;
    const program = userId ? (await DataService.programs.list(p => p.userId === userId && p.status === 'active'))[0] : null;
    const phases = (userId && program) ? await DataService.programPhases.list(ph => ph.programId === program.programId) : [];
    const currentPhase = phases.length ? Calculations.getCurrentPhase(phases) : null;
    const counters = program ? Calculations.getProgramDayCounters(program) : null;
    const weightEntries = userId ? await DataService.weightEntries.list(w => w.userId === userId) : [];
    const targets = profile ? Calculations.calculateAllTargets(profile, { weightEntries, program, phase: currentPhase }) : null;

    if (userId && targets) {
      // Safety net: catches any drift (e.g. a data import) not already logged by profile/program saves.
      await Calculations.recordTargetChangesIfNeeded(userId, targets, 'recalculation');
    }

    const today = Models.todayIso();
    const entries = userId ? await DataService.mealItems.list(e => e.userId === userId) : [];
    const waterEntries = userId ? await DataService.waterEntries.list(w => w.userId === userId) : [];
    const stepEntries = userId ? await DataService.stepEntries.list(s => s.userId === userId) : [];
    const workouts = userId ? await DataService.workouts.list(w => w.userId === userId) : [];
    const sleepEntries = userId ? await DataService.sleepEntries.list(s => s.userId === userId) : [];
    const recoveryEntries = userId ? await DataService.recoveryEntries.list(r => r.userId === userId) : [];
    const scheduleItems = userId ? await DataService.scheduleItems.list(s => s.userId === userId) : [];
    const dailyChecklist = userId ? (await DataService.dailyChecklists.list(c => c.userId === userId && c.date === today))[0] || null : null;
    const manualChecks = dailyChecklist?.checks || {};

    const trackingData = { entries, waterEntries, stepEntries, workouts, sleepEntries, weightEntries, targets, profile };
    const daySummary = DailyTrackingEngine.computeDaySummary(today, trackingData);
    const dailyScore = DailyTrackingEngine.computeDailyScore(today, trackingData, manualChecks);

    // Kept deliberately short: greeting/overview, the interactive story
    // slideshow, today's actionable pillars, quick logging, real program
    // status, today's schedule, and a link grid to every tracker — each of
    // these is the ONE place its information lives on this page. Deeper
    // detail (targets, checklists, nutrient breakdowns, weight charts,
    // activity history) lives on its own dedicated page rather than being
    // duplicated here too.
    container.appendChild(Utils.el('div', { class: 'grid grid--dashboard' }, [
      renderMobileHeadRow(profile, program, currentPhase, daySummary, dailyScore, targets, counters),
      renderTrackerLinksCard(),
      renderStorySlideshowCard({ profile, program, targets, counters, dailyScore, workouts, recoveryEntries, sleepEntries }, today, container),
      renderTodayMissionCard(program, currentPhase, targets, daySummary, dailyScore),
      renderQuickActionsCard(userId, today, container),
      await renderProgramJourneyCard(userId),
      renderScheduleCard(scheduleItems, userId, container),
      profile?.wellbeingDashboardVisible ? await renderWellbeingSummaryCard(userId, today) : null,
    ].filter(Boolean)));

    animateRingsIn(container);
  }

  // -----------------------------------------------------------------------
  // STREAK — consecutive days (ending today, walking backward) where the
  // Daily Score met a "solid day" bar. Capped to the program's elapsed days
  // (or 60 with no active program) so it can never look further back than
  // there is data for. Reuses DailyTrackingEngine — no separate score math.
  // -----------------------------------------------------------------------

  function computeCompletionStreak(trackingData, allDailyChecklists, today, maxDays) {
    const checksByDate = new Map(allDailyChecklists.map(c => [c.date, c.checks || {}]));
    let streak = 0;
    let cursor = today;
    const cap = Math.max(1, Math.min(maxDays || 60, 365));
    for (let i = 0; i < cap; i++) {
      const score = DailyTrackingEngine.computeDailyScore(cursor, trackingData, checksByDate.get(cursor) || {});
      if (score.overall != null && score.overall >= 50) {
        streak++;
        cursor = ProgramTemplates.addDays(cursor, -1);
      } else break;
    }
    return streak;
  }

  // -----------------------------------------------------------------------
  // RECENT ACTIVITY — most recent real entry per category. `null` where
  // nothing has ever been logged; never fabricated.
  // -----------------------------------------------------------------------

  function computeRecentActivity(trackingData) {
    const { entries, waterEntries, stepEntries, workouts, sleepEntries, weightEntries } = trackingData;
    const latestByDate = (list, dateKey = 'date') => {
      if (!list.length) return null;
      return [...list].sort((a, b) => (b[dateKey] || '').localeCompare(a[dateKey] || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
    };
    return {
      workout: latestByDate(workouts),
      meal: latestByDate(entries),
      water: latestByDate(waterEntries),
      weight: latestByDate(weightEntries),
      steps: latestByDate(stepEntries),
      sleep: latestByDate(sleepEntries),
    };
  }

  function daysAgoLabel(date, today = Models.todayIso()) {
    if (!date) return null;
    if (date === today) return 'Today';
    const a = new Date(date + 'T00:00:00');
    const b = new Date(today + 'T00:00:00');
    const diff = Math.round((b - a) / 86400000);
    if (diff === 1) return 'Yesterday';
    if (diff > 1) return `${diff} days ago`;
    return Utils.formatDate(date);
  }

  // -----------------------------------------------------------------------
  // HERO — a full-width welcome banner: greeting, active-program ring, and
  // headline stats. Every number reuses a value already computed above
  // (program day counters, dailyScore, targets) — nothing here is
  // calculated independently, so it can never drift from the cards below it.
  // -----------------------------------------------------------------------


  /** On mobile only, pairs a compact version of the page header (title,
   *  date, name, sign out) side-by-side with the hero card, in place of the
   *  full-width topbar sitting above everything — see the person's own
   *  mockup for the exact target layout. On desktop this wrapper is inert
   *  (display: contents unwraps it, .dash-mobile-head__info stays hidden)
   *  so the real topbar and a normal full-width hero card are unaffected;
   *  see the CSS for the media-query split. Duplicates a small amount of
   *  what router.js already puts in the real topbar (title, date, name,
   *  sign out) rather than trying to relocate that actual DOM node, which
   *  would need to be moved back before any other page's topbar re-render. */
  function renderMobileHeadRow(profile, program, currentPhase, daySummary, dailyScore, targets, counters) {
    const heroCard = renderHeroCard(profile, program, currentPhase, daySummary, dailyScore, targets, counters);
    if (!heroCard) return null;

    const todaySubtitle = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const signOutBtn = Utils.el('button', {
      class: 'dash-mobile-head__signout', type: 'button', title: 'Sign out',
      onClick: async () => {
        if (typeof AuthService === 'undefined' || !AuthService.isConfigured()) return;
        await SyncService.flush();
        await AuthService.signOut();
        window.location.reload();
      },
    }, 'Sign out');

    // The greeting headline ("Good evening, alpha.") and its subtitle live
    // in the hero card by default (see renderHeroCard) — on this paired
    // mobile layout they move into the info block instead, right under
    // the name/account line, so the hero card's whole width goes to the
    // stat tiles. Moved (not cloned) so there's exactly one live copy —
    // Utils.el nodes with click handlers elsewhere wouldn't survive a clone.
    const greetingEl = heroCard.querySelector('.hero__greeting');
    const heroSubtitleEl = heroCard.querySelector('.hero__subtitle');

    const info = Utils.el('div', { class: 'dash-mobile-head__info' }, [
      Utils.el('h1', { class: 'dash-mobile-head__title' }, 'Dashboard'),
      Utils.el('p', { class: 'dash-mobile-head__subtitle' }, todaySubtitle),
      Utils.el('p', { class: 'dash-mobile-head__name' }, profile?.name || 'No profile yet'),
      Utils.el('p', { class: 'dash-mobile-head__meta' }, profile ? 'Your account' : 'Set up your profile'),
      greetingEl,
      heroSubtitleEl,
      (typeof AuthService !== 'undefined' && AuthService.isConfigured()) ? signOutBtn : null,
    ].filter(Boolean));

    return Utils.el('div', { class: 'dash-mobile-head' }, [info, heroCard]);
  }

  function renderHeroCard(profile, program, currentPhase, daySummary, dailyScore, targets, counters) {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = profile?.name ? profile.name.split(' ')[0] : null;

    if (!profile) {
      return Utils.el('section', { class: 'card card--hero card--hero--transformation' }, [
        Utils.el('div', { class: 'hero__bg-motif' }, '\uD83D\uDC64'),
        Utils.el('div', { class: 'hero__empty' }, [
          Utils.el('div', { class: 'hero__eyebrow' }, [Utils.el('span', { class: 'sparkle' }, '\u2726'), 'Welcome', Utils.el('span', { class: 'sparkle' }, '\u2726')]),
          Utils.el('h2', { class: 'hero__greeting' }, `${timeGreeting}.`),
          Utils.el('p', {}, 'Set up your profile to unlock your personalized targets, program ring, and daily tracking.'),
          Utils.el('a', { class: 'btn', href: '#/profile' }, 'Set up your profile'),
        ]),
      ]);
    }

    const day = counters?.day ?? null;
    const total = counters?.totalDays ?? program?.durationDays ?? null;
    const pct = (program && total) ? Math.min(100, Math.round(((day ?? 0) / total) * 100)) : 0;
    const circumference = 2 * Math.PI * 58;
    const offset = circumference - (pct / 100) * circumference;

    const weightChange = targets ? formatSignedKg(targets.weightDifferenceKg) : null;
    const startingWeightKg = program?.startingWeightKg ?? null;
    const currentWeightKg = profile?.currentWeightKg ?? null;
    const targetWeightKg = currentPhase?.weightTargetKg ?? program?.targetWeightKg ?? profile?.targetWeightKg ?? null;

    // "Completion %" is the program's day-by-day progress (day / total days),
    // distinct from today's daily-tracking score shown further down the page.
    const stats = [
      [total ? `${total} DAYS` : 'PROGRAM', program ? `Day ${day ?? '\u2013'}` : 'No data entered', true],
      ['Phase', currentPhase ? currentPhase.name : (program ? '\u2014' : 'No data entered'), false],
      ['Completion %', program && total ? `${pct}%` : 'No data entered', false],
      ['Starting weight', Utils.fmt(startingWeightKg, ' kg') ?? 'No data entered', false],
      ['Current weight', Utils.fmt(currentWeightKg, ' kg') ?? 'No data entered', false],
      ['Target weight', Utils.fmt(targetWeightKg, ' kg') ?? 'No data entered', false],
      ['Weight change', weightChange ?? 'No data entered', false],
    ];

    const ringSvg = program ? Utils.el('div', { class: 'hero__ring-wrap' }, [
      (() => {
        const wrap = Utils.el('div');
        wrap.innerHTML = `
          <svg viewBox="0 0 132 132" class="hero__ring-svg">
            <defs>
              <linearGradient id="heroRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:var(--gold-soft)"></stop>
                <stop offset="100%" style="stop-color:var(--gold)"></stop>
              </linearGradient>
            </defs>
            <circle cx="66" cy="66" r="58" class="hero__ring-track"></circle>
            <circle cx="66" cy="66" r="58" class="hero__ring-progress"
              data-target-offset="${offset}" data-circumference="${circumference}"
              style="stroke-dasharray:${circumference};stroke-dashoffset:${circumference}"></circle>
          </svg>`;
        return wrap.firstElementChild;
      })(),
      Utils.el('div', { class: 'hero__ring-label' }, [
        Utils.el('span', { class: 'hero__ring-number' }, `${day ?? '\u2013'}`),
        Utils.el('span', { class: 'hero__ring-of' }, `of ${total ?? '\u2013'} days`),
      ]),
    ]) : null;

    const motif = Utils.el('div', { class: 'hero__bg-motif' }, '\uD83D\uDC64');

    return Utils.el('section', { class: 'card card--hero card--hero--transformation' }, [
      motif,
      Utils.el('div', { class: 'hero__inner' }, [
        Utils.el('div', { class: 'hero__intro' }, [
          Utils.el('div', { class: 'hero__eyebrow' }, [Utils.el('span', { class: 'sparkle' }, '\u2726'), program ? program.name : 'Your transformation', Utils.el('span', { class: 'sparkle' }, '\u2726')]),
          Utils.el('h2', { class: 'hero__greeting' }, [`${timeGreeting}, `, name ? Utils.el('span', { class: 'hero__name' }, name) : 'there', '.']),
          Utils.el('p', { class: 'hero__subtitle' }, program
            ? `Day ${day ?? '\u2013'} of ${total ?? '\u2013'} — here\u2019s where things stand today.`
            : 'Set up a program to see your day-by-day progress ring here.'),
          profile?.primaryGoal ? Utils.el('p', { class: 'hero__goal' }, [
            Utils.el('span', { class: 'hero__goal-label' }, 'Your goal'),
            Utils.el('span', { class: 'hero__goal-text' }, profile.primaryGoal),
          ]) : null,
          Utils.el('a', {
            class: 'btn btn--primary hero__cta', href: '#today-mission',
            onClick: (e) => {
              const target = document.getElementById('today-mission');
              if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            },
          }, 'CONTINUE TODAY'),
        ]),
        Utils.el('div', { class: 'hero__stats' }, stats.map(([label, val, gold]) =>
          Utils.el('div', { class: 'hero__stat' }, [
            Utils.el('div', { class: `hero__stat-value${gold ? ' hero__stat-value--gold' : ''}` }, val),
            Utils.el('div', { class: 'hero__stat-label' }, label),
          ])
        )),
        ringSvg,
      ].filter(Boolean)),
    ]);
  }

  /** Triggers the "draw in" animation on every progress ring in the just-
   *  rendered dashboard (hero ring + the Program Dashboard day-ring) by
   *  flipping stroke-dashoffset a frame after mount, so the CSS transition
   *  actually has something to animate between. */
  function animateRingsIn(container) {
    const rings = container.querySelectorAll('.hero__ring-progress[data-target-offset], .day-ring__progress[data-target-offset]');
    if (!rings.length) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rings.forEach(ring => { ring.style.strokeDashoffset = ring.dataset.targetOffset; });
      });
    });
  }
  /**
   * Sexual Wellbeing is private by default (see Models.createProfile /
   * pages/wellbeing.js). This card is the ONLY place that data ever
   * touches the Dashboard, and only when the person has explicitly turned
   * on "Show summary on Dashboard" in the Sexual Wellbeing page itself —
   * checked by the caller above before this function is ever invoked.
   */
  async function renderWellbeingSummaryCard(userId, today) {
    const entries = await DataService.sexualWellbeingEntries.list(e => e.userId === userId);
    const fields = [
      ['libidoLevel', 'Libido'], ['energyLevel', 'Energy'], ['stressLevel', 'Stress'],
      ['sleepQuality', 'Sleep Quality'], ['recoveryLevel', 'Recovery'],
    ];
    const endDate = new Date(today + 'T00:00:00');
    const rows = fields.map(([key, label]) => {
      const trend = RecoveryEngine.computeWeeklyTrend(entries, key, endDate);
      return [label, trend.thisWeekAvg != null ? `${trend.thisWeekAvg} / 5` : null];
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Wellbeing (Private)'),
        Utils.el('a', { class: 'link', href: '#/wellbeing' }, 'Manage'),
      ]),
      Utils.el('p', { class: 'card__footnote' }, 'This week\u2019s averages only — you turned this summary on in Sexual Wellbeing settings.'),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v ?? 'No data entered')])),
    ]);
  }

  async function getLastTargetChange(userId) {
    const history = await DataService.targetHistory.list(h => h.userId === userId);
    if (!history.length) return null;
    // Compare full createdAt timestamps, not the day-granularity effectiveDate:
    // multiple target changes on the same calendar day would otherwise tie on
    // effectiveDate and silently resolve to the wrong ("first same-day") record.
    return history.reduce((a, b) => ((a.createdAt || a.effectiveDate) >= (b.createdAt || b.effectiveDate) ? a : b));
  }

  /**
   * TODAY'S MISSION — five interactive cards (Workout, Nutrition, Water,
   * Steps, Sleep). Each shows today's real status and, on click, opens the
   * actual existing experience for that pillar — never a fake/dead link.
   */
  function renderTodayMissionCard(program, currentPhase, targets, daySummary, dailyScore) {
    const missions = [
      {
        key: 'workout', icon: '🏋', label: 'Workout', href: '#/workout',
        done: daySummary.workout.done,
        detail: daySummary.workout.done
          ? `Done${daySummary.workout.minutes ? ` — ${daySummary.workout.minutes} min` : ''}`
          : 'Not started',
        cta: daySummary.workout.done ? 'View workout' : 'Start workout',
      },
      {
        key: 'nutrition', icon: '🍽', label: 'Nutrition', href: '#/diet',
        done: daySummary.calories.consumed != null,
        detail: daySummary.calories.consumed == null
          ? 'No meals logged'
          : `${daySummary.calories.consumed} / ${daySummary.calories.target ?? '—'} kcal`,
        cta: daySummary.calories.consumed == null ? 'Log food' : 'Log more food',
      },
      {
        key: 'water', icon: '💧', label: 'Water', href: '#/water',
        done: daySummary.water.targetMl != null && (daySummary.water.consumedMl || 0) >= daySummary.water.targetMl,
        detail: daySummary.water.consumedMl == null
          ? 'No water logged'
          : `${daySummary.water.consumedMl} / ${daySummary.water.targetMl ?? '—'} ml`,
        cta: 'Open water tracker',
      },
      {
        key: 'steps', icon: '👣', label: 'Steps', href: '#/steps',
        done: daySummary.steps.target != null && (daySummary.steps.consumed || 0) >= daySummary.steps.target,
        detail: daySummary.steps.consumed == null
          ? 'No steps logged'
          : `${daySummary.steps.consumed} / ${daySummary.steps.target ?? '—'}`,
        cta: 'Open steps tracker',
      },
      {
        key: 'sleep', icon: '🌙', label: 'Sleep', href: '#/sleep',
        done: daySummary.sleep.met === true,
        detail: daySummary.sleep.hoursSlept == null
          ? 'No sleep logged'
          : `${daySummary.sleep.hoursSlept} h${daySummary.sleep.targetHours ? ` / ${daySummary.sleep.targetHours} h` : ''}`,
        cta: 'Open sleep tracker',
      },
    ];

    const cards = missions.map(m => Utils.el('a', {
      class: `mission-card${m.done ? ' mission-card--done' : ''}`, href: m.href,
    }, [
      Utils.el('div', { class: 'mission-card__top' }, [
        Utils.el('span', { class: 'mission-card__icon' }, m.icon),
        Utils.el('span', { class: `badge${m.done ? '' : ' badge--draft'}` }, m.done ? 'Done' : 'To do'),
      ]),
      Utils.el('div', { class: 'mission-card__label' }, m.label),
      Utils.el('div', { class: 'mission-card__detail' }, m.detail),
      Utils.el('div', { class: 'mission-card__cta' }, `${m.cta} →`),
    ]));

    return Utils.el('section', { class: 'card', id: 'today-mission' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, "Today's Mission"),
          Utils.el('p', { class: 'card__subtitle' }, program
            ? `${currentPhase ? currentPhase.name + ' · ' : ''}Daily completion: ${dailyScore.overall != null ? `${dailyScore.overall}%` : 'No data entered'}`
            : 'Set up a program to personalize today\u2019s targets.'),
        ]),
      ]),
      Utils.el('div', { class: 'mission-grid' }, cards),
    ]);
  }

  /**
   * QUICK ACTIONS — the single set of fast-logging controls on the
   * dashboard. Start Workout / Log Food route to the real feature pages;
   * Add Water / Log Weight / Log Steps / Log Sleep write straight through
   * DataService, the same as their dedicated tracker pages, so there is
   * exactly one place on the dashboard to quick-log each of these
   * (no duplicate tracker widgets).
   */
  function renderQuickActionsCard(userId, today, container) {
    const navActions = [
      ['🏋', 'Start Workout', '#/workout'],
      ['🍽', 'Log Food', '#/diet'],
      ['📈', 'View Progress', '#/progress'],
    ].map(([icon, label, href]) => Utils.el('a', { class: 'quick-action', href }, [
      Utils.el('span', { class: 'quick-action__icon' }, icon),
      Utils.el('span', {}, label),
    ]));

    const waterInput = Utils.el('input', { class: 'form__input', type: 'number', min: 0, placeholder: 'ml', style: 'width:80px;' });
    const waterBtn = Utils.el('button', { class: 'quick-action', type: 'button' }, [Utils.el('span', { class: 'quick-action__icon' }, '💧'), Utils.el('span', {}, 'Add Water')]);
    waterBtn.addEventListener('click', async () => {
      const amountMl = Number(waterInput.value);
      if (!amountMl || amountMl <= 0) { Utils.toast('Enter an amount in ml.', 'error'); return; }
      if (!userId) { Utils.toast('Set up your profile first.', 'error'); return; }
      await DataService.waterEntries.create(Models.createWaterEntry(userId, today, { amountMl }));
      Utils.toast('Water logged.', 'success');
      container.innerHTML = ''; await render(container);
    });

    const weightInput = Utils.el('input', { class: 'form__input', type: 'number', step: '0.01', min: 0, placeholder: 'kg', style: 'width:80px;' });
    const weightBtn = Utils.el('button', { class: 'quick-action', type: 'button' }, [Utils.el('span', { class: 'quick-action__icon' }, '⚖'), Utils.el('span', {}, 'Log Weight')]);
    weightBtn.addEventListener('click', async () => {
      const weightKg = Number(weightInput.value);
      const err = Utils.Validate.range(weightInput.value, 30, 300, 'Weight');
      if (!weightInput.value || err) { Utils.toast(err || 'Enter a weight in kg.', 'error'); return; }
      if (!userId) { Utils.toast('Set up your profile first.', 'error'); return; }
      const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
      const existing = (await DataService.weightEntries.list(w => w.userId === userId && w.date === today))[0];
      if (existing) await DataService.weightEntries.update(existing.weightEntryId, { weightKg });
      else await DataService.weightEntries.create(Models.createWeightEntry(userId, today, { weightKg }));
      if (profile) await DataService.profiles.update(profile.profileId, { currentWeightKg: weightKg });
      Utils.toast('Weight logged.', 'success');
      container.innerHTML = ''; await render(container);
    });

    const stepsInput = Utils.el('input', { class: 'form__input', type: 'number', min: 0, placeholder: 'steps', style: 'width:90px;' });
    const stepsBtn = Utils.el('button', { class: 'quick-action', type: 'button' }, [Utils.el('span', { class: 'quick-action__icon' }, '👣'), Utils.el('span', {}, 'Log Steps')]);
    stepsBtn.addEventListener('click', async () => {
      const steps = Number(stepsInput.value);
      if (!steps || steps < 0) { Utils.toast('Enter a step count.', 'error'); return; }
      if (!userId) { Utils.toast('Set up your profile first.', 'error'); return; }
      const existing = (await DataService.stepEntries.list(s => s.userId === userId && s.date === today))[0];
      if (existing) await DataService.stepEntries.update(existing.stepEntryId, { steps });
      else await DataService.stepEntries.create(Models.createStepEntry(userId, today, { steps }));
      Utils.toast('Steps logged.', 'success');
      container.innerHTML = ''; await render(container);
    });

    const sleepInput = Utils.el('input', { class: 'form__input', type: 'number', min: 0, max: 16, step: '0.1', placeholder: 'hours', style: 'width:80px;' });
    const sleepBtn = Utils.el('button', { class: 'quick-action', type: 'button' }, [Utils.el('span', { class: 'quick-action__icon' }, '🌙'), Utils.el('span', {}, 'Log Sleep')]);
    sleepBtn.addEventListener('click', async () => {
      const hoursSlept = Number(sleepInput.value);
      if (!hoursSlept || hoursSlept < 0) { Utils.toast('Enter hours slept.', 'error'); return; }
      if (!userId) { Utils.toast('Set up your profile first.', 'error'); return; }
      const existing = (await DataService.sleepEntries.list(s => s.userId === userId && s.date === today))[0];
      if (existing) await DataService.sleepEntries.update(existing.sleepEntryId, { hoursSlept });
      else await DataService.sleepEntries.create(Models.createSleepEntry(userId, today, { hoursSlept }));
      Utils.toast('Sleep logged.', 'success');
      container.innerHTML = ''; await render(container);
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Quick Actions')),
      Utils.el('div', { class: 'quick-actions-grid' }, [
        navActions[0], navActions[1], navActions[2],
        Utils.el('div', { class: 'quick-action-input' }, [waterBtn, waterInput]),
        Utils.el('div', { class: 'quick-action-input' }, [weightBtn, weightInput]),
        Utils.el('div', { class: 'quick-action-input' }, [stepsBtn, stepsInput]),
        Utils.el('div', { class: 'quick-action-input' }, [sleepBtn, sleepInput]),
      ]),
    ]);
  }

  /**
   * PROGRESS SNAPSHOT — six clickable summary chips (Weight, Program,
   * Streak, Workout, Nutrition, Water), each linking to the page that owns
   * that data. Numbers are pulled from values already computed above.
   */
  function renderProgressSnapshotCard(profile, program, targets, streak, dailyScore) {
    const chips = [
      { label: 'Weight', value: targets ? formatSignedKg(targets.weightDifferenceKg) : null, href: '#/progress' },
      { label: 'Program', value: program ? program.name : null, href: '#/programs' },
      { label: 'Streak', value: streak > 0 ? `${streak} day${streak === 1 ? '' : 's'}` : null, href: '#/reports' },
      { label: 'Workout', value: dailyScore.checklist.find(c => c.key === 'workout')?.detail ?? null, href: '#/workout' },
      { label: 'Nutrition', value: dailyScore.qualityScore != null ? `${dailyScore.qualityScore}% quality` : null, href: '#/diet' },
      { label: 'Water', value: dailyScore.checklist.find(c => c.key === 'water')?.detail ?? null, href: '#/water' },
    ];

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Progress Snapshot')),
      Utils.el('div', { class: 'snapshot-grid' }, chips.map(c => Utils.el('a', { class: 'snapshot-chip', href: c.href }, [
        Utils.el('div', { class: 'snapshot-chip__label' }, c.label),
        Utils.el('div', { class: 'snapshot-chip__value' }, c.value ?? 'No data entered'),
      ]))),
    ]);
  }

  /**
   * RECENT ACTIVITY — the latest real entry per category. Never invented:
   * a category with nothing logged shows "No data entered".
   */
  /**
   * Connects morning/afternoon/evening/night activity across water, steps,
   * workouts, sleep, and recovery — all pulled straight from
   * DailyTrackingEngine.buildDailyTimeline, which reads the exact same
   * records each tracker's own page does. Read-only: editing still happens
   * on each tracker's own page (one source of truth per metric).
   */
  function renderDailyTimelineCard(today, timelineData) {
    const events = DailyTrackingEngine.buildDailyTimeline(today, timelineData);
    const groups = DailyTrackingEngine.groupTimelineBySegment(events);

    const body = groups.length
      ? Utils.el('div', {}, groups.map(g => renderTimelineSegment(g)))
      : Utils.el('p', { class: 'card__footnote' }, 'No data entered');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Daily Timeline'),
        Utils.el('p', { class: 'card__subtitle' }, "Today's activity across every tracker, in order."),
      ]),
      body,
    ]);
  }

  function renderTimelineSegment(g) {
    const items = g.events.map(e => renderTimelineEvent(e));
    return Utils.el('div', { class: 'timeline-segment' }, [
      Utils.el('h4', { class: 'timeline-segment__title' }, g.label),
      Utils.el('ul', { class: 'timeline-segment__list' }, items),
    ]);
  }

  function renderTimelineEvent(e) {
    const parts = [
      Utils.el('span', { class: 'timeline-segment__icon' }, e.icon),
      Utils.el('span', {}, e.label),
    ];
    if (e.minuteOfDay != null) parts.push(Utils.el('span', { class: 'timeline-segment__time' }, formatMinuteOfDay(e.minuteOfDay)));
    return Utils.el('li', {}, parts);
  }

  function formatMinuteOfDay(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const period = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')}${period}`;
  }

  function renderRecentActivityCard(recentActivity) {
    const today = Models.todayIso();
    const rows = [
      ['Workout', recentActivity.workout, w => `${w.name || 'Workout'} — ${daysAgoLabel(w.date, today)}`],
      ['Meal', recentActivity.meal, m => `${m.mealType ? m.mealType.replace(/_/g, ' ') : 'Meal'} — ${daysAgoLabel(m.date, today)}`],
      ['Water', recentActivity.water, w => `${w.amountMl} ml — ${daysAgoLabel(w.date, today)}`],
      ['Weight', recentActivity.weight, w => `${w.weightKg} kg — ${daysAgoLabel(w.date, today)}`],
      ['Steps', recentActivity.steps, s => `${s.steps} steps — ${daysAgoLabel(s.date, today)}`],
      ['Sleep', recentActivity.sleep, s => `${s.hoursSlept} h — ${daysAgoLabel(s.date, today)}`],
    ];

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Recent Activity')),
      Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([label, record, fmt]) => [
        Utils.el('dt', {}, label),
        Utils.el('dd', {}, record ? fmt(record) : 'No data entered'),
      ])),
    ]);
  }

  /**
   * "Program Dashboard": name, Day X of Y, days remaining, current phase,
   * goal, starting/current/target weight, and progress %. Every value comes
   * from Calculations — this page never computes any of it itself.
   */
  /**
   * PROGRAM JOURNEY — both program types this app supports (60-Day and
   * 100-Day), each with its OWN real status, regardless of which one is
   * currently active. A program the person hasn't started yet is shown
   * honestly as "Not Started", never with fabricated progress.
   */
  async function renderProgramJourneyCard(userId) {
    const programs = userId ? await DataService.programs.list(p => p.userId === userId) : [];
    const sixtyDay = programs.find(p => p.programType === '60_day') || null;
    const hundredDay = programs.find(p => p.programType === BollywoodProgramData.PROGRAM_TYPE) || null;

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Program Journey'),
        Utils.el('p', { class: 'card__subtitle' }, 'Your actual status in each program — nothing here is assumed.' ),
      ]),
      renderJourneyRow(sixtyDay, '60-Day Transformation', '#/programs'),
      renderJourneyRow(hundredDay, '100-Day Journey', '#/program-bollywood'),
    ]);
  }

  const JOURNEY_STATUS_LABELS = { active: 'In Progress', paused: 'Paused', completed: 'Completed', draft: 'Not Started', future: 'Scheduled' };

  function renderJourneyRow(program, label, href) {
    if (!program) {
      return Utils.el('div', { class: 'journey-row' }, [
        Utils.el('div', { class: 'journey-row__main' }, [
          Utils.el('div', { class: 'journey-row__name' }, label),
          Utils.el('div', { class: 'journey-row__meta' }, 'Not started'),
        ]),
        Utils.el('a', { class: 'btn btn--secondary btn--row', href: '#/programs' }, 'Start'),
      ]);
    }
    const counters = Calculations.getProgramDayCounters(program);
    const statusLabel = JOURNEY_STATUS_LABELS[program.status] || program.status;
    return Utils.el('div', { class: 'journey-row' }, [
      Utils.el('div', { class: 'journey-row__main' }, [
        Utils.el('div', { class: 'journey-row__name' }, [
          program.name || label,
          Utils.el('span', { class: `badge journey-row__badge journey-row__badge--${program.status}` }, statusLabel),
        ]),
        Utils.el('div', { class: 'journey-row__meta' }, counters ? `Day ${counters.day} of ${counters.totalDays}` : 'No data entered'),
      ]),
      Utils.el('a', { class: 'btn btn--secondary btn--row', href }, 'View'),
    ]);
  }

  /**
   * STORY SLIDESHOW — Transformation / Training / Nutrition / Progress /
   * Recovery, each with a real statistic pulled from data already computed
   * above (never a second calculation of the same number). Built with
   * direct DOM event listeners rather than a full page re-render per
   * interaction, so swipe/autoplay stay smooth.
   */
  // Two layouts for the story slideshow, switchable from a small link on
  // the card itself and remembered per-profile via dashboardSlideshowLayout:
  //   'classic' (default) — the original 5 slides, one per pillar.
  //   'compact' — 4 slides; Transformation and Progress are merged into one
  //     slide since both ultimately point at the /progress page and were
  //     showing overlapping stats (weight change vs. % complete).
  // Nothing on the /progress page itself changes either way — this only
  // affects how many dashboard preview slides lead there.
  function renderStorySlideshowCard(ctx, today, container) {
    const { profile, program, targets, counters, dailyScore, workouts, recoveryEntries, sleepEntries } = ctx;
    if (!profile) return null;

    const pct = (program && counters?.totalDays) ? Math.min(100, Math.round((counters.day / counters.totalDays) * 100)) : null;
    const workoutStreak = WorkoutEngine.computeWorkoutStreak(workouts, today);
    const recoveryTrend = RecoveryEngine.computeWeeklyTrend(recoveryEntries, 'recoveryScore', new Date(today + 'T00:00:00'));
    const lastSleep = sleepEntries.find(s => s.date === today) || null;

    const transformationSlide = {
      theme: 'transformation', eyebrow: 'Transformation', icon: '\uD83D\uDCF7', headline: 'See how far you\u2019ve come',
      description: 'Compare your first photo against today, checkpoint by checkpoint.',
      statLabel: 'Weight change', statValue: targets?.weightDifferenceKg != null ? formatSignedKg(targets.weightDifferenceKg) : 'No data entered',
      primaryLabel: 'View Transformation', primaryHref: '#/progress', secondaryLabel: 'Add Photo', secondaryHref: '#/progress',
    };
    const trainingSlide = {
      theme: 'training', eyebrow: 'Training', icon: '\uD83C\uDFCB\uFE0F', headline: 'Keep the streak alive',
      description: 'Every session compounds — see today\u2019s plan and your recent consistency.',
      statLabel: 'Workout streak', statValue: workoutStreak > 0 ? `${workoutStreak} day${workoutStreak === 1 ? '' : 's'}` : 'No data entered',
      primaryLabel: 'Go to Workout', primaryHref: '#/workout', secondaryLabel: 'View History', secondaryHref: '#/workout',
    };
    const nutritionSlide = {
      theme: 'nutrition', eyebrow: 'Nutrition', icon: '\uD83C\uDF7D', headline: 'Fuel matches the goal',
      description: 'Log today\u2019s meals to stay on target with your calculated macros.',
      statLabel: 'Nutrition quality today', statValue: dailyScore.qualityScore != null ? `${dailyScore.qualityScore}%` : 'No data entered',
      primaryLabel: 'Log Nutrition', primaryHref: '#/nutrition', secondaryLabel: 'View Diet', secondaryHref: '#/diet',
    };
    const progressSlide = {
      theme: 'progress', eyebrow: 'Progress', icon: '\uD83D\uDCC8', headline: 'Track the whole picture',
      description: 'Weight, strength, measurements, and adherence — all in one place.',
      statLabel: 'Program complete', statValue: pct != null ? `${pct}%` : 'No data entered',
      primaryLabel: 'View Analytics', primaryHref: '#/progress', secondaryLabel: null, secondaryHref: null,
    };
    const recoverySlide = {
      theme: 'recovery', eyebrow: 'Recovery', icon: '\u267B\uFE0F', headline: 'Recovery drives results',
      description: 'Sleep, training load, and how you\u2019re really feeling — together.',
      statLabel: 'Sleep last night', statValue: lastSleep?.hoursSlept != null ? `${lastSleep.hoursSlept} h` : (recoveryTrend.thisWeekAvg != null ? `Recovery avg ${recoveryTrend.thisWeekAvg}/5` : 'No data entered'),
      primaryLabel: 'Go to Recovery', primaryHref: '#/recovery', secondaryLabel: null, secondaryHref: null,
    };
    const transformationAndProgressSlide = {
      theme: 'transformation', eyebrow: 'Transformation & Progress', icon: '\uD83D\uDCC8', headline: 'See how far you\u2019ve come',
      description: 'Photos, weight, strength, measurements, and adherence — the whole picture in one place.',
      statLabel: 'Weight change', statValue: targets?.weightDifferenceKg != null ? formatSignedKg(targets.weightDifferenceKg) : (pct != null ? `${pct}% complete` : 'No data entered'),
      primaryLabel: 'View Progress', primaryHref: '#/progress', secondaryLabel: 'Add Photo', secondaryHref: '#/progress',
    };

    const layout = profile.dashboardSlideshowLayout === 'compact' ? 'compact' : 'classic';
    const slides = layout === 'compact'
      ? [transformationAndProgressSlide, trainingSlide, nutritionSlide, recoverySlide]
      : [transformationSlide, trainingSlide, nutritionSlide, progressSlide, recoverySlide];

    const toggleLink = Utils.el('button', {
      class: 'slideshow__layout-toggle', type: 'button',
    }, layout === 'compact' ? 'Back to classic (5 slides)' : 'Try compact layout (4 slides)');
    toggleLink.addEventListener('click', async () => {
      await DataService.profiles.update(profile.profileId, {
        dashboardSlideshowLayout: layout === 'compact' ? 'classic' : 'compact',
      });
      await render(container);
    });

    const card = buildSlideshow(slides);
    card.insertBefore(
      Utils.el('div', { class: 'slideshow__layout-row' }, [toggleLink]),
      card.firstChild
    );
    return card;
  }

  function buildSlideshow(slides) {
    const AUTOPLAY_MS = 6000;
    let index = 0;
    let timer = null;

    const stage = Utils.el('div', { class: 'slideshow__stage' });
    const dotsRow = Utils.el('div', { class: 'slideshow__dots' });
    const dots = slides.map((_, i) => {
      const dot = Utils.el('button', { class: `slideshow__dot${i === 0 ? ' slideshow__dot--active' : ''}`, type: 'button', 'aria-label': `Go to slide ${i + 1}` });
      dot.addEventListener('click', () => { stopAutoplay(); goTo(i); startAutoplay(); });
      dotsRow.appendChild(dot);
      return dot;
    });

    function renderSlide(i) {
      const s = slides[i];
      const bgMotif = Utils.el('div', { class: 'slideshow__bg-motif' }, s.icon);
      const bg = Utils.el('div', { class: 'slideshow__bg' }, [bgMotif]);
      const overlay = Utils.el('div', { class: 'slideshow__overlay' });
      const panel = Utils.el('div', { class: 'slideshow__panel' }, [
        Utils.el('div', { class: 'slideshow__visual' }, s.icon),
        Utils.el('div', { class: 'slideshow__eyebrow' }, s.eyebrow),
        Utils.el('h3', { class: 'slideshow__headline' }, s.headline),
        Utils.el('p', { class: 'slideshow__description' }, s.description),
        Utils.el('div', { class: 'slideshow__stat' }, [
          Utils.el('span', { class: 'slideshow__stat-value' }, s.statValue),
          Utils.el('span', { class: 'slideshow__stat-label' }, s.statLabel),
        ]),
        Utils.el('div', { class: 'row-actions', style: 'margin-top:14px;' }, [
          Utils.el('a', { class: 'btn btn--primary', href: s.primaryHref }, s.primaryLabel),
          s.secondaryLabel ? Utils.el('a', { class: 'btn btn--secondary', href: s.secondaryHref }, s.secondaryLabel) : null,
        ].filter(Boolean)),
      ]);
      const glass = Utils.el('div', { class: 'slideshow__glass' }, [panel]);
      const slideEl = Utils.el('div', { class: `slideshow__slide slideshow__slide--${s.theme}` }, [bg, overlay, glass]);
      stage.innerHTML = '';
      stage.appendChild(slideEl);
      dots.forEach((d, di) => d.classList.toggle('slideshow__dot--active', di === i));
    }

    function goTo(i) { index = ((i % slides.length) + slides.length) % slides.length; renderSlide(index); }
    function next() { goTo(index + 1); }
    function prev() { goTo(index - 1); }
    function startAutoplay() {
      stopAutoplay();
      timer = setInterval(() => {
        // Self-cleaning: once this slideshow's card is no longer in the
        // document (the person navigated away), stop ticking instead of
        // leaking an interval that runs forever in the background.
        if (!document.body.contains(wrap)) { stopAutoplay(); return; }
        next();
      }, AUTOPLAY_MS);
    }
    function stopAutoplay() { if (timer) clearInterval(timer); timer = null; }

    const prevBtn = Utils.el('button', { class: 'slideshow__nav slideshow__nav--prev', type: 'button', 'aria-label': 'Previous slide' }, '\u2039');
    const nextBtn = Utils.el('button', { class: 'slideshow__nav slideshow__nav--next', type: 'button', 'aria-label': 'Next slide' }, '\u203a');
    prevBtn.addEventListener('click', () => { stopAutoplay(); prev(); startAutoplay(); });
    nextBtn.addEventListener('click', () => { stopAutoplay(); next(); startAutoplay(); });

    let touchStartX = null;
    stage.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; stopAutoplay(); }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (touchStartX == null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); }
      touchStartX = null;
      startAutoplay();
    }, { passive: true });

    const wrap = Utils.el('section', { class: 'card slideshow' }, [
      Utils.el('div', { class: 'slideshow__viewport' }, [prevBtn, stage, nextBtn]),
      dotsRow,
    ]);
    wrap.addEventListener('mouseenter', stopAutoplay);
    wrap.addEventListener('mouseleave', startAutoplay);
    wrap.addEventListener('focusin', stopAutoplay);
    wrap.addEventListener('focusout', startAutoplay);

    renderSlide(0);
    startAutoplay();

    return wrap;
  }

  function renderProgramDashboardCard(program, currentPhase, profile) {
    if (!program) {
      return Utils.el('section', { class: 'card card--ring' }, [
        Utils.el('h2', { class: 'card__title' }, 'Program Dashboard'),
        Utils.el('p', { class: 'card__empty' }, 'No data entered'),
        Utils.el('a', { class: 'btn btn--secondary', href: '#/programs' }, 'Set up a program'),
      ]);
    }

    const counters = Calculations.getProgramDayCounters(program);
    const day = counters?.day ?? null;
    const total = counters?.totalDays ?? program.durationDays ?? 60;
    const daysRemaining = counters?.daysRemaining ?? null;
    const pct = total ? Math.min(100, Math.round(((day ?? 0) / total) * 100)) : 0;
    const circumference = 2 * Math.PI * 52;
    const offset = circumference - (pct / 100) * circumference;

    const startingWeightKg = program.startingWeightKg ?? null;
    const currentWeightKg = profile?.currentWeightKg ?? null;
    const targetWeightKg = currentPhase?.weightTargetKg ?? program.targetWeightKg ?? null;
    const targetLabel = (program.targetWeightMinKg != null && program.targetWeightMaxKg != null)
      ? `${program.targetWeightMinKg}–${program.targetWeightMaxKg} kg`
      : Utils.fmt(targetWeightKg, ' kg');
    const progressPct = Calculations.calculateProgressPercent({ startingWeightKg, currentWeightKg, targetWeightKg });

    const rows = [
      ['Days remaining', daysRemaining != null ? `${daysRemaining} days` : null],
      ['Current phase', currentPhase ? currentPhase.name : (program.programType === '1_year' ? 'No data entered' : '—')],
      ['Goal', Utils.fmt(currentPhase?.goalType ? currentPhase.goalType.replace(/_/g, ' ') : (program.goal || null))],
      ['Starting weight', Utils.fmt(startingWeightKg, ' kg')],
      ['Current weight', Utils.fmt(currentWeightKg, ' kg')],
      ['Target weight', targetLabel],
      ['Progress', progressPct != null ? `${progressPct}%` : null],
    ];

    return Utils.el('section', { class: 'card card--ring' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Program Dashboard'),
        Utils.el('a', { class: 'link', href: '#/programs' }, 'Manage'),
      ]),
      Utils.el('div', { class: 'day-ring' }, [
        (() => {
          const wrapper = Utils.el('div', { class: 'day-ring__svg-wrap' });
          wrapper.innerHTML = `
            <svg viewBox="0 0 120 120" class="day-ring__svg">
              <circle cx="60" cy="60" r="52" class="day-ring__track"></circle>
              <circle cx="60" cy="60" r="52" class="day-ring__progress"
                data-target-offset="${offset}"
                style="stroke-dasharray:${circumference};stroke-dashoffset:${circumference}"></circle>
            </svg>`;
          const label = Utils.el('div', { class: 'day-ring__label' }, [
            Utils.el('span', { class: 'day-ring__number' }, `${day ?? '–'}`),
            Utils.el('span', { class: 'day-ring__of' }, `/ ${total}`),
          ]);
          wrapper.appendChild(label);
          return wrapper;
        })(),
        Utils.el('div', { class: 'day-ring__meta' }, [
          Utils.el('div', { class: 'day-ring__name' }, program.name),
          Utils.el('div', { class: 'day-ring__dates' }, `${Utils.formatDate(program.startDate)} → ${Utils.formatDate(program.endDate)}`),
          Utils.el('div', { class: `badge badge--${program.status}` }, program.status),
        ]),
      ]),
      Utils.el('dl', { class: 'stat-list', style: 'margin-top:16px;' }, rows.flatMap(([label, val]) => ([
        Utils.el('dt', {}, label),
        Utils.el('dd', {}, val ?? 'No data entered'),
      ]))),
    ]);
  }

  function renderProfileSnapshotCard(profile) {
    const rows = !profile ? [] : [
      ['Current weight', Utils.fmt(profile.currentWeightKg, ' kg')],
      ['Target weight', Utils.fmt(profile.targetWeightKg, ' kg')],
      ['Height', Utils.fmt(profile.heightCm, ' cm')],
      ['Goal type', Utils.fmt(profile.goalType ? profile.goalType.replace(/_/g, ' ') : '')],
      ['Training frequency', Utils.fmt(profile.trainingFrequencyPerWeek, ' days/wk')],
      ['Diet', Utils.fmt(profile.dietaryPreference)],
    ];
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Profile Snapshot'),
        Utils.el('a', { class: 'link', href: '#/profile' }, 'Edit'),
      ]),
      profile
        ? Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([label, val]) => ([
            Utils.el('dt', {}, label),
            Utils.el('dd', {}, val),
          ])))
        : Utils.el('div', { class: 'card__empty-state' }, [
            Utils.el('p', {}, 'No data entered'),
            Utils.el('a', { class: 'btn btn--secondary', href: '#/profile' }, 'Complete your profile'),
          ]),
    ]);
  }

  function renderTargetsCard(targets, lastTargetChange, currentPhase) {
    const proteinLabel = targets?.proteinRange
      ? `${Utils.fmt(targets.proteinRange.minG)}–${Utils.fmt(targets.proteinRange.upperG)} g (rec. ${Utils.fmt(targets.proteinRange.recommendedG)} g)`
      : null;

    const rows = [
      ['BMI', targets ? Utils.fmt(targets.bmi) : null],
      ['BMR', targets ? Utils.fmt(targets.bmr, ' kcal') : null],
      ['TDEE', targets ? `${Utils.fmt(targets.tdee, ' kcal')}${targets.tdee != null ? ` (${targets.activitySource})` : ''}` : null],
      ['Calorie target', targets ? Utils.fmt(targets.calorieTarget, ' kcal') : null],
      ['Protein target', proteinLabel],
      ['Fat target', targets ? Utils.fmt(targets.fatTargetG, ' g') : null],
      ['Carb target', targets ? Utils.fmt(targets.carbTargetG, ' g') : null],
      ['Fibre target', targets ? Utils.fmt(targets.fibreTargetG, ' g') : null],
      ['Water target', targets ? Utils.fmt(targets.waterTargetMl, ' mL') : null],
      ['Step target', targets ? Utils.fmt(targets.stepTarget) : null],
    ];

    const footer = lastTargetChange
      ? Utils.el('p', { class: 'card__footnote' },
          `Last recalculated ${Utils.formatDate(lastTargetChange.effectiveDate)} — ${lastTargetChange.reason.replace(/_/g, ' ')}`)
      : null;

    const phaseNote = currentPhase
      ? Utils.el('p', { class: 'card__subtitle' }, `Adjusted for current phase: ${currentPhase.name}.`)
      : null;

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Calculated Targets'),
        Utils.el('p', { class: 'card__subtitle' }, 'BMI is descriptive only — it is never used, by itself, to set calorie intake.'),
      ]),
      phaseNote,
      Utils.el('dl', { class: 'stat-list stat-list--mono' }, rows.flatMap(([label, val]) => ([
        Utils.el('dt', {}, label),
        Utils.el('dd', {}, val ?? 'No data entered'),
      ]))),
      footer,
    ].filter(Boolean));
  }

  function renderWeightProgressCard(profile, targets, userId, container) {
    const rows = targets ? [
      ['Change since start', formatSignedKg(targets.weightDifferenceKg)],
      ['Remaining to target', formatSignedKg(targets.targetWeightDifferenceKg)],
      ['% change since start', targets.percentWeightChangeSinceStart != null ? `${targets.percentWeightChangeSinceStart}%` : null],
      ['7-day average weight', Utils.fmt(targets.sevenDayAverageWeightKg, ' kg')],
      ['Weekly trend', formatSignedKg(targets.weeklyWeightTrendKg)],
      ['4-week trend', formatSignedKg(targets.fourWeekWeightTrendKg)],
    ] : [];

    const weightInput = Utils.el('input', {
      class: 'form__input', type: 'number', step: '0.01', min: '30', max: '300',
      placeholder: 'kg', id: 'quick-weight-input',
    });
    const logBtn = Utils.el('button', { class: 'btn btn--secondary', type: 'button', id: 'quick-weight-btn' }, 'Log today\u2019s weight');

    const quickAdd = Utils.el('div', { class: 'quick-add' }, [weightInput, logBtn]);

    logBtn.addEventListener('click', async () => {
      const raw = weightInput.value;
      const err = Utils.Validate.range(raw, 30, 300, 'Weight');
      if (!raw || err) { Utils.toast(err || 'Enter a weight in kg.', 'error'); return; }
      if (!userId || !profile) { Utils.toast('Set up your profile first.', 'error'); return; }

      const weightKg = Number(raw);
      const today = Models.todayIso();
      const existing = (await DataService.weightEntries.list(w => w.userId === userId && w.date === today))[0];
      if (existing) {
        await DataService.weightEntries.update(existing.weightEntryId, { weightKg });
      } else {
        await DataService.weightEntries.create(Models.createWeightEntry(userId, today, { weightKg }));
      }
      await DataService.profiles.update(profile.profileId, { currentWeightKg: weightKg });

      const program = (await DataService.programs.list(p => p.userId === userId && p.status === 'active'))[0] || null;
      const phases = program ? await DataService.programPhases.list(ph => ph.programId === program.programId) : [];
      const phase = phases.length ? Calculations.getCurrentPhase(phases) : null;
      const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
      const refreshedProfile = await DataService.profiles.get(profile.profileId);
      const newTargets = Calculations.calculateAllTargets(refreshedProfile, { weightEntries, program, phase });
      await Calculations.recordTargetChangesIfNeeded(userId, newTargets, 'weight_update');

      Utils.toast('Weight logged.', 'success');
      container.innerHTML = '';
      await render(container);
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('h2', { class: 'card__title' }, 'Weight Progress'),
      profile
        ? Utils.el('dl', { class: 'stat-list' }, rows.flatMap(([label, val]) => ([
            Utils.el('dt', {}, label),
            Utils.el('dd', {}, val ?? 'No data entered'),
          ])))
        : Utils.el('p', { class: 'card__empty' }, 'No data entered'),
      quickAdd,
    ]);
  }

  // -----------------------------------------------------------------------
  // TODAY TRACKING — calories/protein/water/steps/workout/sleep + Daily Score.
  // Program/weight fields reuse the exact same computed values already
  // shown above (targets, program, currentPhase) — nothing recomputed here.
  // Food/nutrient figures come from DietEngine via DailyTrackingEngine.
  // -----------------------------------------------------------------------

  function renderTodayTrackingCard(program, currentPhase, profile, targets, daySummary, dailyScore, userId, container) {
    const counters = program ? Calculations.getProgramDayCounters(program) : null;

    const overview = [
      ['Active program', program ? program.name : null],
      ['Day', counters ? `Day ${counters.day} of ${counters.totalDays ?? '–'}` : null],
      ['Current phase', currentPhase ? currentPhase.name : null],
      ['Current weight', Utils.fmt(profile?.currentWeightKg, ' kg')],
      ['Starting weight', Utils.fmt(program?.startingWeightKg, ' kg')],
      ['Target weight', Utils.fmt(program?.targetWeightKg ?? profile?.targetWeightKg, ' kg')],
      ['Weight change', targets ? formatSignedKg(targets.weightDifferenceKg) : null],
      ['7-day average', targets ? Utils.fmt(targets.sevenDayAverageWeightKg, ' kg') : null],
    ];

    const nutrientLine = (label, d, unit) => [
      label, d.consumed == null ? 'No data entered' : `${d.consumed}${unit} / ${d.target ?? '—'}${unit} (${d.percent != null ? d.percent + '%' : '—'})`,
    ];

    const daily = [
      nutrientLine('Calories', daySummary.calories, ' kcal'),
      nutrientLine('Protein', daySummary.protein, ' g'),
      ['Water', daySummary.water.consumedMl == null ? 'No data entered' : `${daySummary.water.consumedMl} ml / ${daySummary.water.targetMl ?? '—'} ml (${daySummary.water.percent != null ? daySummary.water.percent + '%' : '—'})`],
      ['Steps', daySummary.steps.consumed == null ? 'No data entered' : `${daySummary.steps.consumed} / ${daySummary.steps.target ?? '—'} (${daySummary.steps.percent != null ? daySummary.steps.percent + '%' : '—'})`],
      ['Workout', daySummary.workout.done ? `Done${daySummary.workout.minutes ? ` — ${daySummary.workout.minutes} min` : ''}` : 'Not logged'],
      ['Sleep', daySummary.sleep.hoursSlept == null ? 'No data entered' : `${daySummary.sleep.hoursSlept} h${daySummary.sleep.targetHours ? ` / ${daySummary.sleep.targetHours} h` : ''}`],
    ];

    const scoreBadge = Utils.el('div', { class: `quality-badge quality-badge--${scoreTier(dailyScore.overall)}` }, [
      Utils.el('span', { class: 'quality-badge__score' }, dailyScore.overall == null ? '—' : `${dailyScore.overall}%`),
      Utils.el('span', { class: 'quality-badge__label' }, 'Daily completion'),
    ]);
    const scoreNote = dailyScore.severelyUnderCalorie
      ? Utils.el('p', { class: 'card__footnote', style: 'color:var(--danger);font-style:normal;' },
          'Calorie intake is well below target today — completion is capped, not rewarded, for this.')
      : null;

    return Utils.el('section', { class: 'card', id: 'today-tracking' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, "Today's Tracking"),
        Utils.el('a', { class: 'link', href: '#/diet' }, 'Log food'),
      ]),
      Utils.el('dl', { class: 'stat-list' }, overview.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v ?? 'No data entered')])),
      Utils.el('dl', { class: 'stat-list', style: 'margin-top:10px;' }, daily.flatMap(([l, v]) => [Utils.el('dt', {}, l), Utils.el('dd', {}, v)])),
      scoreBadge,
      scoreNote,
    ].filter(Boolean));
  }

  function scoreTier(score) {
    if (score == null) return 'fair';
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    return 'attention';
  }

  // -----------------------------------------------------------------------
  // SECONDARY NUTRIENTS — fat/carbs/fibre/calcium/potassium/magnesium/iron/zinc.
  // Pulled straight from the same DietEngine daily summary as Today Tracking.
  // -----------------------------------------------------------------------

  function renderSecondaryNutrientsCard(daySummary) {
    const rows = [
      ['Fat', daySummary.fat], ['Carbohydrates', daySummary.carbs], ['Fibre', daySummary.fibre],
      ['Calcium', daySummary.calcium], ['Potassium', daySummary.potassium], ['Magnesium', daySummary.magnesium],
      ['Iron', daySummary.iron], ['Zinc', daySummary.zinc],
    ];
    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Secondary Nutrients')),
      Utils.el('dl', { class: 'stat-list stat-list--mono' }, rows.flatMap(([label, d]) => [
        Utils.el('dt', {}, label),
        Utils.el('dd', {}, d.consumed == null ? 'No data entered' : `${d.consumed}${d.unit ? ' ' + d.unit : ''} / ${d.target ?? '—'}${d.unit ? ' ' + d.unit : ''}${d.percent != null ? ` (${d.percent}%)` : ''}`),
      ])),
    ]);
  }

  // -----------------------------------------------------------------------
  // DAILY CHECKLIST — 13 of 15 items are derived live from real data; only
  // "Morning walk" and "Evening walk" are manual toggles (see Models.createDailyChecklist).
  // -----------------------------------------------------------------------

  function renderChecklistCard(checklist, dailyScore, userId, today, dailyChecklist, container) {
    const rows = checklist.map(item => {
      const toggle = (item.key === 'morning_walk' || item.key === 'evening_walk')
        ? Utils.el('button', {
            class: `chip${item.done ? ' chip--active' : ''}`, type: 'button',
            onClick: async () => {
              const checks = { ...(dailyChecklist?.checks || {}), [item.key]: !item.done };
              if (dailyChecklist) await DataService.dailyChecklists.update(dailyChecklist.dailyChecklistId, { checks });
              else await DataService.dailyChecklists.create(Models.createDailyChecklist(userId, today, { checks }));
              container.innerHTML = ''; await render(container);
            },
          }, item.done ? '✓ Done' : 'Mark done')
        : Utils.el('span', { class: `badge${item.done ? '' : ' badge--draft'}` }, item.done ? '✓ Done' : 'Not yet');

      return Utils.el('div', { class: 'checklist-row' }, [
        Utils.el('span', { class: 'checklist-row__label' }, item.label),
        Utils.el('span', { class: 'checklist-row__detail' }, item.detail),
        toggle,
      ]);
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Daily Checklist' ),
        Utils.el('p', { class: 'card__subtitle' }, `${dailyScore.doneCount} / ${dailyScore.totalCount} complete`),
      ]),
      Utils.el('div', { class: 'checklist-list' }, rows),
    ]);
  }

  // -----------------------------------------------------------------------
  // SCHEDULE — creator's initial schedule, fully editable.
  // -----------------------------------------------------------------------

  function renderScheduleCard(scheduleItems, userId, container) {
    const sorted = [...scheduleItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const rows = sorted.map(item => renderScheduleRow(item, userId, container));

    const addBtn = Utils.el('button', {
      class: 'btn btn--secondary', type: 'button',
      onClick: async () => {
        const maxOrder = sorted.reduce((m, s) => Math.max(m, s.order || 0), 0);
        const created = await DataService.scheduleItems.create(Models.createScheduleItem(userId, { order: maxOrder + 1, label: 'New item', startTime: '12:00' }));
        expandedScheduleItemId = created.scheduleItemId; // open the new row straight into edit mode
        container.innerHTML = ''; await render(container);
      },
    }, '+ Add Row');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Schedule'),
        Utils.el('p', { class: 'card__subtitle' }, 'Editable — this is a starting point, not a fixed plan.'),
      ]),
      scheduleItems.length ? Utils.el('div', { class: 'schedule-list schedule-list--compact' }, rows) : Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      addBtn,
    ]);
  }

  /** Collapsed by default — a single vertical line ("18:00–19:15  Gym")
   *  with an Edit button. Only the row actually being edited expands into
   *  the full label/time-picker/Save/Delete form, so a full day's
   *  schedule stays compact without needing a horizontal layout. */
  function renderScheduleRow(item, userId, container) {
    const timeLabel = item.endTime ? `${item.startTime}–${item.endTime}` : (item.startTime || '—');
    const isExpanded = expandedScheduleItemId === item.scheduleItemId;

    if (!isExpanded) {
      const editBtn = Utils.el('button', {
        class: 'btn btn--secondary btn--row', type: 'button',
        onClick: () => { expandedScheduleItemId = item.scheduleItemId; container.innerHTML = ''; render(container); },
      }, 'Edit');
      return Utils.el('div', { class: 'schedule-row schedule-row--compact' }, [
        Utils.el('span', { class: 'schedule-row__time' }, timeLabel),
        Utils.el('span', { class: 'schedule-row__label' }, item.label || 'Untitled'),
        editBtn,
      ]);
    }

    const labelInput = Utils.el('input', { class: 'form__input', type: 'text', value: item.label, style: 'width:140px;' });
    const startInput = Utils.el('input', { class: 'form__input', type: 'time', value: item.startTime || '', style: 'width:110px;' });
    const endInput = Utils.el('input', { class: 'form__input', type: 'time', value: item.endTime || '', style: 'width:110px;' });

    const saveBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        await DataService.scheduleItems.update(item.scheduleItemId, {
          label: labelInput.value, startTime: startInput.value, endTime: endInput.value,
        });
        expandedScheduleItemId = null;
        Utils.toast('Schedule updated.', 'success');
        container.innerHTML = ''; await render(container);
      },
    }, 'Save');

    const cancelBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => { expandedScheduleItemId = null; container.innerHTML = ''; render(container); },
    }, 'Cancel');

    const deleteBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => {
        await DataService.scheduleItems.delete(item.scheduleItemId);
        expandedScheduleItemId = null;
        Utils.toast('Row removed.', 'success');
        container.innerHTML = ''; await render(container);
      },
    }, 'Delete');

    return Utils.el('div', { class: 'schedule-row schedule-row--editing' }, [
      Utils.el('span', { class: 'schedule-row__time' }, timeLabel),
      labelInput, startInput, endInput,
      Utils.el('div', { class: 'row-actions' }, [saveBtn, cancelBtn, deleteBtn]),
    ]);
  }

  function renderMicronutrientsCard(targets) {
    const m = targets?.micronutrients;
    const rows = m ? [
      ['Calcium', Utils.fmt(m.calciumMg, ' mg')],
      ['Potassium', Utils.fmt(m.potassiumMg, ' mg')],
      ['Magnesium', Utils.fmt(m.magnesiumMg, ' mg')],
      ['Iron', Utils.fmt(m.ironMg, ' mg')],
      ['Zinc', Utils.fmt(m.zincMg, ' mg')],
      ['Sodium', Utils.fmt(m.sodiumMg, ' mg')],
      ['Vitamin C', Utils.fmt(m.vitaminCMg, ' mg')],
      ['Vitamin A', Utils.fmt(m.vitaminAMcg, ' mcg')],
      ['Folate', Utils.fmt(m.folateMcg, ' mcg')],
      ['Vitamin B12', Utils.fmt(m.vitaminB12Mcg, ' mcg')],
      ['Vitamin D', Utils.fmt(m.vitaminDMcg, ' mcg')],
      ['Omega-3', Utils.fmt(m.omega3G, ' g')],
      ['Fibre', Utils.fmt(m.fibreG, ' g')],
    ] : [];

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Micronutrient References'),
        Utils.el('p', { class: 'card__subtitle' }, 'Personalized reference values by age and sex — not a prescription.'),
      ]),
      m
        ? Utils.el('dl', { class: 'stat-list stat-list--mono' }, rows.flatMap(([label, val]) => ([
            Utils.el('dt', {}, label),
            Utils.el('dd', {}, val),
          ])))
        : Utils.el('p', { class: 'card__empty' }, 'No data entered'),
    ]);
  }

  function renderTrackerLinksCard() {
    const links = [
      ['diet', 'Diet'], ['nutrition', 'Nutrition'], ['workout', 'Workout'],
      ['water', 'Water'], ['steps', 'Steps'], ['sleep', 'Sleep'], ['recovery', 'Recovery'],
      ['progress', 'Progress'], ['wellbeing', 'Sexual Wellbeing'], ['craving', 'Craving Control'], ['shopping', 'Shopping'],
    ];
    return Utils.el('section', { class: 'card card--links card--full-width' }, [
      Utils.el('h2', { class: 'card__title' }, 'Trackers'),
      Utils.el('div', { class: 'quick-links quick-links--horizontal' }, links.map(([path, label]) =>
        Utils.el('a', { class: 'quick-links__item', href: `#/${path}` }, label)
      )),
    ]);
  }

  function formatSignedKg(val) {
    if (val === null || val === undefined) return null;
    const sign = val > 0 ? '+' : '';
    return `${sign}${val} kg`;
  }

  return { render };
})();
