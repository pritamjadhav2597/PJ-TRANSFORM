/**
 * pages/products.js — the Product database. Every value here is exactly
 * what the person typed off a package label; nothing is ever pre-filled
 * from FoodDatabase (generic estimates). Products saved here become
 * selectable, higher-priority sources in the Food Entry page.
 */

const PageProducts = (() => {

  const BASIS_OPTIONS = [
    { value: 'per_100g', label: 'Per 100 g' },
    { value: 'per_serving', label: 'Per serving' },
    { value: 'per_piece', label: 'Per piece' },
    { value: 'custom', label: 'Custom unit' },
  ];

  let view = 'list';        // 'list' | 'form'
  let editingProductId = null;

  async function render(container) {
    await renderInner(container);
  }

  async function renderInner(container) {
    container.innerHTML = '';
    const userId = DataService.getCurrentUserId();
    const products = userId ? await DataService.foodProducts.list(p => p.userId === userId) : [];

    if (view === 'form') {
      const editing = editingProductId ? products.find(p => p.productId === editingProductId) : null;
      container.appendChild(renderForm(userId, editing, container));
      return;
    }

    container.appendChild(renderProductsHero(products));
    container.appendChild(renderListCard(products, container));

    UIFx.animateIn(container);
  }

  function renderProductsHero(products) {
    const withBarcode = products.filter(p => p.barcode).length;
    const hero = UIFx.hero({
      theme: 'nutrition',
      icon: '\uD83C\uDFF7\uFE0F',
      eyebrow: 'Products',
      title: 'Your Saved Products',
      subtitle: products.length
        ? `${products.length} product${products.length === 1 ? '' : 's'} saved from labels, ready to log from Food Entry.`
        : 'Save a product straight from a nutrition label to reuse it every time you log it.',
      stats: [
        ['Saved products', `${products.length}`, true],
      ],
    });
    hero.classList.add('card--hero--compact');
    return hero;
  }

  // -------------------------------------------------------------------
  // LIST
  // -------------------------------------------------------------------

  function renderListCard(products, container) {
    const sorted = [...products].sort((a, b) => (a.brand + a.name).localeCompare(b.brand + b.name));

    const newBtn = Utils.el('button', {
      class: 'btn btn--primary', type: 'button',
      onClick: () => { view = 'form'; editingProductId = null; renderInner(container); },
    }, '+ Add Product');

    let body;
    if (!sorted.length) {
      body = Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered'));
    } else {
      body = Utils.el('div', { class: 'table-wrap' }, Utils.el('table', { class: 'table' }, [
        Utils.el('thead', {}, Utils.el('tr', {}, [
          'Brand', 'Product', 'Basis', 'Calories', 'Protein', 'Carbs', 'Fat', '',
        ].map(h => Utils.el('th', {}, h)))),
        Utils.el('tbody', {}, sorted.map(p => renderProductRow(p, container))),
      ]));
    }

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Your Products'),
          Utils.el('p', { class: 'card__subtitle' }, 'Saved exactly as printed on the package. These override generic estimates in Food Entry.'),
        ]),
        newBtn,
      ]),
      body,
    ]);
  }

  function renderProductRow(product, container) {
    const basisMeta = BASIS_OPTIONS.find(b => b.value === product.labelBasis);
    const n = product.nutrients || {};

    const editBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => { view = 'form'; editingProductId = product.productId; renderInner(container); },
    }, 'Edit');

    const deleteBtn = Utils.el('button', {
      class: 'btn btn--danger btn--row', type: 'button',
      onClick: async () => {
        const confirmed = window.confirm(`Delete "${product.name || 'Untitled Product'}"? This cannot be undone.`);
        if (!confirmed) return;
        await DataService.foodProducts.delete(product.productId);
        Utils.toast('Product deleted.', 'success');
        await renderInner(container);
      },
    }, 'Delete');

    return Utils.el('tr', {}, [
      Utils.el('td', {}, product.brand || '—'),
      Utils.el('td', {}, product.name || 'Untitled Product'),
      Utils.el('td', {}, basisMeta ? basisMeta.label : product.labelBasis),
      Utils.el('td', {}, Utils.fmt(n.calories, ' kcal')),
      Utils.el('td', {}, Utils.fmt(n.proteinG, ' g')),
      Utils.el('td', {}, Utils.fmt(n.carbsG, ' g')),
      Utils.el('td', {}, Utils.fmt(n.fatG, ' g')),
      Utils.el('td', {}, Utils.el('div', { class: 'row-actions' }, [editBtn, deleteBtn])),
    ]);
  }

  // -------------------------------------------------------------------
  // FORM
  // -------------------------------------------------------------------

  function renderForm(userId, product, container) {
    const isEdit = !!product;
    const values = product || Models.createFoodProduct(userId);

    const form = Utils.el('form', { class: 'form', id: 'product-form' });
    const errorsHost = Utils.el('div', { class: 'form__errors' });

    // Identity
    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, 'Identity'));
    const identityGrid = Utils.el('div', { class: 'form__grid' }, [
      field('text', 'brand', 'Brand', values.brand),
      field('text', 'name', 'Product name', values.name),
    ]);
    form.appendChild(identityGrid);

    // Label basis
    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, 'How the label prints its values'));
    const basisGrid = Utils.el('div', { class: 'form__grid', id: 'basis-grid' });
    basisGrid.appendChild(selectField('labelBasis', 'Basis', values.labelBasis, BASIS_OPTIONS));
    form.appendChild(basisGrid);

    const basisDetail = Utils.el('div', { class: 'form__grid', id: 'basis-detail' });
    form.appendChild(basisDetail);
    renderBasisDetail(basisDetail, values.labelBasis, values);
    Utils.qs('#basis-grid select[name="labelBasis"]', form).addEventListener('change', (e) => {
      renderBasisDetail(basisDetail, e.target.value, values);
    });

    // Nutrients, grouped
    const groups = [...new Set(FoodCalc.NUTRIENT_FIELDS.map(f => f.group))];
    groups.forEach(group => {
      form.appendChild(Utils.el('h3', { class: 'form__group-title' }, group));
      form.appendChild(Utils.el('p', { class: 'card__footnote' },
        group === 'Macros' ? 'Enter values exactly as printed for the basis selected above.' : ''));
      const grid = Utils.el('div', { class: 'form__grid' },
        FoodCalc.NUTRIENT_FIELDS.filter(f => f.group === group).map(f =>
          field('number', `nutrient__${f.key}`, `${f.label} (${f.unit})`, values.nutrients ? values.nutrients[f.key] : null, { step: 'any', min: 0 })));
      form.appendChild(grid);
    });

    // Other nutrients (free-form)
    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, 'Other nutrients'));
    const otherText = (values.otherNutrients || []).map(o => `${o.label}: ${o.amount}`).join('\n');
    form.appendChild(Utils.el('div', { class: 'form__field form__field--wide' }, [
      Utils.el('label', { class: 'form__label', for: 'field-otherNutrients' }, 'Anything else on the label, one per line (e.g. "Vitamin E: 2.4 mg")'),
      Utils.el('textarea', { class: 'form__input', id: 'field-otherNutrients', name: 'otherNutrients', rows: 3 }, otherText),
    ]));

    // Notes
    form.appendChild(Utils.el('div', { class: 'form__field form__field--wide' }, [
      Utils.el('label', { class: 'form__label', for: 'field-notes' }, 'Notes'),
      Utils.el('textarea', { class: 'form__input', id: 'field-notes', name: 'notes', rows: 2 }, values.notes || ''),
    ]));

    const actions = Utils.el('div', { class: 'form__actions' }, [
      Utils.el('button', { class: 'btn btn--primary', type: 'submit' }, isEdit ? 'Save changes' : 'Save product'),
      Utils.el('button', {
        class: 'btn btn--secondary', type: 'button',
        onClick: () => { view = 'list'; editingProductId = null; renderInner(container); },
      }, 'Cancel'),
    ]);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleSave(form, userId, values, isEdit, errorsHost, container);
    });

    return Utils.el('section', { class: 'card card--form' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('h2', { class: 'card__title' }, isEdit ? 'Edit Product' : 'Add Product'),
        Utils.el('p', { class: 'card__subtitle' }, 'Enter values exactly as printed on the package — leave anything not shown on the label blank.'),
      ]),
      errorsHost,
      form,
    ]);
  }

  function renderBasisDetail(host, basis, values) {
    host.innerHTML = '';
    if (basis === 'per_serving') {
      host.appendChild(field('number', 'servingSizeG', 'Serving size (g) — if stated', values.servingSizeG, { step: 'any', min: 0 }));
      host.appendChild(field('text', 'servingSizeLabel', 'Serving size as printed (e.g. "1 scoop (30 g)")', values.servingSizeLabel));
    } else if (basis === 'per_piece') {
      host.appendChild(field('number', 'pieceWeightG', 'Weight per piece (g) — if stated', values.pieceWeightG, { step: 'any', min: 0 }));
      host.appendChild(field('text', 'pieceLabel', 'Piece label (e.g. "1 biscuit")', values.pieceLabel));
    } else if (basis === 'custom') {
      host.appendChild(field('text', 'customUnitLabel', 'Custom unit label (e.g. "1 bar")', values.customUnitLabel));
      host.appendChild(field('number', 'customUnitG', 'Weight per custom unit (g) — if known', values.customUnitG, { step: 'any', min: 0 }));
    }
  }

  function field(type, name, label, value, opts = {}) {
    const id = `field-${name}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('input', { class: 'form__input', id, name, type, value: value ?? '', ...opts }),
    ]);
  }

  function selectField(name, label, value, options) {
    const id = `field-${name}`;
    return Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label', for: id }, label),
      Utils.el('select', { class: 'form__input', id, name }, options.map(o => {
        const opt = Utils.el('option', { value: o.value }, o.label);
        if (value === o.value) opt.setAttribute('selected', 'selected');
        return opt;
      })),
    ]);
  }

  function parseOtherNutrients(raw) {
    return String(raw || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const idx = line.indexOf(':');
        return idx === -1
          ? { label: line, amount: '' }
          : { label: line.slice(0, idx).trim(), amount: line.slice(idx + 1).trim() };
      });
  }

  async function handleSave(form, userId, values, isEdit, errorsHost, container) {
    const formData = new FormData(form);
    const errors = [];

    const brand = (formData.get('brand') || '').toString().trim();
    const name = (formData.get('name') || '').toString().trim();
    if (!name) errors.push('Product name is required.');

    const labelBasis = formData.get('labelBasis');

    const nutrients = {};
    FoodCalc.NUTRIENT_FIELDS.forEach(f => {
      const raw = formData.get(`nutrient__${f.key}`);
      if (raw === '' || raw === null) { nutrients[f.key] = null; return; }
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0) errors.push(`${f.label} must be a non-negative number.`);
      nutrients[f.key] = Number.isNaN(n) ? null : n;
    });

    errorsHost.innerHTML = '';
    if (errors.length) {
      errorsHost.appendChild(Utils.el('ul', { class: 'error-list' }, errors.map(msg => Utils.el('li', {}, msg))));
      Utils.toast('Please fix the highlighted errors.', 'error');
      return;
    }

    const patch = {
      brand, name,
      labelBasis,
      servingSizeG: numOrNull(formData.get('servingSizeG')),
      servingSizeLabel: (formData.get('servingSizeLabel') || '').toString(),
      pieceWeightG: numOrNull(formData.get('pieceWeightG')),
      pieceLabel: (formData.get('pieceLabel') || '').toString(),
      customUnitLabel: (formData.get('customUnitLabel') || '').toString(),
      customUnitG: numOrNull(formData.get('customUnitG')),
      nutrients,
      otherNutrients: parseOtherNutrients(formData.get('otherNutrients')),
      notes: (formData.get('notes') || '').toString(),
    };

    if (isEdit) {
      await DataService.foodProducts.update(values.productId, patch);
      Utils.toast('Product updated.', 'success');
    } else {
      await DataService.foodProducts.create({ ...values, ...patch });
      Utils.toast('Product saved.', 'success');
    }

    view = 'list';
    editingProductId = null;
    await renderInner(container);
  }

  function numOrNull(raw) {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  return { render };
})();
