/**
 * welcome-intro.js
 * ---------------------------------------------------------------------------
 * A one-time, full-screen welcome slideshow shown the moment a brand-new
 * account signs in for the very first time — before the profile-onboarding
 * gate (see router.js) takes over. Reuses the same themed gradient "glass"
 * visual language as the Dashboard's story slideshow (js/pages/dashboard.js)
 * so it feels like part of the app rather than a bolted-on splash screen.
 *
 * Shown at most once per account, ever (any device) — tracked on the User
 * record (Models.createUser().welcomeIntroSeen) so it syncs through the same
 * cloud sync as everything else, rather than a device-local flag that would
 * pop back up after a reinstall or on a second device.
 * ---------------------------------------------------------------------------
 */

const WelcomeIntro = (() => {

  const SLIDES = [
    {
      theme: 'transformation', icon: '\u{1F44B}', eyebrow: 'Welcome',
      headline: 'Your transformation, all in one place',
      description: 'Workouts, meals, hydration, sleep, and progress photos — everything you track lives together, and everything is personalized to you.',
    },
    {
      theme: 'training', icon: '\u{1F3CB}\uFE0F', eyebrow: 'Training',
      headline: 'Guided workouts, real progress',
      description: 'Follow structured programs, log every set, and watch personal records build up automatically as you go.',
    },
    {
      theme: 'nutrition', icon: '\u{1F37D}', eyebrow: 'Nutrition',
      headline: 'Meals that match your goal',
      description: 'Your calorie and macro targets are calculated from your own numbers — not a generic guess — and adjust as you update your profile.',
    },
    {
      theme: 'progress', icon: '\u{1F4C8}', eyebrow: 'Progress',
      headline: 'Watch it add up',
      description: 'Weight trends, measurements, strength, and adherence — tracked over time so the small daily wins are easy to see.',
    },
    {
      theme: 'recovery', icon: '\u267B\uFE0F', eyebrow: 'Recovery',
      headline: 'Recovery counts too',
      description: 'Sleep and recovery are tracked right alongside training, because results come from both.',
    },
    {
      theme: 'transformation', icon: '\u2728', eyebrow: 'You\u2019re all set',
      headline: 'Let\u2019s build your plan',
      description: 'A couple of quick details \u2014 age, weight, goal \u2014 and every target in the app personalizes to you.',
      isFinal: true,
    },
  ];

  const AUTOPLAY_MS = 5000;

  /** Shows the welcome overlay if this user hasn't seen it yet. Resolves
   *  once dismissed (Skip or Get Started) — or immediately, synchronously
   *  in effect, if the user has already seen it before. Callers should
   *  `await` this before rendering anything else. */
  function showIfNeeded() {
    return new Promise(async (resolve) => {
      const userId = DataService.getCurrentUserId();
      if (!userId) { resolve(); return; }

      const user = await DataService.users.get(userId);
      if (!user || user.welcomeIntroSeen) { resolve(); return; }

      let index = 0;
      let timer = null;

      const stage = Utils.el('div', { class: 'welcome-overlay__stage' });
      const dotsRow = Utils.el('div', { class: 'welcome-overlay__dots' });
      const dots = SLIDES.map((_, i) => {
        const dot = Utils.el('button', {
          class: `welcome-overlay__dot${i === 0 ? ' welcome-overlay__dot--active' : ''}`,
          type: 'button', 'aria-label': `Go to slide ${i + 1}`,
        });
        dot.addEventListener('click', () => { stopAutoplay(); goTo(i); startAutoplay(); });
        dotsRow.appendChild(dot);
        return dot;
      });

      async function dismiss() {
        stopAutoplay();
        await DataService.users.update(userId, { welcomeIntroSeen: true });
        overlay.classList.remove('welcome-overlay--visible');
        setTimeout(() => overlay.remove(), 250);
        resolve();
      }

      function renderSlide(i) {
        const s = SLIDES[i];
        const bgMotif = Utils.el('div', { class: 'slideshow__bg-motif' }, s.icon);
        const bg = Utils.el('div', { class: 'slideshow__bg' }, [bgMotif]);
        const overlayTint = Utils.el('div', { class: 'slideshow__overlay' });
        const panel = Utils.el('div', { class: 'welcome-overlay__panel' }, [
          Utils.el('div', { class: 'slideshow__visual' }, s.icon),
          Utils.el('div', { class: 'slideshow__eyebrow' }, s.eyebrow),
          Utils.el('h2', { class: 'welcome-overlay__headline' }, s.headline),
          Utils.el('p', { class: 'welcome-overlay__description' }, s.description),
          Utils.el('div', { class: 'row-actions', style: 'margin-top:20px;' }, [
            s.isFinal
              ? Utils.el('button', {
                  class: 'btn btn--primary', type: 'button',
                  onClick: dismiss,
                }, 'Get Started')
              : Utils.el('button', {
                  class: 'btn btn--primary', type: 'button',
                  onClick: () => { stopAutoplay(); next(); startAutoplay(); },
                }, 'Next'),
          ]),
        ]);
        const glass = Utils.el('div', { class: 'slideshow__glass welcome-overlay__glass' }, [panel]);
        const slideEl = Utils.el('div', { class: `slideshow__slide slideshow__slide--${s.theme}` }, [bg, overlayTint, glass]);
        stage.innerHTML = '';
        stage.appendChild(slideEl);
        dots.forEach((d, di) => d.classList.toggle('welcome-overlay__dot--active', di === i));
      }

      function goTo(i) { index = ((i % SLIDES.length) + SLIDES.length) % SLIDES.length; renderSlide(index); }
      function next() { if (index === SLIDES.length - 1) return; goTo(index + 1); }
      function prev() { goTo(index - 1); }
      function startAutoplay() {
        stopAutoplay();
        if (index === SLIDES.length - 1) return; // don't auto-advance off the final CTA slide
        timer = setInterval(() => {
          if (!document.body.contains(overlay)) { stopAutoplay(); return; }
          next();
        }, AUTOPLAY_MS);
      }
      function stopAutoplay() { if (timer) clearInterval(timer); timer = null; }

      const prevBtn = Utils.el('button', { class: 'slideshow__nav slideshow__nav--prev welcome-overlay__nav-btn', type: 'button', 'aria-label': 'Previous slide', onClick: () => { stopAutoplay(); prev(); startAutoplay(); } }, '\u2039');
      const nextBtn = Utils.el('button', { class: 'slideshow__nav slideshow__nav--next welcome-overlay__nav-btn', type: 'button', 'aria-label': 'Next slide', onClick: () => { stopAutoplay(); next(); startAutoplay(); } }, '\u203a');

      let touchStartX = null;
      stage.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; stopAutoplay(); }, { passive: true });
      stage.addEventListener('touchend', (e) => {
        if (touchStartX == null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); }
        touchStartX = null;
        startAutoplay();
      }, { passive: true });

      const skipBtn = Utils.el('button', { class: 'welcome-overlay__skip', type: 'button', onClick: dismiss }, 'Skip');

      const overlay = Utils.el('div', { class: 'welcome-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome' }, [
        skipBtn,
        Utils.el('div', { class: 'welcome-overlay__viewport' }, [prevBtn, stage, nextBtn]),
        dotsRow,
      ]);
      overlay.addEventListener('mouseenter', stopAutoplay);
      overlay.addEventListener('mouseleave', startAutoplay);

      document.body.appendChild(overlay);
      renderSlide(0);
      requestAnimationFrame(() => overlay.classList.add('welcome-overlay--visible'));
      startAutoplay();
    });
  }

  return { showIfNeeded };
})();
