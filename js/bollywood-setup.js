/**
 * bollywood-setup.js
 * ---------------------------------------------------------------------------
 * Creates the ProgramPhase / WorkoutTemplate / MealTemplate records for one
 * newly-created "100 Day Body Program" (see pages/programs.js,
 * which calls this right after the Program record itself is created).
 * Content comes entirely from BollywoodProgramData — this file only wires
 * it into DataService with the correct programId/phaseId, so program data
 * ownership rules hold ("must belong to the correct programId").
 * ---------------------------------------------------------------------------
 */

const BollywoodSetup = (() => {

  async function setupProgram(programId, userId, startDate) {
    const phases = BollywoodProgramData.buildPhases(programId, startDate);
    const savedPhases = [];
    for (const phase of phases) savedPhases.push(await DataService.programPhases.create(phase));

    const phaseByKey = Object.fromEntries(savedPhases.map(p => [p.phaseKey, p]));

    await setupPhase1(userId, programId, phaseByKey.foundation_week);
    await setupPhase2(userId, programId, phaseByKey.building_the_base);
    await setupPhase3(userId, programId, phaseByKey.muscle_building_mode);
    // Phase 4 (Shredding) and Phase 5 (Peak Week) are Coming Soon — no
    // workout/meal templates are created for them; the phase records above
    // already carry comingSoon: true, which the landing page renders as
    // locked/coming-soon without inventing any content.

    return savedPhases;
  }

  async function setupPhase1(userId, programId, phase) {
    await DataService.workoutTemplates.create(Models.createWorkoutTemplate(userId, {
      programId, phaseId: phase.phaseId,
      name: 'Foundation Week — Full Body', category: 'Full Body', programDayLabel: 'Days 1–6',
      exercises: BollywoodProgramData.buildPhase1FullBodyExercises().map((e, i) => ({ ...e, order: i + 1 })),
      notes: 'Priority: form over everything else. Use light-to-moderate weights; do not add exercises or chase heavy weights. Rest 60–90 sec between sets. Day 7 is rest.',
    }));
  }

  async function setupPhase2(userId, programId, phase) {
    const days = [
      { label: 'Push', category: 'Push', builder: BollywoodProgramData.buildPhase2PushExercises },
      { label: 'Pull', category: 'Pull', builder: BollywoodProgramData.buildPhase2PullExercises },
      { label: 'Legs', category: 'Legs', builder: BollywoodProgramData.buildPhase2LegsExercises },
    ];
    for (const d of days) {
      await DataService.workoutTemplates.create(Models.createWorkoutTemplate(userId, {
        programId, phaseId: phase.phaseId,
        name: `Building the Base — ${d.label}`, category: d.category, programDayLabel: `${d.label} days (×2/week)`,
        exercises: d.builder().map((e, i) => ({ ...e, order: i + 1 })),
        notes: '10–15 reps. Compound rest 90s, isolation rest 60s. 15–20 min LISS after training. Abs routine follows the main workout (see phase guide); Day 7 is rest.',
      }));
    }

    const optionA = BollywoodProgramData.buildPhase2MealOptionA();
    const optionB = BollywoodProgramData.buildPhase2MealOptionB();
    await createMealSlots(userId, programId, phase.phaseId, 'Phase 2 Option A', optionA, 4, 6, 'vegetarian');
    await createMealSlots(userId, programId, phase.phaseId, 'Phase 2 Option B', optionB, 3, 6, 'vegetarian');
  }

  /** Splits a flat list of meal items into Meal 1 / Snack / Meal 2 template
   *  records at the given split indices, matching the 16:8 fasting
   *  structure (2 main meals + 1 snack). */
  async function createMealSlots(userId, programId, phaseId, labelPrefix, items, snackStart, mealTwoStart, dietType) {
    const meal1 = items.slice(0, snackStart);
    const snack = items.slice(snackStart, mealTwoStart);
    const meal2 = items.slice(mealTwoStart);

    const slots = [
      { suffix: 'Meal 1 (12:00 PM)', mealType: 'lunch', items: meal1 },
      { suffix: 'Snack (3–4 PM)', mealType: 'snack', items: snack },
      { suffix: 'Meal 2 (7–8 PM)', mealType: 'dinner', items: meal2 },
    ];
    for (const slot of slots) {
      if (!slot.items.length) continue;
      await DataService.mealTemplates.create(Models.createMealTemplate(userId, {
        programId, phaseId, name: `${labelPrefix} — ${slot.suffix}`, mealType: slot.mealType, dietType,
        items: slot.items, notes: 'Fasting window 8 PM–12 PM next day. Eating window 12 PM–8 PM.',
      }));
    }
  }

  async function setupPhase3(userId, programId, phase) {
    const days = [
      { label: 'Pull', category: 'Pull', builder: BollywoodProgramData.buildPhase3PullExercises },
      { label: 'Legs', category: 'Legs', builder: BollywoodProgramData.buildPhase3LegsExercises },
      { label: 'Chest + Back', category: 'Chest + Back', builder: BollywoodProgramData.buildPhase3ChestBackExercises },
      { label: 'Arms + Delts', category: 'Arms + Delts', builder: BollywoodProgramData.buildPhase3ArmsDeltsExercises },
    ];
    for (const d of days) {
      await DataService.workoutTemplates.create(Models.createWorkoutTemplate(userId, {
        programId, phaseId: phase.phaseId,
        name: `Muscle Building Mode — ${d.label}`, category: d.category, programDayLabel: d.label,
        exercises: d.builder().map((e, i) => ({ ...e, order: i + 1 })),
        notes: 'Weekly rule: increase weight or reps on at least 2 exercises where appropriate — never at the cost of form.',
      }));
    }
    // Day 1 (Push) has no source content — see BollywoodProgramData.buildPhase3PushExercises's
    // doc comment. We deliberately do NOT create a workout template for it.
  }

  return { setupProgram };
})();
