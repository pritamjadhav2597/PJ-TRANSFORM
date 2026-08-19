/**
 * pages/placeholder.js — functional placeholder for modules arriving in
 * later prompts. Deliberately shows no fabricated data.
 */

const PagePlaceholder = (() => {

  async function render(container, route) {
    container.appendChild(Utils.el('section', { class: 'card card--placeholder' }, [
      Utils.el('div', { class: 'placeholder__icon' }, route.icon || '◌'),
      Utils.el('h2', { class: 'card__title' }, route.title || route.label),
      Utils.el('p', { class: 'card__subtitle' }, 'No data entered'),
      Utils.el('p', { class: 'placeholder__note' },
        `Full functionality for ${route.title || route.label} arrives in ${route.promptNote || 'a later prompt'}. ` +
        'The data model, storage layer, and navigation slot for this module already exist — only the UI and workflows remain.'),
      Utils.el('a', { class: 'btn btn--secondary', href: '#/dashboard' }, 'Back to Dashboard'),
    ]));
  }

  return { render };
})();
