/* Transaction ledger, manual entry and CSV import. */

import { api } from '../api.js';
import { todayKey } from '/shared/dates.js';
import {
  accountOptions, card, confirmDialog, dateLabel, field, h, modal, money,
  ownerName, ownerOptions, pill, select, toast, toInput,
} from '../ui.js';

function transactionForm(tx, state) {
  const people = state.settings.people;
  const options = accountOptions(state.accounts, people);

  const kindSelect = select(
    [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }],
    tx?.kind ?? 'expense', { name: 'kind' },
  );

  const conditional = h('div', { class: 'form-grid', style: { gridColumn: '1 / -1' } });
  const renderConditional = () => {
    conditional.replaceChildren();
    if (kindSelect.value === 'transfer') {
      conditional.append(field('To account',
        select(options, tx?.transferAccountId ?? options[0]?.value, { name: 'transferAccountId' }),
        { hint: 'Transfers into savings or investments count towards your savings rate' }));
    } else {
      const cats = state.categories.filter((c) => c.kind === (kindSelect.value === 'income' ? 'income' : 'expense'));
      conditional.append(field('Category',
        select(cats.map((c) => ({ value: c.id, label: c.name })), tx?.category ?? cats[0]?.id, { name: 'category' })));
    }
  };
  kindSelect.addEventListener('change', renderConditional);

  const form = h('div', { class: 'form-grid' },
    field('Date', h('input', { class: 'input', type: 'date', name: 'date', required: true, value: tx?.date ?? todayKey() })),
    field('Amount', h('input', {
      class: 'input tabular', name: 'amount', required: true, inputmode: 'decimal',
      placeholder: '0.00', value: toInput(tx ? Math.abs(tx.amount) : null),
    }), { hint: 'Always positive — the type below sets the direction' }),
    field('Type', kindSelect),
    field('Account', select(options, tx?.accountId ?? options[0]?.value, { name: 'accountId' })),
    field('Description', h('input', { class: 'input', name: 'description', placeholder: 'Grocery run', value: tx?.description ?? '' })),
    field('Who', select(ownerOptions(people), tx?.ownerId ?? 'joint', { name: 'ownerId' })),
    conditional,
  );
  renderConditional();
  return form;
}

function importForm(state) {
  const accounts = state.accounts.filter((a) => !a.archived);
  return h('div', { class: 'stack', style: { gap: '14px' } },
    field('Import into account',
      select(accounts.map((a) => ({ value: a.id, label: a.name })), accounts[0]?.id, { name: 'accountId' })),
    field('CSV contents', h('textarea', {
      class: 'input', name: 'csv', required: true, rows: '9',
      placeholder: 'Date,Description,Amount\n2026-08-03,Coffee,-4.50',
    }), { hint: 'Paste your bank export. Date, description and amount columns are detected automatically, including separate debit/credit columns.' }),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'flipSign' }),
      'Flip the sign (for card exports that list purchases as positive)'),
    h('div', { class: 'field-hint' }, 'Rows identical to ones already imported are skipped.'),
  );
}

