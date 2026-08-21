/**
 * utils.js — small shared helpers used across pages.
 */

const Utils = (() => {

  /** Internal storage format is always ISO (YYYY-MM-DD). This formats for display only. */
  function formatDate(isoDate, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
    if (!isoDate) return 'Not available';
    const d = new Date(isoDate + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return 'Not available';
    return d.toLocaleDateString(undefined, options);
  }

  function formatDateTime(isoTimestamp) {
    if (!isoTimestamp) return 'Not available';
    const d = new Date(isoTimestamp);
    if (Number.isNaN(d.getTime())) return 'Not available';
    return d.toLocaleString();
  }

  function fmt(value, suffix = '') {
    if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
      return 'No data entered';
    }
    return `${value}${suffix}`;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, val]) => {
      if (key === 'class') node.className = val;
      else if (key === 'html') node.innerHTML = val;
      else if (key.startsWith('on') && typeof val === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (val !== null && val !== undefined) {
        node.setAttribute(key, val);
      }
    });
    (Array.isArray(children) ? children : [children]).forEach(child => {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function qs(selector, root = document) { return root.querySelector(selector); }
  function qsa(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // -------------------------------------------------------------------
  // Validation helpers — return an error string, or null when valid.
  // -------------------------------------------------------------------
  const Validate = {
    range(value, min, max, label) {
      if (value === null || value === '' || value === undefined) return null; // optional field
      const n = Number(value);
      if (Number.isNaN(n)) return `${label} must be a number.`;
      if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
      return null;
    },
    required(value, label) {
      if (value === null || value === undefined || String(value).trim() === '') {
        return `${label} is required.`;
      }
      return null;
    },
    dateNotFuture(value, label) {
      if (!value) return null;
      const d = new Date(value + 'T00:00:00');
      if (d.getTime() > Date.now()) return `${label} cannot be in the future.`;
      return null;
    },
    positiveInt(value, label) {
      if (value === null || value === '' || value === undefined) return null;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return `${label} must be a whole number, 0 or greater.`;
      return null;
    },
  };

  function toast(message, type = 'info') {
    const host = document.getElementById('toast-host');
    if (!host) { alert(message); return; }
    const node = el('div', { class: `toast toast--${type}` }, message);
    host.appendChild(node);
    requestAnimationFrame(() => node.classList.add('toast--visible'));
    setTimeout(() => {
      node.classList.remove('toast--visible');
      setTimeout(() => node.remove(), 250);
    }, 3200);
  }

  /** Canonicalizes a mobile number so the same person's number always
   *  matches regardless of how it was typed — with or without a country
   *  code, spaces, dashes, parens, or a leading "+"/"0". Strips everything
   *  down to digits, then keeps just the last 10, since that's the actual
   *  subscriber number in India (and most countries) once any country
   *  code / trunk prefix is set aside. So "+91 98765 43210", "919876543210",
   *  "09876543210", and "9876543210" all normalize to "9876543210".
   *  Used both when saving a profile's mobile number and when resolving it
   *  at sign-in — see js/auth-service.js. Without this, a number saved with
   *  a country code would never match the same number typed without one at
   *  sign-in. */
  function normalizeMobile(value) {
    const digits = (value || '').replace(/\D/g, '');
    return digits.slice(-10);
  }

  return { formatDate, formatDateTime, fmt, el, qs, qsa, debounce, Validate, toast, normalizeMobile };
})();
