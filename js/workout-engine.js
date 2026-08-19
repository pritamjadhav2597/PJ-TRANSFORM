/**
 * workout-engine.js
 * ---------------------------------------------------------------------------
 * Pure logic for the Workout module: exercise history, previous/best
 * performance, and progression suggestions. No storage access — pages fetch
 * workouts/workoutExercises/workoutSets and pass them in.
 *
 * Progression is always a SUGGESTION, never an auto-applied change — the
 * person decides the actual weight for their next set. This module never
 * recommends a weight increase when the last session's form was flagged as
 * a problem, no matter how the reps/RIR looked.
 * ---------------------------------------------------------------------------
 */

const WorkoutEngine = (() => {

  /** Epley formula — a standard, widely-used estimate, not a guarantee. */
  function estimateOneRepMax(weightKg, reps) {
    if (weightKg == null || reps == null || weightKg <= 0 || reps <= 0) return null;
    return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
  }

  /** All logged sessions (any status) for one exercise name, newest first.
   *  Each entry: { workout, exercise, sets }. */
  function getExerciseHistory(exerciseName, workouts, workoutExercises, workoutSets) {
    const matchingExercises = workoutExercises.filter(ex => ex.exerciseName === exerciseName);
    const rows = matchingExercises.map(exercise => {
      const workout = workouts.find(w => w.workoutId === exercise.workoutId) || null;
      const sets = workoutSets.filter(s => s.workoutExerciseId === exercise.workoutExerciseId).sort((a, b) => a.setNumber - b.setNumber);
      return { workout, exercise, sets };
    }).filter(r => r.workout);
    rows.sort((a, b) => (b.workout.date || '').localeCompare(a.workout.date || '') || (b.workout.createdAt || '').localeCompare(a.workout.createdAt || ''));
    return rows;
  }

  /** Most recent PRIOR session for this exercise (optionally excluding one
   *  in-progress workoutId — e.g. today's session-in-progress shouldn't
   *  count as its own "previous"). */
  function getPreviousPerformance(exerciseName, workouts, workoutExercises, workoutSets, excludeWorkoutId = null) {
    const history = getExerciseHistory(exerciseName, workouts, workoutExercises, workoutSets)
      .filter(r => r.workout.workoutId !== excludeWorkoutId && r.sets.some(s => s.completed && s.weightKg != null));
    if (!history.length) return null;
    const latest = history[0];
    const completedSets = latest.sets.filter(s => s.completed && s.weightKg != null);
    const topSet = completedSets.reduce((best, s) => (!best || (estimateOneRepMax(s.weightKg, s.reps) || 0) > (estimateOneRepMax(best.weightKg, best.reps) || 0)) ? s : best, null);
    return { date: latest.workout.date, exercise: latest.exercise, sets: completedSets, topSet };
  }

  /** Best set ever logged for this exercise, by estimated 1RM. */
  function getBestPerformance(exerciseName, workouts, workoutExercises, workoutSets) {
    const history = getExerciseHistory(exerciseName, workouts, workoutExercises, workoutSets);
    let best = null;
    history.forEach(({ workout, sets }) => {
      sets.filter(s => s.completed && s.weightKg != null && s.reps != null).forEach(s => {
        const e1rm = estimateOneRepMax(s.weightKg, s.reps);
        if (!best || e1rm > best.estOneRepMax) best = { date: workout.date, weightKg: s.weightKg, reps: s.reps, rir: s.rir, estOneRepMax: e1rm };
      });
    });
    return best;
  }

  /** Personal bests across every exercise that has history. */
  function getPersonalBests(workouts, workoutExercises, workoutSets) {
    const names = [...new Set(workoutExercises.map(e => e.exerciseName).filter(Boolean))];
    return names
      .map(name => ({ exerciseName: name, best: getBestPerformance(name, workouts, workoutExercises, workoutSets) }))
      .filter(r => r.best)
      .sort((a, b) => b.best.estOneRepMax - a.best.estOneRepMax);
  }

  /**
   * Progression suggestion — advisory only. Encodes: prioritize form,
   * ~1–3 RIR as the target zone, increase weight only once target reps
   * feel comfortable (reps at/above target-max with RIR >= 2), typical
   * increase 2.5–5 kg (smaller — 1–2.5 kg — for isolation work), and NEVER
   * suggest an increase if the last session's form was flagged as a problem.
   */
  function suggestProgression({ exerciseType, targetRepsMin, targetRepsMax, targetRIR, previous }) {
    if (!previous || !previous.topSet) {
      return { action: 'start', message: 'No previous performance yet — start with a comfortable, controlled weight and prioritize form.', suggestedIncrementKg: null };
    }

    const { topSet } = previous;
    const isIsolation = exerciseType === 'isolation';
    const incrementRange = isIsolation ? [1, 2.5] : [2.5, 5];

    if (previous.exercise && (previous.exercise.formRating === 'poor' || previous.exercise.formRating === 'minor_breakdown')) {
      return {
        action: 'hold_form',
        message: `Last session's form was flagged (${previous.exercise.formRating.replace('_', ' ')}) — repeat ${topSet.weightKg ?? '—'} kg and prioritize clean reps before adding weight.`,
        suggestedIncrementKg: 0,
      };
    }

    const repsMet = targetRepsMax != null ? topSet.reps >= targetRepsMax : (targetRepsMin != null ? topSet.reps >= targetRepsMin : false);
    const rirComfortable = topSet.rir != null ? topSet.rir >= 2 : null;

    if (repsMet && (rirComfortable === true || rirComfortable === null)) {
      return {
        action: 'increase',
        message: `Last session you hit ${topSet.reps} reps at ${topSet.weightKg} kg${topSet.rir != null ? ` (RIR ${topSet.rir})` : ''} — target reps look comfortable. Consider +${incrementRange[0]}–${incrementRange[1]} kg next session, staying in the 1–3 RIR range.`,
        suggestedIncrementKg: incrementRange,
      };
    }
    if (repsMet && rirComfortable === false) {
      return {
        action: 'hold_rir',
        message: `You reached target reps but with less than 2 RIR — hold ${topSet.weightKg} kg and aim to build a rep or two of reserve before increasing.`,
        suggestedIncrementKg: 0,
      };
    }
    return {
      action: 'hold_reps',
      message: `Last session: ${topSet.reps} reps at ${topSet.weightKg} kg. Keep the same weight and work toward ${targetRepsMax ?? targetRepsMin ?? 'your target'} reps with good form before increasing.`,
      suggestedIncrementKg: 0,
    };
  }

  /** Planned-vs-completed sets for whatever workout(s) happened on one
   *  date — used by the Progress module's "Workout completion" chart.
   *  Returns null (not 0%) when no workout was logged that day, so a rest
   *  day doesn't read as a missed one. */
  function computeDailyWorkoutCompletion(date, workouts, workoutExercises, workoutSets) {
    const dayWorkouts = workouts.filter(w => w.date === date);
    if (!dayWorkouts.length) return null;
    const exIds = new Set(workoutExercises.filter(e => dayWorkouts.some(w => w.workoutId === e.workoutId)).map(e => e.workoutExerciseId));
    const sets = workoutSets.filter(s => exIds.has(s.workoutExerciseId));
    if (!sets.length) return dayWorkouts.some(w => w.status === 'completed') ? 100 : 0;
    const completed = sets.filter(s => s.completed).length;
    return Math.round((completed / sets.length) * 100);
  }

  /** Elapsed seconds for a live session — startedAt to now (or completedAt
   *  once finished), minus any accumulated/in-progress pause time. Never
   *  negative, never counts paused time as training time. */
  function computeElapsedSeconds(workout, nowMs = Date.now()) {
    if (!workout || !workout.startedAt) return 0;
    const start = new Date(workout.startedAt).getTime();
    const end = workout.completedAt ? new Date(workout.completedAt).getTime() : nowMs;
    let pausedMs = workout.totalPausedMs || 0;
    if (workout.pausedAt) pausedMs += Math.max(0, nowMs - new Date(workout.pausedAt).getTime());
    const elapsedMs = Math.max(0, (end - start) - pausedMs);
    return Math.floor(elapsedMs / 1000);
  }

  function formatElapsed(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  /** Live-session progress for Workout Mode's progress bar/stats: sets
   *  completed, exercises fully completed, percentage, and how many
   *  exercises remain. A set counts toward "completed" whether logged
   *  normally or explicitly skipped — both mean "no longer pending". */
  function computeSessionProgress(exercises, setsByExercise) {
    let totalSets = 0, doneSets = 0, exercisesCompleted = 0;
    exercises.forEach(ex => {
      const sets = setsByExercise[ex.workoutExerciseId] || [];
      if (ex.isCardio) {
        totalSets += 1;
        const cardioDone = ex.cardioDurationMinutes != null || ex.cardioDistance != null;
        if (cardioDone) { doneSets += 1; exercisesCompleted += 1; }
        return;
      }
      totalSets += sets.length;
      const setsDone = sets.filter(s => s.completed || s.skipped).length;
      doneSets += setsDone;
      if (sets.length > 0 && setsDone === sets.length) exercisesCompleted += 1;
    });
    const pct = totalSets > 0 ? Math.round((doneSets / totalSets) * 100) : 0;
    return {
      totalSets, doneSets, pct,
      exercisesTotal: exercises.length,
      exercisesCompleted,
      exercisesRemaining: Math.max(0, exercises.length - exercisesCompleted),
    };
  }

  /** Consecutive-day streak of completed workouts, ending on `today` (or
   *  yesterday, so a streak survives until the day is actually missed). */
  function computeWorkoutStreak(workouts, today) {
    const completedDates = new Set(workouts.filter(w => w.status === 'completed').map(w => w.date));
    let streak = 0;
    let cursor = completedDates.has(today) ? today : ProgramTemplates.addDays(today, -1);
    while (completedDates.has(cursor)) { streak++; cursor = ProgramTemplates.addDays(cursor, -1); }
    return streak;
  }

  /**
   * Completion-screen summary — duration, exercises/sets logged, total
   * volume, and any PRs actually set THIS session (compared against the
   * best performance recorded before this workout). Only ever reports
   * data that's really there — no fabricated numbers.
   */
  function computeWorkoutSummary(workout, exercises, workoutSets, allWorkouts, allWorkoutExercises, allWorkoutSets) {
    const exIds = new Set(exercises.map(e => e.workoutExerciseId));
    const sets = workoutSets.filter(s => exIds.has(s.workoutExerciseId));
    const completedSets = sets.filter(s => s.completed && s.weightKg != null && s.reps != null);
    const skippedSets = sets.filter(s => s.skipped);
    const totalVolumeKg = completedSets.reduce((sum, s) => sum + (s.weightKg || 0) * (s.reps || 0), 0);

    const prs = [];
    exercises.forEach(ex => {
      if (ex.isCardio) return;
      const exSets = completedSets.filter(s => s.workoutExerciseId === ex.workoutExerciseId);
      if (!exSets.length) return;
      // Best set logged in THIS session for this exercise.
      const sessionBest = exSets.reduce((b, s) => (!b || (estimateOneRepMax(s.weightKg, s.reps) || 0) > (estimateOneRepMax(b.weightKg, b.reps) || 0)) ? s : b, null);
      const sessionE1rm = estimateOneRepMax(sessionBest.weightKg, sessionBest.reps) || 0;
      // Best set from BEFORE this workout (exclude this workout's own id).
      const priorHistory = getExerciseHistory(ex.exerciseName, allWorkouts, allWorkoutExercises, allWorkoutSets)
        .filter(r => r.workout.workoutId !== workout.workoutId);
      let priorBestE1rm = 0;
      priorHistory.forEach(r => r.sets.filter(s => s.completed && s.weightKg != null).forEach(s => {
        const e1rm = estimateOneRepMax(s.weightKg, s.reps) || 0;
        if (e1rm > priorBestE1rm) priorBestE1rm = e1rm;
      }));
      if (sessionE1rm > priorBestE1rm) {
        prs.push({ exerciseName: ex.exerciseName, weightKg: sessionBest.weightKg, reps: sessionBest.reps, estOneRepMax: sessionE1rm, isFirst: priorBestE1rm === 0 });
      }
    });

    return {
      elapsedSeconds: computeElapsedSeconds(workout),
      exercisesCount: exercises.length,
      setsCompleted: completedSets.length,
      setsSkipped: skippedSets.length,
      setsTotal: sets.length,
      totalVolumeKg: Math.round(totalVolumeKg),
      prs,
    };
  }

  return {
    estimateOneRepMax,
    getExerciseHistory,
    getPreviousPerformance,
    getBestPerformance,
    getPersonalBests,
    suggestProgression,
    computeDailyWorkoutCompletion,
    computeElapsedSeconds,
    formatElapsed,
    computeSessionProgress,
    computeWorkoutStreak,
    computeWorkoutSummary,
  };
})();