export function renderTransactions(ctx) {
  const { state, month } = ctx;
  const people = state.settings.people;
  const accountName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '—';
  const categoryName = (id) => state.categories.find((c) => c.id === id)?.name ?? id ?? '—';

  const filters = { month, accountId: '', ownerId: '', q: '' };
  const tbody = h('tbody', {});
  const summary = h('div', { class: 'row-tight' });

  const load = async () => {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: '7', class: 'muted', style: { padding: '24px', textAlign: 'center' } }, 'Loading…')));
    try {
      const { transactions, total } = await api.transactions(filters);
      summary.replaceChildren(
        pill(`${total} transaction${total === 1 ? '' : 's'}`, 'neutral'),
        pill(`${money(transactions.filter((t) => t.kind === 'expense').reduce((a, t) => a - t.amount, 0))} out`, 'neutral'),
        pill(`${money(transactions.filter((t) => t.kind === 'income').reduce((a, t) => a + t.amount, 0))} in`, 'neutral'),
      );
      if (!transactions.length) {
        tbody.replaceChildren(h('tr', {},
          h('td', { colspan: '7', class: 'muted', style: { padding: '30px', textAlign: 'center' } },
            'No transactions match these filters.')));
        return;
      }
      tbody.replaceChildren(...transactions.map((tx) => h('tr', {},
        h('td', {}, dateLabel(tx.date)),
        h('td', { class: 'name' }, tx.description || h('span', { class: 'muted' }, 'No description')),
        h('td', {}, accountName(tx.accountId)),
        h('td', {}, tx.kind === 'transfer'
          ? pill(`→ ${accountName(tx.transferAccountId)}`, 'neutral')
          : h('span', { class: 'chip' }, categoryName(tx.category))),
        h('td', {}, ownerName(people, tx.ownerId)),
        h('td', { class: 'num', style: { color: tx.amount > 0 ? 'var(--good-text)' : null, fontWeight: '600' } },
          (tx.amount > 0 ? '+' : '') + money(tx.amount)),
        h('td', { class: 'num' },
          h('div', { class: 'row-tight', style: { justifyContent: 'flex-end' } },
            h('button', { class: 'btn btn-sm', onclick: () => openForm(tx) }, 'Edit'),
            h('button', { class: 'btn btn-sm btn-danger', onclick: () => remove(tx) }, '✕'))),
      )));
    } catch (err) {
      tbody.replaceChildren(h('tr', {}, h('td', { colspan: '7', class: 'muted' }, err.message)));
    }
  };

  const openForm = async (tx) => {
    if (!state.accounts.length) {
      toast('Add an account first', 'error');
      return;
    }
    const saved = await modal({
      title: tx ? 'Edit transaction' : 'Add transaction',
      submitLabel: tx ? 'Save changes' : 'Add',
      render: () => transactionForm(tx, state),
      onSubmit: async (data) => {
        const body = {
          date: data.get('date'),
          amount: data.get('amount'),
          kind: data.get('kind'),
          accountId: data.get('accountId'),
          description: data.get('description'),
          ownerId: data.get('ownerId'),
          category: data.get('category') || null,
          transferAccountId: data.get('transferAccountId') || null,
        };
        if (tx) await api.updateTransaction(tx.id, body);
        else await api.createTransaction(body);
        return true;
      },
    });
    if (saved) {
      toast(tx ? 'Transaction updated' : 'Transaction added');
      await ctx.refresh({ silent: true });
      await load();
    }
  };

  const remove = async (tx) => {
    const ok = await confirmDialog({
      title: 'Delete transaction?',
      message: `${tx.description || 'This transaction'} — ${money(tx.amount)} on ${dateLabel(tx.date)}.`,
    });
    if (!ok) return;
    await api.deleteTransaction(tx.id);
    toast('Transaction deleted');
    await ctx.refresh({ silent: true });
    await load();
  };

  const openImport = async () => {
    if (!state.accounts.length) {
      toast('Add an account first', 'error');
      return;
    }
    const result = await modal({
      title: 'Import transactions from CSV',
      submitLabel: 'Import',
      width: 620,
      render: () => importForm(state),
      onSubmit: (data) => api.importTransactions({
        accountId: data.get('accountId'),
        csv: data.get('csv'),
        flipSign: data.get('flipSign') === 'on',
      }),
    });
    if (result && result.imported !== undefined) {
      const parts = [`Imported ${result.imported}`];
      if (result.duplicates) parts.push(`${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped`);
      if (result.skipped?.length) parts.push(`${result.skipped.length} row${result.skipped.length === 1 ? '' : 's'} unreadable`);
      toast(parts.join(' · '));
      await ctx.refresh({ silent: true });
      await load();
    }
  };

  const monthOptions = [{ value: '', label: 'All months' }, ...ctx.monthOptions];
  const filterBar = h('div', { class: 'row', style: { marginBottom: '12px' } },
    select(monthOptions, month, { onchange: (e) => { filters.month = e.target.value; load(); }, style: 'width:auto' }),
    select(accountOptions(state.accounts, people, { includeArchived: true, placeholder: 'All accounts' }),
      '', { onchange: (e) => { filters.accountId = e.target.value; load(); }, style: 'width:auto' }),
    select([{ value: '', label: 'Everyone' }, ...ownerOptions(people)],
      '', { onchange: (e) => { filters.ownerId = e.target.value; load(); }, style: 'width:auto' }),
    h('input', {
      class: 'input', placeholder: 'Search description…', style: { width: 'auto', flex: '1', minWidth: '160px' },
      oninput: debounce((e) => { filters.q = e.target.value; load(); }, 220),
    }),
    summary,
  );

  load();

  return card('Transactions', {
    note: 'Categorised spending, income and transfers',
    actions: h('div', { class: 'row-tight' },
      h('button', { class: 'btn', onclick: openImport }, 'Import CSV'),
      h('button', { class: 'btn btn-primary', onclick: () => openForm(null) }, 'Add transaction')),
  },
    filterBar,
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Date'), h('th', {}, 'Description'), h('th', {}, 'Account'),
          h('th', {}, 'Category'), h('th', {}, 'Who'),
          h('th', { class: 'num' }, 'Amount'), h('th', { class: 'num' }, ''))),
        tbody)),
  );
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
