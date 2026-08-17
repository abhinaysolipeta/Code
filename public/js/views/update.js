/* The once-a-month chore, on one screen: every account, one number each.
 * Credit cards additionally take the statement figures that drive payments due. */

import { api } from '../api.js';
import { ACCOUNT_TYPES } from '/shared/model.js';
import { dayInMonth } from '/shared/dates.js';
import {
  card, h, money, monthLabel, ownerName, pill, shortMonth, toast, toInput,
} from '../ui.js';

export function renderUpdate(ctx) {
  const { state, month } = ctx;
  const accounts = state.accounts.filter((a) => !a.archived);

  if (!accounts.length) {
    return card('Monthly update', {}, h('div', { class: 'chart-empty' },
      'Add your accounts first, then come back here each month to record balances.'));
  }

  const existing = new Map(
    state.snapshots.filter((s) => s.month === month).map((s) => [s.accountId, s]),
  );
  // What was on file last month, shown as a hint so a typo stands out.
  const previous = new Map();
  for (const s of state.snapshots) {
    if (s.month >= month) continue;
    const prior = previous.get(s.accountId);
    if (!prior || s.month > prior.month) previous.set(s.accountId, s);
  }

  const inputs = new Map();
  const groups = new Map();
  for (const account of accounts) {
    if (!groups.has(account.type)) groups.set(account.type, []);
    groups.get(account.type).push(account);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => (ACCOUNT_TYPES[a[0]]?.order ?? 99) - (ACCOUNT_TYPES[b[0]]?.order ?? 99),
  );

  const status = h('span', { class: 'muted', style: { fontSize: '12.5px' } });

  const rowFor = (account) => {
    const snap = existing.get(account.id);
    const prev = previous.get(account.id);
    const isCredit = account.type === 'credit' || account.type === 'loan';

    const balance = h('input', {
      class: 'input tabular', inputmode: 'decimal', placeholder: '0.00',
      value: toInput(snap?.balance), style: { textAlign: 'right' },
      'aria-label': `${account.name} balance`,
    });
    const statement = isCredit ? h('input', {
      class: 'input tabular', inputmode: 'decimal', placeholder: 'statement',
      value: toInput(snap?.statementBalance), style: { textAlign: 'right' },
      'aria-label': `${account.name} statement balance`,
    }) : null;
    const minimum = isCredit ? h('input', {
      class: 'input tabular', inputmode: 'decimal', placeholder: 'minimum',
      value: toInput(snap?.minimumPayment), style: { textAlign: 'right' },
      'aria-label': `${account.name} minimum payment`,
    }) : null;
    const due = isCredit ? h('input', {
      class: 'input', type: 'date',
      value: snap?.dueDate ?? (account.dueDay ? dayInMonth(nextMonth(month), account.dueDay) : ''),
      'aria-label': `${account.name} due date`,
    }) : null;

    inputs.set(account.id, { balance, statement, minimum, due });

    return h('tr', {},
      h('td', { class: 'name' },
        account.name,
        h('div', { class: 'muted', style: { fontSize: '11.5px' } },
          [account.institution, account.last4 ? `····${account.last4}` : null, ownerName(ctx.state.settings.people, account.ownerId)]
            .filter(Boolean).join(' · '))),
      h('td', { class: 'num muted', style: { whiteSpace: 'nowrap' } },
        prev ? `${money(prev.balance)}` : '—',
        prev ? h('div', { style: { fontSize: '11px' } }, shortMonth(prev.month)) : null),
      h('td', { style: { minWidth: '130px' } }, balance),
      h('td', {}, statement ?? h('span', { class: 'muted' }, '—')),
      h('td', {}, minimum ?? h('span', { class: 'muted' }, '—')),
      h('td', {}, due ?? h('span', { class: 'muted' }, '—')),
    );
  };

  const sections = ordered.map(([type, list]) => h('div', { class: 'stack', style: { gap: '0' } },
    h('div', { class: 'row', style: { padding: '14px 0 6px' } },
      h('h3', {}, ACCOUNT_TYPES[type]?.label ?? type),
      h('span', { class: 'muted', style: { fontSize: '12px' } },
        type === 'credit' || type === 'loan' ? 'Enter what you owe as a positive number' : null)),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Account'),
          h('th', { class: 'num' }, 'Last on file'),
          h('th', {}, 'Balance'),
          h('th', {}, 'Statement'),
          h('th', {}, 'Minimum'),
          h('th', {}, 'Due date'))),
        h('tbody', {}, ...list.map(rowFor)))),
  ));

  const save = async (button) => {
    const entries = [];
    for (const account of accounts) {
      const row = inputs.get(account.id);
      const raw = row.balance.value.trim();
      if (raw === '') continue; // a blank field means "not updated", not zero
      entries.push({
        accountId: account.id,
        month,
        balance: raw,
        statementBalance: row.statement?.value.trim() || null,
        minimumPayment: row.minimum?.value.trim() || null,
        dueDate: row.due?.value || null,
      });
    }
    if (!entries.length) {
      toast('Nothing to save — enter at least one balance.', 'error');
      return;
    }
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      const result = await api.saveSnapshots(month, entries);
      toast(`Saved ${result.saved} account balance${result.saved === 1 ? '' : 's'} for ${monthLabel(month)}`);
      await ctx.refresh();
      ctx.navigate('dashboard');
    } catch (err) {
      toast(err.message, 'error');
      status.textContent = '';
    } finally {
      button.disabled = false;
    }
  };

  const saveBtn = h('button', { class: 'btn btn-primary', onclick: (e) => save(e.currentTarget) },
    `Save ${monthLabel(month)} balances`);

  const filled = accounts.filter((a) => existing.has(a.id)).length;

  return h('div', { class: 'stack' },
    card(`Update balances — ${monthLabel(month, true)}`, {
      note: 'Enter the figure from each statement. Leave a field blank to keep the previous month’s value.',
      actions: pill(`${filled} of ${accounts.length} recorded`, filled === accounts.length ? 'good' : 'neutral',
        filled === accounts.length ? '✓' : ''),
    },
      ...sections,
      h('div', { class: 'row', style: { marginTop: '18px' } }, saveBtn, status)),
  );
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
