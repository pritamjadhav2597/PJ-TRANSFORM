/**
 * pages/programs.js — the Program System.
 *
 * Covers: the three program options (60-Day / 1-Year / Custom), editable
 * 1-Year phases, custom durations, multiple programs per user (never
 * deleting historical ones), the program dashboard summary, and
 * carry-forward of profile/history data into new programs.
 */

const PagePrograms = (() => {

  // View state. Reset whenever the page is freshly entered via render().
  let view = 'list';           // 'list' | 'choose' | 'create' | 'edit' | 'phases'
  let selectedType = null;     // '60_day' | '1_year' | 'custom' — while in 'create'
  let editingProgramId = null; // while in 'edit'
  let phasesProgramId = null;  // while in 'phases'

  async function render(container) {
    view = 'list';
    selectedType = null;
    editingProgramId = null;
    phasesProgramId = null;
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
    const programs = await DataService.programs.list(p => p.userId === userId);

    // A brand-new user with zero programs must choose their own. Land them
    // straight in the chooser.
    if (!programs.length && view === 'list') view = 'choose';

    if (view === 'phases') {
      const program = programs.find(p => p.programId === phasesProgramId);
      if (!program) { view = 'list'; }
      else {
        container.appendChild(await renderPhasesView(program, container));
        return;
      }
    }

    if (view === 'choose') {
      container.appendChild(renderChooserView(userId, profile, programs, container));
      return;
    }

    if (view === 'create' && selectedType) {
      container.appendChild(renderCreateForm(userId, profile, selectedType, programs, container));
      return;
    }

    if (view === 'edit') {
      const editingProgram = programs.find(p => p.programId === editingProgramId) || null;
      if (!editingProgram) { view = 'list'; }
      else {
        container.appendChild(renderEditForm(userId, editingProgram, container));
        return;
      }
    }

    // Default: list view.
    const activeProgram = programs.find(p => p.status === 'active') || null;
    container.appendChild(Utils.el('div', { class: 'stack' }, [
      renderProgramsHero(activeProgram),
      renderListCard(programs, container),
    ]));

    UIFx.animateIn(container);
  }

  function renderProgramsHero(activeProgram) {
    const counters = activeProgram ? Calculations.getProgramDayCounters(activeProgram) : null;
    const day = counters?.day ?? null;
    const total = counters?.totalDays ?? activeProgram?.durationDays ?? null;
    const pct = (activeProgram && total) ? Math.min(100, Math.round(((day ?? 0) / total) * 100)) : 0;
    const typeMeta = activeProgram ? ProgramTemplates.findTypeMeta(activeProgram.programType) : null;

    return UIFx.hero({
      theme: 'program',
      icon: '\uD83C\uDFC6',
      eyebrow: 'Programs',
      title: activeProgram ? activeProgram.name : 'No Active Program',
      subtitle: activeProgram
        ? `${typeMeta?.label || 'Program'} \u2014 day ${day ?? '\u2013'} of ${total ?? '\u2013'}, ${counters?.daysRemaining ?? '\u2013'} days remaining.`
        : 'Start a program below to begin tracking day-by-day progress.',
      stats: [],
      ring: activeProgram ? { pct, number: `${day ?? '\u2013'}`, of: `of ${total ?? '\u2013'} days` } : null,
    });
  }

  // -----------------------------------------------------------------------
  // LIST — multiple programs, never deleted, with quick status actions.
  // -----------------------------------------------------------------------

  function renderListCard(programs, container) {
    const sorted = [...programs].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    const newBtn = Utils.el('button', {
      class: 'btn btn--primary', type: 'button',
      onClick: () => { view = 'choose'; selectedType = null; renderInner(container); },
    }, '+ Start a New Program');

    return Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, 'Your Programs'),
          Utils.el('p', { class: 'card__subtitle' },
            'You can run multiple programs over time. Historical programs are always kept.'),
        ]),
        newBtn,
      ]),
      sorted.length
        ? Utils.el('div', { class: 'program-list' }, sorted.map(p => renderProgramRow(p, container)))
        : Utils.el('div', { class: 'card__empty-state' }, Utils.el('p', {}, 'No data entered')),
    ]);
  }

  function renderProgramRow(program, container) {
    const counters = Calculations.getProgramDayCounters(program);
    const typeMeta = ProgramTemplates.findTypeMeta(program.programType);

    const dayLabel = counters
      ? (program.status === 'active' || program.status === 'completed'
          ? `Day ${counters.day} of ${counters.totalDays ?? '–'}${counters.daysRemaining != null ? ` · ${counters.daysRemaining} days remaining` : ''}`
          : `${counters.totalDays ?? '–'} days`)
      : 'No data entered';

    const editBtn = Utils.el('button', {
      class: 'btn btn--secondary btn--row', type: 'button',
      onClick: () => { view = 'edit'; editingProgramId = program.programId; renderInner(container); },
    }, 'Edit');

    const phasesBtn = program.programType === '1_year'
      ? Utils.el('button', {
          class: 'btn btn--secondary btn--row', type: 'button',
          onClick: () => { view = 'phases'; phasesProgramId = program.programId; renderInner(container); },
        }, 'Manage Phases')
      : null;

    const mealCalendarBtn = typeMeta?.hasMealCalendar
      ? Utils.el('a', { class: 'btn btn--secondary btn--row', href: '#/meal-calendar' }, 'Meal Calendar')
      : null;

    const programHomeBtn = typeMeta?.hasPhaseLanding
      ? Utils.el('a', { class: 'btn btn--secondary btn--row', href: '#/program-bollywood' }, 'Program Home')
      : null;

    const activateBtn = program.status !== 'active'
      ? Utils.el('button', {
          class: 'btn btn--secondary btn--row', type: 'button',
          onClick: async () => {
            await setAsActiveProgram(program);
            Utils.toast(`"${program.name}" is now active.`, 'success');
            await renderInner(container);
          },
        }, 'Set Active')
      : null;

    // Historical programs (active or completed) are never deleted — only draft/future can be.
    const canDelete = program.status === 'draft' || program.status === 'future';
    const deleteBtn = Utils.el('button', {
      class: `btn btn--danger btn--row${canDelete ? '' : ' btn--disabled'}`,
      type: 'button',
      title: canDelete ? '' : 'Historical and active programs are kept and cannot be deleted.',
      onClick: async () => {
        if (!canDelete) {
          Utils.toast('Active and completed programs are kept as history and cannot be deleted.', 'error');
          return;
        }
        const confirmed = window.confirm(`Delete "${program.name || 'Untitled Program'}"? This cannot be undone.`);
        if (!confirmed) return;
        await DataService.programs.delete(program.programId);
        Utils.toast('Program deleted.', 'success');
        await renderInner(container);
      },
    }, 'Delete');

    return Utils.el('div', { class: 'program-row' }, [
      Utils.el('div', { class: 'program-row__main' }, [
        Utils.el('div', { class: 'program-row__title-line' }, [
          Utils.el('span', { class: 'program-row__name' }, program.name || 'Untitled Program'),
          Utils.el('span', { class: `badge badge--${program.status}` }, program.status),
        ]),
        Utils.el('div', { class: 'program-row__meta' }, [
          typeMeta ? typeMeta.label : program.programType.replace(/_/g, ' '),
          ' · ',
          `${Utils.formatDate(program.startDate)} → ${Utils.formatDate(program.endDate)}`,
          ' · ',
          dayLabel,
        ].join('')),
      ]),
      Utils.el('div', { class: 'row-actions' }, [activateBtn, mealCalendarBtn, programHomeBtn, phasesBtn, editBtn, deleteBtn].filter(Boolean)),
    ]);
  }

  /** Marks `program` active; any other currently-active program for the same
   *  user is stepped down to 'paused' (kept, never deleted — see spec). */
  async function setAsActiveProgram(program) {
    const others = await DataService.programs.list(p => p.userId === program.userId && p.status === 'active' && p.programId !== program.programId);
    for (const other of others) {
      await DataService.programs.update(other.programId, { status: 'paused' });
    }
    await DataService.programs.update(program.programId, { status: 'active' });
  }

  // -----------------------------------------------------------------------
  // CHOOSER — "Program Options": 60-Day / 1-Year / Custom.
  // -----------------------------------------------------------------------

  function renderChooserView(userId, profile, programs, container) {
    const cards = ProgramTemplates.PROGRAM_TYPES.map(type => Utils.el('button', {
      class: 'program-type-card', type: 'button',
      onClick: () => { view = 'create'; selectedType = type.value; renderInner(container); },
    }, [
      Utils.el('h3', { class: 'program-type-card__title' }, type.label),
      Utils.el('p', { class: 'program-type-card__blurb' }, type.blurb),
      Utils.el('span', { class: 'program-type-card__cta' }, 'Choose →'),
    ]));

    const backBtn = programs.length
      ? Utils.el('button', {
          class: 'btn btn--secondary', type: 'button',
          onClick: () => { view = 'list'; renderInner(container); },
        }, '← Back to your programs')
      : null;

    return Utils.el('div', { class: 'stack' }, [
      Utils.el('section', { class: 'card' }, [
        Utils.el('div', { class: 'card__header' }, [
          Utils.el('div', {}, [
            Utils.el('h2', { class: 'card__title' }, 'Choose Your Program'),
            Utils.el('p', { class: 'card__subtitle' }, 'Pick how you want to structure this program.'),
          ]),
          backBtn,
        ]),
        Utils.el('div', { class: 'program-type-grid' }, cards),
      ]),
    ]);
  }

  // -----------------------------------------------------------------------
  // CREATE — type-specific form. Always carries forward current weight
  // from the profile as the new program's starting weight.
  // -----------------------------------------------------------------------

  function renderCreateForm(userId, profile, type, programs, container) {
    const typeMeta = ProgramTemplates.findTypeMeta(type);
    const carriedWeight = profile?.currentWeightKg ?? null;
    const hasActive = programs.some(p => p.status === 'active');

    const form = Utils.el('form', { class: 'form' });

    const nameInput = Utils.el('input', {
      class: 'form__input', name: 'name', type: 'text',
      placeholder: typeMeta.label,
      value: type === '1_year' ? '1-Year Transformation' : (type === '60_day' ? '60-Day Transformation' : ''),
    });
    const startInput = Utils.el('input', {
      class: 'form__input', name: 'startDate', type: 'date', value: Models.todayIso(),
    });

    // Duration: fixed for 60-day/1-year; chip selector + custom number for custom.
    let durationDays = typeMeta.durationDays;
    const durationField = [];
    let customDurationInput = null;
    if (type === 'custom') {
      const chipsWrap = Utils.el('div', { class: 'chip-row' });
      let selectedChip = 90;
      const setChip = (val) => {
        selectedChip = val;
        Utils.qsa('.chip', chipsWrap).forEach(c => c.classList.toggle('chip--active', Number(c.dataset.val) === val));
        customDurationInput.value = '';
      };
      ProgramTemplates.CUSTOM_DURATION_OPTIONS.forEach(d => {
        const chip = Utils.el('button', {
          class: `chip${d === selectedChip ? ' chip--active' : ''}`, type: 'button', 'data-val': d,
          onClick: () => setChip(d),
        }, `${d} days`);
        chipsWrap.appendChild(chip);
      });
      customDurationInput = Utils.el('input', {
        class: 'form__input', type: 'number', min: 1, max: 3650,
        placeholder: 'Custom number of days',
      });
      customDurationInput.addEventListener('input', () => {
        if (customDurationInput.value) {
          Utils.qsa('.chip', chipsWrap).forEach(c => c.classList.remove('chip--active'));
        }
      });
      durationField.push(
        Utils.el('div', { class: 'form__field form__field--wide' }, [
          Utils.el('label', { class: 'form__label' }, 'Duration'),
          chipsWrap,
          customDurationInput,
        ])
      );
      durationDays = null; // resolved at submit time
    } else {
      durationField.push(
        Utils.el('div', { class: 'form__field' }, [
          Utils.el('label', { class: 'form__label' }, 'Duration'),
          Utils.el('p', { class: 'form__static-value' }, `${typeMeta.durationDays} days (fixed for ${typeMeta.label})`),
        ])
      );
    }

    const goalSelect = Utils.el('select', { class: 'form__input', name: 'goalType' }, [
      Utils.el('option', { value: '' }, '— Select —'),
      ...['fat_loss', 'maintenance', 'muscle_gain', 'body_recomposition', 'general_fitness'].map(g =>
        Utils.el('option', { value: g }, g.replace(/_/g, ' '))),
    ]);
    if (profile?.goalType) goalSelect.value = profile.goalType;

    const targetMinInput = Utils.el('input', {
      class: 'form__input', type: 'number', step: '0.01', min: 30, max: 300, placeholder: 'Min kg (optional)',
    });
    const targetMaxInput = Utils.el('input', {
      class: 'form__input', type: 'number', step: '0.01', min: 30, max: 300, placeholder: 'Max kg (optional)',
      value: profile?.targetWeightKg ?? '',
    });

    const statusSelect = Utils.el('select', { class: 'form__input', name: 'status' }, [
      Utils.el('option', { value: 'active' }, 'Active — start now'),
      Utils.el('option', { value: 'future' }, 'Future — plan ahead'),
      Utils.el('option', { value: 'draft' }, 'Draft — not scheduled yet'),
    ]);
    if (hasActive) statusSelect.value = 'future';

    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, `Create: ${typeMeta.label}`));
    form.appendChild(Utils.el('p', { class: 'card__subtitle' },
      carriedWeight != null
        ? `Starting weight carried forward from your profile: ${carriedWeight} kg. Measurements, favorites, and history are never reset.`
        : 'No current weight on file yet — set one up in your profile for best results.'));

    const grid = Utils.el('div', { class: 'form__grid' }, [
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Program name'), nameInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Start date'), startInput]),
      ...durationField,
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Goal'), goalSelect]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Target weight — min (kg)'), targetMinInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Target weight — max (kg)'), targetMaxInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Status'), statusSelect]),
    ]);
    form.appendChild(grid);

    if (type === '1_year') {
      form.appendChild(Utils.el('p', { class: 'card__footnote' },
        'Five default phases will be created automatically (fat loss + habits → strength + recomposition → long-term maintenance). You can edit every phase afterward.'));
    }

    const errorsHost = Utils.el('div', { class: 'form__errors' });
    form.appendChild(errorsHost);

    const actions = Utils.el('div', { class: 'form__actions' }, [
      Utils.el('button', { class: 'btn btn--primary', type: 'submit' }, 'Create program'),
      Utils.el('button', {
        class: 'btn btn--secondary', type: 'button',
        onClick: () => { view = 'choose'; renderInner(container); },
      }, '← Back'),
    ]);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errors = [];
      let finalDuration = durationDays;
      if (type === 'custom') {
        finalDuration = customDurationInput.value ? Number(customDurationInput.value) : selectedChipValue(form);
        const durErr = Utils.Validate.range(finalDuration, 1, 3650, 'Duration');
        if (durErr) errors.push(durErr);
      }
      const minErr = Utils.Validate.range(targetMinInput.value, 30, 300, 'Target weight (min)');
      const maxErr = Utils.Validate.range(targetMaxInput.value, 30, 300, 'Target weight (max)');
      if (minErr) errors.push(minErr);
      if (maxErr) errors.push(maxErr);

      errorsHost.innerHTML = '';
      if (errors.length) {
        errorsHost.appendChild(Utils.el('ul', { class: 'error-list' }, errors.map(m => Utils.el('li', {}, m))));
        return;
      }

      const start = startInput.value || Models.todayIso();
      // endDate is the calendar date of the LAST day of the program (Day N),
      // not one day past it — e.g. a 100-day program starting Sep 1 ends Dec 9
      // (Day 100), matching Calculations.getProgramDayCounters' day numbering.
      const end = ProgramTemplates.addDays(start, finalDuration - 1);
      const targetMin = targetMinInput.value ? Number(targetMinInput.value) : null;
      const targetMax = targetMaxInput.value ? Number(targetMaxInput.value) : null;
      const targetMid = (targetMin != null && targetMax != null) ? round1((targetMin + targetMax) / 2)
        : (targetMax ?? targetMin ?? profile?.targetWeightKg ?? null);

      const newStatus = statusSelect.value;
      if (newStatus === 'active') {
        const others = await DataService.programs.list(p => p.userId === userId && p.status === 'active');
        for (const other of others) await DataService.programs.update(other.programId, { status: 'paused' });
      }

      const savedProgram = await DataService.programs.create(Models.createProgram(userId, {
        name: nameInput.value || typeMeta.label,
        goal: goalSelect.value ? goalSelect.value.replace(/_/g, ' ') : '',
        programType: type,
        startDate: start,
        endDate: end,
        durationDays: finalDuration,
        startingWeightKg: carriedWeight, // carried forward, never re-entered
        targetWeightKg: targetMid,
        targetWeightMinKg: targetMin,
        targetWeightMaxKg: targetMax,
        status: newStatus,
      }));

      if (type === '1_year') {
        const phases = ProgramTemplates.buildDefaultYearPhases(savedProgram.programId, start);
        for (const phase of phases) await DataService.programPhases.create(phase);
      }
      if (type === BollywoodProgramData.PROGRAM_TYPE) {
        await BollywoodSetup.setupProgram(savedProgram.programId, userId, start);
      }

      // A new/changed active program changes the calorie/macro targets — recalculate.
      if (profile && savedProgram.status === 'active') {
        const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
        const targets = Calculations.calculateAllTargets(profile, { weightEntries, program: savedProgram });
        await Calculations.recordTargetChangesIfNeeded(userId, targets, 'program_change');
      }

      Utils.toast('Program created.', 'success');
      view = type === '1_year' ? 'phases' : 'list';
      phasesProgramId = savedProgram.programId;
      await renderInner(container);
    });

    return Utils.el('section', { class: 'card' }, [form]);
  }

  function selectedChipValue(form) {
    const active = Utils.qs('.chip--active', form);
    return active ? Number(active.dataset.val) : 90;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  // -----------------------------------------------------------------------
  // EDIT — adjust an existing program's basics (name/dates/status/target).
  // -----------------------------------------------------------------------

  function renderEditForm(userId, program, container) {
    const typeMeta = ProgramTemplates.findTypeMeta(program.programType);
    const form = Utils.el('form', { class: 'form' });

    const nameInput = Utils.el('input', { class: 'form__input', type: 'text', value: program.name || '' });
    const startInput = Utils.el('input', { class: 'form__input', type: 'date', value: program.startDate || Models.todayIso() });
    const durationLocked = program.programType !== 'custom';
    const durationInput = Utils.el('input', {
      class: 'form__input', type: 'number', min: 1, max: 3650,
      value: program.durationDays || 60,
      disabled: durationLocked ? 'disabled' : null,
    });
    const targetMinInput = Utils.el('input', { class: 'form__input', type: 'number', step: '0.01', min: 30, max: 300, value: program.targetWeightMinKg ?? '' });
    const targetMaxInput = Utils.el('input', { class: 'form__input', type: 'number', step: '0.01', min: 30, max: 300, value: program.targetWeightMaxKg ?? program.targetWeightKg ?? '' });
    const statusSelect = Utils.el('select', { class: 'form__input' }, [
      Utils.el('option', { value: 'draft' }, 'Draft'),
      Utils.el('option', { value: 'future' }, 'Future'),
      Utils.el('option', { value: 'active' }, 'Active'),
      Utils.el('option', { value: 'paused' }, 'Paused'),
      Utils.el('option', { value: 'completed' }, 'Completed'),
    ]);
    statusSelect.value = program.status;

    form.appendChild(Utils.el('h3', { class: 'form__group-title' }, `Edit: ${typeMeta ? typeMeta.label : program.programType}`));
    form.appendChild(Utils.el('div', { class: 'form__grid' }, [
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Program name'), nameInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Start date'), startInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, `Duration (days)${durationLocked ? ' — fixed' : ''}`), durationInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Target weight — min (kg)'), targetMinInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Target weight — max (kg)'), targetMaxInput]),
      Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Status'), statusSelect]),
    ]));

    if (program.status === 'active' || program.status === 'completed') {
      form.appendChild(Utils.el('p', { class: 'card__footnote' }, 'This program is historical/active data and can be edited but never deleted.'));
    }

    const errorsHost = Utils.el('div', { class: 'form__errors' });
    form.appendChild(errorsHost);

    const actions = Utils.el('div', { class: 'form__actions' }, [
      Utils.el('button', { class: 'btn btn--primary', type: 'submit' }, 'Save changes'),
      Utils.el('button', {
        class: 'btn btn--secondary', type: 'button',
        onClick: () => { view = 'list'; editingProgramId = null; renderInner(container); },
      }, 'Cancel'),
    ]);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const duration = durationLocked ? program.durationDays : Number(durationInput.value);
      const errors = [];
      if (!durationLocked) {
        const durErr = Utils.Validate.range(duration, 1, 3650, 'Duration');
        if (durErr) errors.push(durErr);
      }
      errorsHost.innerHTML = '';
      if (errors.length) {
        errorsHost.appendChild(Utils.el('ul', { class: 'error-list' }, errors.map(m => Utils.el('li', {}, m))));
        return;
      }

      const start = startInput.value || program.startDate;
      const end = ProgramTemplates.addDays(start, duration);
      const targetMin = targetMinInput.value ? Number(targetMinInput.value) : null;
      const targetMax = targetMaxInput.value ? Number(targetMaxInput.value) : null;
      const targetMid = (targetMin != null && targetMax != null) ? round1((targetMin + targetMax) / 2)
        : (targetMax ?? targetMin ?? program.targetWeightKg ?? null);

      if (statusSelect.value === 'active') {
        const others = await DataService.programs.list(p => p.userId === userId && p.status === 'active' && p.programId !== program.programId);
        for (const other of others) await DataService.programs.update(other.programId, { status: 'paused' });
      }

      const savedProgram = await DataService.programs.update(program.programId, {
        name: nameInput.value || 'Untitled Program',
        startDate: start,
        endDate: end,
        durationDays: duration,
        targetWeightKg: targetMid,
        targetWeightMinKg: targetMin,
        targetWeightMaxKg: targetMax,
        status: statusSelect.value,
      });

      const profile = (await DataService.profiles.list(p => p.userId === userId))[0] || null;
      if (profile && savedProgram.status === 'active') {
        const weightEntries = await DataService.weightEntries.list(w => w.userId === userId);
        const targets = Calculations.calculateAllTargets(profile, { weightEntries, program: savedProgram });
        await Calculations.recordTargetChangesIfNeeded(userId, targets, 'program_change');
      }

      Utils.toast('Program updated.', 'success');
      view = 'list';
      editingProgramId = null;
      await renderInner(container);
    });

    return Utils.el('section', { class: 'card' }, [form]);
  }

  // -----------------------------------------------------------------------
  // PHASES — editable 1-Year phase structure.
  // -----------------------------------------------------------------------

  async function renderPhasesView(program, container) {
    let phases = await DataService.programPhases.list(ph => ph.programId === program.programId);
    phases = phases.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const backBtn = Utils.el('button', {
      class: 'btn btn--secondary', type: 'button',
      onClick: () => { view = 'list'; phasesProgramId = null; renderInner(container); },
    }, '← Back to your programs');

    const header = Utils.el('section', { class: 'card' }, [
      Utils.el('div', { class: 'card__header' }, [
        Utils.el('div', {}, [
          Utils.el('h2', { class: 'card__title' }, `Phases — ${program.name}`),
          Utils.el('p', { class: 'card__subtitle' },
            'Each phase can change calories, protein, fat, carbohydrates, fibre, steps, water, training, weight target, and goal. Leave a field blank to keep using your profile-calculated default for that phase.'),
        ]),
        backBtn,
      ]),
    ]);

    const phaseCards = phases.length
      ? phases.map(p => renderPhaseCard(p, container))
      : [Utils.el('section', { class: 'card' }, Utils.el('p', { class: 'card__empty' }, 'No phases defined.'))];

    return Utils.el('div', { class: 'stack' }, [header, ...phaseCards]);
  }

  function renderPhaseCard(phase, container) {
    const numField = (label, key, value, opts = {}) => {
      const input = Utils.el('input', {
        class: 'form__input', type: 'number', step: opts.step || '1',
        min: opts.min, max: opts.max,
        placeholder: 'Use default', value: value ?? '',
      });
      return { field: Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, label), input]), input, key, label };
    };

    const calories = numField('Calories (kcal)', 'calorieTarget', phase.calorieTarget, { min: 800, max: 6000 });
    const protein = numField('Protein (g)', 'proteinTargetG', phase.proteinTargetG, { min: 0, max: 400 });
    const fat = numField('Fat (g)', 'fatTargetG', phase.fatTargetG, { min: 0, max: 300 });
    const carbs = numField('Carbohydrates (g)', 'carbTargetG', phase.carbTargetG, { min: 0, max: 800 });
    const fibre = numField('Fibre (g)', 'fibreTargetG', phase.fibreTargetG, { min: 0, max: 100 });
    const steps = numField('Steps', 'stepTarget', phase.stepTarget, { min: 0, max: 60000 });
    const water = numField('Water (mL)', 'waterTargetMl', phase.waterTargetMl, { min: 0, max: 8000 });
    const training = numField('Training (days/week)', 'trainingFrequencyPerWeek', phase.trainingFrequencyPerWeek, { min: 0, max: 14 });
    const weightTarget = numField('Weight target (kg)', 'weightTargetKg', phase.weightTargetKg, { min: 30, max: 300, step: '0.01' });

    const goalSelect = Utils.el('select', { class: 'form__input' }, [
      Utils.el('option', { value: '' }, '— Use profile default —'),
      ...['fat_loss', 'maintenance', 'muscle_gain', 'body_recomposition', 'general_fitness'].map(g =>
        Utils.el('option', { value: g }, g.replace(/_/g, ' '))),
    ]);
    goalSelect.value = phase.goalType || '';

    const numFields = [calories, protein, fat, carbs, fibre, steps, water, training, weightTarget];

    const form = Utils.el('form', { class: 'form' }, [
      Utils.el('h3', { class: 'form__group-title' }, `${phase.name}${phase.notes ? ` · ${phase.notes}` : ''}`),
      Utils.el('div', { class: 'form__grid' }, [
        ...numFields.map(f => f.field),
        Utils.el('div', { class: 'form__field' }, [Utils.el('label', { class: 'form__label' }, 'Goal'), goalSelect]),
      ]),
      Utils.el('div', { class: 'form__actions' }, [
        Utils.el('button', { class: 'btn btn--primary', type: 'submit' }, 'Save phase'),
      ]),
    ]);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const patch = { goalType: goalSelect.value || '' };
      const errors = [];
      numFields.forEach(f => {
        const raw = f.input.value;
        const err = Utils.Validate.range(raw, Number(f.input.min), Number(f.input.max), f.label);
        if (err) errors.push(err);
        patch[f.key] = raw === '' ? null : Number(raw);
      });
      if (errors.length) {
        Utils.toast(errors[0], 'error');
        return;
      }
      await DataService.programPhases.update(phase.phaseId, patch);
      Utils.toast('Phase saved.', 'success');
      await renderInner(container);
    });

    return Utils.el('section', { class: 'card' }, [form]);
  }

  return { render };
})();
