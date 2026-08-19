/**
 * progress-engine.js
 * ---------------------------------------------------------------------------
 * Pure logic for the Progress module. Weight metrics (current/starting/
 * target/change/%/remaining/7-day average/weekly & 4-week trend) are NEVER
 * recomputed here — they come straight from Calculations.calculateAllTargets().
 * This module only adds what doesn't exist elsewhere: measurement
 * checkpoints/trends, and milestone evaluation.
 *
 * Every function here treats a single day's number as noise, not signal —
 * "Daily fluctuations are normal... use trends" applies throughout, and
 * milestone evaluation is worded so a person is never told they've failed.
 * ---------------------------------------------------------------------------
 */

const ProgressEngine = (() => {

  const MILESTONE_DISCLAIMER = 'These are guideline ranges, not guarantees. Bodies respond differently — being outside a range doesn\u2019t mean you\u2019re failing. Trends over weeks matter far more than any single check-in.';
  const FLUCTUATION_NOTE = 'Daily weight fluctuates with water, sodium, hormones, and digestion — a one-day increase is not a setback. Look at the weekly and 4-week trend, not any single entry.';

  const MEASUREMENT_FIELDS = [
    { key: 'waistCm', label: 'Waist', unit: 'cm' },
    { key: 'chestCm', label: 'Chest', unit: 'cm' },
    { key: 'hipCm', label: 'Hip', unit: 'cm' },
    { key: 'armCm', label: 'Arm', unit: 'cm' },
    { key: 'thighCm', label: 'Thigh', unit: 'cm' },
    { key: 'neckCm', label: 'Neck', unit: 'cm' },
  ];

  function round1(n) { return Math.round(n * 10) / 10; }

  /**
   * Suggested check-in days for a program of any duration, generalized
   * from the creator's own 60-day pattern (Day 1, 15, 30, 45, 60 — i.e.
   * day 1 then every quarter of the program). Purely a suggestion; any
   * date can still be logged freely ("allow custom dates").
   */
  function computeCheckpointDays(durationDays) {
    if (!durationDays || durationDays < 1) return [1];
    const days = [1, Math.round(durationDays * 0.25), Math.round(durationDays * 0.5), Math.round(durationDays * 0.75), durationDays];
    return [...new Set(days)].sort((a, b) => a - b);
  }

  function computeMeasurementCheckpoints(program) {
    if (!program || !program.startDate || !program.durationDays) return [];
    return computeCheckpointDays(program.durationDays).map(day => ({
      dayNumber: day,
      label: `Day ${day}`,
      date: ProgramTemplates.addDays(program.startDate, day - 1),
    }));
  }

  /** Sorted {date, value} series for one measurement field, values only
   *  where actually logged (never interpolated/invented). */
  function getMeasurementSeries(measurementEntries, fieldKey) {
    return measurementEntries
      .filter(e => e[fieldKey] != null)
      .map(e => ({ date: e.date, value: e[fieldKey] }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function computeMeasurementChange(measurementEntries, fieldKey) {
    const series = getMeasurementSeries(measurementEntries, fieldKey);
    if (series.length < 1) return { first: null, last: null, changeAbs: null, changePercent: null };
    const first = series[0].value;
    const last = series[series.length - 1].value;
    const changeAbs = series.length >= 2 ? round1(last - first) : null;
    const changePercent = (series.length >= 2 && first) ? round1(((last - first) / first) * 100) : null;
    return { first, last, changeAbs, changePercent, count: series.length };
  }

  /**
   * Evaluates logged weight against a milestone's guideline range using
   * the closest weight entry within +/-3 days of the milestone's date.
   * Status is deliberately neutral — 'within_range' / 'below_range' (lost
   * MORE than the range — not a bad thing) / 'above_range' / 'no_data'.
   * Never returns anything framed as pass/fail.
   */
  function evaluateMilestone(milestone, program, weightEntries) {
    if (!program || !program.startDate) return { status: 'no_data', closestEntry: null };
    const targetDate = ProgramTemplates.addDays(program.startDate, milestone.dayNumber - 1);
    const withDistance = weightEntries
      .filter(w => w.weightKg != null)
      .map(w => ({ ...w, distanceDays: Math.abs(dayDiff(w.date, targetDate)) }))
      .filter(w => w.distanceDays <= 3)
      .sort((a, b) => a.distanceDays - b.distanceDays);

    if (!withDistance.length) return { status: 'no_data', closestEntry: null, targetDate };

    const closest = withDistance[0];
    let status;
    if (milestone.weightMinKg == null && milestone.weightMaxKg == null) status = 'no_data';
    else if (closest.weightKg < milestone.weightMinKg) status = 'below_range';
    else if (closest.weightKg > milestone.weightMaxKg) status = 'above_range';
    else status = 'within_range';

    return { status, closestEntry: closest, targetDate };
  }

  function dayDiff(dateA, dateB) {
    const a = new Date(dateA + 'T00:00:00');
    const b = new Date(dateB + 'T00:00:00');
    return Math.round((a - b) / 86400000);
  }

  // -------------------------------------------------------------------
  // ADHERENCE STREAK — consecutive days (ending at endDate, working
  // backward) with a daily score at/above `threshold`. Same pattern as
  // WorkoutEngine.computeWorkoutStreak / the water page's hydration streak.
  // -------------------------------------------------------------------

  function computeAdherenceStreak(dailyData, endDate, threshold = 50) {
    let streak = 0;
    let d = endDate;
    let guard = 0;
    while (guard < 400) {
      const score = DailyTrackingEngine.computeDailyScore(d, dailyData, dailyData.checklistsByDate?.[d] || {});
      if (score.overall == null || score.overall < threshold) break;
      streak++;
      d = ProgramTemplates.addDays(d, -1);
      guard++;
    }
    return streak;
  }

  // -------------------------------------------------------------------
  // MEASUREMENT TREND — direction over the most recent entries (never
  // fewer than 2 data points; 'stable' means the recent change is small
  // relative to the value, not exactly zero).
  // -------------------------------------------------------------------

  function computeMeasurementTrend(measurementEntries, fieldKey, lookback = 3) {
    const series = getMeasurementSeries(measurementEntries, fieldKey);
    if (series.length < 2) return 'no_data';
    const recent = series.slice(-lookback);
    const delta = recent[recent.length - 1].value - recent[0].value;
    const magnitude = Math.abs(delta);
    if (magnitude < 0.3) return 'stable';
    return delta > 0 ? 'increasing' : 'decreasing';
  }

  // -------------------------------------------------------------------
  // WEIGHT CHART WINDOW — filters entries to a trailing N-day window
  // ending at `endDate` ('ALL' = no filtering). Pure date-range slicing,
  // never interpolates or invents a point.
  // -------------------------------------------------------------------

  function filterEntriesByWindow(entries, windowDays, endDate) {
    if (windowDays === 'ALL' || windowDays == null) return entries;
    const cutoff = ProgramTemplates.addDays(endDate, -(windowDays - 1));
    return entries.filter(e => e.date >= cutoff && e.date <= endDate);
  }

  // -------------------------------------------------------------------
  // HISTORY GRANULARITY — weekly/monthly weight averages, for the
  // History card's daily/weekly/monthly/program views. Only real logged
  // values are averaged; a week/month with nothing logged is omitted,
  // never shown as zero.
  // -------------------------------------------------------------------

  function isoWeekKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const target = new Date(d.valueOf());
    const dayNr = (d.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const weekNumber = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
  }

  function groupWeightBy(weightEntries, granularity) {
    const keyFn = granularity === 'monthly' ? (d => d.slice(0, 7)) : isoWeekKey;
    const groups = new Map();
    [...weightEntries].filter(w => w.weightKg != null).sort((a, b) => a.date.localeCompare(b.date)).forEach(w => {
      const key = keyFn(w.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w.weightKg);
    });
    return [...groups.entries()].map(([key, values]) => ({
      key, avgKg: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10, count: values.length,
    }));
  }

  /** Closest logged entry to `targetDate` within `maxDistanceDays`, by any
   *  numeric field — used to anchor a checkpoint (e.g. "Day 30") to real
   *  logged data without requiring an entry on that exact calendar date. */
  function findClosestValue(entries, targetDate, valueKey, maxDistanceDays = 3) {
    const withDistance = entries
      .filter(e => e[valueKey] != null)
      .map(e => ({ ...e, distanceDays: Math.abs(dayDiff(e.date, targetDate)) }))
      .filter(e => e.distanceDays <= maxDistanceDays)
      .sort((a, b) => a.distanceDays - b.distanceDays);
    return withDistance[0] || null;
  }

  /**
   * Anchors each of a program's checkpoint days to whatever real weight/
   * waist/photo data exists near it (never invented for a missing
   * checkpoint — a checkpoint with nothing logged nearby is simply
   * omitted from the result, not filled in with a guess).
   */
  function buildTransformationCheckpoints(checkpoints, weightEntries, measurementEntries, progressPhotos) {
    return checkpoints.map(cp => {
      const weightEntry = findClosestValue(weightEntries, cp.date, 'weightKg');
      const waistEntry = findClosestValue(measurementEntries, cp.date, 'waistCm');
      const hasPhoto = progressPhotos.some(p => p.date === cp.date);
      return {
        ...cp,
        weightKg: weightEntry ? weightEntry.weightKg : null,
        waistCm: waistEntry ? waistEntry.waistCm : null,
        hasPhoto,
      };
    }).filter(cp => cp.weightKg != null || cp.waistCm != null || cp.hasPhoto);
  }

  return {
    MILESTONE_DISCLAIMER,
    FLUCTUATION_NOTE,
    MEASUREMENT_FIELDS,
    computeCheckpointDays,
    computeMeasurementCheckpoints,
    getMeasurementSeries,
    computeMeasurementChange,
    evaluateMilestone,
    computeAdherenceStreak,
    computeMeasurementTrend,
    filterEntriesByWindow,
    groupWeightBy,
    findClosestValue,
    buildTransformationCheckpoints,
  };
})();
