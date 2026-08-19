/**
 * workout-session.js — "Workout Mode": the immersive, full-screen active-
 * workout experience (Section 1B). Renders itself as an overlay appended to
 * <body> (same technique as UIFx.weightSplash) so it sits above the normal
 * page regardless of which route is mounted underneath, and hands control
 * back to the calling page via onExit() when closed.
 *
 * Layout: mobile shows one exercise at a time with sticky bottom nav and a
 * dot stepper (swipe left/right to move between exercises); desktop adds a
 * persistent exercise-list sidebar next to the active exercise (CSS handles
 * the split — see .wsx-sidebar's media query in styles.css). Both share the
 * same DOM/state, just reflowed by CSS.
 *
 * All math (elapsed time, session progress, PRs, streaks) comes from
 * WorkoutEngine — this file only renders and wires up interaction.
 */

const WorkoutSession = (() => {

  let s = null; // session state, null when closed
  let overlayEl = null;
  let clockTimerId = null;
  let restTimerId = null;

  // -----------------------------------------------------------------------
  // OPEN / CLOSE / LOAD
  // -----------------------------------------------------------------------

  async function open(userId, workoutId, onExit) {
    if (overlayEl) close(false); // guard against double-open

    s = {
      userId, workoutId, onExit,
      view: 'loading', // 'loading' | 'active' | 'completion' | 'error'
      workout: null, exercises: [], setsByExercise: {},
      currentIndex: 0,
      restTimer: null,   // { totalSeconds, remaining, exerciseName, paused, tickId }
      lastCompletedSetId: null, // drives the one-shot set-complete pulse animation
      errorMessage: '',
      touchStartX: null,
    };

    overlayEl = Utils.el('div', { class: 'wsx-overlay' });
    document.body.appendChild(overlayEl);
    document.body.style.overflow = 'hidden';
    render();

    try {
      await load();
      s.view = s.workout && s.workout.status === 'completed' ? 'completion' : 'active';
      if (s.view === 'active') startClock();
      else s.summary = await computeSummaryBeforeSaving();
      render();
    } catch (err) {
      console.error('WorkoutSession load failed', err);
      s.view = 'error';
      s.errorMessage = 'Could not load this workout. Please try again.';
      render();
    }
  }

  async function load() {
    const workout = (await DataService.workouts.list(w => w.workoutId === s.workoutId))[0];
    if (!workout) throw new Error('Workout not found');
    const exercises = (await DataService.workoutExercises.list(e => e.workoutId === s.workoutId)).sort((a, b) => a.order - b.order);
    const exIds = new Set(exercises.map(e => e.workoutExerciseId));
    const allSets = await DataService.workoutSets.list(set => exIds.has(set.workoutExerciseId));
    const setsByExercise = {};
    exercises.forEach(ex => {
      setsByExercise[ex.workoutExerciseId] = allSets.filter(set => set.workoutExerciseId === ex.workoutExerciseId).sort((a, b) => a.setNumber - b.setNumber);
    });
    // Older sessions logged before the live-timer fields existed won't have
    // a startedAt — backfill once so the elapsed clock still has a sane
    // reference point instead of reading 0:00 forever.
    if (!workout.startedAt && workout.status !== 'completed') {
      await DataService.workouts.update(workout.workoutId, { startedAt: Models.nowIso() });
      workout.startedAt = Models.nowIso();
    }

    s.workout = workout;
    s.exercises = exercises;
    s.setsByExercise = setsByExercise;
    if (s.currentIndex >= exercises.length) s.currentIndex = Math.max(0, exercises.length - 1);
  }

  function close(callExit = true) {
    stopClock();
    stopRestTimer(false);
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    document.body.style.overflow = '';
    const cb = s && s.onExit;
    s = null;
    if (callExit && cb) cb();
  }

  async function refresh() {
    try { await load(); } catch (e) { console.error(e); }
    render();
  }

  // -----------------------------------------------------------------------
  // ELAPSED CLOCK
  // -----------------------------------------------------------------------

  function startClock() {
    stopClock();
    clockTimerId = setInterval(() => {
      if (!s || !s.workout) return;
      const clockEl = overlayEl && overlayEl.querySelector('[data-wsx-clock]');
      if (clockEl) clockEl.textContent = WorkoutEngine.formatElapsed(WorkoutEngine.computeElapsedSeconds(s.workout));
    }, 1000);
  }
  function stopClock() { if (clockTimerId) { clearInterval(clockTimerId); clockTimerId = null; } }

  // -----------------------------------------------------------------------
  // RENDER
  // -----------------------------------------------------------------------

  function render() {
    if (!overlayEl || !s) return;
    overlayEl.innerHTML = '';
    if (s.view === 'loading') { overlayEl.appendChild(renderLoading()); return; }
    if (s.view === 'error') { overlayEl.appendChild(renderErrorState()); return; }
    if (s.view === 'completion') { overlayEl.appendChild(renderCompletion()); return; }
    overlayEl.appendChild(renderHeader());
    overlayEl.appendChild(renderProgressBar());
    overlayEl.appendChild(renderBody());
    if (s.restTimer) overlayEl.appendChild(renderRestTimer());
  }

  function renderLoading() {
    const wrap = Utils.el('div', { class: 'wsx-skeleton' }, [
      Utils.el('div', { class: 'wsx-skeleton__bar', style: 'width:40%;height:26px;' }),
      Utils.el('div', { class: 'wsx-skeleton__bar', style: 'width:70%;' }),
      Utils.el('div', { class: 'wsx-skeleton__bar', style: 'width:90%;' }),
      Utils.el('div', { class: 'wsx-skeleton__bar', style: 'width:60%;' }),
    ]);
    return Utils.el('div', { style: 'display:flex;align-items:center;justify-content:center;height:100%;' }, wrap);
  }

  function renderErrorState() {
    return Utils.el('div', { style: 'display:flex;align-items:center;justify-content:center;height:100%;padding:20px;' }, [
      Utils.el('div', { class: 'wsx-rest-card' }, [
        Utils.el('p', { class: 'wsx-banner wsx-banner--error' }, s.errorMessage || 'Something went wrong.'),
        Utils.el('button', { class: 'btn btn--primary', type: 'button', onClick: () => close(true) }, 'Close'),
      ]),
    ]);
  }

  // ---- Header ----

  function renderHeader() {
    const closeBtn = Utils.el('button', {
      class: 'wsx-header__close', type: 'button', title: 'Exit Workout Mode', 'aria-label': 'Close',
      onClick: () => close(true),
    }, '\u00d7');

    const paused = s.workout.status === 'paused';
    const pauseBtn = Utils.el('button', {
      class: 'wsx-header__pause', type: 'button', onClick: () => toggleWorkoutPause(),
    }, paused ? '\u25b6 Resume' : '\u23f8 Pause');

    return Utils.el('div', { class: 'wsx-header' }, [
      closeBtn,
      Utils.el('div', { class: 'wsx-header__title' }, [
        Utils.el('p', { class: 'wsx-header__name' }, s.workout.name || 'Workout'),
        Utils.el('p', { class: 'wsx-header__meta' }, `Exercise ${Math.min(s.currentIndex + 1, s.exercises.length)} of ${s.exercises.length}`),
      ]),
      Utils.el('div', { class: 'wsx-header__clock', 'data-wsx-clock': '1' }, WorkoutEngine.formatElapsed(WorkoutEngine.computeElapsedSeconds(s.workout))),
      pauseBtn,
    ]);
  }

  async function toggleWorkoutPause() {
    const nowPaused = s.workout.status !== 'paused';
    const patch = nowPaused
      ? { status: 'paused', pausedAt: Models.nowIso() }
      : { status: 'in_progress', pausedAt: null, totalPausedMs: (s.workout.totalPausedMs || 0) + (s.workout.pausedAt ? (Date.now() - new Date(s.workout.pausedAt).getTime()) : 0) };
    await DataService.workouts.update(s.workout.workoutId, patch);
    await refresh();
  }

  // ---- Progress bar ----

  function renderProgressBar() {
    const progress = WorkoutEngine.computeSessionProgress(s.exercises, s.setsByExercise);
    const wrap = Utils.el('div', { class: 'wsx-progress' }, [
      Utils.el('div', { class: 'wsx-progress__row' }, [
        Utils.el('span', {}, [Utils.el('strong', {}, `${progress.doneSets}/${progress.totalSets}`), ' sets']),
        Utils.el('span', {}, [Utils.el('strong', {}, `${progress.exercisesCompleted}/${progress.exercisesTotal}`), ' exercises']),
        Utils.el('span', {}, [Utils.el('strong', {}, `${progress.exercisesRemaining}`), ' remaining']),
        Utils.el('span', {}, [Utils.el('strong', {}, `${progress.pct}%`), ' complete']),
      ]),
      Utils.el('div', { class: 'wsx-progress__track' }, Utils.el('div', { class: 'wsx-progress__fill', style: `width:${progress.pct}%;` })),
    ]);
    if (s.workout.status === 'paused') {
      wrap.appendChild(Utils.el('div', { class: 'wsx-banner wsx-banner--paused', style: 'margin-top:10px;' }, '\u23f8 Workout paused — timer is holding. Resume when you\u2019re ready.'));
    }
    return wrap;
  }

  // ---- Body: sidebar + main ----

  function renderBody() {
    const body = Utils.el('div', { class: 'wsx-body' });
    body.appendChild(renderSidebar());
    const main = Utils.el('div', { class: 'wsx-main' });
    main.appendChild(renderMobileStepper());
    const inner = Utils.el('div', { class: 'wsx-main__inner' });
    if (!s.exercises.length) {
      inner.appendChild(Utils.el('p', { class: 'card__empty-state' }, 'No exercises in this workout.'));
    } else {
      inner.appendChild(renderExercise(s.exercises[s.currentIndex]));
    }
    main.appendChild(inner);
    main.appendChild(renderNav());
    attachSwipeHandlers(main);
    body.appendChild(main);
    return body;
  }

  function renderSidebar() {
    return Utils.el('div', { class: 'wsx-sidebar' }, s.exercises.map((ex, idx) => {
      const sets = s.setsByExercise[ex.workoutExerciseId] || [];
      const done = ex.isCardio ? (ex.cardioDurationMinutes != null || ex.cardioDistance != null) : (sets.length > 0 && sets.every(st => st.completed || st.skipped));
      const item = Utils.el('div', {
        class: `wsx-sidebar__item${idx === s.currentIndex ? ' wsx-sidebar__item--active' : ''}${done ? ' wsx-sidebar__item--done' : ''}`,
        onClick: () => goToExercise(idx),
      }, [
        Utils.el('div', { class: 'wsx-sidebar__dot' }, done ? '\u2713' : `${idx + 1}`),
        Utils.el('div', {}, [
          Utils.el('div', { class: 'wsx-sidebar__name' }, ex.exerciseName || 'Exercise'),
          Utils.el('div', { class: 'wsx-sidebar__sub' }, ex.isCardio ? 'Cardio' : `${sets.filter(st => st.completed || st.skipped).length}/${sets.length} sets`),
        ]),
      ]);
      return item;
    }));
  }

  function renderMobileStepper() {
    return Utils.el('div', { class: 'wsx-mobile-stepper' }, s.exercises.map((ex, idx) => {
      const sets = s.setsByExercise[ex.workoutExerciseId] || [];
      const done = ex.isCardio ? (ex.cardioDurationMinutes != null || ex.cardioDistance != null) : (sets.length > 0 && sets.every(st => st.completed || st.skipped));
      const cls = idx === s.currentIndex ? 'wsx-mobile-stepper__dot wsx-mobile-stepper__dot--active' : (done ? 'wsx-mobile-stepper__dot wsx-mobile-stepper__dot--done' : 'wsx-mobile-stepper__dot');
      return Utils.el('span', { class: cls });
    }));
  }

  function renderNav() {
    const prevBtn = Utils.el('button', {
      class: 'btn btn--secondary', type: 'button', disabled: s.currentIndex === 0 ? 'disabled' : null,
      onClick: () => goToExercise(s.currentIndex - 1),
    }, '\u2190 Prev');
    const isLast = s.currentIndex >= s.exercises.length - 1;
    const nextBtn = isLast
      ? Utils.el('button', { class: 'btn btn--primary', type: 'button', onClick: () => finishWorkout() }, 'Finish Workout')
      : Utils.el('button', { class: 'btn btn--primary', type: 'button', onClick: () => goToExercise(s.currentIndex + 1) }, 'Next \u2192');
    return Utils.el('div', { class: 'wsx-nav' }, [prevBtn, nextBtn]);
  }

  function goToExercise(idx) {
    if (idx < 0 || idx >= s.exercises.length || idx === s.currentIndex) return;
    s.currentIndex = idx;
    // Every freshly-rendered .wsx-exercise carries its own slide-in
    // animation (see styles.css) simply by entering the DOM, so a full
    // render() here is enough to get the exercise-transition effect.
    render();
  }

  function attachSwipeHandlers(main) {
    let startX = null;
    main.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    main.addEventListener('touchend', (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) < 60) return;
      if (dx < 0 && s.currentIndex < s.exercises.length - 1) goToExercise(s.currentIndex + 1);
      else if (dx > 0 && s.currentIndex > 0) goToExercise(s.currentIndex - 1);
    }, { passive: true });
  }

  // ---- Active exercise ----

  function renderExercise(ex) {
    const prevPerf = getPreviousAcrossHistory(ex.exerciseName);
    const bestPerf = getBestAcrossHistory(ex.exerciseName);

    const perf = Utils.el('div', { class: 'wsx-perf' }, [
      Utils.el('div', { class: 'wsx-perf__item' }, [
        Utils.el('div', { class: 'wsx-perf__label' }, 'Previous'),
        Utils.el('div', { class: 'wsx-perf__value' }, prevPerf ? `${prevPerf.weightKg} kg \u00d7 ${prevPerf.reps}` : 'No data entered'),
      ]),
      Utils.el('div', { class: 'wsx-perf__item' }, [
        Utils.el('div', { class: 'wsx-perf__label' }, 'Best (est. 1RM)'),
        Utils.el('div', { class: 'wsx-perf__value' }, bestPerf ? `${bestPerf.estOneRepMax} kg` : 'No data entered'),
      ]),
    ]);

    const targetLine = ex.isCardio
      ? `Target ${ex.cardioDurationMinutes ?? '\u2014'} min${ex.cardioDistance ? ` \u00b7 ${ex.cardioDistance} km` : ''}`
      : `Target ${ex.targetSets ?? '\u2014'} \u00d7 ${ex.targetRepsMin ?? '\u2014'}-${ex.targetRepsMax ?? '\u2014'} reps \u00b7 RIR ${ex.targetRIR ?? '\u2014'} \u00b7 rest ${ex.restSeconds ?? '\u2014'}s`;

    const body = ex.isCardio ? renderCardioBlock(ex) : renderSetsBlock(ex);

    return Utils.el('div', { class: 'wsx-exercise' }, [
      Utils.el('p', { class: 'wsx-exercise__eyebrow' }, ex.muscleGroup ? ex.muscleGroup.replace(/_/g, ' ') : (ex.isCardio ? 'Cardio' : ex.exerciseType)),
      Utils.el('div', { class: 'wsx-exercise__name-row' }, [
        Utils.el('h2', { class: 'wsx-exercise__name' }, ex.exerciseName || 'Exercise'),
        Utils.el('button', {
          class: 'video-help-btn video-help-btn--on-dark', type: 'button', title: `Watch ${ex.exerciseName} demo`,
          onClick: (e) => { e.preventDefault(); VideoModal.open(ex.exerciseName); },
        }, '?'),
      ]),
      Utils.el('p', { class: 'wsx-exercise__target' }, targetLine),
      perf,
      body,
    ]);
  }

  function allSetsFlat() { return Object.values(s.setsByExercise).flat(); }

  function getPreviousAcrossHistory(exerciseName) {
    // Look across every workout except the live one for this exercise's most recent completed top set.
    // Kept local (not WorkoutEngine.getPreviousPerformance) because Workout Mode only has this one
    // session's data loaded — pulling full cross-session history here would need every workout, which
    // the page-level "Previous/Best" line already computes and passes in via openFromPage().
    return s.historyCache ? s.historyCache.previous[exerciseName] || null : null;
  }
  function getBestAcrossHistory(exerciseName) {
    return s.historyCache ? s.historyCache.best[exerciseName] || null : null;
  }

  function renderSetsBlock(ex) {
    const sets = s.setsByExercise[ex.workoutExerciseId] || [];
    const rows = sets.map((set, idx) => renderSetRow(set, idx, ex));
    const addSetBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        const created = await DataService.workoutSets.create(Models.createWorkoutSet(ex.workoutExerciseId, { setNumber: sets.length + 1 }));
        s.setsByExercise[ex.workoutExerciseId] = [...sets, created];
        render();
      },
    }, '+ Add Set');
    return Utils.el('div', {}, [
      Utils.el('div', { class: 'wsx-sets' }, rows.length ? rows : [Utils.el('p', { class: 'card__footnote' }, 'No sets yet.')]),
      addSetBtn,
    ]);
  }

  function renderSetRow(set, idx, ex) {
    const weightInput = Utils.el('input', { type: 'number', step: 'any', min: 0, inputmode: 'decimal', value: set.weightKg ?? '' });
    const repsInput = Utils.el('input', { type: 'number', min: 0, inputmode: 'numeric', value: set.reps ?? '' });

    const doneBtn = Utils.el('button', {
      class: 'wsx-set-row__done-btn', type: 'button', title: set.completed ? 'Mark not done' : 'Mark set done',
      onClick: () => markSetComplete(set, ex, weightInput.value, repsInput.value),
    }, set.completed ? '\u2713' : '\u25cb');

    const skipBtn = set.completed ? null : Utils.el('button', {
      class: 'wsx-set-row__skip-btn', type: 'button', onClick: () => skipSet(set, ex),
    }, set.skipped ? 'Skipped' : 'Skip');

    const justCompleted = s.lastCompletedSetId === set.workoutSetId;
    const rowClass = `wsx-set-row${set.completed ? ' wsx-set-row--done' : ''}${set.skipped ? ' wsx-set-row--skipped' : ''}${justCompleted ? ' wsx-set-row--pulse' : ''}`;
    return Utils.el('div', { class: rowClass, 'data-set-id': set.workoutSetId }, [
      Utils.el('div', { class: 'wsx-set-row__num' }, `${idx + 1}`),
      Utils.el('div', { class: 'wsx-set-row__field' }, [Utils.el('label', {}, 'kg'), weightInput]),
      Utils.el('div', { class: 'wsx-set-row__field' }, [Utils.el('label', {}, 'reps'), repsInput]),
      Utils.el('div', { class: 'wsx-set-row__spacer' }),
      skipBtn,
      doneBtn,
    ].filter(Boolean));
  }

  async function markSetComplete(set, ex, weightRaw, repsRaw) {
    const nowCompleting = !set.completed;
    const patch = nowCompleting
      ? { completed: true, skipped: false, weightKg: numOrNull(weightRaw), reps: numOrNull(repsRaw), completedAt: Models.nowIso() }
      : { completed: false, completedAt: null };
    await DataService.workoutSets.update(set.workoutSetId, patch);
    Object.assign(set, patch);

    // Flag this set so the row rendered in the very next render() carries
    // the pulse class from the moment it's created — a full render()
    // happens right after this (to refresh the progress bar/sidebar), so
    // targeting the old, about-to-be-replaced DOM node would never
    // actually be visible. A CSS keyframe animation on a *freshly
    // inserted* element plays automatically, no reflow trick needed.
    s.lastCompletedSetId = nowCompleting ? set.workoutSetId : null;
    render();
    s.lastCompletedSetId = null;

    if (nowCompleting && ex.restSeconds) startRestTimer(ex.restSeconds, ex.exerciseName);
  }

  async function skipSet(set, ex) {
    const patch = { skipped: !set.skipped, completed: false, completedAt: null };
    await DataService.workoutSets.update(set.workoutSetId, patch);
    Object.assign(set, patch);
    render();
  }

  function renderCardioBlock(ex) {
    const durInput = Utils.el('input', { type: 'number', step: 'any', min: 0, value: ex.cardioDurationMinutes ?? '' });
    const distInput = Utils.el('input', { type: 'number', step: 'any', min: 0, value: ex.cardioDistance ?? '' });
    const saveBtn = Utils.el('button', {
      class: 'btn btn--primary', type: 'button',
      onClick: async () => {
        const patch = { cardioDurationMinutes: numOrNull(durInput.value), cardioDistance: numOrNull(distInput.value) };
        await DataService.workoutExercises.update(ex.workoutExerciseId, patch);
        Object.assign(ex, patch);
        Utils.toast('Cardio logged.', 'success');
        render();
      },
    }, 'Save Cardio');
    return Utils.el('div', { class: 'wsx-sets' }, [
      Utils.el('div', { class: 'wsx-set-row' }, [
        Utils.el('div', { class: 'wsx-set-row__field' }, [Utils.el('label', {}, 'minutes'), durInput]),
        Utils.el('div', { class: 'wsx-set-row__field' }, [Utils.el('label', {}, 'km'), distInput]),
        Utils.el('div', { class: 'wsx-set-row__spacer' }),
        saveBtn,
      ]),
    ]);
  }

  function numOrNull(raw) {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  // -----------------------------------------------------------------------
  // REST TIMER
  // -----------------------------------------------------------------------

  function startRestTimer(seconds, exerciseName) {
    stopRestTimer(false);
    s.restTimer = { totalSeconds: seconds, remaining: seconds, exerciseName, paused: false };
    restTimerId = setInterval(() => {
      if (!s.restTimer || s.restTimer.paused) return;
      s.restTimer.remaining -= 1;
      if (s.restTimer.remaining <= 0) { stopRestTimer(true); return; }
      updateRestRingDom();
    }, 1000);
    render();
  }

  function stopRestTimer(playChime) {
    if (restTimerId) { clearInterval(restTimerId); restTimerId = null; }
    if (s && s.restTimer) { s.restTimer = null; render(); }
    if (playChime) Utils.toast('Rest complete — next set!', 'success');
  }

  function pauseResumeRest() {
    if (!s.restTimer) return;
    s.restTimer.paused = !s.restTimer.paused;
    render();
  }

  function adjustRest(deltaSeconds) {
    if (!s.restTimer) return;
    s.restTimer.remaining = Math.max(0, s.restTimer.remaining + deltaSeconds);
    s.restTimer.totalSeconds = Math.max(s.restTimer.totalSeconds, s.restTimer.remaining);
    if (s.restTimer.remaining <= 0) { stopRestTimer(true); return; }
    render();
  }

  function updateRestRingDom() {
    if (!overlayEl || !s.restTimer) return;
    const { remaining, totalSeconds } = s.restTimer;
    const timeEl = overlayEl.querySelector('[data-wsx-rest-time]');
    if (timeEl) timeEl.textContent = WorkoutEngine.formatElapsed(remaining);
    const ringEl = overlayEl.querySelector('[data-wsx-rest-fill]');
    if (ringEl) {
      const circumference = Number(ringEl.getAttribute('data-circumference'));
      const pct = totalSeconds > 0 ? remaining / totalSeconds : 0;
      ringEl.style.strokeDashoffset = `${circumference * (1 - pct)}`;
    }
    const ringWrap = overlayEl.querySelector('.wsx-rest-ring');
    if (ringWrap) ringWrap.classList.toggle('wsx-rest-ring--urgent', remaining <= 5);
  }

  function renderRestTimer() {
    const { remaining, totalSeconds, exerciseName, paused } = s.restTimer;
    const size = 168, stroke = 9, r = (size / 2) - stroke - 1;
    const circumference = 2 * Math.PI * r;
    const pct = totalSeconds > 0 ? remaining / totalSeconds : 0;
    const offset = circumference * (1 - pct);

    const ring = Utils.el('div', { class: `wsx-rest-ring${remaining <= 5 ? ' wsx-rest-ring--urgent' : ''}${paused ? ' wsx-rest-ring--paused' : ''}` });
    ring.innerHTML = `
      <svg viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="wsx-rest-ring__track"></circle>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="wsx-rest-ring__fill" data-wsx-rest-fill="1"
          data-circumference="${circumference}" stroke-dasharray="${circumference}" style="stroke-dashoffset:${offset}"></circle>
      </svg>
      <div class="wsx-rest-ring__time" data-wsx-rest-time="1">${WorkoutEngine.formatElapsed(remaining)}</div>`;

    const adjustRow = Utils.el('div', { class: 'wsx-rest-adjust' }, [
      Utils.el('button', { type: 'button', onClick: () => adjustRest(-15) }, '\u221215s'),
      Utils.el('button', { type: 'button', onClick: () => adjustRest(15) }, '+15s'),
      Utils.el('button', { type: 'button', onClick: () => adjustRest(30) }, '+30s'),
    ]);

    const actions = Utils.el('div', { class: 'wsx-rest-actions' }, [
      Utils.el('button', { class: 'btn btn--secondary', type: 'button', onClick: () => pauseResumeRest() }, paused ? 'Resume' : 'Pause'),
      Utils.el('button', { class: 'btn btn--primary', type: 'button', onClick: () => stopRestTimer(false) }, 'Skip'),
    ]);

    return Utils.el('div', { class: 'wsx-rest-backdrop' }, [
      Utils.el('div', { class: 'wsx-rest-card' }, [
        Utils.el('p', { class: 'wsx-rest-card__label' }, `Resting \u2014 ${exerciseName || 'next set'}`),
        ring, adjustRow, actions,
      ]),
    ]);
  }

  // -----------------------------------------------------------------------
  // FINISH / COMPLETION SCREEN
  // -----------------------------------------------------------------------

  async function finishWorkout() {
    const progress = WorkoutEngine.computeSessionProgress(s.exercises, s.setsByExercise);
    if (progress.doneSets < progress.totalSets) {
      const proceed = window.confirm(`${progress.totalSets - progress.doneSets} set(s) are still unlogged. Finish anyway?`);
      if (!proceed) return;
    }
    stopRestTimer(false);
    stopClock();

    const completedAt = Models.nowIso();
    const summary = await computeSummaryBeforeSaving();
    await DataService.workouts.update(s.workout.workoutId, {
      status: 'completed', completedAt,
      durationMinutes: Math.max(1, Math.round(summary.elapsedSeconds / 60)),
    });
    s.workout.status = 'completed';
    s.workout.completedAt = completedAt;
    s.summary = summary;
    s.view = 'completion';
    render();
  }

  async function computeSummaryBeforeSaving() {
    const allWorkouts = await DataService.workouts.list(w => w.userId === s.userId);
    const allWorkoutExercises = await DataService.workoutExercises.list(e => allWorkouts.some(w => w.workoutId === e.workoutId));
    const allWorkoutSets = await DataService.workoutSets.list(set => allWorkoutExercises.some(e => e.workoutExerciseId === set.workoutExerciseId));
    return WorkoutEngine.computeWorkoutSummary(s.workout, s.exercises, allSetsFlat(), allWorkouts, allWorkoutExercises, allWorkoutSets);
  }

  function renderCompletion() {
    const summary = s.summary || { elapsedSeconds: WorkoutEngine.computeElapsedSeconds(s.workout), exercisesCount: s.exercises.length, setsCompleted: 0, setsTotal: 0, totalVolumeKg: 0, prs: [] };

    const stats = [
      ['Duration', WorkoutEngine.formatElapsed(summary.elapsedSeconds)],
      ['Exercises', `${summary.exercisesCount}`],
      ['Sets completed', `${summary.setsCompleted}/${summary.setsTotal}`],
      ['Total volume', summary.totalVolumeKg > 0 ? `${summary.totalVolumeKg} kg` : '\u2014'],
    ];

    const prsBlock = summary.prs.length ? Utils.el('div', { class: 'wsx-complete__prs' }, [
      Utils.el('h4', {}, '\ud83c\udfc6 New personal records'),
      ...summary.prs.map(pr => Utils.el('p', { class: 'wsx-complete__pr-row' },
        `${pr.exerciseName} \u2014 ${pr.weightKg} kg \u00d7 ${pr.reps} (est. 1RM ${pr.estOneRepMax} kg)${pr.isFirst ? ' \u2014 first time logged!' : ''}`)),
    ]) : null;

    const doneBtn = Utils.el('button', { class: 'btn btn--primary', type: 'button', onClick: () => close(true) }, 'Done');
    const viewLogBtn = Utils.el('button', { class: 'btn btn--secondary', type: 'button', onClick: () => close(true) }, 'View Full Log');

    return Utils.el('div', { class: 'wsx-complete' }, [
      renderConfetti(),
      Utils.el('div', { class: 'wsx-complete__inner' }, [
        Utils.el('div', { class: 'wsx-complete__badge' }, '\ud83c\udf89'),
        Utils.el('h2', { class: 'wsx-complete__title' }, 'Workout Complete'),
        Utils.el('p', { class: 'wsx-complete__subtitle' }, s.workout.name || 'Nice work — logged for today.'),
        Utils.el('div', { class: 'wsx-complete__stats' }, stats.map(([label, val]) => Utils.el('div', { class: 'wsx-complete__stat' }, [
          Utils.el('div', { class: 'wsx-complete__stat-value' }, val),
          Utils.el('div', { class: 'wsx-complete__stat-label' }, label),
        ]))),
        prsBlock,
        renderDetailedLog(),
        Utils.el('div', { class: 'wsx-complete__actions' }, [viewLogBtn, doneBtn]),
      ].filter(Boolean)),
    ]);
  }

  /** Read-only set-by-set breakdown, collapsed by default — this is what
   *  "previous workouts open into detailed results" means from the History
   *  card: the same completion screen, reopened, with the full log visible. */
  function renderDetailedLog() {
    if (!s.exercises.length) return null;
    const details = Utils.el('details', { class: 'wsx-complete__prs', style: 'text-align:left;background:var(--surface);border:1px solid var(--line);' });
    details.appendChild(Utils.el('summary', { style: 'cursor:pointer;font-weight:600;font-size:13.5px;color:var(--ink);' }, 'View set-by-set details'));
    s.exercises.forEach(ex => {
      const sets = s.setsByExercise[ex.workoutExerciseId] || [];
      const line = ex.isCardio
        ? `${ex.exerciseName}: ${ex.cardioDurationMinutes ?? '\u2014'} min${ex.cardioDistance ? `, ${ex.cardioDistance} km` : ''}`
        : `${ex.exerciseName}: ${sets.map(st => st.completed ? `${st.weightKg ?? '\u2014'}kg\u00d7${st.reps ?? '\u2014'}` : (st.skipped ? 'skipped' : '\u2014')).join(', ') || 'No sets'}`;
      details.appendChild(Utils.el('p', { class: 'wsx-complete__pr-row' }, line));
    });
    return details;
  }

  function renderConfetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Utils.el('div', {});
    const colors = ['var(--ember)', 'var(--gold)', 'var(--moss)', 'var(--water)'];
    const layer = Utils.el('div', { class: 'wsx-confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 26; i++) {
      const left = Math.random() * 100;
      const delay = (Math.random() * 0.5).toFixed(2);
      const duration = (1.4 + Math.random() * 0.9).toFixed(2);
      layer.appendChild(Utils.el('div', {
        class: 'wsx-confetti__piece',
        style: `left:${left}%; background:${colors[i % colors.length]}; animation-delay:${delay}s; animation-duration:${duration}s;`,
      }));
    }
    return layer;
  }

  // -----------------------------------------------------------------------
  // PUBLIC ENTRY — called by pages/workout.js. Pre-loads cross-session
  // previous/best performance for every exercise so the immersive view
  // doesn't need every workout in memory just to show one "Previous" line.
  // -----------------------------------------------------------------------

  async function openFromPage(userId, workoutId, allData, onExit) {
    const previous = {}, best = {};
    const exNames = [...new Set((allData.workoutExercises || []).filter(e => e.workoutId === workoutId).map(e => e.exerciseName))];
    exNames.forEach(name => {
      const prev = WorkoutEngine.getPreviousPerformance(name, allData.workouts, allData.workoutExercises, allData.workoutSets, workoutId);
      previous[name] = prev && prev.topSet ? prev.topSet : null;
      best[name] = WorkoutEngine.getBestPerformance(name, allData.workouts, allData.workoutExercises, allData.workoutSets);
    });
    await open(userId, workoutId, onExit);
    if (s) s.historyCache = { previous, best };
    render();
  }

  return { open: openFromPage, close };
})();
