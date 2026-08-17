// HTTP API. A tiny pattern router over the store; every handler returns a
// plain object that the server serialises as JSON.

import { currentMonth, isMonthKey, monthOf, todayKey } from '../shared/dates.js';
import { toCents, centsToDecimal } from '../shared/money.js';
import { parseCsvRecords, toCsv } from '../shared/csv.js';
import { buildMonthlyReport } from '../shared/report.js';
import { ACCOUNT_TYPES } from '../shared/model.js';
import { newId } from './store.js';
import {
  ValidationError,
  validateAccount,
  validateBill,
  validateCategory,
  validateSettings,
  validatePayment,
  validateSnapshot,
  validateTransaction,
} from './validate.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const notFound = (what) => new HttpError(404, `${what} not found`);

/* ------------------------------------------------------------------ *
 * Collection helpers
 * ------------------------------------------------------------------ */

function findOrThrow(list, id, label) {
  const row = list.find((r) => r.id === id);
  if (!row) throw notFound(label);
  return row;
}

function makeCrud(collection, label, validate) {
  return {
    list: (store) => ({ [collection]: store.db[collection] }),
    create: (store, body) =>
      store.update((db) => {
        const row = { id: newId(), createdAt: new Date().toISOString(), ...validate(body, db) };
        db[collection].push(row);
        return row;
      }),
    update: (store, id, body) =>
      store.update((db) => {
        const existing = findOrThrow(db[collection], id, label);
        Object.assign(existing, validate(body, db, existing), { id: existing.id });
        return existing;
      }),
    remove: (store, id) =>
      store.update((db) => {
        const i = db[collection].findIndex((r) => r.id === id);
        if (i === -1) throw notFound(label);
        const [removed] = db[collection].splice(i, 1);
        return { removed: removed.id };
      }),
  };
}

const accountsCrud = makeCrud('accounts', 'Account', validateAccount);
const transactionsCrud = makeCrud('transactions', 'Transaction', validateTransaction);
const billsCrud = makeCrud('bills', 'Bill', validateBill);

/* ------------------------------------------------------------------ *
 * Snapshots: upsert keyed on (account, month)
 * ------------------------------------------------------------------ */

function upsertSnapshot(db, body) {
  const clean = validateSnapshot(body, db);
  const existing = db.snapshots.find(
    (s) => s.accountId === clean.accountId && s.month === clean.month,
  );
  if (existing) {
    Object.assign(existing, clean);
    return existing;
  }
  const row = { id: newId(), ...clean };
  db.snapshots.push(row);
  return row;
}

/* ------------------------------------------------------------------ *
 * CSV transaction import
 * ------------------------------------------------------------------ */

const HEADER_ALIASES = {
  date: ['date', 'transactiondate', 'posteddate', 'postingdate', 'postdate', 'valuedate'],
  description: ['description', 'payee', 'merchant', 'name', 'memo', 'details', 'transactiondescription'],
  amount: ['amount', 'transactionamount', 'value'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'moneyout', 'paymentamount'],
  credit: ['credit', 'deposit', 'deposits', 'moneyin'],
  category: ['category', 'categoryname', 'type'],
};

function pick(record, aliases) {
  for (const key of aliases) {
    if (record[key] !== undefined && record[key] !== '') return record[key];
  }
  return '';
}

/** Bank exports vary wildly; normalise dates to YYYY-MM-DD or give up on the row. */
function normaliseDate(value) {
  const s = String(value).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${p2(m[1])}-${p2(m[2])}`; // US convention: MM/DD/YYYY
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${p2(parsed.getMonth() + 1)}-${p2(parsed.getDate())}`;
  }
  return null;
}
const p2 = (n) => String(Number(n)).padStart(2, '0');

