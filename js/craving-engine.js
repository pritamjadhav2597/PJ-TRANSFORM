/**
 * craving-engine.js
 * ---------------------------------------------------------------------------
 * Pure logic for Craving Control. No storage access -- pages fetch
 * CravingEvent records and pass them in.
 *
 * The protocol itself is fixed (water, wait, unsweetened tea/coffee, walk,
 * then a short list of foods if still hungry) -- this module never
 * substitutes or reorders it. Frequency detection only ever produces a
 * suggestion to review the diet, never a restrictive or shaming message.
 * ---------------------------------------------------------------------------
 */

const CravingEngine = (() => {

  const PROTOCOL_STEPS = [
    { key: 'water', label: 'Drink a glass of water', detail: 'Thirst is often mistaken for hunger.' },
    { key: 'waited', label: 'Wait 10\u201315 minutes', detail: 'Give the craving time to pass on its own.' },
    { key: 'tea_coffee', label: 'Have unsweetened tea or coffee', detail: 'No sugar, no cream.' },
    { key: 'walk', label: 'Take a 10-minute walk', detail: 'A short walk can shift focus away from the craving.' },
  ];

  const HUNGER_FOODS = [
    { key: 'curd', label: 'Curd' },
    { key: 'fruit', label: 'Fruit' },
    { key: 'cucumber', label: 'Cucumber' },
    { key: 'roasted_chana', label: 'Roasted Chana' },
  ];

  function countOnDate(events, date) {
    return events.filter(e => e.date === date).length;
  }

  function countInLastNDays(events, n, endDate = new Date()) {
    const end = new Date(endDate); end.setHours(0, 0, 0, 0);
    const start = new Date(end); start.setDate(start.getDate() - (n - 1));
    return events.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date + 'T00:00:00');
      return d >= start && d <= end;
    }).length;
  }

  /**
   * "If frequent hunger occurs, suggest reviewing the diet rather than
   * suppressing hunger." Flags on 3+ craving events in a single day, or
   * 7+ in the last 7 days -- either pattern suggests intake (calories,
   * protein, fibre, meal spacing) is worth a look, not more willpower.
   */
  function detectFrequentCravings(cravingEvents, today, endDate = new Date()) {
    const todayCount = countOnDate(cravingEvents, today);
    const weekCount = countInLastNDays(cravingEvents, 7, endDate);
    const flagged = todayCount >= 3 || weekCount >= 7;

    return {
      flagged, todayCount, weekCount,
      message: flagged
        ? "You've logged frequent cravings. If hunger keeps showing up like this, it's often more effective to review your diet — meal spacing, protein, and fibre — than to keep suppressing it each time."
        : null,
    };
  }

  return { PROTOCOL_STEPS, HUNGER_FOODS, detectFrequentCravings };
})();
