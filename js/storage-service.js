/**
 * storage-service.js
 * ---------------------------------------------------------------------------
 * DataService — the ONLY module allowed to talk to localStorage.
 *
 * Every other part of the app (pages, business logic, calculations) must go
 * through DataService.* methods. This is what lets Phase 2 swap the browser
 * storage engine for a real API/database with no changes to UI or business
 * logic — only StorageEngine below (and DataService's internals) get
 * replaced.
 *
 * Conceptual pipeline:
 *   UI  →  Application Logic  →  DataService  →  StorageEngine (swappable)
 *
 * Today StorageEngine = LocalStorageEngine. In Phase 2, an ApiStorageEngine
 * implementing the same three methods (getCollection/setCollection/clear)
 * would slot in behind DataService without touching a single page.
 * ---------------------------------------------------------------------------
 */

const DataService = (() => {

  const NAMESPACE = 'ptx';               // Personal Transformation app namespace
  const SCHEMA_VERSION = 1;
  const SESSION_KEY = `${NAMESPACE}:session`; // { currentUserId }

  // -------------------------------------------------------------------
  // Storage engine — swap this object out in Phase 2 for a real API.
  // Every method returns data synchronously today, but callers should
  // treat DataService methods as if they *could* be async (see the
  // Promise-wrapped public API further down) so the eventual swap to a
  // real network-backed engine doesn't force UI rewrites.
  // -------------------------------------------------------------------
  const LocalStorageEngine = {
    read(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.error('StorageEngine read failed', key, e);
        return null;
      }
    },
    write(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.error('StorageEngine write failed', key, e);
        return false;
      }
    },
    remove(key) {
      window.localStorage.removeItem(key);
    },
    isAvailable() {
      try {
        const testKey = `${NAMESPACE}:__test__`;
        window.localStorage.setItem(testKey, '1');
        window.localStorage.removeItem(testKey);
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  const engine = LocalStorageEngine; // <-- swap point for Phase 2

  function collectionKey(collectionName) {
    return `${NAMESPACE}:${collectionName}`;
  }

  function getCollection(collectionName) {
    return engine.read(collectionKey(collectionName)) || [];
  }

  function setCollection(collectionName, records) {
    const ok = engine.write(collectionKey(collectionName), records);
    // Fire-and-forget: if a SyncService is loaded and a user is signed in,
    // queue a debounced cloud push. Optional chaining keeps this file
    // working standalone (no sync configured) with zero changes.
    if (ok && typeof window !== 'undefined' && window.SyncService) {
      window.SyncService.schedulePush();
    }
    return ok;
  }

  // -------------------------------------------------------------------
  // Generic CRUD helpers, parameterized by collection name + PK field.
  // Concrete per-entity helpers below wrap these with the right names.
  // -------------------------------------------------------------------

  function insert(collectionName, record) {
    const records = getCollection(collectionName);
    records.push(record);
    setCollection(collectionName, records);
    return record;
  }

  function update(collectionName, pkField, id, patch) {
    const records = getCollection(collectionName);
    const idx = records.findIndex(r => r[pkField] === id);
    if (idx === -1) return null;
    records[idx] = { ...records[idx], ...patch, updatedAt: Models.nowIso() };
    setCollection(collectionName, records);
    return records[idx];
  }

  function remove(collectionName, pkField, id) {
    const records = getCollection(collectionName);
    const filtered = records.filter(r => r[pkField] !== id);
    setCollection(collectionName, filtered);
    return filtered.length !== records.length;
  }

  function findById(collectionName, pkField, id) {
    return getCollection(collectionName).find(r => r[pkField] === id) || null;
  }

  function findWhere(collectionName, predicate) {
    return getCollection(collectionName).filter(predicate);
  }

  // -------------------------------------------------------------------
  // Session (which user is "current" in the prototype's single browser)
  // -------------------------------------------------------------------

  function getCurrentUserId() {
    const session = engine.read(SESSION_KEY);
    return session ? session.currentUserId : null;
  }

  function setCurrentUserId(userId) {
    const existing = engine.read(SESSION_KEY) || {};
    engine.write(SESSION_KEY, { ...existing, currentUserId: userId });
  }

  /** Which Supabase auth account (session.user.id) the data currently
   *  sitting in local storage belongs to — null if this device has never
   *  signed in to a cloud account (local-only mode, or fresh install).
   *  Used on sign-in to detect "this is a different identity than what's
   *  stored locally" (a different account, or the same email re-signed-up
   *  after the old account was deleted — Supabase gives that a brand new
   *  id) so stale data doesn't leak across accounts on the same device.
   *  See js/app.js afterAuthenticated(). */
  function getLinkedAuthUserId() {
    const session = engine.read(SESSION_KEY);
    return session ? (session.authUserId || null) : null;
  }

  function setLinkedAuthUserId(authUserId) {
    const existing = engine.read(SESSION_KEY) || {};
    engine.write(SESSION_KEY, { ...existing, authUserId });
  }

  // -------------------------------------------------------------------
  // Entity-specific convenience API. All wrapped in Promise.resolve so
  // call sites already read as async — this is the seam Phase 2 needs.
  // -------------------------------------------------------------------

  const C = Models.COLLECTIONS;

  function makeEntityApi(collectionName, pkField) {
    return {
      list: (predicate) => Promise.resolve(
        predicate ? findWhere(collectionName, predicate) : getCollection(collectionName)
      ),
      get: (id) => Promise.resolve(findById(collectionName, pkField, id)),
      create: (record) => Promise.resolve(insert(collectionName, record)),
      update: (id, patch) => Promise.resolve(update(collectionName, pkField, id, patch)),
      delete: (id) => Promise.resolve(remove(collectionName, pkField, id)),
      count: (predicate) => Promise.resolve(
        (predicate ? findWhere(collectionName, predicate) : getCollection(collectionName)).length
      ),
    };
  }

  const api = {
    users: makeEntityApi(C.USERS, 'userId'),
    profiles: makeEntityApi(C.PROFILES, 'profileId'),
    programs: makeEntityApi(C.PROGRAMS, 'programId'),
    programPhases: makeEntityApi(C.PROGRAM_PHASES, 'phaseId'),
    dailyLogs: makeEntityApi(C.DAILY_LOGS, 'dailyLogId'),
    foods: makeEntityApi(C.FOODS, 'foodId'),
    foodProducts: makeEntityApi(C.FOOD_PRODUCTS, 'productId'),
    meals: makeEntityApi(C.MEALS, 'mealId'),
    mealItems: makeEntityApi(C.MEAL_ITEMS, 'mealItemId'),
    mealTemplates: makeEntityApi(C.MEAL_TEMPLATES, 'mealTemplateId'),
    nutritionEntries: makeEntityApi(C.NUTRITION_ENTRIES, 'nutritionEntryId'),
    waterEntries: makeEntityApi(C.WATER_ENTRIES, 'waterEntryId'),
    stepEntries: makeEntityApi(C.STEP_ENTRIES, 'stepEntryId'),
    workouts: makeEntityApi(C.WORKOUTS, 'workoutId'),
    workoutExercises: makeEntityApi(C.WORKOUT_EXERCISES, 'workoutExerciseId'),
    workoutSets: makeEntityApi(C.WORKOUT_SETS, 'workoutSetId'),
    weightEntries: makeEntityApi(C.WEIGHT_ENTRIES, 'weightEntryId'),
    measurementEntries: makeEntityApi(C.MEASUREMENT_ENTRIES, 'measurementEntryId'),
    progressPhotos: makeEntityApi(C.PROGRESS_PHOTOS, 'progressPhotoId'),
    sleepEntries: makeEntityApi(C.SLEEP_ENTRIES, 'sleepEntryId'),
    recoveryEntries: makeEntityApi(C.RECOVERY_ENTRIES, 'recoveryEntryId'),
    sexualWellbeingEntries: makeEntityApi(C.SEXUAL_WELLBEING_ENTRIES, 'sexualWellbeingEntryId'),
    shoppingLists: makeEntityApi(C.SHOPPING_LISTS, 'shoppingListId'),
    shoppingItems: makeEntityApi(C.SHOPPING_ITEMS, 'shoppingItemId'),
    targetHistory: makeEntityApi(C.TARGET_HISTORY, 'targetHistoryId'),
    reports: makeEntityApi(C.REPORTS, 'reportId'),
    scheduleItems: makeEntityApi(C.SCHEDULE_ITEMS, 'scheduleItemId'),
    dailyChecklists: makeEntityApi(C.DAILY_CHECKLISTS, 'dailyChecklistId'),
    workoutTemplates: makeEntityApi(C.WORKOUT_TEMPLATES, 'workoutTemplateId'),
    milestones: makeEntityApi(C.MILESTONES, 'milestoneId'),
    cravingEvents: makeEntityApi(C.CRAVING_EVENTS, 'cravingEventId'),
    mealCalendarPlans: makeEntityApi(C.MEAL_CALENDAR_PLANS, 'mealCalendarPlanId'),
    exerciseVideos: makeEntityApi(C.EXERCISE_VIDEOS, 'exerciseVideoId'),
  };

  // -------------------------------------------------------------------
  // Whole-store utilities: export / import / reset / dev inspection
  // -------------------------------------------------------------------

  function getAllCollectionsSnapshot() {
    const snapshot = {};
    Object.values(C).forEach(name => {
      snapshot[name] = getCollection(name);
    });
    return snapshot;
  }

  function exportData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Models.nowIso(),
      namespace: NAMESPACE,
      session: engine.read(SESSION_KEY) || null,
      data: getAllCollectionsSnapshot(),
    };
  }

  function importData(payload) {
    if (!payload || typeof payload !== 'object' || !payload.data) {
      throw new Error('Invalid import file: missing "data" object.');
    }
    Object.values(C).forEach(name => {
      const incoming = payload.data[name];
      if (Array.isArray(incoming)) {
        setCollection(name, incoming);
      }
    });
    if (payload.session && payload.session.currentUserId) {
      setCurrentUserId(payload.session.currentUserId);
    }
    return true;
  }

  function clearAll() {
    Object.values(C).forEach(name => engine.remove(collectionKey(name)));
    engine.remove(SESSION_KEY);
  }

  function getStorageStatus() {
    const available = engine.isAvailable();
    let bytesUsed = 0;
    try {
      Object.values(C).forEach(name => {
        const raw = window.localStorage.getItem(collectionKey(name));
        if (raw) bytesUsed += raw.length;
      });
    } catch (e) { /* ignore */ }
    return { available, bytesUsed, engine: 'localStorage' };
  }

  function getRecordCounts() {
    const counts = {};
    Object.entries(C).forEach(([key, name]) => {
      counts[name] = getCollection(name).length;
    });
    return counts;
  }

  return {
    ...api,
    getCurrentUserId,
    setCurrentUserId,
    getLinkedAuthUserId,
    setLinkedAuthUserId,
    exportData,
    importData,
    clearAll,
    getStorageStatus,
    getRecordCounts,
    // Escape hatches for seed/dev-mode scripts that need raw collection access:
    _getCollection: getCollection,
    _setCollection: setCollection,
  };
})();
