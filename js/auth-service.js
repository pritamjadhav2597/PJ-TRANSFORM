/**
 * auth-service.js
 * ---------------------------------------------------------------------------
 * Thin wrapper around Supabase Auth. Nothing else in the app talks to
 * supabaseClient.auth directly — this is the single seam, mirroring how
 * storage-service.js is the single seam for data.
 *
 * Note on password recovery: Supabase fires a 'PASSWORD_RECOVERY' auth event
 * the moment it finishes processing a "reset password" email link — this can
 * happen very early, during the client's own initialization, possibly before
 * the rest of the app has finished loading. So we subscribe immediately at
 * module load (as early as this file can possibly run) and buffer the first
 * event, replaying it to whoever calls onAuthStateChange later. This avoids
 * guessing at URL formats (Supabase has used both hash-token links and
 * ?code= links over time) — the event fires correctly either way.
 * ---------------------------------------------------------------------------
 */

const AuthService = (() => {

  let bufferedEvent = null;
  let bufferedSession = null;
  let liveListener = null;

  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (bufferedEvent === null) {
        bufferedEvent = event;
        bufferedSession = session;
      }
      if (liveListener) liveListener(event, session);
    });
  }

  function isConfigured() {
    return !!supabaseClient;
  }

  async function getSession() {
    if (!isConfigured()) return null;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) { console.error('getSession failed', error); return null; }
    return data.session;
  }

  async function signUp(email, password) {
    if (!isConfigured()) return { error: { message: 'Supabase is not configured yet.' } };
    return supabaseClient.auth.signUp({ email, password });
  }

  async function signIn(email, password) {
    if (!isConfigured()) return { error: { message: 'Supabase is not configured yet.' } };
    return supabaseClient.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    if (!isConfigured()) return;
    await supabaseClient.auth.signOut();
  }

  async function resetPasswordForEmail(email) {
    if (!isConfigured()) return { error: { message: 'Supabase is not configured yet.' } };
    return supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
  }

  async function updateUserPassword(newPassword) {
    if (!isConfigured()) return { error: { message: 'Supabase is not configured yet.' } };
    return supabaseClient.auth.updateUser({ password: newPassword });
  }

  /** Links a mobile number to the currently signed-in account's email, so
   *  a future sign-in can use the mobile number instead of typing the email
   *  (see resolveEmailByMobile below). Called from the Profile page
   *  whenever the mobile number field is saved. Silently no-ops if
   *  Supabase isn't configured or nobody is signed in — this is a
   *  convenience layer, not something the rest of the app depends on. */
  async function linkMobileNumber(mobileNumber) {
    if (!isConfigured()) return;
    const session = await getSession();
    if (!session?.user?.id) return;
    try {
      const { error } = await supabaseClient.rpc('link_mobile_number', { p_mobile: mobileNumber });
      if (error) throw error;
    } catch (err) {
      console.error('linkMobileNumber failed', err);
    }
  }

  /** Removes a previously-linked mobile number (e.g. the person cleared the
   *  field on their profile). Best-effort — a failure here just means an
   *  old number keeps resolving to this account, which isn't dangerous
   *  since sign-in still requires the correct password either way. */
  async function unlinkMobileNumber(mobileNumber) {
    if (!isConfigured() || !mobileNumber) return;
    const session = await getSession();
    if (!session?.user?.id) return;
    try {
      const { error } = await supabaseClient.rpc('unlink_mobile_number', { p_mobile: mobileNumber });
      if (error) throw error;
    } catch (err) {
      console.error('unlinkMobileNumber failed', err);
    }
  }

  /** Resolves a mobile number to its linked email via the get_email_by_mobile
   *  Postgres function (see supabase-setup-phone-lookup.sql) — returns null
   *  if there's no match. Used by the sign-in screen so someone can type
   *  their mobile number instead of their email. */
  async function resolveEmailByMobile(mobileNumber) {
    if (!isConfigured()) return null;
    try {
      const { data, error } = await supabaseClient.rpc('get_email_by_mobile', { p_mobile: mobileNumber });
      if (error) { console.error('resolveEmailByMobile failed', error); return null; }
      return data || null;
    } catch (err) {
      console.error('resolveEmailByMobile failed', err);
      return null;
    }
  }

  /** Register the app's single auth-event handler. If Supabase already fired
   *  an event before this was called (see module-load subscription above),
   *  replay it immediately so nothing gets missed. */
  function onAuthStateChange(callback) {
    if (!isConfigured()) return;
    liveListener = callback;
    if (bufferedEvent !== null) {
      callback(bufferedEvent, bufferedSession);
    }
  }

  return {
    isConfigured, getSession, signUp, signIn, signOut, resetPasswordForEmail, updateUserPassword,
    linkMobileNumber, unlinkMobileNumber, resolveEmailByMobile, onAuthStateChange,
  };
})();
