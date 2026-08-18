/* Entry point for the standalone preview build.
 *
 * Runs the real report engine and the real dashboard against a demo household
 * held in memory. There is no server and nothing is persisted: ticking a
 * payment off recomputes the report exactly as it would in the app, and a
 * reload puts everything back.
 */

import { buildMonthlyReport } from '../shared/report.js';
import { currentMonth, isMonthKey, monthRange } from '../shared/dates.js';
import { clear, configureFormat, h, monthLabel, pill, toast } from '../public/js/ui.js';
import { renderDashboard } from '../public/js/views/dashboard.js';

const DB = /*__DEMO_DB__*/ null;
const TODAY = /*__DEMO_TODAY__*/ null;

configureFormat(DB.settings);

const months = monthRange(
  DB.snapshots.reduce((latest, s) => (s.month > latest ? s.month : latest), '0000-01'),
  12,
).reverse();

let month = months[0];
const root = document.getElementById('app');

function ctx() {
  return {
    report: buildMonthlyReport(DB, month, { today: TODAY, trendMonths: 12 }),
    month,
    // In the real app this refetches from the server; here the ledger is
    // already in memory, so re-rendering is the whole of it.
    refresh: async () => { render(); },
    navigate: () => {},
  };
}

/* The preview swaps the server-backed API for direct edits to the in-memory
 * ledger, so the payments checklist behaves exactly as it does in the app. */
export const previewApi = {
  markPaid: async ({ month: m, source, refId, amount, paidOn }) => {
    const existing = DB.payments.find((p) => p.month === m && p.source === source && p.refId === refId);
    if (existing) Object.assign(existing, { amount, paidOn });
    else DB.payments.push({ id: `pay-${Date.now()}`, month: m, source, refId, amount, paidOn });
  },
  unmarkPaid: async (m, source, refId) => {
    const i = DB.payments.findIndex((p) => p.month === m && p.source === source && p.refId === refId);
    if (i !== -1) DB.payments.splice(i, 1);
  },
};

function header() {
  const select = h('select', {
    style: { width: 'auto' },
    'aria-label': 'Reporting month',
    onchange: (e) => { month = e.target.value; render(); },
  }, ...months.map((m) => h('option', { value: m, selected: m === month }, monthLabel(m, true))));

  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-title' },
      h('h1', {}, 'Monthly report'),
      h('div', { class: 'topbar-sub' }, `${DB.settings.household} · ${monthLabel(month, true)}`)),
    select,
    pill('Sample data', 'neutral'));
}

function banner() {
  return h('div', { class: 'alert info' },
    h('div', {},
      h('div', { class: 'alert-title' }, 'This is a preview, running on a sample household'),
      h('div', { class: 'alert-detail' },
        'Every figure here is invented. The real app runs on your own machine — your balances stay in a file on your computer and are never uploaded. Switch months and tick payments off to try it; nothing is saved.')));
}

function render() {
  clear(root);
  root.appendChild(h('div', { class: 'main' },
    header(),
    h('div', { class: 'content stack' }, banner(), renderDashboard(ctx()))));
}

render();
