// Service worker for Personal Transformation PWA
// Bump this version any time app files change, to force cache refresh.
const CACHE_VERSION = 'v14';
const CACHE_NAME = `transform-app-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.json",
  "css/styles.css",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
  "js/app.js",
  "js/supabase-config.js",
  "js/auth-service.js",
  "js/sync-service.js",
  "js/auth-ui.js",
  "js/welcome-intro.js",
  "js/step-counter.js",
  "js/bollywood-program-data.js",
  "js/bollywood-setup.js",
  "js/calculations.js",
  "js/chart-utils.js",
  "js/craving-engine.js",
  "js/daily-tracking-engine.js",
  "js/device-integration.js",
  "js/diet-engine.js",
  "js/exercise-library.js",
  "js/exercise-video.js",
  "js/video-modal.js",
  "js/food-calculations.js",
  "js/food-database.js",
  "js/meal-calendar-data.js",
  "js/models.js",
  "js/pages/calendar.js",
  "js/pages/craving.js",
  "js/pages/dashboard.js",
  "js/pages/diet.js",
  "js/pages/meal-calendar.js",
  "js/pages/nutrition.js",
  "js/pages/placeholder.js",
  "js/pages/products.js",
  "js/pages/profile.js",
  "js/pages/program-bollywood.js",
  "js/pages/programs.js",
  "js/pages/progress.js",
  "js/pages/recovery.js",
  "js/pages/reports.js",
  "js/pages/settings.js",
  "js/pages/shopping.js",
  "js/pages/sleep.js",
  "js/pages/steps.js",
  "js/pages/water.js",
  "js/pages/wellbeing.js",
  "js/pages/workout.js",
  "js/program-templates.js",
  "js/progress-engine.js",
  "js/recovery-engine.js",
  "js/reports-engine.js",
  "js/router.js",
  "js/seed.js",
  "js/shopping-engine.js",
  "js/storage-service.js",
  "js/ui-fx.js",
  "js/utils.js",
  "js/workout-actions.js",
  "js/workout-engine.js",
  "js/workout-session.js"
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - Same-origin app files: cache-first, falling back to network, then updating cache.
// - Google Fonts / cross-origin: stale-while-revalidate.
// - Navigation requests: network-first with cache fallback (so a rebuild is picked up
//   when online, but the app still opens when offline).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('index.html')))
    );
    return;
  }

  if (isSameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        });
      })
    );
  } else {
    // Cross-origin (e.g. Google Fonts): stale-while-revalidate.
    // Skip anything that isn't a normal http(s) request — browser extensions
    // sometimes trigger fetches with schemes like chrome-extension://, which
    // the Cache API can't store and would otherwise throw on.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return;
    }
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
