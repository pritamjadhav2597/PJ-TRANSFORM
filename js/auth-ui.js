/**
 * auth-ui.js
 * ---------------------------------------------------------------------------
 * Full-screen login / signup gate rendered into #app before the router ever
 * starts. Resolves once the person is signed in (or chooses to continue in
 * local-only mode, if Supabase isn't configured yet).
 * ---------------------------------------------------------------------------
 */

const AuthUI = (() => {

  function render({ onAuthenticated, initialNotice = null }) {
    const app = document.getElementById('app');
    app.innerHTML = '';

    let mode = 'signin'; // 'signin' | 'signup' | 'reset'
    let pendingNotice = initialNotice; // text to show once, right after a redraw (e.g. "check your email")

    const wrap = Utils.el('div', { class: 'auth-screen' });
    app.appendChild(wrap);

    function draw() {
      wrap.innerHTML = '';

      const card = Utils.el('div', { class: 'card auth-card' });

      const brand = Utils.el('div', { class: 'auth-brand' }, [
        Utils.el('span', { class: 'auth-brand__mark' }, '◐'),
        Utils.el('span', { class: 'auth-brand__text' }, 'Transform'),
      ]);

      const title = Utils.el('h1', { class: 'auth-title' },
        mode === 'signup' ? 'Create your account'
        : mode === 'reset' ? 'Reset your password'
        : 'Welcome back');

      const subtitle = Utils.el('p', { class: 'auth-subtitle' },
        mode === 'signup' ? 'Your data syncs across every device you sign in on.'
        : mode === 'reset' ? "We'll email you a reset link."
        : 'Sign in to pick up right where you left off.');

      const errorBox = Utils.el('div', { class: 'error-list', style: 'display:none;' });

      if (pendingNotice) {
        errorBox.className = 'auth-notice';
        errorBox.textContent = pendingNotice;
        errorBox.style.display = 'block';
        pendingNotice = null;
      }

      const emailField = Utils.el('div', { class: 'form__field' }, [
        Utils.el('label', { class: 'form__label' }, 'Email'),
        Utils.el('input', { class: 'form__input', type: 'email', id: 'auth-email', autocomplete: 'email', placeholder: 'you@example.com' }),
      ]);

      const passwordField = Utils.el('div', { class: 'form__field' }, [
        Utils.el('label', { class: 'form__label' }, 'Password'),
        Utils.el('input', {
          class: 'form__input', type: 'password', id: 'auth-password',
          autocomplete: mode === 'signup' ? 'new-password' : 'current-password',
          placeholder: mode === 'signup' ? 'At least 6 characters' : '••••••••',
        }),
      ]);

      const fields = [emailField];
      if (mode !== 'reset') fields.push(passwordField);

      const submitLabel = mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in';

      const submitBtn = Utils.el('button', { class: 'btn btn--primary auth-submit', type: 'submit' }, submitLabel);

      const form = Utils.el('form', {
        class: 'form auth-form',
        onSubmit: async (e) => {
          e.preventDefault();
          errorBox.style.display = 'none';
          const email = document.getElementById('auth-email').value.trim();
          const password = mode === 'reset' ? null : document.getElementById('auth-password').value;

          if (!email) return showError('Enter your email address.');
          if (mode !== 'reset' && (!password || password.length < 6)) {
            return showError('Password must be at least 6 characters.');
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Please wait…';

          try {
            if (mode === 'signup') {
              const { data, error } = await AuthService.signUp(email, password);
              if (error) return showError(error.message);
              if (data.session) {
                onAuthenticated(data.session);
              } else {
                pendingNotice = 'Account created. Check your email and click the confirmation link, then come back here to sign in.';
                mode = 'signin';
                draw();
              }
            } else if (mode === 'reset') {
              const { error } = await AuthService.resetPasswordForEmail(email);
              if (error) return showError(error.message);
              pendingNotice = 'Reset link sent — check your email.';
              mode = 'signin';
              draw();
            } else {
              const { data, error } = await AuthService.signIn(email, password);
              if (error) {
                if (/email not confirmed/i.test(error.message)) {
                  return showError('Please confirm your email first — check your inbox for the link we sent when you signed up.');
                }
                return showError(error.message);
              }
              onAuthenticated(data.session);
            }
          } catch (err) {
            showError(err.message || 'Something went wrong. Try again.');
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = submitLabel;
          }
        },
      }, [...fields, errorBox, Utils.el('div', { class: 'form__actions' }, [submitBtn])]);

      function showError(msg) {
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
      }

      const switchLine = Utils.el('p', { class: 'auth-switch' });
      if (mode === 'signin') {
        switchLine.appendChild(document.createTextNode("Don't have an account? "));
        switchLine.appendChild(Utils.el('a', { href: '#', onClick: (e) => { e.preventDefault(); mode = 'signup'; draw(); } }, 'Create one'));
        switchLine.appendChild(document.createTextNode('  ·  '));
        switchLine.appendChild(Utils.el('a', { href: '#', onClick: (e) => { e.preventDefault(); mode = 'reset'; draw(); } }, 'Forgot password?'));
      } else if (mode === 'signup') {
        switchLine.appendChild(document.createTextNode('Already have an account? '));
        switchLine.appendChild(Utils.el('a', { href: '#', onClick: (e) => { e.preventDefault(); mode = 'signin'; draw(); } }, 'Sign in'));
      } else {
        switchLine.appendChild(Utils.el('a', { href: '#', onClick: (e) => { e.preventDefault(); mode = 'signin'; draw(); } }, '← Back to sign in'));
      }

      card.appendChild(brand);
      card.appendChild(title);
      card.appendChild(subtitle);
      card.appendChild(form);
      card.appendChild(switchLine);

      if (!AuthService.isConfigured()) {
        card.appendChild(Utils.el('div', { class: 'auth-local-notice' }, [
          Utils.el('p', {}, 'Cloud sync isn\u2019t configured yet, so accounts can\u2019t be created right now.'),
          Utils.el('button', {
            class: 'btn btn--secondary',
            type: 'button',
            onClick: () => onAuthenticated(null), // fall back to local-only mode
          }, 'Continue without an account'),
        ]));
      }

      wrap.appendChild(card);
    }

    draw();
  }

  /**
   * Shown when someone arrives via a "reset your password" email link.
   * Supabase has already logged them into a temporary recovery session at
   * this point — this screen just collects a new password and applies it.
   */
  function renderSetNewPassword({ onDone }) {
    const app = document.getElementById('app');
    app.innerHTML = '';

    const wrap = Utils.el('div', { class: 'auth-screen' });
    app.appendChild(wrap);

    const card = Utils.el('div', { class: 'card auth-card' });

    const brand = Utils.el('div', { class: 'auth-brand' }, [
      Utils.el('span', { class: 'auth-brand__mark' }, '◐'),
      Utils.el('span', { class: 'auth-brand__text' }, 'Transform'),
    ]);
    const title = Utils.el('h1', { class: 'auth-title' }, 'Set a new password');
    const subtitle = Utils.el('p', { class: 'auth-subtitle' }, 'Choose a new password for your account.');
    const errorBox = Utils.el('div', { class: 'error-list', style: 'display:none;' });

    const passwordField = Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label' }, 'New password'),
      Utils.el('input', { class: 'form__input', type: 'password', id: 'new-password', autocomplete: 'new-password', placeholder: 'At least 6 characters' }),
    ]);
    const confirmField = Utils.el('div', { class: 'form__field' }, [
      Utils.el('label', { class: 'form__label' }, 'Confirm password'),
      Utils.el('input', { class: 'form__input', type: 'password', id: 'confirm-password', autocomplete: 'new-password', placeholder: 'Type it again' }),
    ]);

    const submitBtn = Utils.el('button', { class: 'btn btn--primary auth-submit', type: 'submit' }, 'Update password');

    const form = Utils.el('form', {
      class: 'form auth-form',
      onSubmit: async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';
        const pw = document.getElementById('new-password').value;
        const confirmPw = document.getElementById('confirm-password').value;

        if (!pw || pw.length < 6) return showError('Password must be at least 6 characters.');
        if (pw !== confirmPw) return showError('Passwords don\u2019t match.');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating…';
        const { error } = await AuthService.updateUserPassword(pw);
        if (error) {
          showError(error.message);
          return;
        }
        Utils.toast && Utils.toast('Password updated.', 'success');
        onDone();
      },
    }, [passwordField, confirmField, errorBox, Utils.el('div', { class: 'form__actions' }, [submitBtn])]);

    function showError(msg) {
      errorBox.textContent = msg;
      errorBox.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Update password';
    }

    card.appendChild(brand);
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(form);
    wrap.appendChild(card);
  }

  return { render, renderSetNewPassword };
})();