function importTransactions(store, body) {
  const accountId = String(body.accountId ?? '');
  const account = store.db.accounts.find((a) => a.id === accountId);
  if (!account) throw new ValidationError('Choose an account to import into', 'accountId');

  const { records } = parseCsvRecords(String(body.csv ?? ''));
  if (!records.length) throw new ValidationError('No rows found in that CSV', 'csv');

  // Credit-card exports usually list purchases as positive numbers; flipping is
  // opt-in so the caller stays in control of sign conventions.
  const flip = Boolean(body.flipSign);
  const categoryIds = new Set(store.db.categories.map((c) => c.id));
  const categoryByName = new Map(
    store.db.categories.map((c) => [c.name.toLowerCase(), c.id]),
  );

  const prepared = [];
  const skipped = [];

  records.forEach((record, i) => {
    const date = normaliseDate(pick(record, HEADER_ALIASES.date));
    if (!date) { skipped.push({ row: i + 2, reason: 'Unrecognised date' }); return; }

    let cents = toCents(pick(record, HEADER_ALIASES.amount));
    if (cents === null) {
      const debit = toCents(pick(record, HEADER_ALIASES.debit));
      const credit = toCents(pick(record, HEADER_ALIASES.credit));
      if (debit !== null && debit !== 0) cents = -Math.abs(debit);
      else if (credit !== null && credit !== 0) cents = Math.abs(credit);
    }
    if (cents === null || cents === 0) { skipped.push({ row: i + 2, reason: 'No usable amount' }); return; }
    if (flip) cents = -cents;

    const rawCategory = pick(record, HEADER_ALIASES.category).toLowerCase();
    const category = categoryIds.has(rawCategory)
      ? rawCategory
      : categoryByName.get(rawCategory) ?? (cents < 0 ? 'other' : 'other-income');

    prepared.push({
      date,
      accountId,
      kind: cents >= 0 ? 'income' : 'expense',
      amount: cents,
      category,
      description: pick(record, HEADER_ALIASES.description).slice(0, 160),
      ownerId: body.ownerId ?? account.ownerId,
      transferAccountId: null,
    });
  });

  if (!prepared.length) {
    throw new ValidationError('None of those rows could be read as transactions', 'csv');
  }

  return store.update((db) => {
    // Same account + date + amount + description twice is almost always a
    // re-import of an overlapping statement, not two identical purchases.
    const seen = new Set(
      db.transactions.map((t) => `${t.accountId}|${t.date}|${t.amount}|${t.description}`),
    );
    let imported = 0;
    let duplicates = 0;
    for (const tx of prepared) {
      const key = `${tx.accountId}|${tx.date}|${tx.amount}|${tx.description}`;
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key);
      db.transactions.push({ id: newId(), createdAt: new Date().toISOString(), ...tx });
      imported++;
    }
    return { imported, duplicates, skipped, total: prepared.length + skipped.length };
  });
}

/* ------------------------------------------------------------------ *
 * CSV report export
 * ------------------------------------------------------------------ */

