/**
 * app.js — bootstraps the app:
 *   1. Verifies local storage is available.
 *   2. If Supabase is configured, waits for its first auth event and reacts
 *      to it: PASSWORD_RECOVERY -> "set new password" screen, an existing
 *      session -> straight into the app, no session -> sign-in screen.
 *   3. From then on, a SIGNED_OUT event reloads back to the sign-in screen.
 *   4. Pulls the signed-in user's cloud data down, seeds a starter profile
 *      on first run, then starts the router.
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

  async function startApp() {
    await Seed.ensureCurrentUser();
    await Router.init();
  }

  async function afterAuthenticated(session) {
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

  if (AuthService.isConfigured()) {
    let initialDecisionMade = false;

    AuthService.onAuthStateChange((event, session) => {
      // A "reset your password" email link lands here and Supabase fires
      // this event once it's finished logging the person into a temporary
      // recovery session — regardless of which link format was used.
      if (event === 'PASSWORD_RECOVERY') {
        initialDecisionMade = true;
        AuthUI.renderSetNewPassword({
          onDone: async () => {
            // Clean any recovery tokens/params out of the URL so refreshing
            // afterwards doesn't try to replay this flow.
            history.replaceState(null, '', window.location.pathname);
            await afterAuthenticated(session);
          },
        });
        return;
      }

      if (event === 'SIGNED_OUT') {
        if (initialDecisionMade) window.location.reload();
        return;
      }

      // First "normal" event we see (typically INITIAL_SESSION) decides
      // whether to open straight into the app or show the sign-in screen.
      if (!initialDecisionMade) {
        initialDecisionMade = true;
        if (session) {
          afterAuthenticated(session);
        } else {
          AuthUI.render({ onAuthenticated: afterAuthenticated });
        }
      }
    });
  } else {
    // No Supabase config yet — behave like the original local-only prototype.
    AuthUI.render({ onAuthenticated: afterAuthenticated });
  }
})();
