/**
 * video-modal.js
 * ---------------------------------------------------------------------------
 * The floating "picture-in-picture" exercise video panel opened by the (?)
 * button next to any exercise. Deliberately NOT a full-screen takeover or a
 * route change — it's a small floating card layered over whatever page is
 * already open, with its own close (X), so a person can check form on an
 * exercise without losing their place mid-workout.
 *
 * Singleton: only one panel exists at a time (a second open() call just
 * swaps its content), appended once to <body> the first time it's needed.
 * ---------------------------------------------------------------------------
 */

const VideoModal = (() => {

  let panelEl = null;

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = Utils.el('div', { class: 'video-pip', id: 'video-pip' });
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function close() {
    if (!panelEl) return;
    panelEl.classList.remove('video-pip--open');
    panelEl.innerHTML = '';
  }

  function renderBody(exerciseName, video) {
    if (video && video.videoId) {
      const iframe = Utils.el('iframe', {
        src: ExerciseVideo.buildEmbedUrl(video.videoId),
        class: 'video-pip__frame',
        title: `${exerciseName} demo video`,
        frameborder: '0',
        allow: 'autoplay; encrypted-media; picture-in-picture',
        allowfullscreen: 'true',
      });
      return Utils.el('div', { class: 'video-pip__body' }, [
        iframe,
        video.source === 'custom'
          ? Utils.el('p', { class: 'video-pip__note' }, 'Video attached by you or another user of this app.')
          : null,
      ].filter(Boolean));
    }

    // No video yet for this exercise — offer a real YouTube search (not a
    // guessed link) plus a way to attach one for next time.
    const input = Utils.el('input', {
      class: 'form__input', type: 'text', placeholder: 'Paste a YouTube link…',
    });
    const saveBtn = Utils.el('button', { class: 'btn btn--secondary btn--row', type: 'button' }, 'Save');
    const errorMsg = Utils.el('p', { class: 'video-pip__error', style: 'display:none;' });

    saveBtn.addEventListener('click', async () => {
      const id = await ExerciseVideo.saveCustom(exerciseName, input.value);
      if (!id) {
        errorMsg.textContent = "That doesn't look like a YouTube link.";
        errorMsg.style.display = 'block';
        return;
      }
      open(exerciseName); // re-render now showing the newly attached video
    });

    return Utils.el('div', { class: 'video-pip__body video-pip__body--empty' }, [
      Utils.el('div', { class: 'video-pip__empty-icon' }, '🎬'),
      Utils.el('p', { class: 'video-pip__empty-title' }, 'No demo video yet'),
      Utils.el('p', { class: 'video-pip__empty-text' }, `Nothing's been linked for "${exerciseName}" yet.`),
      Utils.el('a', {
        class: 'btn btn--secondary btn--row', href: ExerciseVideo.buildSearchUrl(exerciseName),
        target: '_blank', rel: 'noopener',
      }, 'Search YouTube \u2197'),
      Utils.el('div', { class: 'video-pip__attach' }, [
        Utils.el('label', { class: 'form__label' }, 'Found a good one? Attach it here for next time:'),
        Utils.el('div', { class: 'row-actions' }, [input, saveBtn]),
        errorMsg,
      ]),
    ]);
  }

  /** Opens (or re-renders) the panel for the given exercise name. */
  async function open(exerciseName) {
    const panel = ensurePanel();
    panel.innerHTML = '';
    panel.classList.add('video-pip--open');

    const header = Utils.el('div', { class: 'video-pip__header' }, [
      Utils.el('span', { class: 'video-pip__title' }, exerciseName),
      Utils.el('button', {
        class: 'video-pip__close', type: 'button', 'aria-label': 'Close video',
        onClick: () => close(),
      }, '\u2715'),
    ]);
    panel.appendChild(header);

    const loading = Utils.el('div', { class: 'video-pip__body video-pip__body--loading' }, 'Loading…');
    panel.appendChild(loading);

    const video = await ExerciseVideo.resolve(exerciseName);
    if (!panelEl.classList.contains('video-pip--open')) return; // closed while resolving
    loading.remove();
    panel.appendChild(renderBody(exerciseName, video));
  }

  return { open, close };
})();
