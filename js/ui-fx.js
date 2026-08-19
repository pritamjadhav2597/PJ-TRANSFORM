/**
 * ui-fx.js — shared "luxury" visual toolkit.
 * ---------------------------------------------------------------------------
 * The dashboard introduced the house style: a dark moss/gold hero banner
 * with a drifting sheen, sparkle eyebrow, and an animated gold progress
 * ring, plus staggered card entrances. This module extracts that language
 * into reusable, data-driven pieces so every page can carry the same
 * polish while showing graphics specific to *its own* data — macro rings
 * for nutrition, a liquid gauge for water, a step arc for steps, a sleep
 * bar chart for sleep, a mood dial for wellbeing, and so on.
 *
 * Nothing here fabricates numbers — every builder takes values the page
 * already computed and simply renders them. Callers pass null/0 for
 * missing data and the graphic degrades gracefully (empty ring, "No data
 * entered" labels stay the caller's responsibility).
 * ---------------------------------------------------------------------------
 */

const UIFx = (() => {

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function clampPct(v) { return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)); }

  // -------------------------------------------------------------------
  // HERO — page-top banner. Same moss/gold luxury shell as the dashboard
  // hero, parameterised so each page supplies its own eyebrow/title/stats
  // and (optionally) a single headline ring stat relevant to that page.
  // -------------------------------------------------------------------

  let ringUid = 0;

  function hero({ eyebrow, title, subtitle, stats = [], ring = null, icon = null, theme = null } = {}) {
    const inner = Utils.el('div', { class: 'hero__inner' }, [
      Utils.el('div', { class: 'hero__intro' }, [
        Utils.el('div', { class: 'hero__eyebrow' }, [
          Utils.el('span', { class: 'sparkle' }, '\u2726'),
          icon ? `${icon}  ${eyebrow || ''}` : (eyebrow || ''),
          Utils.el('span', { class: 'sparkle' }, '\u2726'),
        ]),
        Utils.el('h2', { class: 'hero__greeting' }, title || ''),
        subtitle ? Utils.el('p', { class: 'hero__subtitle' }, subtitle) : null,
      ].filter(Boolean)),
      stats.length ? Utils.el('div', { class: 'hero__stats' }, stats.map(([label, val, gold]) =>
        Utils.el('div', { class: 'hero__stat' }, [
          Utils.el('div', { class: `hero__stat-value${gold ? ' hero__stat-value--gold' : ''}` }, val),
          Utils.el('div', { class: 'hero__stat-label' }, label),
        ]))) : null,
      ring ? ringNode({ ...ring, wrapClass: 'hero__ring-wrap', svgClass: 'hero__ring-svg', size: 132, stroke: 9 }) : null,
    ].filter(Boolean));

    // Giant faded background motif — the same per-page icon already passed
    // in, just rendered large as a decorative watermark, so every themed
    // hero communicates its subject before the text is even read.
    const motif = (theme && icon) ? Utils.el('div', { class: 'hero__bg-motif' }, icon) : null;

    return Utils.el('section', { class: `card card--hero${theme ? ` card--hero--${theme}` : ''}` }, [motif, inner].filter(Boolean));
  }

  // -------------------------------------------------------------------
  // RING — generic animated circular gauge. Returns a positioned wrapper
  // with an inline gradient so many can appear on one page without id
  // collisions. pct is 0-100; the stroke animates in via animateIn().
  // -------------------------------------------------------------------

  function ringNode({ pct, colorFrom = 'var(--gold-soft)', colorTo = 'var(--gold)', size = 96, stroke = 8,
    number = '', of = '', wrapClass = 'ring-mini', svgClass = 'ring-mini__svg', trackClass = 'hero__ring-track',
    numberClass = 'hero__ring-number', ofClass = 'hero__ring-of', labelClass = 'hero__ring-label' } = {}) {
    const id = `ring-grad-${ringUid++}`;
    const r = (size / 2) - stroke - 1;
    const cx = size / 2, cy = size / 2;
    const circumference = 2 * Math.PI * r;
    const offset = circumference - (clampPct(pct) / 100) * circumference;

    const wrap = Utils.el('div', { class: wrapClass, style: `width:${size}px;height:${size}px;` });
    wrap.innerHTML = `
      <svg viewBox="0 0 ${size} ${size}" class="${svgClass}">
        <defs>
          <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${colorFrom}"></stop>
            <stop offset="100%" style="stop-color:${colorTo}"></stop>
          </linearGradient>
        </defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" class="${trackClass}"></circle>
        <circle cx="${cx}" cy="${cy}" r="${r}" class="ring-progress" stroke="url(#${id})"
          stroke-width="${stroke}" data-target-offset="${offset}" data-circumference="${circumference}"
          style="stroke-dasharray:${circumference};stroke-dashoffset:${circumference}"></circle>
      </svg>`;
    wrap.appendChild(Utils.el('div', { class: labelClass }, [
      Utils.el('span', { class: numberClass }, number),
      of ? Utils.el('span', { class: ofClass }, of) : null,
    ].filter(Boolean)));
    return wrap;
  }

  /** A row of small labelled rings — used for macro/nutrient breakdowns. */
  function ringRow(items) {
    // items: [{ label, pct, number, of, colorFrom, colorTo }]
    return Utils.el('div', { class: 'ring-row' }, items.map(it =>
      Utils.el('div', { class: 'ring-row__item' }, [
        ringNode({
          pct: it.pct, number: it.number, of: it.of,
          colorFrom: it.colorFrom || 'var(--moss-tint)', colorTo: it.colorTo || 'var(--moss)',
          size: 84, stroke: 7,
        }),
        Utils.el('div', { class: 'ring-row__label' }, it.label),
      ])));
  }

  // -------------------------------------------------------------------
  // LIQUID GAUGE — wavy fill circle, used for hydration.
  // -------------------------------------------------------------------

  function liquidGauge({ pct, label = '', sublabel = '', colorVar = 'var(--water)' } = {}) {
    const p = clampPct(pct);
    const size = 150;
    const level = size - (size * p / 100);
    const wrap = Utils.el('div', { class: 'liquid-gauge' });
    wrap.innerHTML = `
      <svg viewBox="0 0 ${size} ${size}" class="liquid-gauge__svg">
        <defs>
          <clipPath id="liquidClip"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}"></circle></clipPath>
        </defs>
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}" class="liquid-gauge__track"></circle>
        <g clip-path="url(#liquidClip)">
          <g class="liquid-gauge__fill-group" data-target-y="${level}" style="transform:translateY(${size}px)">
            <path class="liquid-gauge__wave" d="M0 20 Q 18.75 10 37.5 20 T 75 20 T 112.5 20 T 150 20 V 160 H 0 Z" style="fill:${colorVar}"></path>
          </g>
        </g>
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}" class="liquid-gauge__ring"></circle>
      </svg>
      <div class="liquid-gauge__label">
        <span class="liquid-gauge__number">${esc(label)}</span>
        <span class="liquid-gauge__sub">${esc(sublabel)}</span>
      </div>`;
    return wrap;
  }

  // -------------------------------------------------------------------
  // GAUGE ARC — half-circle dial (steps, recovery score, craving intensity).
  // -------------------------------------------------------------------

  function arcGauge({ pct, number = '', sublabel = '', colorFrom = 'var(--ember)', colorTo = 'var(--gold)' } = {}) {
    const p = clampPct(pct);
    const id = `arc-grad-${ringUid++}`;
    const w = 200, h = 116, r = 84, cx = 100, cy = 100;
    const circumference = Math.PI * r;
    const offset = circumference - (p / 100) * circumference;
    const wrap = Utils.el('div', { class: 'arc-gauge' });
    wrap.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" class="arc-gauge__svg">
        <defs>
          <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:${colorFrom}"></stop>
            <stop offset="100%" style="stop-color:${colorTo}"></stop>
          </linearGradient>
        </defs>
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" class="arc-gauge__track"></path>
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" class="arc-gauge__progress"
          stroke="url(#${id})" data-target-offset="${offset}" data-circumference="${circumference}"
          style="stroke-dasharray:${circumference};stroke-dashoffset:${circumference}"></path>
      </svg>
      <div class="arc-gauge__label">
        <span class="arc-gauge__number">${esc(number)}</span>
        <span class="arc-gauge__sub">${esc(sublabel)}</span>
      </div>`;
    return wrap;
  }

  // -------------------------------------------------------------------
  // ANIMATED BAR — horizontal fill bar (workout volume, sleep stages,
  // meal-quality factors). Reuses .factor-bar visuals from the base CSS.
  // -------------------------------------------------------------------

  function animBar({ label, pct, detail = '', colorVar = 'var(--moss)' } = {}) {
    const p = clampPct(pct);
    return Utils.el('div', { class: 'factor-row' }, [
      Utils.el('div', { class: 'factor-row__label' }, label),
      Utils.el('div', { class: 'factor-bar' }, [
        Utils.el('div', { class: 'factor-bar__fill', style: `background:${colorVar};width:0%`, 'data-target-width': `${p}%` }),
      ]),
      detail ? Utils.el('div', { class: 'factor-row__detail' }, detail) : null,
    ].filter(Boolean));
  }

  // -------------------------------------------------------------------
  // ANIMATION DRIVERS — call once after a page/card is in the DOM.
  // -------------------------------------------------------------------

  function animateIn(container) {
    requestAnimationFrame(() => {
      (container.querySelectorAll('.ring-progress, .arc-gauge__progress') || []).forEach(el => {
        const target = el.getAttribute('data-target-offset');
        if (target != null) el.style.strokeDashoffset = target;
      });
      (container.querySelectorAll('[data-target-width]') || []).forEach(el => {
        el.style.transition = 'width 0.9s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.width = el.getAttribute('data-target-width');
      });
      (container.querySelectorAll('.liquid-gauge__fill-group') || []).forEach(el => {
        const y = el.getAttribute('data-target-y');
        el.style.transition = 'transform 1.1s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = `translateY(${y}px)`;
      });
    });
  }

  // -------------------------------------------------------------------
  // WEIGHT SPLASH — "app open" moment for the Workout page: a handful of
  // dumbbells/kettlebells/plates tumble in from the top and settle with a
  // little bounce, the way a workout app's splash screen feels alive the
  // instant it opens. Call once per real navigation to the page (not on
  // every internal re-render, or it'd replay every time a set is logged).
  // -------------------------------------------------------------------

  const WEIGHT_ICONS = [
    // dumbbell
    `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="24" width="10" height="16" rx="3" fill="#26251f"/><rect x="48" y="24" width="10" height="16" rx="3" fill="#26251f"/><rect x="14" y="19" width="9" height="26" rx="3" fill="var(--ember)"/><rect x="41" y="19" width="9" height="26" rx="3" fill="var(--ember)"/><rect x="20" y="29" width="24" height="6" rx="3" fill="#3a3a3a"/></svg>`,
    // kettlebell
    `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M22 21a10 10 0 0 1 20 0" fill="none" stroke="#26251f" stroke-width="6" stroke-linecap="round"/><circle cx="32" cy="42" r="18" fill="var(--gold)"/></svg>`,
    // weight plate
    `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="26" fill="var(--moss)"/><circle cx="32" cy="32" r="9" fill="#16241c"/></svg>`,
  ];

  function weightSplash(container, { count = 8 } = {}) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = Utils.el('div', { class: 'weight-splash', 'aria-hidden': 'true' });
    for (let i = 0; i < count; i++) {
      const size = 28 + Math.round(Math.random() * 20);
      const left = 4 + Math.random() * 90;
      const delay = (Math.random() * 0.4).toFixed(2);
      const duration = (1.15 + Math.random() * 0.5).toFixed(2);
      const rotEnd = Math.round(Math.random() * 46 - 23);
      const settleY = Math.round(30 + Math.random() * 26);
      const piece = Utils.el('div', {
        class: 'weight-splash__piece',
        style: `left:${left}%; width:${size}px; height:${size}px; animation-delay:${delay}s; animation-duration:${duration}s; --rot-end:${rotEnd}deg; --settle-y:${settleY}vh;`,
      });
      piece.innerHTML = WEIGHT_ICONS[i % WEIGHT_ICONS.length];
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2800);
  }

  return { hero, ringNode, ringRow, liquidGauge, arcGauge, animBar, animateIn, weightSplash };
})();
