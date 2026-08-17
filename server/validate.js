// Request-body validation. Every write path funnels through here so the stored
// document stays well-formed regardless of what the client sends.

import { isDateKey, isMonthKey } from '../shared/dates.js';
import { toCents } from '../shared/money.js';
import { ACCOUNT_TYPES, JOINT, TRANSACTION_KINDS } from '../shared/model.js';

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.field = field;
  }
}

const str = (v, field, { required = false, max = 200, fallback = '' } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${field} is required`, field);
    return fallback;
  }
  const s = String(v).trim();
  if (required && !s) throw new ValidationError(`${field} is required`, field);
  if (s.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`, field);
  return s;
};

const money = (v, field, { required = false, fallback = null } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${field} is required`, field);
    return fallback;
  }
  const cents = toCents(v);
  if (cents === null) throw new ValidationError(`${field} must be a valid amount`, field);
  if (!Number.isSafeInteger(cents)) throw new ValidationError(`${field} is out of range`, field);
  return cents;
};

const intInRange = (v, field, min, max, { fallback = null } = {}) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`, field);
  const i = Math.round(n);
  if (i < min || i > max) throw new ValidationError(`${field} must be between ${min} and ${max}`, field);
  return i;
};

const rate = (v, field, { fallback = null } = {}) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new ValidationError(`${field} must be between 0 and 100`, field);
  }
  return n;
};

const bool = (v, fallback = false) => (v === undefined || v === null ? fallback : Boolean(v));

const owner = (v, people) => {
  const id = str(v, 'owner', { fallback: JOINT }) || JOINT;
  if (id === JOINT) return JOINT;
  if (!people.some((p) => p.id === id)) {
    throw new ValidationError(`Unknown owner "${id}"`, 'ownerId');
  }
  return id;
};

export function validateAccount(body, db, existing = null) {
  const people = db.settings.people ?? [];
  const type = str(body.type ?? existing?.type, 'type', { required: true });
  if (!ACCOUNT_TYPES[type]) {
    throw new ValidationError(`Unknown account type "${type}"`, 'type');
  }
  const isCredit = type === 'credit' || type === 'loan';

  return {
    name: str(body.name ?? existing?.name, 'name', { required: true, max: 80 }),
    institution: str(body.institution ?? existing?.institution, 'institution', { max: 80 }),
    last4: str(body.last4 ?? existing?.last4, 'last4', { max: 4 }).replace(/\D/g, '').slice(0, 4),
    type,
    ownerId: owner(body.ownerId ?? existing?.ownerId, people),
    creditLimit: isCredit ? money(body.creditLimit ?? existing?.creditLimit, 'creditLimit') : null,
    apr: isCredit ? rate(body.apr ?? existing?.apr, 'apr') : null,
    dueDay: isCredit ? intInRange(body.dueDay ?? existing?.dueDay, 'dueDay', 1, 31) : null,
    interestRate: !isCredit ? rate(body.interestRate ?? existing?.interestRate, 'interestRate') : null,
    autopay: bool(body.autopay ?? existing?.autopay),
    notes: str(body.notes ?? existing?.notes, 'notes', { max: 500 }),
    archived: bool(body.archived ?? existing?.archived),
  };
}

