/**
 * router.js
 * ---------------------------------------------------------------------------
 * Minimal hash-based router + app shell. Each nav item maps to a page module
 * exposing a render(container) function. Keeping routing this simple (vs. a
 * framework) keeps the Phase 2 rewrite surface small: page modules are plain
 * functions that receive a DOM node and DataService — a future SPA framework
 * swap only touches this file, not the page modules themselves.
 * ---------------------------------------------------------------------------
 */

const Router = (() => {

  const NAV_ITEMS = [
    { path: 'dashboard', label: 'Dashboard', icon: '◆', page: () => PageDashboard, theme: 'transformation' },
    { path: 'diet', label: 'Diet', icon: '🍽', page: () => PageDiet, title: 'Diet & Nutrition', theme: 'nutrition' },
    { path: 'nutrition', label: 'Nutrition', icon: '🥗', page: () => PageNutrition, title: 'Food Entry', theme: 'nutrition' },
    { path: 'workout', label: 'Workout', icon: '🏋', page: () => PageWorkout, title: 'Workout' },
    { path: 'progress', label: 'Progress', icon: '📈', page: () => PageProgress, title: 'Progress', theme: 'progress' },
    { path: 'water', label: 'Water', icon: '💧', page: () => PageWater, title: 'Water', theme: 'hydration' },
    { path: 'steps', label: 'Steps', icon: '👣', page: () => PageSteps, title: 'Steps', theme: 'steps' },
    { path: 'sleep', label: 'Sleep', icon: '🌙', page: () => PageSleep, title: 'Sleep', theme: 'sleep' },
    { path: 'recovery', label: 'Recovery', icon: '🧘', page: () => PageRecovery, title: 'Recovery', theme: 'recovery' },
    { path: 'wellbeing', label: 'Sexual Wellbeing', icon: '❤', page: () => PageWellbeing, title: 'Sexual Wellbeing (Private)', theme: 'wellbeing' },
    { path: 'craving', label: 'Craving Control', icon: '🍫', page: () => PageCraving, title: 'Craving Control', theme: 'craving' },
    { path: 'products', label: 'Products', icon: '📦', page: () => PageProducts, title: 'Products', theme: 'nutrition' },
    { path: 'shopping', label: 'Shopping', icon: '🛒', page: () => PageShopping, title: 'Shopping', theme: 'nutrition' },
    { path: 'programs', label: 'Programs', icon: '📅', page: () => PagePrograms, theme: 'program' },
    { path: 'program-bollywood', label: '100-Day Body Program', icon: '🎬', page: () => PageProgramBollywood, title: '100 Day Body Program', theme: 'program' },
    { path: 'calendar', label: 'Calendar', icon: '🗓', page: () => PageCalendar, title: '60-Day Calendar', theme: 'program' },
    { path: 'meal-calendar', label: 'Meal Calendar', icon: '🍛', page: () => PageMealCalendar, title: '60-Day Transformation — Meal Calendar', theme: 'nutrition' },
    { path: 'reports', label: 'Reports', icon: '📊', page: () => PageReports, title: 'Reports & Analytics', theme: 'progress' },
    { path: 'profile', label: 'Profile', icon: '◍', page: () => PageProfile, theme: 'transformation' },
    { path: 'settings', label: 'Settings', icon: '⚙', page: () => PageSettings, title: 'Settings' },
  ];

  // Path currently being dragged in the sidebar, and the profile it belongs
  // to (loaded once per drag so drop handlers don't re-fetch on every
  // dragover). Cleared on dragend/drop.
  let draggedPath = null;
  let draggedProfile = null;

  function findRoute(path) {
    return NAV_ITEMS.find(item => item.path === path) || NAV_ITEMS[0];
  }

  /** The visible (non-hidden) nav items, arranged into any custom order the
   *  person saved (see pages/settings.js). Items in `navOrder` come first,
   *  in that order; anything not yet in a saved order (new nav items added
   *  after the person last customized it) falls back to the end, in the
   *  app's built-in default order — nothing is ever silently dropped. */
  function getOrderedNavItems(navOrder) {
    const visible = NAV_ITEMS.filter(i => !i.hiddenFromNav);
    if (!navOrder || !navOrder.length) return visible;
    const byPath = new Map(visible.map(i => [i.path, i]));
    const ordered = navOrder.map(path => byPath.get(path)).filter(Boolean);
    const orderedPaths = new Set(ordered.map(i => i.path));
    const remaining = visible.filter(i => !orderedPaths.has(i.path));
    return [...ordered, ...remaining];
  }

  async function loadNavOrder() {
    const userId = DataService.getCurrentUserId();
    if (!userId) return [];
    const profile = (await DataService.profiles.list(p => p.userId === userId))[0];
    return profile?.navOrder || [];
  }

  function currentPath() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const withoutQuery = hash.split('?')[0];
    return withoutQuery || 'dashboard';
  }

  /** Query params on the current hash route, e.g. '#/workout?program=abc'
   *  -> { program: 'abc' }. Lets a page module distinguish "entered
   *  generally" from "entered scoped to something specific" using the URL
   *  itself as the source of truth (survives refresh/back button, unlike
   *  module-level state). */
  function currentQuery() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const queryString = hash.split('?')[1] || '';
    return Object.fromEntries(new URLSearchParams(queryString));
  }

  function navigate(path) {
    window.location.hash = `/${path}`;
  }

  async function renderShell() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    // Persistent mobile-only top strip (hamburger + wordmark). The full
    // sidebar becomes an off-canvas drawer below 880px — see styles.css —
    // so something has to stay on-screen at all times to open it again.
    const mobileBar = Utils.el('div', { class: 'mobile-bar' }, [
      Utils.el('button', {
        class: 'mobile-bar__toggle', type: 'button', 'aria-label': 'Open navigation menu',
        onClick: () => openDrawer(),
      }, '\u2630'),
      Utils.el('div', { class: 'mobile-bar__brand' }, [
        Utils.el('span', { class: 'mobile-bar__brand-mark' }, '◐'),
        Utils.el('span', { class: 'mobile-bar__brand-text' }, 'Transform'),
      ]),
    ]);

    const backdrop = Utils.el('div', {
      class: 'sidebar-backdrop', id: 'sidebar-backdrop',
      onClick: () => closeDrawer(),
    });

    const sidebar = Utils.el('aside', { class: 'sidebar' }, [
      Utils.el('div', { class: 'sidebar__brand' }, [
        Utils.el('span', { class: 'sidebar__brand-mark' }, '◐'),
        Utils.el('div', { class: 'sidebar__brand-lockup' }, [
          Utils.el('span', { class: 'sidebar__brand-text' }, 'Transform'),
          Utils.el('span', { class: 'sidebar__brand-credit' }, 'a PJ creation'),
        ]),
        Utils.el('button', {
          class: 'sidebar__close', type: 'button', 'aria-label': 'Close navigation menu',
          onClick: () => closeDrawer(),
        }, '\u2715'),
      ]),
      Utils.el('nav', { class: 'sidebar__nav', id: 'sidebar-nav' }),
    ]);

    const main = Utils.el('div', { class: 'main' }, [
      Utils.el('header', { class: 'topbar', id: 'topbar' }),
      Utils.el('main', { class: 'page', id: 'page-outlet' }),
    ]);

    app.appendChild(mobileBar);
    app.appendChild(sidebar);
    app.appendChild(backdrop);
    app.appendChild(main);
    app.appendChild(Utils.el('div', { class: 'toast-host', id: 'toast-host' }));

    await renderSidebarNav();
  }

  /** Opens the mobile off-canvas drawer. No-op (harmless) on desktop,
   *  where .sidebar is never translated off-screen in the first place. */
  function openDrawer() {
    document.querySelector('.sidebar')?.classList.add('sidebar--open');
    document.getElementById('sidebar-backdrop')?.classList.add('sidebar-backdrop--visible');
    document.body.classList.add('drawer-open');
  }

  function closeDrawer() {
    document.querySelector('.sidebar')?.classList.remove('sidebar--open');
    document.getElementById('sidebar-backdrop')?.classList.remove('sidebar-backdrop--visible');
    document.body.classList.remove('drawer-open');
  }

  async function renderSidebarNav() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;
    nav.innerHTML = '';
    const active = currentPath();
    const navOrder = await loadNavOrder();
    const isCustomized = !!(navOrder && navOrder.length);

    getOrderedNavItems(navOrder).forEach(item => {
      const link = Utils.el('a', {
        href: `#/${item.path}`,
        class: `sidebar__link${item.path === active ? ' sidebar__link--active' : ''}`,
        draggable: 'true',
        'data-path': item.path,
        onDragstart: async (e) => {
          draggedPath = item.path;
          const userId = DataService.getCurrentUserId();
          draggedProfile = userId ? (await DataService.profiles.list(p => p.userId === userId))[0] : null;
          link.classList.add('sidebar__link--dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', item.path); } catch (err) { /* Safari needs the call even if unused */ }
        },
        onDragend: () => {
          link.classList.remove('sidebar__link--dragging');
          clearDropMarkers(nav);
          draggedPath = null;
          draggedProfile = null;
        },
        onDragover: (e) => {
          if (!draggedPath || draggedPath === item.path) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          clearDropMarkers(nav);
          link.classList.add(isBeforeTarget(nav, link, e) ? 'sidebar__link--drop-before' : 'sidebar__link--drop-after');
        },
        onDrop: async (e) => {
          e.preventDefault();
          const before = isBeforeTarget(nav, link, e);
          clearDropMarkers(nav);
          if (!draggedPath || draggedPath === item.path || !draggedProfile) { draggedPath = null; draggedProfile = null; return; }
          await reorderNav(draggedProfile, draggedPath, item.path, before);
          draggedPath = null;
          draggedProfile = null;
        },
        onClick: () => closeDrawer(),
      }, [
        Utils.el('span', { class: 'sidebar__drag-handle', title: 'Drag to reorder' }, '\u22ee\u22ee'),
        Utils.el('span', { class: 'sidebar__icon' }, item.icon),
        Utils.el('span', { class: 'sidebar__label' }, item.label),
      ]);
      nav.appendChild(link);
    });

    if (isCustomized) {
      nav.appendChild(Utils.el('button', {
        class: 'sidebar__reset-order',
        type: 'button',
        title: 'Reset navigation to default order',
        onClick: async () => {
          const userId = DataService.getCurrentUserId();
          const profile = userId ? (await DataService.profiles.list(p => p.userId === userId))[0] : null;
          if (!profile) return;
          await DataService.profiles.update(profile.profileId, { navOrder: [] });
          await renderSidebarNav();
          Utils.toast('Navigation reset to default order.', 'success');
        },
      }, '\u21bb Reset order'));
    }
  }

  function clearDropMarkers(nav) {
    nav.querySelectorAll('.sidebar__link--drop-before, .sidebar__link--drop-after')
      .forEach(el => el.classList.remove('sidebar__link--drop-before', 'sidebar__link--drop-after'));
  }

  /** Whether the dragged item should land before (vs. after) `link`, based on
   *  pointer position along whichever axis the sidebar is currently laid out
   *  on (vertical list on desktop, horizontal strip on narrow screens). */
  function isBeforeTarget(nav, link, e) {
    const rect = link.getBoundingClientRect();
    const isRow = getComputedStyle(nav).flexDirection === 'row';
    return isRow ? (e.clientX - rect.left) < rect.width / 2 : (e.clientY - rect.top) < rect.height / 2;
  }

  async function reorderNav(profile, draggedItemPath, targetPath, before) {
    const paths = getOrderedNavItems(profile.navOrder || []).map(i => i.path);
    const fromIdx = paths.indexOf(draggedItemPath);
    if (fromIdx === -1) return;
    paths.splice(fromIdx, 1);
    let toIdx = paths.indexOf(targetPath);
    if (toIdx === -1) return;
    if (!before) toIdx += 1;
    paths.splice(toIdx, 0, draggedItemPath);
    await DataService.profiles.update(profile.profileId, { navOrder: paths });
    await renderSidebarNav();
  }

  async function renderTopbar(route) {
    const topbar = document.getElementById('topbar');
    topbar.innerHTML = '';
    // Reset any page-specific theme class from the previous route, then
    // apply this route's own. Workout keeps its existing dedicated
    // photo-backed treatment (topbar--workout); every other page uses the
    // generic gradient theme system (topbar--{theme}) — see styles.css.
    topbar.className = 'topbar';
    if (route.path === 'workout') topbar.classList.add('topbar--workout');
    else if (route.theme) topbar.classList.add(`topbar--${route.theme}`);

    const userId = DataService.getCurrentUserId();
    const profile = userId ? (await DataService.profiles.list(p => p.userId === userId))[0] : null;

    document.title = profile?.name ? `${profile.name}'s Transformation` : 'Personal Transformation';

    topbar.appendChild(Utils.el('div', { class: 'topbar__title-block' }, [
      Utils.el('h1', { class: 'topbar__title' }, route.title || route.label),
      Utils.el('p', { class: 'topbar__subtitle' }, todaySubtitle()),
    ]));

    const signOutBtn = Utils.el('button', {
      class: 'topbar__signout', type: 'button', title: 'Sign out',
      onClick: async () => {
        if (typeof AuthService === 'undefined' || !AuthService.isConfigured()) return;
        await SyncService.flush();
        await AuthService.signOut();
        window.location.reload();
      },
    }, 'Sign out');

    topbar.appendChild(Utils.el('div', { class: 'topbar__user' }, [
      Utils.el('div', { class: 'topbar__user-name' }, profile?.name || 'No profile yet'),
      Utils.el('div', { class: 'topbar__user-meta' },
        profile ? 'Your account' : 'Set up your profile'),
      (typeof AuthService !== 'undefined' && AuthService.isConfigured()) ? signOutBtn : null,
    ]));
  }

  function todaySubtitle() {
    const d = new Date();
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Paths reachable even with an incomplete profile — just the profile
  // page itself, so onboarding can be finished. Signing out no longer
  // requires a dedicated page — see the topbar's Sign out button above.
  const ONBOARDING_EXEMPT_PATHS = new Set(['profile']);

  async function renderPage() {
    const path = currentPath();
    const route = findRoute(path);

    // Onboarding gate — runs before anything else renders. A brand-new
    // account (blank profile) or one still missing required fields gets
    // redirected to the Profile page; nothing else in the app can produce
    // real numbers (calorie targets, workout plans, etc.) without them.
    if (!ONBOARDING_EXEMPT_PATHS.has(path)) {
      const userId = DataService.getCurrentUserId();
      const profile = userId ? (await DataService.profiles.list(p => p.userId === userId))[0] : null;
      if (typeof PageProfile !== 'undefined' && !PageProfile.isComplete(profile)) {
        if (typeof Utils !== 'undefined') {
          Utils.toast('Please complete your profile to unlock the rest of the app.', 'info');
        }
        navigate('profile');
        return;
      }
    }

    await renderSidebarNav();
    await renderTopbar(route);

    const outlet = document.getElementById('page-outlet');
    outlet.innerHTML = '';
    outlet.className = 'page'; // reset any page-specific decoration classes (e.g. page--workout) from the previous route
    if (route.path === 'workout') outlet.classList.add('page--workout');
    else if (route.theme) outlet.classList.add(`page--${route.theme}`);
    outlet.classList.add('page--loading');

    const pageModule = route.page();
    try {
      await pageModule.render(outlet, route);
    } catch (err) {
      console.error('Page render failed', err);
      outlet.innerHTML = '';
      outlet.appendChild(Utils.el('div', { class: 'card card--error' }, [
        Utils.el('h3', {}, 'Something went wrong loading this page.'),
        Utils.el('p', {}, String(err.message || err)),
      ]));
    } finally {
      outlet.classList.remove('page--loading');
    }
  }

  async function init() {
    await renderShell();
    window.addEventListener('hashchange', () => { closeDrawer(); renderPage(); });
    await renderPage();
  }

  return { init, navigate, currentQuery, getOrderedNavItems, refreshNav: renderSidebarNav, NAV_ITEMS };
})();
