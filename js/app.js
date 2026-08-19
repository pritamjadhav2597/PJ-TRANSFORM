/**
 * app.js — bootstraps the app.
 *
 * IMPORTANT: this app's own router (router.js) uses the URL hash for its
 * own page routing (#/dashboard, #/settings, ...). Supabase ALSO uses the
 * URL hash to deliver session info when someone lands here via an email
 * link (#access_token=...&type=recovery, or &type=signup, etc). These two
 * systems would collide if we relied on timing/events to sort it out — so
 * instead we read the hash ourselves, synchronously, as the very first
 * thing that runs, before the router (or anything async) ever touches it.
 *
 * Flow:
 *   1. Verify local storage is available.
 *   2. If the URL hash says we just arrived from an email link
 *      (type=recovery / type=signup / ...error), handle that case
 *      explicitly and stop — never fall through to the normal app.
 *   3. Otherwise, check for an existing session and show either the app or
 *      the sign-in screen.
 *   4. Pull the signed-in user's cloud data down, seed a starter profile on
 *      first run, then start the router.
 */

(async function bootstrap() {
  const status = DataService.getStorageStatus();
  if (!status.available) {
    document.getElementById('app').innerHTML = `
      <div class="boot-error">
        <h1>Local storage is unavailable</h1>
        <p>This app needs browser storage to run (private/incognito mode or
        disabled storage can block it). Enable storage and reload the page.</p>
      </div>`;
    return;
  }

  let appHasStarted = false;

  async function startApp() {
    await Seed.ensureCurrentUser();
    await WelcomeIntro.showIfNeeded();
    await Router.init();
  }

  async function afterAuthenticated(session) {
    appHasStarted = true;
    if (session && session.user) {
      SyncService.setActiveUser(session.user.id);
      await SyncService.pullFromCloud(); // hydrate this device from the cloud, if there's anything there
    }
    await startApp();

    // Push any local changes before the tab closes / app backgrounds, so a
    // quick edit right before closing isn't lost.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') SyncService.flush();
    });
    window.addEventListener('pagehide', () => SyncService.flush());
  }

  /** Reads Supabase's auth params straight off the URL hash — this is the
   *  exact format its /auth/v1/verify redirect uses:
   *  #access_token=...&refresh_token=...&type=recovery (or signup, etc)
   *  A normal in-app route hash looks like "#/dashboard" and is left alone. */
  function parseAuthHashParams() {
    const hash = window.location.hash || '';
    if (!hash || hash === '#' || hash.startsWith('#/')) return {};
    return Object.fromEntries(new URLSearchParams(hash.replace(/^#/, '')));
  }

  function clearAuthParamsFromUrl() {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  if (!AuthService.isConfigured()) {
    // No Supabase config yet — behave like the original local-only prototype.
    AuthUI.render({ onAuthenticated: afterAuthenticated });
    return;
  }

  // Watch for sign-outs (including ones triggered from another tab) once the
  // app has actually started, and drop back to a clean sign-in screen.
  AuthService.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && appHasStarted) {
      window.location.reload();
    }
  });

  const hashParams = parseAuthHashParams();
  const authType = hashParams.type || null;
  const authError = hashParams.error || hashParams.error_code || null;

  if (authError) {
    clearAuthParamsFromUrl();
    const description = hashParams.error_description
      ? decodeURIComponent(hashParams.error_description.replace(/\+/g, ' '))
      : 'That link is invalid or has expired. Please try again.';
    AuthUI.render({ onAuthenticated: afterAuthenticated, initialNotice: description });
    return;
  }

  if (authType === 'recovery') {
    // Supabase has already logged the person into a temporary recovery
    // session by this point — read it, then force the "set a new password"
    // screen before anything else can happen.
    const recoverySession = await AuthService.getSession();
    clearAuthParamsFromUrl();
    AuthUI.renderSetNewPassword({
      onDone: async () => { await afterAuthenticated(recoverySession); },
    });
    return;
  }

  if (authType === 'signup' || authType === 'email_change' || authType === 'invite' || authType === 'magiclink') {
    // Supabase auto-logs the person in here too, but we deliberately sign
    // them back out and ask them to log in explicitly, rather than silently
    // dropping them into the app straight from an email link.
    await AuthService.signOut();
    clearAuthParamsFromUrl();
    AuthUI.render({
      onAuthenticated: afterAuthenticated,
      initialNotice: 'Email confirmed! Please sign in to continue.',
    });
    return;
  }

  // Normal case: no special email-link params — just check for an existing session.
  const existingSession = await AuthService.getSession();
  if (existingSession) {
    await afterAuthenticated(existingSession);
  } else {
    AuthUI.render({ onAuthenticated: afterAuthenticated });
  }
})();