export function validateSnapshot(body, db, existing = null) {
  const month = str(body.month ?? existing?.month, 'month', { required: true });
  if (!isMonthKey(month)) throw new ValidationError('month must look like YYYY-MM', 'month');

  const accountId = str(body.accountId ?? existing?.accountId, 'accountId', { required: true });
  const account = db.accounts.find((a) => a.id === accountId);
  if (!account) throw new ValidationError(`Unknown account "${accountId}"`, 'accountId');

  let balance = money(body.balance ?? existing?.balance, 'balance', { required: true });
  // Credit and loan balances are stored positive = amount owed. People type in
  // what their statement shows, which may carry a minus sign either way.
  if (account.type === 'credit' || account.type === 'loan') balance = Math.abs(balance);

  const dueDate = str(body.dueDate ?? existing?.dueDate, 'dueDate', { fallback: '' });
  if (dueDate && !isDateKey(dueDate)) {
    throw new ValidationError('dueDate must look like YYYY-MM-DD', 'dueDate');
  }

  return {
    accountId,
    month,
    balance,
    statementBalance: (() => {
      const v = money(body.statementBalance ?? existing?.statementBalance, 'statementBalance');
      return v === null ? null : Math.abs(v);
    })(),
    minimumPayment: (() => {
      const v = money(body.minimumPayment ?? existing?.minimumPayment, 'minimumPayment');
      return v === null ? null : Math.abs(v);
    })(),
    dueDate: dueDate || null,
    updatedAt: new Date().toISOString(),
  };
}

export function validateTransaction(body, db, existing = null) {
  const people = db.settings.people ?? [];
  const date = str(body.date ?? existing?.date, 'date', { required: true });
  if (!isDateKey(date)) throw new ValidationError('date must look like YYYY-MM-DD', 'date');

  const accountId = str(body.accountId ?? existing?.accountId, 'accountId', { required: true });
  if (!db.accounts.some((a) => a.id === accountId)) {
    throw new ValidationError(`Unknown account "${accountId}"`, 'accountId');
  }

  const kind = str(body.kind ?? existing?.kind ?? 'expense', 'kind', { fallback: 'expense' });
  if (!TRANSACTION_KINDS.includes(kind)) {
    throw new ValidationError(`kind must be one of ${TRANSACTION_KINDS.join(', ')}`, 'kind');
  }

  let amount = money(body.amount ?? existing?.amount, 'amount', { required: true });
  // Sign is derived from kind so the ledger stays consistent no matter how the
  // user typed it: expenses and transfers leave the account, income arrives.
  if (kind === 'income') amount = Math.abs(amount);
  else amount = -Math.abs(amount);

  let transferAccountId = null;
  if (kind === 'transfer') {
    transferAccountId = str(body.transferAccountId ?? existing?.transferAccountId, 'transferAccountId', { required: true });
    if (!db.accounts.some((a) => a.id === transferAccountId)) {
      throw new ValidationError(`Unknown destination account "${transferAccountId}"`, 'transferAccountId');
    }
    if (transferAccountId === accountId) {
      throw new ValidationError('A transfer needs two different accounts', 'transferAccountId');
    }
  }

  const category = str(body.category ?? existing?.category, 'category', { max: 60 }) || null;
  if (category && kind !== 'transfer' && !db.categories.some((c) => c.id === category)) {
    throw new ValidationError(`Unknown category "${category}"`, 'category');
  }

  return {
    date,
    accountId,
    kind,
    amount,
    transferAccountId,
    category: kind === 'transfer' ? null : category,
    description: str(body.description ?? existing?.description, 'description', { max: 160 }),
    ownerId: owner(body.ownerId ?? existing?.ownerId, people),
  };
}

export function validateBill(body, db, existing = null) {
  const people = db.settings.people ?? [];
  const accountId = str(body.accountId ?? existing?.accountId, 'accountId', { fallback: '' });
  if (accountId && !db.accounts.some((a) => a.id === accountId)) {
    throw new ValidationError(`Unknown account "${accountId}"`, 'accountId');
  }
  return {
    name: str(body.name ?? existing?.name, 'name', { required: true, max: 80 }),
    amount: Math.abs(money(body.amount ?? existing?.amount, 'amount', { required: true })),
    dueDay: intInRange(body.dueDay ?? existing?.dueDay, 'dueDay', 1, 31, { fallback: 1 }),
    accountId: accountId || null,
    category: str(body.category ?? existing?.category, 'category', { max: 60 }) || null,
    ownerId: owner(body.ownerId ?? existing?.ownerId, people),
    autopay: bool(body.autopay ?? existing?.autopay),
    active: bool(body.active ?? existing?.active ?? true, true),
    notes: str(body.notes ?? existing?.notes, 'notes', { max: 300 }),
  };
}