function reportCsv(report) {
  const rows = [['Section', 'Item', 'Owner', 'Detail', 'Amount']];
  const push = (section, item, owner, detail, cents) =>
    rows.push([section, item, owner, detail, centsToDecimal(cents ?? 0)]);

  const ownerName = (id) =>
    id === 'joint' ? 'Joint' : report.people.find((p) => p.id === id)?.name ?? id;

  for (const type of ['checking', 'savings', 'cash', 'investment']) {
    for (const a of report.cash[type].accounts) {
      push(ACCOUNT_TYPES[type].label, a.name, ownerName(a.ownerId), a.institution, a.balance);
    }
  }
  for (const c of report.credit.cards) {
    push('Credit Card', c.name, ownerName(c.ownerId), `Due ${c.dueDate ?? 'n/a'}`, c.balance);
  }
  for (const i of report.paymentsDue.items) {
    push('Payment Due', i.name, ownerName(i.ownerId), i.dueDate, i.amount);
  }
  for (const c of report.flow.byCategory) {
    push('Spending', c.name, 'All', `${c.txCount} transaction${c.txCount === 1 ? '' : 's'}`, c.amount);
  }
  push('Summary', 'Liquid cash', 'All', 'Checking + cash', report.cash.liquid);
  push('Summary', 'Total savings', 'All', '', report.cash.savings.total);
  push('Summary', 'Savings contributions', 'All', 'Transfers in', report.flow.savingsContributions);
  push('Summary', 'Income', 'All', '', report.flow.income);
  push('Summary', 'Expenses', 'All', '', report.flow.expenses);
  push('Summary', 'Credit card debt', 'All', '', report.credit.totalBalance);
  push('Summary', 'Net worth', 'All', '', report.netWorth.net);
  return toCsv(rows);
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true, time: new Date().toISOString() })],

  ['GET', /^\/api\/state$/, (store) => ({
    version: store.db.version,
    settings: store.db.settings,
    accounts: store.db.accounts,
    categories: store.db.categories,
    bills: store.db.bills,
    snapshots: store.db.snapshots,
    payments: store.db.payments,
    counts: {
      transactions: store.db.transactions.length,
      snapshots: store.db.snapshots.length,
    },
  })],

  ['GET', /^\/api\/report$/, (store, _b, { query }) => {
    const month = isMonthKey(query.get('month')) ? query.get('month') : currentMonth();
    const trendMonths = Math.min(Math.max(Number(query.get('trend')) || 12, 3), 36);
    return buildMonthlyReport(store.db, month, { trendMonths, today: todayKey() });
  }],

  ['GET', /^\/api\/report\.csv$/, (store, _b, { query }) => {
    const month = isMonthKey(query.get('month')) ? query.get('month') : currentMonth();
    const report = buildMonthlyReport(store.db, month, { today: todayKey() });
    return {
      __raw: reportCsv(report),
      __contentType: 'text/csv; charset=utf-8',
      __filename: `finance-report-${month}.csv`,
    };
  }],

  ['GET', /^\/api\/accounts$/, (s) => accountsCrud.list(s)],
  ['POST', /^\/api\/accounts$/, (s, b) => accountsCrud.create(s, b)],
  ['PATCH', /^\/api\/accounts\/([^/]+)$/, (s, b, { params }) => accountsCrud.update(s, params[0], b)],
  ['DELETE', /^\/api\/accounts\/([^/]+)$/, (s, _b, { params }) =>
    s.update((db) => {
      const id = params[0];
      const i = db.accounts.findIndex((a) => a.id === id);
      if (i === -1) throw notFound('Account');
      // Cascade: an account's history is meaningless without the account.
      db.snapshots = db.snapshots.filter((x) => x.accountId !== id);
      db.transactions = db.transactions.filter((x) => x.accountId !== id && x.transferAccountId !== id);
      db.bills = db.bills.filter((x) => x.accountId !== id);
      db.accounts.splice(i, 1);
      return { removed: id };
    })],

  ['GET', /^\/api\/snapshots$/, (s, _b, { query }) => {
    const month = query.get('month');
    const rows = isMonthKey(month) ? s.db.snapshots.filter((x) => x.month === month) : s.db.snapshots;
    return { snapshots: rows };
  }],
  ['PUT', /^\/api\/snapshots$/, (s, b) => s.update((db) => upsertSnapshot(db, b))],
  ['POST', /^\/api\/snapshots\/bulk$/, (s, b) =>
    s.update((db) => {
      const entries = Array.isArray(b.entries) ? b.entries : [];
      if (!entries.length) throw new ValidationError('No entries supplied', 'entries');
      const saved = entries.map((entry) => upsertSnapshot(db, { ...entry, month: b.month ?? entry.month }));
      return { saved: saved.length, snapshots: saved };
    })],
  ['DELETE', /^\/api\/snapshots\/([^/]+)$/, (s, _b, { params }) =>
    s.update((db) => {
      const i = db.snapshots.findIndex((x) => x.id === params[0]);
      if (i === -1) throw notFound('Snapshot');
      db.snapshots.splice(i, 1);
      return { removed: params[0] };
    })],

  ['GET', /^\/api\/transactions$/, (s, _b, { query }) => {
    let rows = s.db.transactions;
    const month = query.get('month');
    if (isMonthKey(month)) rows = rows.filter((t) => monthOf(t.date) === month);
    const accountId = query.get('accountId');
    if (accountId) rows = rows.filter((t) => t.accountId === accountId);
    const ownerId = query.get('ownerId');
    if (ownerId) rows = rows.filter((t) => t.ownerId === ownerId);
    const q = (query.get('q') ?? '').toLowerCase();
    if (q) rows = rows.filter((t) => (t.description ?? '').toLowerCase().includes(q));
    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
    const limit = Math.min(Number(query.get('limit')) || 500, 5000);
    return { transactions: sorted.slice(0, limit), total: sorted.length };
  }],
  ['POST', /^\/api\/transactions$/, (s, b) => transactionsCrud.create(s, b)],
  ['POST', /^\/api\/transactions\/import$/, (s, b) => importTransactions(s, b)],
  ['PATCH', /^\/api\/transactions\/([^/]+)$/, (s, b, { params }) => transactionsCrud.update(s, params[0], b)],
  ['DELETE', /^\/api\/transactions\/([^/]+)$/, (s, _b, { params }) => transactionsCrud.remove(s, params[0])],

  ['GET', /^\/api\/bills$/, (s) => billsCrud.list(s)],
  ['POST', /^\/api\/bills$/, (s, b) => billsCrud.create(s, b)],
  ['PATCH', /^\/api\/bills\/([^/]+)$/, (s, b, { params }) => billsCrud.update(s, params[0], b)],
  ['DELETE', /^\/api\/bills\/([^/]+)$/, (s, _b, { params }) => billsCrud.remove(s, params[0])],

  ['GET', /^\/api\/payments$/, (s, _b, { query }) => {
    const month = query.get('month');
    const rows = isMonthKey(month) ? s.db.payments.filter((p) => p.month === month) : s.db.payments;
    return { payments: rows };
  }],
  // Idempotent tick-off: marking the same obligation twice updates it rather
  // than stacking duplicate rows.
  ['PUT', /^\/api\/payments$/, (s, b) =>
    s.update((db) => {
      const clean = validatePayment(b, db);
      const existing = db.payments.find(
        (p) => p.month === clean.month && p.source === clean.source && p.refId === clean.refId,
      );
      if (existing) {
        Object.assign(existing, clean);
        return existing;
      }
      const row = { id: newId(), ...clean };
      db.payments.push(row);
      return row;
    })],
  ['DELETE', /^\/api\/payments$/, (s, _b, { query }) =>
    s.update((db) => {
      const month = query.get('month');
      const source = query.get('source');
      const refId = query.get('refId');
      const i = db.payments.findIndex(
        (p) => p.month === month && p.source === source && p.refId === refId,
      );
      if (i === -1) throw notFound('Payment');
      db.payments.splice(i, 1);
      return { removed: true };
    })],

  ['GET', /^\/api\/categories$/, (s) => ({ categories: s.db.categories })],
  ['POST', /^\/api\/categories$/, (s, b) =>
    s.update((db) => {
      const clean = validateCategory(b);
      const id = (b.id ? String(b.id) : clean.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id) throw new ValidationError('Category needs a usable name', 'name');
      if (db.categories.some((c) => c.id === id)) throw new ValidationError('That category already exists', 'name');
      const row = { id, ...clean };
      db.categories.push(row);
      return row;
    })],
  ['PATCH', /^\/api\/categories\/([^/]+)$/, (s, b, { params }) =>
    s.update((db) => {
      const existing = findOrThrow(db.categories, params[0], 'Category');
      Object.assign(existing, validateCategory(b, existing), { id: existing.id });
      return existing;
    })],
  ['DELETE', /^\/api\/categories\/([^/]+)$/, (s, _b, { params }) =>
    s.update((db) => {
      const id = params[0];
      const i = db.categories.findIndex((c) => c.id === id);
      if (i === -1) throw notFound('Category');
      const inUse = db.transactions.filter((t) => t.category === id).length;
      if (inUse) throw new ValidationError(`${inUse} transaction(s) still use that category`, 'id');
      db.categories.splice(i, 1);
      return { removed: id };
    })],

  ['GET', /^\/api\/settings$/, (s) => ({ settings: s.db.settings })],
  ['PATCH', /^\/api\/settings$/, (s, b) =>
    s.update((db) => {
      db.settings = validateSettings(b, db.settings);
      return db.settings;
    })],

  ['GET', /^\/api\/export$/, (s) => ({
    __raw: JSON.stringify(s.db, null, 2),
    __contentType: 'application/json',
    __filename: `finance-backup-${todayKey()}.json`,
  })],
  ['POST', /^\/api\/import$/, (s, b) => {
    if (!b || typeof b !== 'object' || !Array.isArray(b.accounts)) {
      throw new ValidationError('That does not look like a LedgerLight backup', 'accounts');
    }
    const db = s.replaceAll(b);
    return { ok: true, accounts: db.accounts.length, transactions: db.transactions.length };
  }],
];

export function handleApi(store, method, pathname, query, body) {
  for (const [verb, pattern, handler] of routes) {
    const match = pathname.match(pattern);
    if (!match) continue;
    if (verb !== method) continue;
    return handler(store, body, { params: match.slice(1).map(decodeURIComponent), query });
  }
  const pathMatches = routes.some(([, pattern]) => pattern.test(pathname));
  throw new HttpError(pathMatches ? 405 : 404, pathMatches ? `${method} not allowed here` : 'Unknown endpoint');
}

export { HttpError };
