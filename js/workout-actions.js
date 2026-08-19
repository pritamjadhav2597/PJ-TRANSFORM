/**
 * workout-actions.js
 * ---------------------------------------------------------------------------
 * The one place that turns a WorkoutTemplate into a real logged Workout +
 * WorkoutExercise + WorkoutSet records. Both pages/workout.js ("Start
 * Workout" on the Weekly Split) and pages/program-bollywood.js ("Start
 * This Workout" on a phase day) call this same function, so a workout
 * started from either page is identical — including the template's
 * programId and every advanced set-structure field (superset/drop-set/
 * giant-set/cardio mode). See models.js's createWorkoutExercise doc
 * comment for what each field means.
 * ---------------------------------------------------------------------------
 */

const WorkoutActions = (() => {

  async function startWorkoutFromTemplate(userId, date, template) {
    const workout = await DataService.workouts.create(Models.createWorkout(userId, {
      date, programId: template.programId || null, templateId: template.workoutTemplateId,
      dayOfWeek: template.dayOfWeek, name: template.name, status: 'in_progress',
    }));

    for (const [i, ex] of (template.exercises || []).entries()) {
      const created = await DataService.workoutExercises.create(Models.createWorkoutExercise(workout.workoutId, {
        exerciseName: ex.exerciseName, muscleGroup: ex.muscleGroup, exerciseType: ex.exerciseType, isCardio: ex.isCardio, order: i + 1,
        targetSets: ex.targetSets, targetRepsMin: ex.targetRepsMin, targetRepsMax: ex.targetRepsMax, targetRIR: ex.targetRIR, restSeconds: ex.restSeconds,
        groupId: ex.groupId || null, groupType: ex.groupType || '', groupOrder: ex.groupOrder ?? null, groupLabel: ex.groupLabel || '',
        round: ex.round ?? null, totalRounds: ex.totalRounds ?? null, restAfterGroupSeconds: ex.restAfterGroupSeconds ?? null,
        dropPercentage: ex.dropPercentage ?? null, toFailure: !!ex.toFailure,
        cardioMode: ex.cardioMode || '', sprintRounds: ex.sprintRounds ?? null, sprintDistanceM: ex.sprintDistanceM ?? null,
        formNotes: ex.formNotes || '', mistakesToAvoid: ex.mistakesToAvoid || '',
        notes: ex.isCardio && ex.targetDurationMinutes ? `Target: ${ex.targetDurationMinutes} min${ex.notes ? ` — ${ex.notes}` : ''}` : (ex.notes || ''),
      }));
      if (!ex.isCardio && ex.targetSets) {
        for (let s = 1; s <= ex.targetSets; s++) {
          await DataService.workoutSets.create(Models.createWorkoutSet(created.workoutExerciseId, { setNumber: s }));
        }
      }
    }

    return workout;
  }

  /** Finds an already-logged workout for this exact template on this date,
   *  if one exists — used so "Start This Workout" becomes "Continue" and
   *  never creates a duplicate session for the same day. */
  async function findExistingWorkout(userId, date, template) {
    const matches = await DataService.workouts.list(w => w.userId === userId && w.date === date && w.templateId === template.workoutTemplateId);
    return matches[0] || null;
  }

  return { startWorkoutFromTemplate, findExistingWorkout };
})();
