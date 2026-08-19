/**
 * sync-service.js
 * ---------------------------------------------------------------------------
 * Syncs the whole local dataset (everything DataService.exportData() /
 * importData() knows about) to a single row in Supabase's `app_data` table,
 * one row per signed-in user (see supabase-setup.sql).
 *
 * Strategy: local-first. The app always reads/writes localStorage instantly
 * (via DataService), so it stays fast and works offline. This module just
 * keeps a cloud copy in sync in the background:
 *   - PULL once, right after login, to hydrate this device with the user's
 *     latest cloud data.
 *   - PUSH (debounced) after every local write, so the cloud stays current.
 * ---------------------------------------------------------------------------
 */

const SyncService = (() => {

  let currentAuthUserId = null;
  let pushTimer = null;
  let pushInFlight = false;
  let pushQueued = false;
  const PUSH_DEBOUNCE_MS = 2500;

  function setActiveUser(authUserId) {
    currentAuthUserId = authUserId;
  }

  function isActive() {
    return AuthService.isConfigured() && !!currentAuthUserId;
  }

  /** Pull the user's cloud snapshot down and replace local data with it.
   *  Called once right after sign-in, before the app renders anything. */
  async function pullFromCloud() {
    if (!isActive()) return false;
    const { data, error } = await supabaseClient
      .from('app_data')
      .select('data')
      .eq('user_id', currentAuthUserId)
      .maybeSingle();

    if (error) { console.error('Sync pull failed', error); return false; }
    if (!data || !data.data || Object.keys(data.data).length === 0) {
      // Nothing in the cloud yet for this account (brand-new signup).
      return false;
    }
    DataService.importData({ data: data.data });
    return true;
  }

  /** Push the current local snapshot up to the cloud. Debounced so rapid
   *  local writes (e.g. typing) collapse into one network call. */
  function schedulePush() {
    if (!isActive()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS);
  }

  async function pushNow() {
    if (!isActive()) return;
    if (pushInFlight) { pushQueued = true; return; }
    pushInFlight = true;
    try {
      const snapshot = DataService.exportData();
      const { error } = await supabaseClient
        .from('app_data')
        .upsert({ user_id: currentAuthUserId, data: snapshot.data }, { onConflict: 'user_id' });
      if (error) console.error('Sync push failed', error);
    } finally {
      pushInFlight = false;
      if (pushQueued) { pushQueued = false; pushNow(); }
    }
  }

  /** Flush any pending push immediately — call this on sign-out so the
   *  last few seconds of local changes aren't lost. */
  async function flush() {
    clearTimeout(pushTimer);
    await pushNow();
  }

  return { setActiveUser, isActive, pullFromCloud, schedulePush, pushNow, flush };
})();
