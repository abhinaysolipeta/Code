/* App shell: state loading, month selection, routing and theme. */

import { api } from './api.js';
import { addMonths, currentMonth, isMonthKey } from '/shared/dates.js';
import { clear, configureFormat, h, icon, monthLabel } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderUpdate } from './views/update.js';
import { renderAccounts } from './views/accounts.js';
import { renderTransactions } from './views/transactions.js';
import { renderBills } from './views/bills.js';
import { renderSettings } from './views/settings.js';

const ROUTES = {
  dashboard:    { label: 'Monthly report', icon: 'dashboard',    render: renderDashboard, needsReport: true },
  update:       { label: 'Update balances', icon: 'update',      render: renderUpdate },
  accounts:     { label: 'Accounts',        icon: 'accounts',    render: renderAccounts },
  transactions: { label: 'Transactions',    icon: 'transactions', render: renderTransactions },
  bills:        { label: 'Bills',           icon: 'bills',       render: renderBills },
  settings:     { label: 'Settings',        icon: 'settings',    render: renderSettings },
};

const app = {
  route: 'dashboard',
  month: currentMonth(),
  state: null,
  report: null,
};

/* ---- theme -------------------------------------------------------------- */

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ledgerlight-theme', theme);
}

function currentTheme() {
  return localStorage.getItem('ledgerlight-theme') ?? 'system';
}

/* ---- month options ------------------------------------------------------ */

/** Every month we hold data for, plus the current one, newest first. */
function buildMonthOptions(state) {
  const months = new Set([currentMonth()]);
  for (const s of state.snapshots) months.add(s.month);
  for (let i = 1; i <= 3; i++) months.add(addMonths(currentMonth(), -i));
  const sorted = [...months].filter(isMonthKey).sort().reverse();
  return sorted.map((m) => ({ value: m, label: monthLabel(m, true) }));
}

/* ---- shell -------------------------------------------------------------- */

function buildSidebar() {
  const nav = h('nav', { class: 'nav' },
    h('div', { class: 'nav-label' }, 'Household'),
    ...Object.entries(ROUTES).map(([key, route]) => h('a', {
      href: `#${key}`,
      class: app.route === key ? 'active' : '',
    }, icon(route.icon), route.label)),
  );

  const theme = currentTheme();
  const themeBtn = h('button', {
    class: 'btn btn-sm',
    style: { width: '100%' },
    onclick: () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      render();
    },
  }, icon(theme === 'dark' ? 'sun' : 'moon', 14), theme === 'dark' ? 'Light mode' : 'Dark mode');

  return h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-mark' }, 'L'),
      h('div', {},
        h('div', { class: 'brand-name' }, 'LedgerLight'),
        h('div', { class: 'brand-sub' }, app.state?.settings.household ?? ''))),
    nav,
    h('div', { class: 'sidebar-footer' },
      themeBtn,
      h('div', { class: 'brand-sub', style: { padding: '0 6px' } }, 'Data stays on this machine')),
  );
}

function buildTopbar(ctx) {
  const route = ROUTES[app.route];
  const showMonth = ['dashboard', 'update', 'transactions'].includes(app.route);

  const monthSelect = h('select', {
    style: { width: 'auto' },
    'aria-label': 'Reporting month',
    onchange: (e) => {
      app.month = e.target.value;
      location.hash = `#${app.route}/${app.month}`;
    },
  }, ...ctx.monthOptions.map((o) => h('option', { value: o.value, selected: o.value === app.month }, o.label)));

  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-title' },
      h('h1', {}, route.label),
      h('div', { class: 'topbar-sub' },
        app.route === 'dashboard'
          ? `${app.state.settings.household} · ${monthLabel(app.month, true)}`
          : app.state.settings.household)),
    showMonth ? monthSelect : null,
    app.route === 'dashboard'
      ? h('div', { class: 'row-tight no-print' },
          h('a', { class: 'btn', href: `/api/report.csv?month=${app.month}` }, 'Export CSV'),
          h('button', { class: 'btn', onclick: () => window.print() }, 'Print'),
          h('a', { class: 'btn btn-primary', href: '#update' }, 'Update balances'))
      : null,
  );
}

/* ---- rendering ---------------------------------------------------------- */

const root = document.getElementById('app');

async function loadState({ silent = false } = {}) {
  app.state = await api.state();
  configureFormat(app.state.settings);
  if (ROUTES[app.route]?.needsReport) {
    app.report = await api.report(app.month, 12);
  }
  if (!silent) return app.state;
  return app.state;
}

function render() {
  const ctx = {
    state: app.state,
    report: app.report,
    month: app.month,
    monthOptions: buildMonthOptions(app.state),
    refresh: async (opts) => {
      await loadState(opts ?? {});
      if (!opts?.silent) render();
    },
    navigate: (route) => { location.hash = `#${route}`; },
  };

  const route = ROUTES[app.route] ?? ROUTES.dashboard;
  let body;
  try {
    body = route.render(ctx);
  } catch (err) {
    console.error(err);
    body = h('div', { class: 'alert danger' },
      h('span', { class: 'alert-icon' }, icon('alert')),
      h('div', {},
        h('div', { class: 'alert-title' }, 'Something went wrong rendering this page'),
        h('div', { class: 'alert-detail' }, err.message)));
  }

  clear(root);
  root.appendChild(h('div', { class: 'app' },
    buildSidebar(),
    h('div', { class: 'main' }, buildTopbar(ctx), h('div', { class: 'content' }, body))));
}

function showFatal(message) {
  clear(root);
  root.appendChild(h('div', { class: 'loading' },
    h('h2', {}, 'Could not load your data'),
    h('p', { class: 'muted', style: { marginTop: '8px' } }, message),
    h('p', { class: 'muted', style: { marginTop: '8px', fontSize: '12px' } },
      'Check the terminal running the server for details.')));
}

async function route() {
  const [name, month] = location.hash.replace(/^#/, '').split('/');
  app.route = ROUTES[name] ? name : 'dashboard';
  if (isMonthKey(month)) app.month = month;

  root.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await loadState();
    render();
  } catch (err) {
    showFatal(err.message);
  }
}

window.addEventListener('hashchange', route);

applyTheme(currentTheme());
route();
