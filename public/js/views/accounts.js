/* Account management. */

import { api } from '../api.js';
import { ACCOUNT_TYPES } from '/shared/model.js';
import {
  card, confirmDialog, field, h, modal, money, ownerName, ownerOptions,
  pill, select, toast, toInput,
} from '../ui.js';

const TYPE_OPTIONS = Object.entries(ACCOUNT_TYPES)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([value, meta]) => ({ value, label: meta.label }));

function accountForm(account, people) {
  const isCredit = () => ['credit', 'loan'].includes(typeSelect.value);
  const typeSelect = select(TYPE_OPTIONS, account?.type ?? 'checking', { name: 'type' });
  const creditBox = h('div', { class: 'form-grid', style: { gridColumn: '1 / -1' } });

  const renderCredit = () => {
    creditBox.replaceChildren();
    if (!isCredit()) return;
    creditBox.append(
      field('Credit limit', h('input', {
        class: 'input', name: 'creditLimit', inputmode: 'decimal',
        placeholder: '0.00', value: toInput(account?.creditLimit),
      })),
      field('APR %', h('input', {
        class: 'input', name: 'apr', inputmode: 'decimal',
        placeholder: '19.99', value: account?.apr ?? '',
      })),
      field('Payment due day', h('input', {
        class: 'input', name: 'dueDay', type: 'number', min: '1', max: '31',
        placeholder: '14', value: account?.dueDay ?? '',
      }), { hint: 'Day of the month the payment is due' }),
      field('Autopay', h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'autopay', checked: account?.autopay }),
        'Paid automatically')),
    );
  };
  typeSelect.addEventListener('change', renderCredit);

  const form = h('div', { class: 'form-grid' },
    field('Account name', h('input', {
      class: 'input', name: 'name', required: true, placeholder: 'Joint Checking',
      value: account?.name ?? '',
    })),
    field('Institution', h('input', {
      class: 'input', name: 'institution', placeholder: 'First National',
      value: account?.institution ?? '',
    })),
    field('Type', typeSelect),
    field('Owner', select(ownerOptions(people), account?.ownerId ?? 'joint', { name: 'ownerId' })),
    field('Last 4 digits', h('input', {
      class: 'input', name: 'last4', maxlength: '4', placeholder: '4021',
      value: account?.last4 ?? '',
    })),
    field('Notes', h('input', { class: 'input', name: 'notes', value: account?.notes ?? '' })),
    creditBox,
  );
  renderCredit();
  return form;
}

const formValues = (data) => ({
  name: data.get('name'),
  institution: data.get('institution'),
  type: data.get('type'),
  ownerId: data.get('ownerId'),
  last4: data.get('last4'),
  notes: data.get('notes'),
  creditLimit: data.get('creditLimit') || null,
  apr: data.get('apr') || null,
  dueDay: data.get('dueDay') || null,
  autopay: data.get('autopay') === 'on',
});

export function renderAccounts(ctx) {
  const { state } = ctx;
  const people = state.settings.people;
  const latest = new Map();
  for (const s of state.snapshots) {
    const prior = latest.get(s.accountId);
    if (!prior || s.month > prior.month) latest.set(s.accountId, s);
  }

  const openForm = async (account) => {
    const saved = await modal({
      title: account ? `Edit ${account.name}` : 'Add account',
      submitLabel: account ? 'Save changes' : 'Add account',
      render: () => accountForm(account, people),
      onSubmit: async (data) => {
        const body = formValues(data);
        if (account) await api.updateAccount(account.id, body);
        else await api.createAccount(body);
        return true;
      },
    });
    if (saved) {
      toast(account ? 'Account updated' : 'Account added');
      await ctx.refresh();
    }
  };

  const remove = async (account) => {
    const ok = await confirmDialog({
      title: `Delete ${account.name}?`,
      message: 'Its balance history, transactions and linked bills are deleted too. This cannot be undone.',
    });
    if (!ok) return;
    try {
      await api.deleteAccount(account.id);
      toast('Account deleted');
      await ctx.refresh();
    } catch (err) { toast(err.message, 'error'); }
  };

  const toggleArchive = async (account) => {
    await api.updateAccount(account.id, { ...account, archived: !account.archived });
    toast(account.archived ? 'Account restored' : 'Account archived');
    await ctx.refresh();
  };

  const rows = [...state.accounts]
    .sort((a, b) => (ACCOUNT_TYPES[a.type]?.order ?? 9) - (ACCOUNT_TYPES[b.type]?.order ?? 9)
      || a.name.localeCompare(b.name))
    .map((account) => {
      const snap = latest.get(account.id);
      return h('tr', { style: account.archived ? { opacity: '0.55' } : null },
        h('td', { class: 'name' },
          account.name,
          account.archived ? ' ' : null,
          account.archived ? pill('Archived', 'neutral') : null,
          h('div', { class: 'muted', style: { fontSize: '11.5px' } },
            [account.institution, account.last4 ? `····${account.last4}` : null].filter(Boolean).join(' · ') || '—')),
        h('td', {}, h('span', { class: 'chip' }, ACCOUNT_TYPES[account.type]?.label ?? account.type)),
        h('td', {}, ownerName(people, account.ownerId)),
        h('td', { class: 'num' },
          snap ? money(snap.balance) : h('span', { class: 'muted' }, 'No balance yet'),
          snap ? h('div', { class: 'muted', style: { fontSize: '11px' } }, snap.month) : null),
        h('td', { class: 'num' }, account.creditLimit ? money(account.creditLimit) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'num' },
          h('div', { class: 'row-tight', style: { justifyContent: 'flex-end' } },
            h('button', { class: 'btn btn-sm', onclick: () => openForm(account) }, 'Edit'),
            h('button', { class: 'btn btn-sm', onclick: () => toggleArchive(account) },
              account.archived ? 'Restore' : 'Archive'),
            h('button', { class: 'btn btn-sm btn-danger', onclick: () => remove(account) }, 'Delete'))),
      );
    });

  return card('Accounts', {
    note: 'Checking, savings, cards and loans for the whole household',
    actions: h('button', { class: 'btn btn-primary', onclick: () => openForm(null) }, 'Add account'),
  },
    state.accounts.length
      ? h('div', { class: 'table-wrap' },
          h('table', { class: 'data' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'Account'), h('th', {}, 'Type'), h('th', {}, 'Owner'),
              h('th', { class: 'num' }, 'Latest balance'), h('th', { class: 'num' }, 'Limit'),
              h('th', { class: 'num' }, ''))),
            h('tbody', {}, ...rows)))
      : h('div', { class: 'chart-empty' }, 'No accounts yet. Add your checking accounts, cards and savings to begin.'),
  );
}
