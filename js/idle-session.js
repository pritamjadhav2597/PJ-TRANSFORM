/**
 * idle-session.js — signs the person out after 30 minutes with no activity.
 *
 * This covers two situations with one mechanism: a timestamp of "last time
 * the person actually did something", written to localStorage (so it
 * survives closing the tab/app entirely):
 *
 *   1. Idle in an open tab — a periodic check notices too much time has
 *      passed since the last click/keypress/touch and signs out right away.
 *   2. Closed and reopened later — on the very next launch, before the app
 *      renders anything, we compare "now" against that stored timestamp.
 *      If more than 30 minutes have passed, we sign out immediately instead
 *      of silently resuming the old session.
 *
 * Deliberately NOT tied to Supabase's own token refresh/expiry — that's a
 * separate, longer-lived mechanism. This is specifically about the PERSON
 * being away, not about how long the underlying auth token happens to
 * remain valid for.
 */

const IdleSession = (() => {
  const IDLE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
  const STORAGE_KEY = 'pj_last_active_at';
  const WRITE_THROTTLE_MS = 5000; // don't hammer localStorage on every mousemove
  const CHECK_INTERVAL_MS = 30 * 1000; // how often the open-tab check runs

  let lastWriteAt = 0;
  let checkTimer = null;
  let onTimeoutCallback = null;

  function getLastActiveAt() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number(raw) : null;
    return Number.isFinite(parsed) ? parsed : null;
  }

  function touch() {
    const now = Date.now();
    if (now - lastWriteAt < WRITE_THROTTLE_MS) return;
    lastWriteAt = now;
    localStorage.setItem(STORAGE_KEY, String(now));
  }

  /** Call this once, right after confirming a session exists, before the
   *  rest of the app renders. Returns true if the person has been away
   *  longer than the idle limit and should be signed out instead of
   *  resumed. Does NOT sign out itself — the caller decides what to do,
   *  since the exact sign-out + redirect flow differs depending on where
   *  in the boot sequence this is checked. */
  function hasBeenIdleTooLong() {
    const lastActiveAt = getLastActiveAt();
    if (lastActiveAt == null) return false; // no record yet (e.g. first-ever sign-in) — not idle
    return (Date.now() - lastActiveAt) > IDLE_LIMIT_MS;
  }

  /** Starts watching for activity and periodically checking for idleness
   *  while the app is open. Call once, after the app has actually started
   *  (so a stale tab that was never touched doesn't immediately re-trigger
   *  a check before the person has done anything at all). */
  function start(onTimeout) {
    onTimeoutCallback = onTimeout;
    touch(); // mark "active" the moment the app actually starts

    ['click', 'keydown', 'touchstart', 'scroll', 'mousemove'].forEach(evt => {
      window.addEventListener(evt, touch, { passive: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Coming back to the tab counts as activity in its own right, AND
        // is the moment most likely to reveal a long absence — check
        // immediately rather than waiting for the next periodic tick.
        touch();
        checkNow();
      }
    });

    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(checkNow, CHECK_INTERVAL_MS);
  }

  function checkNow() {
    if (hasBeenIdleTooLong() && onTimeoutCallback) {
      stop();
      onTimeoutCallback();
    }
  }

  function stop() {
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = null;
  }

  /** Call on sign-out so the next sign-in starts with a clean slate rather
   *  than immediately looking "idle" from a leftover old timestamp. */
  function clear() {
    stop();
    localStorage.removeItem(STORAGE_KEY);
  }

  return { hasBeenIdleTooLong, start, stop, touch, clear };
})();
