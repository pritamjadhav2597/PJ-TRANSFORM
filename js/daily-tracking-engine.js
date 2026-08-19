/**
 * daily-tracking-engine.js
 * ---------------------------------------------------------------------------
 * Pure logic for the Dashboard's daily tracking surfaces (Today summary,
 * Secondary nutrients, Daily Checklist, Schedule display, 60-Day Calendar,
 * Daily Score). No storage access — pages fetch records and pass them in.
 *
 * Reuses, never re-derives:
 *   - targets:            Calculations.calculateAllTargets()
 *   - nutrient consumed/target/remaining/%: DietEngine.computeDailySummary()
 *   - nutrition quality (incl. the anti-starvation cap): DietEngine.computeNutritionQuality()
 * The only new math here is water/steps/sleep/workout aggregation (which
 * exist nowhere else) and the checklist/score logic that combines all of
 * the above.
 * ---------------------------------------------------------------------------
 */

const DailyTrackingEngine = (() => {

  /** The 15 Daily Checklist items, in spec order. `derive` computes { done, detail }
   *  from real data — nothing here is a manually-checkable box except
   *  'morning_walk' and 'evening_walk', which have no other data source in the app yet. */
  const CHECKLIST_DEFS = [
    { key: 'weight', label: 'Weight' },
    { key: 'morning_walk', label: 'Morning walk' },
    { key: 'breakfast', label: 'Breakfast' },
    { key: 'water', label: 'Water' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'pre_workout', label: 'Pre-workout' },
    { key: 'workout', label: 'Workout' },
    { key: 'dinner', label: 'Dinner' },
    { key: 'evening_walk', label: 'Evening walk' },
    { key: 'steps', label: 'Steps' },
    { key: 'protein', label: 'Protein' },
    { key: 'vegetables', label: 'Vegetables' },
    { key: 'fruit', label: 'Fruit' },
    { key: 'healthy_fats', label: 'Healthy fats' },
    { key: 'sleep', label: 'Sleep' },
  ];

  const MEAL_TYPE_KEYS = ['breakfast', 'lunch', 'pre_workout', 'dinner', 'snack'];

  function sumField(records, dateField, date, valueField) {
    return records
      .filter(r => r[dateField === undefined ? 'date' : dateField] === date)
      .reduce((sum, r) => sum + (Number(r[valueField]) || 0), 0);
  }

  function sumWaterMl(waterEntries, date) {
    return waterEntries.filter(w => w.date === date).reduce((s, w) => s + (Number(w.amountMl) || 0), 0);
  }

  function sumSteps(stepEntries, date) {
    return stepEntries.filter(s => s.date === date).reduce((s, e) => s + (Number(e.steps) || 0), 0);
  }

  function sleepForDate(sleepEntries, date) {
    return sleepEntries.find(s => s.date === date) || null;
  }

  function workoutsForDate(workouts, date) {
    return workouts.filter(w => w.date === date);
  }

  function pctOf(consumed, target) {
    if (consumed == null || target == null || target <= 0) return null;
    return Math.round((consumed / target) * 100);
  }

  /**
   * Everything the Today Dashboard card needs for one date. Calorie/protein/
   * fat/carb/fibre figures are lifted straight out of DietEngine's daily
   * summary (already reconciled against Calculations' targets) — this
   * function does not touch that math itself.
   */
  function computeDaySummary(date, data) {
    const { entries, waterEntries, stepEntries, workouts, sleepEntries, weightEntries, targets, profile } = data;
    const dayEntries = entries.filter(e => e.date === date);

    const nutrientRows = DietEngine.computeDailySummary(dayEntries, targets);
    const byKey = Object.fromEntries(nutrientRows.map(r => [r.key, r]));

    const waterConsumed = sumWaterMl(waterEntries, date);
    const waterTarget = targets?.waterTargetMl ?? null;

    const stepsConsumed = sumSteps(stepEntries, date);
    const stepsTarget = targets?.stepTarget ?? null;

    const dayWorkouts = workoutsForDate(workouts, date);
    const workoutMinutes = dayWorkouts.reduce((s, w) => s + (Number(w.durationMinutes) || 0), 0);

    const sleep = sleepForDate(sleepEntries, date);
    const sleepTargetHours = profile?.typicalSleepHours ?? null;

    const weightToday = weightEntries.find(w => w.date === date) || null;

    return {
      date,
      calories: byKey.calories,
      protein: byKey.proteinG,
      fat: byKey.fatG,
      carbs: byKey.carbsG,
      fibre: byKey.fibreG,
      calcium: byKey.calciumMg,
      potassium: byKey.potassiumMg,
      magnesium: byKey.magnesiumMg,
      iron: byKey.ironMg,
      zinc: byKey.zincMg,
      water: { consumedMl: waterConsumed || null, targetMl: waterTarget, remainingMl: (waterTarget != null) ? FoodCalc.round2(waterTarget - waterConsumed) : null, percent: pctOf(waterConsumed, waterTarget) },
      steps: { consumed: stepsConsumed || null, target: stepsTarget, remaining: (stepsTarget != null) ? (stepsTarget - stepsConsumed) : null, percent: pctOf(stepsConsumed, stepsTarget) },
      workout: { done: dayWorkouts.length > 0, minutes: workoutMinutes || null, count: dayWorkouts.length },
      sleep: { hoursSlept: sleep?.hoursSlept ?? null, targetHours: sleepTargetHours, met: sleep?.hoursSlept != null && sleepTargetHours != null ? sleep.hoursSlept >= sleepTargetHours * 0.9 : null },
      weightKg: weightToday?.weightKg ?? null,
    };
  }

  /**
   * Derives all 15 Daily Checklist items for one date. Every item except
   * 'morning_walk' and 'evening_walk' is computed from real logged data —
   * nothing here can be satisfied by just ticking a box.
   */
  function computeChecklist(date, data, manualChecks = {}) {
    const { entries, targets } = data;
    const daySummary = computeDaySummary(date, data);
    const quality = DietEngine.computeNutritionQuality(entries.filter(e => e.date === date), targets);
    const factorScore = (key) => (quality.factors.find(f => f.key === key) || {}).score;

    const results = CHECKLIST_DEFS.map(def => {
      let done = false, detail = '', applicable = true;
      switch (def.key) {
        case 'weight':
          done = daySummary.weightKg != null;
          detail = done ? `${daySummary.weightKg} kg logged` : 'Not logged';
          break;
        case 'morning_walk':
          done = !!manualChecks.morning_walk;
          detail = done ? 'Marked done' : 'Not marked';
          break;
        case 'evening_walk':
          done = !!manualChecks.evening_walk;
          detail = done ? 'Marked done' : 'Not marked';
          break;
        case 'breakfast': case 'lunch': case 'pre_workout': case 'dinner':
          done = entries.some(e => e.date === date && e.mealType === def.key);
          detail = done ? 'Logged' : 'Not logged';
          break;
        case 'water':
          if (daySummary.water.targetMl != null) { done = daySummary.water.consumedMl != null && daySummary.water.consumedMl >= daySummary.water.targetMl; detail = `${daySummary.water.consumedMl || 0} / ${daySummary.water.targetMl} ml`; }
          else { done = (daySummary.water.consumedMl || 0) > 0; detail = daySummary.water.consumedMl ? `${daySummary.water.consumedMl} ml logged` : 'Not logged'; applicable = daySummary.water.consumedMl != null || true; }
          break;
        case 'workout':
          done = daySummary.workout.done;
          detail = done ? `${daySummary.workout.count} logged${daySummary.workout.minutes ? `, ${daySummary.workout.minutes} min` : ''}` : 'Not logged';
          break;
        case 'steps':
          if (daySummary.steps.target != null) { done = (daySummary.steps.consumed || 0) >= daySummary.steps.target; detail = `${daySummary.steps.consumed || 0} / ${daySummary.steps.target}`; }
          else { done = (daySummary.steps.consumed || 0) > 0; detail = daySummary.steps.consumed ? `${daySummary.steps.consumed} logged` : 'Not logged'; }
          break;
        case 'protein': {
          const score = daySummary.protein.percent;
          done = score != null && score >= 90;
          detail = daySummary.protein.consumed != null ? `${daySummary.protein.consumed} / ${daySummary.protein.target ?? '—'} g` : 'Not logged';
          if (daySummary.protein.target == null) applicable = false;
          break;
        }
        case 'vegetables': case 'fruit': case 'healthy_fats': {
          const score = factorScore(def.key);
          done = score != null && score >= 70;
          const f = quality.factors.find(x => x.key === def.key);
          detail = f ? f.detail : 'No data entered';
          break;
        }
        case 'sleep':
          done = daySummary.sleep.met === true || (daySummary.sleep.hoursSlept != null && daySummary.sleep.targetHours == null);
          detail = daySummary.sleep.hoursSlept != null ? `${daySummary.sleep.hoursSlept} h${daySummary.sleep.targetHours ? ` / ${daySummary.sleep.targetHours} h target` : ''}` : 'Not logged';
          break;
        default:
          applicable = false;
      }
      return { ...def, done, detail, applicable };
    });

    return results;
  }

  /**
   * Daily Score — blends checklist completion (60%) with the Nutrition
   * Quality score (40%, already anti-starvation-safe from DietEngine).
   * On top of that blend, a hard cap enforces "do not reward extreme
   * restriction": if today's calorie intake was severely under target,
   * the WHOLE score is capped regardless of how many boxes got checked —
   * a person can't check their way to a high score while badly under-eating.
   */
  function computeDailyScore(date, data, manualChecks = {}) {
    const { entries, targets } = data;
    const checklist = computeChecklist(date, data, manualChecks);
    const applicable = checklist.filter(c => c.applicable !== false);
    const doneCount = applicable.filter(c => c.done).length;
    const completionPercent = applicable.length ? Math.round((doneCount / applicable.length) * 100) : null;

    const quality = DietEngine.computeNutritionQuality(entries.filter(e => e.date === date), targets);
    const qualityScore = quality.score;

    let overall = null;
    if (completionPercent != null && qualityScore != null) overall = Math.round(completionPercent * 0.6 + qualityScore * 0.4);
    else if (completionPercent != null) overall = completionPercent;
    else if (qualityScore != null) overall = qualityScore;

    if (quality.severelyUnderCalorie && overall != null) {
      overall = Math.min(overall, 45); // never "automatically high" while badly under-eating
    }

    return { overall, completionPercent, doneCount, totalCount: applicable.length, qualityScore, severelyUnderCalorie: quality.severelyUnderCalorie, checklist };
  }

  const TIMELINE_SEGMENTS = [
    { key: 'morning', label: 'Morning', startMin: 5 * 60, endMin: 12 * 60 },
    { key: 'afternoon', label: 'Afternoon', startMin: 12 * 60, endMin: 17 * 60 },
    { key: 'evening', label: 'Evening', startMin: 17 * 60, endMin: 21 * 60 },
    { key: 'night', label: 'Night', startMin: 21 * 60, endMin: 5 * 60 }, // wraps past midnight
  ];

  function segmentForMinute(min) {
    if (min == null) return null;
    const found = TIMELINE_SEGMENTS.find(s => s.startMin < s.endMin
      ? (min >= s.startMin && min < s.endMin)
      : (min >= s.startMin || min < s.endMin)); // night wraps midnight
    return found ? found.key : null;
  }

  function minutesFromClock(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }

  function minutesFromTimestamp(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes();
  }

  /**
   * Builds a single chronological, cross-tracker event list for one day —
   * water, steps, workouts, sleep (bedtime/wake), all pulled from the SAME
   * records each tracker's own page already reads/writes (no separate
   * "timeline" source of truth, and nothing invented for a tracker with
   * nothing logged that day). Each event carries a morning/afternoon/
   * evening/night `segment` for grouping.
   */
  function buildDailyTimeline(date, data) {
    const { waterEntries = [], stepEntries = [], workouts = [], sleepEntries = [], recoveryEntries = [] } = data;
    const events = [];

    waterEntries.filter(w => w.date === date).forEach(w => {
      const min = minutesFromTimestamp(w.createdAt);
      events.push({ minuteOfDay: min, segment: segmentForMinute(min), type: 'water', icon: '\uD83D\uDCA7', label: `+${w.amountMl} ml water` });
    });

    workouts.filter(w => w.date === date).forEach(w => {
      const min = minutesFromTimestamp(w.createdAt);
      events.push({ minuteOfDay: min, segment: segmentForMinute(min), type: 'workout', icon: '\uD83C\uDFCB\uFE0F', label: w.name || 'Workout logged' });
    });

    recoveryEntries.filter(r => r.date === date).forEach(r => {
      const min = minutesFromTimestamp(r.createdAt);
      events.push({ minuteOfDay: min, segment: segmentForMinute(min), type: 'recovery', icon: '\u267B\uFE0F', label: 'Recovery check-in logged' });
    });

    const sleepToday = sleepEntries.find(s => s.date === date);
    if (sleepToday?.bedtime) {
      const min = minutesFromClock(sleepToday.bedtime);
      events.push({ minuteOfDay: min, segment: segmentForMinute(min), type: 'sleep', icon: '\uD83C\uDF19', label: 'Bedtime' });
    }
    if (sleepToday?.wakeTime) {
      const min = minutesFromClock(sleepToday.wakeTime);
      events.push({ minuteOfDay: min, segment: segmentForMinute(min), type: 'sleep', icon: '\uD83C\uDF19', label: `Woke up${sleepToday.hoursSlept != null ? ` \u2014 ${sleepToday.hoursSlept} h slept` : ''}` });
    }

    const stepsToday = stepEntries.find(s => s.date === date && s.steps != null);
    if (stepsToday) {
      const min = minutesFromTimestamp(stepsToday.createdAt);
      events.push({ minuteOfDay: min, segment: segmentForMinute(min), type: 'steps', icon: '\uD83D\uDC63', label: `${stepsToday.steps.toLocaleString()} steps logged` });
    }

    events.sort((a, b) => (a.minuteOfDay ?? 9999) - (b.minuteOfDay ?? 9999));
    return events;
  }

  /** Groups buildDailyTimeline's events into the 4 day segments, in
   *  display order, each only present if it actually has an event. */
  function groupTimelineBySegment(events) {
    return TIMELINE_SEGMENTS
      .map(seg => ({ key: seg.key, label: seg.label, events: events.filter(e => e.segment === seg.key) }))
      .filter(g => g.events.length);
  }

  return {
    CHECKLIST_DEFS,
    MEAL_TYPE_KEYS,
    sumWaterMl,
    sumSteps,
    computeDaySummary,
    computeChecklist,
    computeDailyScore,
    buildDailyTimeline,
    groupTimelineBySegment,
  };
})();
