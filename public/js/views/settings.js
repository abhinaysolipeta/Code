/* Household settings, categories, and data export/import. */

import { api } from '../api.js';
import {
  card, confirmDialog, download, field, h, modal, money, pill, select,
  toast, toInput,
} from '../ui.js';

/* Palette slots people can be assigned. Storing the slot rather than a hex lets
 * each person's hue take its light or dark step with the theme. */
const PERSON_SLOTS = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Magenta', 'Green', 'Violet', 'Red'];

export function renderSettings(ctx) {
  const { state } = ctx;
  return h('div', { class: 'stack' },
    householdCard(ctx),
    peopleCard(ctx),
    categoriesCard(ctx),
    dataCard(ctx),
  );
}

/* ---------------------------------------------------------------- */

function householdCard(ctx) {
  const { settings } = ctx.state;
  const name = h('input', { class: 'input', value: settings.household, name: 'household' });
  const currency = h('input', { class: 'input', value: settings.currency, maxlength: '3', style: { textTransform: 'uppercase' } });
  const locale = h('input', { class: 'input', value: settings.locale });
  const target = h('input', {
    class: 'input', type: 'number', min: '0', max: '100', step: '1',
    value: Math.round((settings.savingsTargetRate ?? 0) * 100),
  });

  const save = async (button) => {
    button.disabled = true;
    try {
      await api.updateSettings({
        household: name.value,
        currency: currency.value,
        locale: locale.value,
        savingsTargetRate: Number(target.value) / 100,
      });
      toast('Settings saved');
      await ctx.refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  };

  return card('Household', { note: 'Names and formatting used throughout the app' },
    h('div', { class: 'form-grid' },
      field('Household name', name),
      field('Currency', currency, { hint: 'Three-letter code, e.g. USD, GBP, EUR' }),
      field('Locale', locale, { hint: 'Controls date and number formatting, e.g. en-US' }),
      field('Savings target', target, { hint: 'Percentage of income you aim to save each month' })),
    h('div', { class: 'row', style: { marginTop: '14px' } },
      h('button', { class: 'btn btn-primary', onclick: (e) => save(e.currentTarget) }, 'Save settings')));
}

/* ---------------------------------------------------------------- */

function peopleCard(ctx) {
  const people = ctx.state.settings.people.map((p) => ({ ...p }));
  const list = h('div', { class: 'stack', style: { gap: '10px' } });

  const draw = () => {
    list.replaceChildren(...people.map((person, i) => {
      const nameInput = h('input', {
        class: 'input', value: person.name,
        oninput: (e) => { people[i].name = e.target.value; },
      });
      const colorPicker = h('div', { class: 'row-tight' },
        ...PERSON_SLOTS.map((name, slot) => h('button', {
          type: 'button',
          title: name,
          'aria-label': name,
          'aria-pressed': String(person.colorSlot === slot),
          onclick: () => { people[i].colorSlot = slot; draw(); },
          style: {
            width: '22px', height: '22px', borderRadius: '5px', cursor: 'pointer',
            background: `var(--series-${slot + 1})`, padding: '0',
            border: person.colorSlot === slot
              ? '2px solid var(--text-primary)' : '1px solid var(--border)',
          },
        })));

      return h('div', { class: 'row', style: { alignItems: 'flex-end' } },
        h('div', { style: { flex: '1', minWidth: '160px' } }, field(`Person ${i + 1}`, nameInput)),
        h('div', {}, field('Chart colour', colorPicker)),
        people.length > 1
          ? h('button', {
              class: 'btn btn-sm btn-danger',
              onclick: () => { people.splice(i, 1); draw(); },
            }, 'Remove')
          : null,
      );
    }));
  };
  draw();

  const save = async (button) => {
    button.disabled = true;
    try {
      await api.updateSettings({ people });
      toast('People updated');
      await ctx.refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  };

  return card('People', {
    note: 'Accounts, bills and transactions can belong to a person or to both of you jointly',
  },
    list,
    h('div', { class: 'row', style: { marginTop: '14px' } },
      h('button', {
        class: 'btn',
        onclick: () => {
          const used = new Set(people.map((p) => p.colorSlot));
          const next = PERSON_SLOTS.findIndex((_, slot) => !used.has(slot));
          people.push({ id: `p${Date.now().toString(36)}`, name: '', colorSlot: next === -1 ? 0 : next });
          draw();
        },
      }, 'Add person'),
      h('button', { class: 'btn btn-primary', onclick: (e) => save(e.currentTarget) }, 'Save people')),
    h('div', { class: 'field-hint', style: { marginTop: '8px' } },
      'Renaming a person keeps their history. Removing one reassigns their records to Joint on next save.'),
  );
}

/* ---------------------------------------------------------------- */

function categoriesCard(ctx) {
  const { state } = ctx;

  const openForm = async (category) => {
    const saved = await modal({
      title: category ? `Edit ${category.name}` : 'Add category',
      submitLabel: category ? 'Save' : 'Add',
      render: () => h('div', { class: 'form-grid' },
        field('Name', h('input', { class: 'input', name: 'name', required: true, value: category?.name ?? '' })),
        field('Type', select(
          [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }],
          category?.kind ?? 'expense', { name: 'kind' })),
        field('Colour', h('input', { class: 'input', name: 'color', type: 'color', value: category?.color ?? '#2a78d6' })),
        field('Monthly budget', h('input', {
          class: 'input tabular', name: 'budget', inputmode: 'decimal',
          placeholder: 'optional', value: toInput(category?.budget),
        })),
      ),
      onSubmit: async (data) => {
        const body = {
          name: data.get('name'), kind: data.get('kind'),
          color: data.get('color'), budget: data.get('budget') || null,
        };
        if (category) await api.updateCategory(category.id, body);
        else await api.createCategory(body);
        return true;
      },
    });
    if (saved) {
      toast(category ? 'Category updated' : 'Category added');
      await ctx.refresh();
    }
  };

  const remove = async (category) => {
    const ok = await confirmDialog({
      title: `Delete ${category.name}?`,
      message: 'Categories still used by transactions cannot be deleted.',
    });
    if (!ok) return;
    try {
      await api.deleteCategory(category.id);
      toast('Category deleted');
      await ctx.refresh();
    } catch (err) { toast(err.message, 'error'); }
  };

  const group = (kind) => state.categories.filter((c) => c.kind === kind).map((c) =>
    h('tr', {},
      h('td', { class: 'name' },
        h('span', { class: 'row-tight' },
          h('span', { class: 'swatch', style: { background: c.color } }), c.name)),
      h('td', { class: 'num' }, c.budget ? money(c.budget) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'num' },
        h('div', { class: 'row-tight', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn btn-sm', onclick: () => openForm(c) }, 'Edit'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => remove(c) }, '✕')))));

  const table = (kind, title) => h('div', {},
    h('h3', { style: { marginBottom: '8px' } }, title),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', { class: 'num' }, 'Budget'), h('th', { class: 'num' }, ''))),
        h('tbody', {}, ...group(kind)))));

  return card('Categories', {
    note: 'Used to group spending in the report',
    actions: h('button', { class: 'btn btn-primary', onclick: () => openForm(null) }, 'Add category'),
  },
    h('div', { class: 'grid grid-2' }, table('expense', 'Expenses'), table('income', 'Income')));
}

/* ---------------------------------------------------------------- */

function dataCard(ctx) {
  const exportJson = async () => {
    const res = await fetch('/api/export');
    download(`finance-backup-${new Date().toISOString().slice(0, 10)}.json`, await res.text());
    toast('Backup downloaded');
  };

  const exportCsv = () => {
    window.location.href = `/api/report.csv?month=${ctx.month}`;
  };

  const importJson = async () => {
    const result = await modal({
      title: 'Restore from backup',
      submitLabel: 'Replace all data',
      render: () => h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { class: 'alert danger' },
          h('div', {},
            h('div', { class: 'alert-title' }, 'This replaces everything'),
            h('div', { class: 'alert-detail' },
              'Every account, balance and transaction is overwritten by the file’s contents. A backup of the current data is kept in data/backups first.'))),
        field('Backup file', h('input', { class: 'input', type: 'file', name: 'file', accept: 'application/json', required: true }))),
      onSubmit: async (data) => {
        const file = data.get('file');
        if (!file || !file.size) throw new Error('Choose a backup file');
        const text = await file.text();
        let parsed;
        try { parsed = JSON.parse(text); }
        catch { throw new Error('That file is not valid JSON'); }
        return api.importBackup(parsed);
      },
    });
    if (result) {
      toast(`Restored ${result.accounts} accounts and ${result.transactions} transactions`);
      await ctx.refresh();
    }
  };

  return card('Your data', {
    note: 'Everything lives in a JSON file on this machine — nothing is uploaded anywhere',
  },
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: exportJson }, 'Download backup (JSON)'),
      h('button', { class: 'btn', onclick: exportCsv }, 'Export this month (CSV)'),
      h('button', { class: 'btn btn-danger', onclick: importJson }, 'Restore from backup')),
    h('div', { class: 'field-hint', style: { marginTop: '12px' } },
      'The app writes to data/finance.json and keeps the last 20 versions in data/backups. Copy that folder to move your ledger to another machine.'),
  );
}
