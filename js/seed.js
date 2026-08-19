/**
 * seed.js
 * ---------------------------------------------------------------------------
 * First-run bootstrap. If no user exists yet on this device (fresh local
 * install, or a brand-new cloud account with nothing synced yet), creates
 * one blank user and makes it the active session. Everything else —
 * profile, program, meals, workouts, schedule — is set up by the person
 * themselves the first time they visit each page; nothing is pre-filled.
 * ---------------------------------------------------------------------------
 */

const Seed = (() => {

  async function ensureCurrentUser() {
    const users = await DataService.users.list();
    let user = users[0];

    if (!user) {
      user = await DataService.users.create(Models.createUser({ name: 'New User' }));
    }

    if (!DataService.getCurrentUserId()) {
      DataService.setCurrentUserId(user.userId);
    }

    return user;
  }

  return { ensureCurrentUser };
})();
