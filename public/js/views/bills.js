/* Recurring bills -- the predictable half of "payments due". */

import { api } from '../api.js';
import {
  card, confirmDialog, field, h, modal, money, ownerName, ownerOptions,
  pill, select, toast, toInput,
} from '../ui.js';

function billForm(bill, state) {
  const people = state.settings.people;
  const accountOptions = [
    { value: '', label: '— none —' },
    ...state.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name })),
  ];
  const categoryOptions = [
    { value: '', label: '— none —' },
    ...state.categories.filter((c) => c.kind === 'expense').map((c) => ({ value: c.id, label: c.name })),
  ];

  return h('div', { class: 'form-grid' },
    field('Name', h('input', {
      class: 'input', name: 'name', required: true, placeholder: 'Mortgage',
      value: bill?.name ?? '',
    })),
    field('Amount', h('input', {
      class: 'input tabular', name: 'amount', required: true, inputmode: 'decimal',
      placeholder: '0.00', value: toInput(bill?.amount),
    })),
    field('Due day', h('input', {
      class: 'input', name: 'dueDay', type: 'number', min: '1', max: '31',
      value: bill?.dueDay ?? 1,
    }), { hint: 'Day of the month' }),
    field('Paid from', select(accountOptions, bill?.accountId ?? '', { name: 'accountId' })),
    field('Category', select(categoryOptions, bill?.category ?? '', { name: 'category' })),
    field('Owner', select(ownerOptions(people), bill?.ownerId ?? 'joint', { name: 'ownerId' })),
    field('Autopay', h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'autopay', checked: bill?.autopay }),
      'Charged automatically')),
    field('Active', h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'active', checked: bill ? bill.active !== false : true }),
      'Still being billed')),
  );
}

export function renderBills(ctx) {
  const { state } = ctx;
  const people = state.settings.people;
  const accountName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '—';

  const openForm = async (bill) => {
    const saved = await modal({
      title: bill ? `Edit ${bill.name}` : 'Add recurring bill',
      submitLabel: bill ? 'Save changes' : 'Add bill',
      render: () => billForm(bill, state),
      onSubmit: async (data) => {
        const body = {
          name: data.get('name'),
          amount: data.get('amount'),
          dueDay: data.get('dueDay'),
          accountId: data.get('accountId') || null,
          category: data.get('category') || null,
          ownerId: data.get('ownerId'),
          autopay: data.get('autopay') === 'on',
          active: data.get('active') === 'on',
        };
        if (bill) await api.updateBill(bill.id, body);
        else await api.createBill(body);
        return true;
      },
    });
    if (saved) {
      toast(bill ? 'Bill updated' : 'Bill added');
      await ctx.refresh();
    }
  };

  const remove = async (bill) => {
    const ok = await confirmDialog({
      title: `Delete ${bill.name}?`,
      message: 'It will stop appearing in payments due.',
    });
    if (!ok) return;
    await api.deleteBill(bill.id);
    toast('Bill deleted');
    await ctx.refresh();
  };

  const active = state.bills.filter((b) => b.active !== false);
  const monthlyTotal = active.reduce((a, b) => a + b.amount, 0);

  const rows = [...state.bills]
    .sort((a, b) => (a.dueDay ?? 0) - (b.dueDay ?? 0) || a.name.localeCompare(b.name))
    .map((bill) => h('tr', { style: bill.active === false ? { opacity: '0.55' } : null },
      h('td', { class: 'name' },
        bill.name,
        bill.active === false ? ' ' : null,
        bill.active === false ? pill('Inactive', 'neutral') : null),
      h('td', {}, `Day ${bill.dueDay}`),
      h('td', {}, accountName(bill.accountId)),
      h('td', {}, ownerName(people, bill.ownerId)),
      h('td', {}, bill.autopay ? pill('Autopay', 'good', '✓') : pill('Manual', 'neutral')),
      h('td', { class: 'num' }, money(bill.amount)),
      h('td', { class: 'num' },
        h('div', { class: 'row-tight', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn btn-sm', onclick: () => openForm(bill) }, 'Edit'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => remove(bill) }, 'Delete'))),
    ));

  return card('Recurring bills', {
    note: 'These are projected into payments due every month',
    actions: h('div', { class: 'row-tight' },
      pill(`${money(monthlyTotal)} per month`, 'neutral'),
      h('button', { class: 'btn btn-primary', onclick: () => openForm(null) }, 'Add bill')),
  },
    state.bills.length
      ? h('div', { class: 'table-wrap' },
          h('table', { class: 'data' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'Bill'), h('th', {}, 'Due'), h('th', {}, 'Paid from'),
              h('th', {}, 'Owner'), h('th', {}, 'Payment'),
              h('th', { class: 'num' }, 'Amount'), h('th', { class: 'num' }, ''))),
            h('tbody', {}, ...rows)))
      : h('div', { class: 'chart-empty' }, 'No recurring bills yet. Add rent, utilities and subscriptions to see them in payments due.'),
  );
}
