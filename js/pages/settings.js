/**
 * pages/settings.js -- navigation order now lives directly on the sidebar
 * (drag items by their handle to reorder; the order is stored on the
 * profile's `navOrder` field and applied by Router.getOrderedNavItems).
 * This page just points people there and offers a reset, for anyone who
 * lands here directly instead of dragging in the sidebar.
 */

const PageSettings = (() => {

  async function render(container) {
    await renderInner(container);
  }

  async function renderInner(container) {
    container.innerHTML = '';

    let userId = DataService.getCurrentUserId();
    if (!userId) {
      const user = await DataService.users.create(Models.createUser({ name: 'New User' }));
      userId = user.userId;
      DataService.setCurrentUserId(userId);
    }

    const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
    container.appendChild(renderNavOrderCard(profile, container));
    container.appendChild(await renderAccountCard());
  }

  async function renderAccountCard() {
    if (!AuthService.isConfigured()) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Account')),
        Utils.el('p', { class: 'card__subtitle' }, 'Cloud sync isn\u2019t configured. Data is stored on this device only.'),
      ]);
    }

    const session = await AuthService.getSession();
    const email = session?.user?.email || 'Signed in';

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Account'),
          Utils.el('p', { class: 'card__subtitle' }, `Signed in as ${email}. Your data syncs automatically across devices.`),
        ]),
      ]),
      Utils.el('button', {
        class: 'btn btn--danger', type: 'button',
        onClick: async () => {
          await SyncService.flush();
          await AuthService.signOut();
          window.location.reload();
        },
      }, 'Sign out'),
    ]);
  }

  function renderNavOrderCard(profile, container) {
    if (!profile) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Navigation')),
        Utils.el('div', { class: 'card__empty-state' }, [
          Utils.el('p', {}, 'Set up your profile first.'),
          Utils.el('a', { class: 'btn btn--secondary', href: '#/profile' }, 'Go to Profile'),
        ]),
      ]);
    }

    const isCustomized = !!(profile.navOrder && profile.navOrder.length);

    const resetBtn = Utils.el('button', {
      class: `btn btn--secondary${isCustomized ? '' : ' btn--disabled'}`, type: 'button',
      onClick: async () => {
        if (!isCustomized) return;
        await DataService.profiles.update(profile.profileId, { navOrder: [] });
        await Router.refreshNav();
        Utils.toast('Navigation reset to default order.', 'success');
        await renderInner(container);
      },
    }, 'Reset to Default Order');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Navigation'),
          Utils.el('p', { class: 'card__subtitle' }, 'Grab a page by the \u22ee\u22ee handle in the sidebar and drag it up or down to match how you actually use the app — it saves as you drop.'),
        ]),
        resetBtn,
      ]),
    ]);
  }

  return { render };
})();
