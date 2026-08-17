/* DOM helpers, formatting bound to household settings, toasts and modals. */

import { formatMoney, formatPercent, centsToDecimal } from '/shared/money.js';
import { formatMonth, formatDate } from '/shared/dates.js';

/* ---- element construction ---------------------------------------------- */

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/* ---- formatting --------------------------------------------------------- */

let currency = 'USD';
let locale = 'en-US';

export function configureFormat(settings) {
  currency = settings?.currency ?? 'USD';
  locale = settings?.locale ?? 'en-US';
}

/** `compact` shortens large figures for axis ticks and dense labels. */
export const money = (cents, compact = false) =>
  formatMoney(cents ?? 0, { currency, locale, compact });

export const moneySigned = (cents) =>
  formatMoney(cents ?? 0, { currency, locale, signed: true });

export const pct = (value, digits = 1) => formatPercent(value, digits);
export const monthLabel = (m, long = false) => formatMonth(m, { long, locale });
export const dateLabel = (d) => formatDate(d, { locale });
export const shortMonth = (m) => formatMonth(m, { locale }).replace(/ (\d{2})(\d{2})$/, " '$2");
export const toInput = (cents) => (cents === null || cents === undefined ? '' : centsToDecimal(cents));

/* ---- small components --------------------------------------------------- */

export function statTile({ label, value, foot, delta, accent }) {
  return h('div', { class: 'card' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value', style: accent ? { color: accent } : null }, value),
      foot || delta ? h('div', { class: 'stat-foot' }, delta ?? null, foot ?? null) : null,
    ));
}

/** Direction is spelled out with an arrow glyph and words, never colour alone. */
export function deltaBadge(cents, { invert = false, suffix = 'vs last month' } = {}) {
  const positive = cents > 0;
  const good = invert ? !positive : positive;
  const cls = cents === 0 ? 'flat' : good ? 'up' : 'down';
  const arrow = cents === 0 ? '→' : positive ? '↑' : '↓';
  return h('span', { class: `delta ${cls}` },
    h('span', { 'aria-hidden': 'true' }, arrow),
    `${money(Math.abs(cents))} ${suffix}`);
}

export function pill(text, tone = 'neutral', icon) {
  return h('span', { class: `pill pill-${tone}` }, icon ? h('span', { 'aria-hidden': 'true' }, icon) : null, text);
}

export function card(title, options = {}, ...body) {
  const head = title || options.actions
    ? h('div', { class: 'card-head' },
        title ? h('div', { style: { marginRight: 'auto' } },
          h('h2', {}, title),
          options.note ? h('div', { class: 'card-note' }, options.note) : null,
        ) : null,
        options.actions ?? null)
    : null;
  return h('div', { class: 'card' }, head,
    h('div', { class: `card-body${options.center ? ' center' : ''}` }, ...body));
}

export function field(label, control, { hint, error } = {}) {
  return h('div', { class: 'field' },
    h('label', {}, label),
    control,
    error ? h('div', { class: 'field-error' }, error) : hint ? h('div', { class: 'field-hint' }, hint) : null,
  );
}

export function select(options, value, attrs = {}) {
  return h('select', attrs,
    ...options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
}

export function emptyState(title, message, action) {
  return h('div', { class: 'empty' }, h('h3', {}, title), h('p', {}, message), action ?? null);
}

/* ---- toasts ------------------------------------------------------------- */

const toastHost = h('div', { class: 'toasts' });
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(toastHost));

export function toast(message, tone = 'success') {
  const node = h('div', { class: `toast ${tone}` }, message);
  toastHost.appendChild(node);
  setTimeout(() => node.remove(), tone === 'error' ? 6000 : 3200);
}

/* ---- modal -------------------------------------------------------------- */

/**
 * Opens a modal and resolves with the submitted value, or null on cancel.
 * `render` receives a helper to close with a value.
 */
export function modal({ title, render, submitLabel = 'Save', onSubmit, width }) {
  return new Promise((resolve) => {
    const body = h('div', { class: 'modal-body' });
    const errorBox = h('div', { class: 'field-error', style: { marginRight: 'auto' } });

    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };

    const form = h('form', {
      class: 'modal',
      style: width ? { width: `min(${width}px, 100%)` } : null,
      onsubmit: async (e) => {
        e.preventDefault();
        errorBox.textContent = '';
        submit.disabled = true;
        try {
          const result = await onSubmit(new FormData(form), form);
          close(result ?? true);
        } catch (err) {
          errorBox.textContent = err.message ?? 'Something went wrong';
          if (err.field) {
            const input = form.querySelector(`[name="${err.field}"]`);
            if (input) { input.classList.add('err'); input.focus(); }
          }
        } finally {
          submit.disabled = false;
        }
      },
    });

    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);
    body.appendChild(render(close));

    form.append(
      h('div', { class: 'modal-head' },
        h('h2', {}, title),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, '✕')),
      body,
      h('div', { class: 'modal-foot' },
        errorBox,
        h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
        submit),
    );

    const backdrop = h('div', {
      class: 'modal-backdrop',
      onclick: (e) => { if (e.target === backdrop) close(null); },
    }, form);

    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    // Focus the first control so the dialog is usable from the keyboard alone.
    setTimeout(() => body.querySelector('input, select, textarea')?.focus(), 20);
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const close = (value) => { backdrop.remove(); resolve(value); };
    const box = h('div', { class: 'modal', style: { width: 'min(430px, 100%)' } },
      h('div', { class: 'modal-head' }, h('h2', {}, title)),
      h('div', { class: 'modal-body' }, h('p', { class: 'secondary' }, message)),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, confirmLabel)),
    );
    const backdrop = h('div', {
      class: 'modal-backdrop',
      onclick: (e) => { if (e.target === backdrop) close(false); },
    }, box);
    document.body.appendChild(backdrop);
  });
}

/* ---- icons (inline, so nothing is fetched at runtime) ------------------- */

const ICONS = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z',
  update: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  accounts: 'M3 7h18v12H3zM3 11h18M7 15h4',
  transactions: 'M4 7h13l-3-3M20 17H7l3 3',
  bills: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5 2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  check: 'M20 6 9 17l-5-5',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
};

export function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] ?? ICONS.info);
  svg.appendChild(path);
  return svg;
}

/* ---- misc --------------------------------------------------------------- */

export function ownerName(people, ownerId) {
  if (ownerId === 'joint') return 'Joint';
  return people.find((p) => p.id === ownerId)?.name ?? 'Unassigned';
}

export function ownerColor(people, ownerId) {
  if (ownerId === 'joint') return 'var(--text-muted)';
  const person = people.find((p) => p.id === ownerId);
  if (!person) return 'var(--text-muted)';
  return `var(--series-${(Number.isInteger(person.colorSlot) ? person.colorSlot : 0) + 1})`;
}

export function ownerOptions(people, { includeJoint = true } = {}) {
  return [
    ...(includeJoint ? [{ value: 'joint', label: 'Joint' }] : []),
    ...people.map((p) => ({ value: p.id, label: p.name })),
  ];
}

export function download(filename, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
