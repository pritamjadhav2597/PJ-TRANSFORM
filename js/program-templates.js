/**
 * program-templates.js
 * ---------------------------------------------------------------------------
 * Static reference data for the Program System: the three top-level program
 * options, the custom-duration choices, and the default 1-Year phase
 * structure. Pure data + pure date-math helpers only — no storage access.
 * ---------------------------------------------------------------------------
 */

const ProgramTemplates = (() => {

  const PROGRAM_TYPES = [
    {
      value: '60_day',
      label: '60-Day Transformation',
      blurb: 'A focused two-month block with a single fixed duration.',
      durationDays: 60,
      hasMealCalendar: true, // unlocks the 60-Day Meal Calendar page (see meal-calendar-data.js)
    },
    {
      value: '1_year',
      label: '1-Year Transformation',
      blurb: 'A full year broken into five editable phases.',
      durationDays: 365,
    },
    {
      value: '100_day_bollywood',
      label: '100 Day Body Program',
      blurb: 'Five phases — Foundation, Base Building, Muscle Building, Shredding, Peak Week — over 100 fixed days.',
      durationDays: 100,
      hasPhaseLanding: true, // unlocks the dedicated Program Landing/Introduction page (see pages/program-bollywood.js)
    },
    {
      value: 'custom',
      label: 'Custom Program',
      blurb: 'Pick a duration — 30, 60, 90, 180, 365 days, or your own.',
      durationDays: null,
    },
  ];

  const CUSTOM_DURATION_OPTIONS = [30, 60, 90, 180, 365];

  /** Default 1-Year phase structure. Days are relative to the program start
   *  date using 30-day months so the five phases sum cleanly to 365 days. */
  const DEFAULT_1YEAR_PHASES = [
    { order: 1, name: 'Phase 1 — Fat Loss + Habits', monthLabel: 'Months 1–2', startDay: 1, endDay: 60, goalType: 'fat_loss' },
    { order: 2, name: 'Phase 2 — Fat Loss + Strength', monthLabel: 'Months 3–4', startDay: 61, endDay: 120, goalType: 'fat_loss' },
    { order: 3, name: 'Phase 3 — Reassessment + Maintenance/Recomposition', monthLabel: 'Months 5–6', startDay: 121, endDay: 180, goalType: 'body_recomposition' },
    { order: 4, name: 'Phase 4 — Strength + Recomposition', monthLabel: 'Months 7–9', startDay: 181, endDay: 270, goalType: 'body_recomposition' },
    { order: 5, name: 'Phase 5 — Long-Term Physique/Maintenance', monthLabel: 'Months 10–12', startDay: 271, endDay: 365, goalType: 'maintenance' },
  ];

  function addDays(isoDate, days) {
    const d = new Date(isoDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** Builds the 5 default phase *records* (unsaved) for a 1-Year program starting on startDate. */
  function buildDefaultYearPhases(programId, startDate) {
    return DEFAULT_1YEAR_PHASES.map(tpl => Models.createProgramPhase(programId, {
      order: tpl.order,
      name: tpl.name,
      notes: tpl.monthLabel,
      startDate: addDays(startDate, tpl.startDay - 1),
      endDate: addDays(startDate, tpl.endDay - 1),
      goalType: tpl.goalType,
    }));
  }

  function findTypeMeta(value) {
    return PROGRAM_TYPES.find(t => t.value === value) || null;
  }

  return {
    PROGRAM_TYPES,
    CUSTOM_DURATION_OPTIONS,
    DEFAULT_1YEAR_PHASES,
    buildDefaultYearPhases,
    findTypeMeta,
    addDays,
  };
})();
