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

  return { formatDate, formatDateTime, fmt, el, qs, qsa, debounce, Validate, toast };
})();
