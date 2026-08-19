/**
 * pages/shopping.js -- Shopping. "Generate"/"Regenerate" always recomputes
 * from the person's current Meal Templates via
 * ShoppingEngine.generateAggregatedItems (pure) -- there is no separate
 * stored total to fall out of sync, so quantities always reflect whatever
 * the meal templates currently say. Manually added items are never
 * touched by regenerate.
 */

const PageShopping = (() => {

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

    let list = (await DataService.shoppingLists.list(l => l.userId === userId))[0] || null;
    if (!list) list = await DataService.shoppingLists.create(Models.createShoppingList(userId));

    const items = await DataService.shoppingItems.list(i => i.shoppingListId === list.shoppingListId);
    const templates = await DataService.mealTemplates.list(t => t.userId === userId);

    container.appendChild(renderShoppingHero(items));
    container.appendChild(renderHeaderCard(userId, list, templates, items, container));
    container.appendChild(renderAddItemCard(list, container));
    container.appendChild(renderListCard(list, items, container));

    UIFx.animateIn(container);
  }

  function renderShoppingHero(items) {
    const purchased = items.filter(i => i.purchased).length;
    const pct = items.length ? Math.round((purchased / items.length) * 100) : 0;

    const hero = UIFx.hero({
      theme: 'nutrition',
      icon: '\uD83D\uDED2',
      eyebrow: 'Shopping',
      title: 'Grocery List',
      subtitle: items.length
        ? `${purchased} of ${items.length} items checked off.`
        : 'Generate a list from your saved Meal Templates to get started.',
      stats: [],
    });
    hero.classList.add('card--hero--compact');
    hero.querySelector('.hero__inner').appendChild(
      UIFx.ringNode({ pct, number: `${purchased}`, of: `of ${items.length}`, size: 110, stroke: 9 })
    );
    return hero;
  }

  function renderHeaderCard(userId, list, templates, items, container) {
    const regenBtn = Utils.el('button', {
      class: `btn btn--primary${templates.length ? '' : ' btn--disabled'}`, type: 'button',
      title: templates.length ? '' : 'Save a Meal Template on the Diet page first.',
      onClick: async () => {
        if (!templates.length) { Utils.toast('No meal templates yet — build one on the Diet page first.', 'error'); return; }
        const generated = ShoppingEngine.generateAggregatedItems(templates);
        const oldAuto = items.filter(i => i.sourceGenerated);
        for (const old of oldAuto) await DataService.shoppingItems.delete(old.shoppingItemId);
        for (const g of generated) {
          await DataService.shoppingItems.create(Models.createShoppingItem(list.shoppingListId, {
            name: g.name, brand: g.brand, category: g.category, quantity: g.quantity, unit: g.unit,
            sourceGenerated: true, purchased: false,
            notes: g.templateNames.length ? `From: ${g.templateNames.join(', ')}` : '',
          }));
        }
        await DataService.shoppingLists.update(list.shoppingListId, { lastGeneratedAt: Models.nowIso() });
        Utils.toast(`Generated ${generated.length} item${generated.length === 1 ? '' : 's'} from your meals.`, 'success');
        await renderInner(container);
      },
    }, items.some(i => i.sourceGenerated) ? 'Regenerate from Meals' : 'Generate from Meals');

    const exportBtn = Utils.el('button', {
      class: `btn btn--secondary${items.length ? '' : ' btn--disabled'}`, type: 'button',
      onClick: () => { if (items.length) exportList(list, items); else Utils.toast('Nothing to export yet.', 'error'); },
    }, 'Export');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, list.name || 'Shopping List'),
          Utils.el('p', { class: 'card__subtitle' }, list.lastGeneratedAt ? `Last generated ${Utils.formatDateTime(list.lastGeneratedAt)}` : 'Generate a list from your saved Meal Templates.'),
        ]),
        Utils.el('div', { class: 'row-actions' }, [regenBtn, exportBtn]),
      ]),
    ]);
  }

  function exportList(list, items) {
    const text = ShoppingEngine.buildExportText(items, list.name || 'Shopping List');
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      console.log(text);
      Utils.toast("Export ready — see console (download isn't supported in this environment).", 'info');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(list.name || 'shopping-list').replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Utils.toast('Shopping list exported.', 'success');
  }

  function renderAddItemCard(list, container) {
    const nameInput = Utils.el('input', { class: 'form__input', type: 'text', placeholder: 'Item name' });
    const categorySelect = Utils.el('select', { class: 'form__input' }, ShoppingEngine.CATEGORIES.map(c => Utils.el('option', { value: c }, c)));
    const quantityInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, placeholder: 'Quantity', style: 'width:110px;' });
    const unitInput = Utils.el('input', { class: 'form__input', type: 'text', placeholder: 'Unit (g, pcs...)', style: 'width:120px;' });

    const addBtn = Utils.el('button', { class: 'btn btn--primary btn--row', type: 'button' }, '+ Add Item');
    addBtn.addEventListener('click', async () => {
      if (!nameInput.value.trim()) { Utils.toast('Enter an item name.', 'error'); return; }
      await DataService.shoppingItems.create(Models.createShoppingItem(list.shoppingListId, {
        name: nameInput.value.trim(), category: categorySelect.value,
        quantity: quantityInput.value === '' ? null : Number(quantityInput.value), unit: unitInput.value,
        sourceGenerated: false,
      }));
      Utils.toast('Item added.', 'success');
      await renderInner(container);
    });

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Add Item')),
      Utils.el('div', { class: 'form__grid' }, [
        Utils.el('div', { class: 'form__field form__field--wide' }, [Utils.el('label', { class: 'form__label' }, 'Name'), nameInput]),
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Category'), categorySelect]),
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Quantity'), quantityInput]),
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Unit'), unitInput]),
      ]),
      addBtn,
    ]);
  }

  function renderListCard(list, items, container) {
    if (!items.length) {
      return Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, Utils.el('h2', { class: 'card__title' }, 'Items')),
        Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
      ]);
    }

    const groups = ShoppingEngine.CATEGORIES
      .map(cat => ({ cat, list: items.filter(i => i.category === cat) }))
      .filter(g => g.list.length);

    const purchasedCount = items.filter(i => i.purchased).length;

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, 'Items'),
        Utils.el('p', { class: 'card__subtitle' }, `${purchasedCount} / ${items.length} purchased`),
      ]),
      Utils.el('div', { class: 'entry-list' }, groups.map(g => Utils.el('div', { class: 'meal-group' }, [
        Utils.el('h3', { class: 'meal-group__title' }, g.cat),
        ...g.list.map(item => renderItemRow(item, container)),
      ]))),
    ]);
  }

  function renderItemRow(item, container) {
    const purchasedCheckbox = Utils.el('input', { type: 'checkbox' });
    if (item.purchased) purchasedCheckbox.setAttribute('checked', 'checked');
    purchasedCheckbox.addEventListener('change', async () => {
      await DataService.shoppingItems.update(item.shoppingItemId, { purchased: purchasedCheckbox.checked });
      await renderInner(container);
    });

    const qtyInput = Utils.el('input', { class: 'form__input', type: 'number', step: 'any', min: 0, value: item.quantity ?? '', style: 'width:80px;' });
    const unitInput = Utils.el('input', { class: 'form__input', type: 'text', value: item.unit || '', style: 'width:90px;' });
    const saveBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: async () => {
        await DataService.shoppingItems.update(item.shoppingItemId, {
          quantity: qtyInput.value === '' ? null : Number(qtyInput.value), unit: unitInput.value,
        });
        Utils.toast('Item updated.', 'success');
        await renderInner(container);
      },
    }, 'Save');

    const deleteBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => { await DataService.shoppingItems.delete(item.shoppingItemId); await renderInner(container); },
    }, 'Delete');

    return Utils.el('div', { class: `entry-row${item.purchased ? ' entry-row--purchased' : ''}` }, [
      purchasedCheckbox,
      Utils.el('div', { class: 'entry-row__main' }, [
        Utils.el('div', { class: 'entry-row__title-line' }, [
          Utils.el('span', { class: 'entry-row__name' }, item.name),
          item.brand ? Utils.el('span', { class: 'entry-row__brand' }, ` \u00b7 ${item.brand}`) : null,
          item.sourceGenerated ? Utils.el('span', { class: 'badge' }, 'From meals') : null,
        ].filter(Boolean)),
        item.notes ? Utils.el('div', { class: 'entry-row__meta' }, item.notes) : null,
      ]),
      qtyInput, unitInput,
      Utils.el('div', { class: 'row-actions' }, [saveBtn, deleteBtn]),
    ]);
  }

  return { render };
})();
