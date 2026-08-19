/**
 * reports-engine.js
 * ---------------------------------------------------------------------------
 * Pure logic for Reports & Analytics. No storage access -- pages fetch every
 * collection and pass it in. This module NEVER invents a statistic: every
 * average is computed only from days that actually have logged data
 * (missing days are skipped, not treated as zero), and every average
 * returns null -- not 0 -- when there's nothing to average.
 *
 * Reuses everything that already exists rather than recomputing it:
 *   - per-day nutrient/water/steps/workout/sleep figures: DailyTrackingEngine.computeDaySummary
 *   - weight metrics/trends, targets: Calculations.calculateAllTargets
 *   - measurement change: ProgressEngine.computeMeasurementChange
 *   - weekly energy/stress/recovery/libido averages: RecoveryEngine.computeWeeklyTrend
 *   - strength history/estimated 1RM: WorkoutEngine
 * ---------------------------------------------------------------------------
 */

const ReportsEngine = (() => {

  const TARGET_FIELD_LABELS = {
    calorieTarget: { label: 'Calories', unit: ' kcal' },
    proteinTargetG: { label: 'Protein', unit: ' g' },
    fatTargetG: { label: 'Fat', unit: ' g' },
    carbTargetG: { label: 'Carbs', unit: ' g' },
    fibreTargetG: { label: 'Fibre', unit: ' g' },
    waterTargetMl: { label: 'Water', unit: ' ml' },
    stepTarget: { label: 'Steps', unit: '' },
  };

  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

  /** Averages only the real numbers in the list -- missing days are
   *  skipped, never counted as zero. Returns null (not 0) if nothing logged. */
  function average(values) {
    const nums = values.filter(isNum);
    if (!nums.length) return null;
    return round2(nums.reduce((s, v) => s + v, 0) / nums.length);
  }

  function buildTrailingDateRange(endDate, days) {
    const arr = [];
    for (let i = days - 1; i >= 0; i--) arr.push(ProgramTemplates.addDays(endDate, -i));
    return arr;
  }

  function buildDateRangeBetween(startDate, endDate) {
    const arr = [];
    let d = startDate;
    let guard = 0;
    while (d <= endDate && guard < 1000) { arr.push(d); d = ProgramTemplates.addDays(d, 1); guard++; }
    return arr;
  }

  /**
   * The shared aggregation core for both Weekly and Program reports.
   * `data` is the same trackingData bundle DailyTrackingEngine already
   * expects, plus measurementEntries/recoveryEntries/sexualWellbeingEntries
   * and an optional checklistsByDate map for Daily Score history.
   */
  function computeAggregateReport(range, data) {
    const { weightEntries, measurementEntries, recoveryEntries, sexualWellbeingEntries,
      workouts, workoutExercises, workoutSets, targets, profile, checklistsByDate = {} } = data;
    const rangeSet = new Set(range);

    const daySummaries = range.map(d => DailyTrackingEngine.computeDaySummary(d, data));

    const weightsInRange = weightEntries.filter(w => rangeSet.has(w.date) && w.weightKg != null).sort((a, b) => a.date.localeCompare(b.date));
    const startingWeight = weightsInRange[0]?.weightKg ?? null;
    const finalWeight = weightsInRange[weightsInRange.length - 1]?.weightKg ?? null;
    const weightChange = (startingWeight != null && finalWeight != null) ? round1(finalWeight - startingWeight) : null;
    const percentWeightChange = (startingWeight != null && finalWeight != null && startingWeight > 0)
      ? round1(((finalWeight - startingWeight) / startingWeight) * 100) : null;

    const measurementEntriesInRange = measurementEntries.filter(m => rangeSet.has(m.date));
    const measurementChanges = ProgressEngine.MEASUREMENT_FIELDS.map(f => ({
      key: f.key, label: f.label, unit: f.unit,
      ...ProgressEngine.computeMeasurementChange(measurementEntriesInRange, f.key),
    }));
    const waistChange = measurementChanges.find(m => m.key === 'waistCm')?.changeAbs ?? null;

    const avgCalories = average(daySummaries.map(d => d.calories.consumed));
    const avgProtein = average(daySummaries.map(d => d.protein.consumed));
    const avgCarbs = average(daySummaries.map(d => d.carbs.consumed));
    const avgFat = average(daySummaries.map(d => d.fat.consumed));
    const avgFibre = average(daySummaries.map(d => d.fibre.consumed));
    const avgCalcium = average(daySummaries.map(d => d.calcium.consumed));
    const avgPotassium = average(daySummaries.map(d => d.potassium.consumed));
    const avgMagnesium = average(daySummaries.map(d => d.magnesium.consumed));
    const avgIron = average(daySummaries.map(d => d.iron.consumed));
    const avgZinc = average(daySummaries.map(d => d.zinc.consumed));

    const avgSteps = average(daySummaries.map(d => d.steps.consumed));
    const avgWaterMl = average(daySummaries.map(d => d.water.consumedMl));
    const avgSleepHours = average(daySummaries.map(d => d.sleep.hoursSlept));

    const workoutCompletionValues = range
      .map(d => WorkoutEngine.computeDailyWorkoutCompletion(d, workouts, workoutExercises, workoutSets))
      .filter(v => v != null);
    const avgWorkoutCompletion = average(workoutCompletionValues);

    const strengthProgression = computeStrengthProgression(range, workouts, workoutExercises, workoutSets);

    const endDate = new Date(range[range.length - 1] + 'T00:00:00');
    const energyTrend = RecoveryEngine.computeWeeklyTrend(recoveryEntries, 'energyLevel', endDate);
    const stressTrend = RecoveryEngine.computeWeeklyTrend(recoveryEntries, 'stressLevel', endDate);
    const recoveryTrend = RecoveryEngine.computeWeeklyTrend(recoveryEntries, 'recoveryScore', endDate);
    const libidoTrend = sexualWellbeingEntries ? RecoveryEngine.computeWeeklyTrend(sexualWellbeingEntries, 'libidoLevel', endDate) : null;

    const dailyScores = range
      .map(d => DailyTrackingEngine.computeDailyScore(d, data, checklistsByDate[d] || {}).overall)
      .filter(v => v != null);
    const avgDailyCompletion = average(dailyScores);

    return {
      rangeStart: range[0], rangeEnd: range[range.length - 1], daysInRange: range.length,
      startingWeight, finalWeight, weightChange, percentWeightChange,
      sevenDayAverageWeightKg: targets?.sevenDayAverageWeightKg ?? null,
      waistChange, measurementChanges,
      avgCalories, avgProtein, avgCarbs, avgFat, avgFibre,
      avgCalcium, avgPotassium, avgMagnesium, avgIron, avgZinc,
      avgSteps, avgWaterMl, avgSleepHours, avgWorkoutCompletion,
      strengthProgression,
      energyAvg: energyTrend.thisWeekAvg, stressAvg: stressTrend.thisWeekAvg, recoveryAvg: recoveryTrend.thisWeekAvg,
      libidoAvg: libidoTrend ? libidoTrend.thisWeekAvg : null,
      avgDailyCompletion,
      daySummaries,
    };
  }

  function computeWeeklyReport(weekEndDate, data) {
    const range = buildTrailingDateRange(weekEndDate, 7);
    return { period: 'week', ...computeAggregateReport(range, data) };
  }

  function computeProgramReport(program, data, asOfDate = Models.todayIso()) {
    const end = (program.endDate && program.endDate < asOfDate) ? program.endDate : asOfDate;
    const range = buildDateRangeBetween(program.startDate, end);
    return { period: 'program', programName: program.name, isComplete: !!(program.endDate && program.endDate <= asOfDate), ...computeAggregateReport(range, data) };
  }

  /** Compares the earliest vs. latest in-range session for every exercise
   *  trained more than once in the range, by estimated 1RM (WorkoutEngine).
   *  Only exercises with 2+ in-range sessions are included -- a single
   *  session has nothing to compare against. */
  function computeStrengthProgression(range, workouts, workoutExercises, workoutSets) {
    const rangeSet = new Set(range);
    const inRangeWorkoutIds = new Set(workouts.filter(w => rangeSet.has(w.date)).map(w => w.workoutId));
    const names = [...new Set(workoutExercises.filter(e => inRangeWorkoutIds.has(e.workoutId)).map(e => e.exerciseName).filter(Boolean))];

    const results = [];
    names.forEach(name => {
      const history = WorkoutEngine.getExerciseHistory(name, workouts, workoutExercises, workoutSets)
        .filter(h => rangeSet.has(h.workout.date))
        .sort((a, b) => a.workout.date.localeCompare(b.workout.date));
      if (history.length < 2) return;

      const topSet = (sets) => sets.filter(s => s.completed && s.weightKg != null && s.reps != null)
        .reduce((best, s) => (!best || (WorkoutEngine.estimateOneRepMax(s.weightKg, s.reps) || 0) > (WorkoutEngine.estimateOneRepMax(best.weightKg, best.reps) || 0)) ? s : best, null);

      const firstTop = topSet(history[0].sets);
      const lastTop = topSet(history[history.length - 1].sets);
      if (!firstTop || !lastTop) return;

      const firstE1RM = WorkoutEngine.estimateOneRepMax(firstTop.weightKg, firstTop.reps);
      const lastE1RM = WorkoutEngine.estimateOneRepMax(lastTop.weightKg, lastTop.reps);
      results.push({
        exerciseName: name, firstDate: history[0].workout.date, lastDate: history[history.length - 1].workout.date,
        firstE1RM, lastE1RM, changeKg: round1(lastE1RM - firstE1RM),
      });
    });

    return results.sort((a, b) => b.changeKg - a.changeKg);
  }

  /**
   * Insights are generated ONLY from the report's own computed numbers --
   * every sentence cites an actual figure. Calorie insights never label
   * under-eating as a win (mirrors DietEngine's anti-starvation stance).
   */
  function generateWeeklyInsights(report, targets, profile) {
    const wentWell = [], needsImprovement = [], nextWeekFocus = [];

    if (report.avgProtein != null && targets?.proteinTargetG) {
      const pct = Math.round((report.avgProtein / targets.proteinTargetG) * 100);
      if (pct >= 90) wentWell.push(`Protein averaged ${report.avgProtein} g/day (${pct}% of your ${targets.proteinTargetG} g target).`);
      else { needsImprovement.push(`Protein averaged ${report.avgProtein} g/day \u2014 ${pct}% of your ${targets.proteinTargetG} g target.`); nextWeekFocus.push('Protein \u2014 build toward hitting your daily target more consistently.'); }
    }

    if (report.avgCalories != null && targets?.calorieTarget) {
      const ratio = report.avgCalories / targets.calorieTarget;
      if (ratio < 0.85) {
        needsImprovement.push(`Calories averaged ${report.avgCalories} kcal/day, noticeably under your ${targets.calorieTarget} kcal target.`);
        nextWeekFocus.push("Eating enough \u2014 under-eating isn't rewarded here; consistent, adequate intake supports better results.");
      } else if (ratio > 1.15) {
        needsImprovement.push(`Calories averaged ${report.avgCalories} kcal/day, above your ${targets.calorieTarget} kcal target.`);
        nextWeekFocus.push('Calorie consistency \u2014 look at portion sizes or where extra calories crept in.');
      } else {
        wentWell.push(`Calories averaged ${report.avgCalories} kcal/day, close to your ${targets.calorieTarget} kcal target.`);
      }
    }

    if (report.avgSteps != null && targets?.stepTarget) {
      const pct = Math.round((report.avgSteps / targets.stepTarget) * 100);
      if (pct >= 90) wentWell.push(`Steps averaged ${report.avgSteps}/day (${pct}% of target).`);
      else { needsImprovement.push(`Steps averaged ${report.avgSteps}/day \u2014 ${pct}% of your ${targets.stepTarget} target.`); nextWeekFocus.push('Daily steps \u2014 small additions like a short extra walk add up.'); }
    }

    if (report.avgWaterMl != null && targets?.waterTargetMl) {
      const pct = Math.round((report.avgWaterMl / targets.waterTargetMl) * 100);
      if (pct >= 90) wentWell.push(`Water intake averaged ${report.avgWaterMl} ml/day (${pct}% of target).`);
      else needsImprovement.push(`Water averaged ${report.avgWaterMl} ml/day \u2014 ${pct}% of target.`);
    }

    if (report.avgSleepHours != null && profile?.typicalSleepHours) {
      if (report.avgSleepHours >= profile.typicalSleepHours * 0.9) wentWell.push(`Sleep averaged ${report.avgSleepHours} h/night, close to your ${profile.typicalSleepHours} h target.`);
      else { needsImprovement.push(`Sleep averaged ${report.avgSleepHours} h/night, under your ${profile.typicalSleepHours} h target.`); nextWeekFocus.push('Sleep \u2014 this affects recovery and hunger regulation.'); }
    }

    if (report.avgWorkoutCompletion != null) {
      if (report.avgWorkoutCompletion >= 80) wentWell.push(`Workout completion averaged ${report.avgWorkoutCompletion}% on training days.`);
      else { needsImprovement.push(`Workout completion averaged ${report.avgWorkoutCompletion}% on training days.`); nextWeekFocus.push('Finishing planned sets \u2014 even partial sessions count, but full completion builds momentum.'); }
    }

    const improving = report.strengthProgression.filter(s => s.changeKg > 0);
    if (improving.length) wentWell.push(`Estimated strength improved on ${improving.length} exercise${improving.length === 1 ? '' : 's'}: ${improving.slice(0, 3).map(s => s.exerciseName).join(', ')}.`);

    if (report.recoveryAvg != null) {
      if (report.recoveryAvg <= 2.5) { needsImprovement.push(`Recovery averaged ${report.recoveryAvg}/5.`); nextWeekFocus.push('Recovery \u2014 prioritize sleep and consider an easier training day or two.'); }
      else wentWell.push(`Recovery averaged ${report.recoveryAvg}/5.`);
    }

    if (targets?.weeklyWeightTrendKg != null && targets?.goal) {
      const trend = targets.weeklyWeightTrendKg;
      if (targets.goal === 'fat_loss' && trend < 0) wentWell.push(`Weight trended down (${trend} kg/week), aligned with your fat-loss goal.`);
      else if (targets.goal === 'muscle_gain' && trend > 0) wentWell.push(`Weight trended up (+${trend} kg/week), aligned with your muscle-gain goal.`);
    }

    if (!nextWeekFocus.length && needsImprovement.length) nextWeekFocus.push('Review the items above and pick one to focus on first.');

    return { wentWell, needsImprovement, nextWeekFocus };
  }

  /** Flattens TargetHistory records into one row per field-change, most
   *  recent first. Every row's old/new values come straight from the
   *  stored record -- nothing here is recomputed. */
  function buildTargetHistoryRows(history) {
    const rows = [];
    [...history].sort((a, b) => (a.effectiveDate || '').localeCompare(b.effectiveDate || '')).forEach(record => {
      Object.keys(TARGET_FIELD_LABELS).forEach(field => {
        const oldVal = record.previousSnapshot ? record.previousSnapshot[field] : null;
        const newVal = record[field];
        if (oldVal !== newVal) {
          rows.push({
            field: TARGET_FIELD_LABELS[field].label, unit: TARGET_FIELD_LABELS[field].unit,
            oldValue: oldVal, newValue: newVal, date: record.effectiveDate, reason: record.reason,
          });
        }
      });
    });
    return rows.reverse();
  }

  return {
    TARGET_FIELD_LABELS,
    average,
    buildTrailingDateRange,
    buildDateRangeBetween,
    computeAggregateReport,
    computeWeeklyReport,
    computeProgramReport,
    computeStrengthProgression,
    generateWeeklyInsights,
    buildTargetHistoryRows,
  };
})();
