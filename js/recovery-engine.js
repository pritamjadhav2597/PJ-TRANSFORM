/**
 * recovery-engine.js
 * ---------------------------------------------------------------------------
 * Pure logic for Sleep + Recovery weekly trends and the "repeatedly poor
 * recovery" nudge. No storage access — pages fetch entries and pass them in.
 *
 * The recommendation logic here is deliberately limited to general
 * wellness guidance (sleep, nutrition, recovery habits) and explicitly
 * never frames anything as a diagnosis — see NON_DIAGNOSTIC_NOTE, which
 * every page using this module surfaces alongside the recommendation.
 * ---------------------------------------------------------------------------
 */

const RecoveryEngine = (() => {

  const NON_DIAGNOSTIC_NOTE = 'This is general wellness guidance, not a medical diagnosis. If low recovery continues or you\u2019re concerned, consider talking to a healthcare professional.';

  function round1(n) { return Math.round(n * 10) / 10; }
  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

  function inLastNDays(entries, n, endDate = new Date()) {
    const end = new Date(endDate); end.setHours(0, 0, 0, 0);
    const start = new Date(end); start.setDate(start.getDate() - (n - 1));
    return entries.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date + 'T00:00:00');
      return d >= start && d <= end;
    });
  }

  function average(entries, field) {
    const vals = entries.map(e => e[field]).filter(isNum);
    if (!vals.length) return null;
    return round1(vals.reduce((s, v) => s + v, 0) / vals.length);
  }

  /** This-week average vs. prior-week average for one field (energy,
   *  stress, soreness, recovery, workout performance, or sleep hours). */
  function computeWeeklyTrend(entries, field, endDate = new Date()) {
    const thisWeek = inLastNDays(entries, 7, endDate);
    const priorWeekEnd = new Date(endDate); priorWeekEnd.setDate(priorWeekEnd.getDate() - 7);
    const priorWeek = inLastNDays(entries, 7, priorWeekEnd);

    const thisWeekAvg = average(thisWeek, field);
    const priorWeekAvg = average(priorWeek, field);
    const change = (isNum(thisWeekAvg) && isNum(priorWeekAvg)) ? round1(thisWeekAvg - priorWeekAvg) : null;

    return { thisWeekAvg, priorWeekAvg, change, loggedThisWeek: thisWeek.length };
  }

  /**
   * Flags a pattern (never a single bad day) of low recovery over the last
   * 7 days, and returns a general, non-diagnostic recommendation to
   * surface alongside NON_DIAGNOSTIC_NOTE. Threshold: recoveryScore <= 2
   * (on the 1-5 scale) on at least 3 of the last 7 logged days.
   */
  function detectPersistentPoorRecovery(recoveryEntries, endDate = new Date()) {
    const recent = inLastNDays(recoveryEntries, 7, endDate).filter(e => isNum(e.recoveryScore));
    const poorDays = recent.filter(e => e.recoveryScore <= 2);

    if (recent.length < 3 || poorDays.length < 3) {
      return { flagged: false, poorDayCount: poorDays.length, loggedDayCount: recent.length, message: null };
    }

    return {
      flagged: true,
      poorDayCount: poorDays.length,
      loggedDayCount: recent.length,
      message: `Recovery has been low on ${poorDays.length} of the last ${recent.length} logged days. Consider prioritizing sleep, nutrition, and recovery — easing training intensity or volume for a few days can help.`,
    };
  }

  /** Duration in hours between a bedtime and a wake time (both 'HH:MM'),
   *  assuming the wake time is the next calendar day when it's earlier
   *  than bedtime (the normal overnight case). Returns null if either is
   *  missing/malformed. */
  function computeSleepDurationHours(bedtime, wakeTime) {
    if (!bedtime || !wakeTime) return null;
    const [bh, bm] = bedtime.split(':').map(Number);
    const [wh, wm] = wakeTime.split(':').map(Number);
    if ([bh, bm, wh, wm].some(n => Number.isNaN(n))) return null;
    let minutes = (wh * 60 + wm) - (bh * 60 + bm);
    if (minutes <= 0) minutes += 24 * 60;
    return round1(minutes / 60);
  }

  return {
    NON_DIAGNOSTIC_NOTE,
    computeWeeklyTrend,
    detectPersistentPoorRecovery,
    computeSleepDurationHours,
  };
})();