export function validateCategory(body, existing = null) {
  const kind = str(body.kind ?? existing?.kind ?? 'expense', 'kind', { fallback: 'expense' });
  if (!['expense', 'income'].includes(kind)) {
    throw new ValidationError('kind must be expense or income', 'kind');
  }
  const color = str(body.color ?? existing?.color, 'color', { fallback: '#64748b' });
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new ValidationError('color must be a hex value like #6366f1', 'color');
  }
  return {
    name: str(body.name ?? existing?.name, 'name', { required: true, max: 60 }),
    kind,
    color,
    budget: (() => {
      const v = toCents(body.budget ?? existing?.budget ?? '');
      return v === null ? null : Math.abs(v);
    })(),
  };
}

export function validateSettings(body, existing) {
  const people = Array.isArray(body.people) ? body.people : existing.people;
  if (!Array.isArray(people) || people.length === 0) {
    throw new ValidationError('At least one person is required', 'people');
  }
  if (people.length > 8) throw new ValidationError('At most 8 people are supported', 'people');

  const seen = new Set();
  const cleanPeople = people.map((p, i) => {
    const id = str(p.id, 'people[].id', { fallback: `p${i + 1}` }) || `p${i + 1}`;
    if (id === JOINT) throw new ValidationError('"joint" is reserved', 'people');
    if (seen.has(id)) throw new ValidationError(`Duplicate person id "${id}"`, 'people');
    seen.add(id);
    return {
      id,
      name: str(p.name, 'people[].name', { required: true, max: 60 }),
      // A palette slot, not a hex: the chart resolves it to the light or dark
      // step of that hue.
      colorSlot: intInRange(p.colorSlot, 'people[].colorSlot', 0, 7, { fallback: i % 8 }),
    };
  });

  let targetRate = existing.savingsTargetRate ?? 0.2;
  if (body.savingsTargetRate !== undefined && body.savingsTargetRate !== '') {
    const n = Number(body.savingsTargetRate);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new ValidationError('savingsTargetRate must be between 0 and 1', 'savingsTargetRate');
    }
    targetRate = n;
  }

  return {
    ...existing,
    household: str(body.household ?? existing.household, 'household', { max: 80, fallback: 'Our Household' }),
    currency: (str(body.currency ?? existing.currency, 'currency', { max: 3, fallback: 'USD' }) || 'USD').toUpperCase(),
    locale: str(body.locale ?? existing.locale, 'locale', { max: 20, fallback: 'en-US' }) || 'en-US',
    savingsTargetRate: targetRate,
    people: cleanPeople,
  };
}

export function validatePayment(body, db) {
  const month = str(body.month, 'month', { required: true });
  if (!isMonthKey(month)) throw new ValidationError('month must look like YYYY-MM', 'month');

  const source = str(body.source, 'source', { required: true });
  if (!['card', 'bill'].includes(source)) {
    throw new ValidationError('source must be card or bill', 'source');
  }

  const refId = str(body.refId, 'refId', { required: true });
  const exists = source === 'card'
    ? db.accounts.some((a) => a.id === refId)
    : db.bills.some((b) => b.id === refId);
  if (!exists) throw new ValidationError(`Unknown ${source} "${refId}"`, 'refId');

  const paidOn = str(body.paidOn, 'paidOn', { fallback: '' });
  if (paidOn && !isDateKey(paidOn)) {
    throw new ValidationError('paidOn must look like YYYY-MM-DD', 'paidOn');
  }

  return {
    month,
    source,
    refId,
    paidOn: paidOn || null,
    amount: Math.abs(money(body.amount, 'amount', { fallback: 0 }) ?? 0),
  };
}
