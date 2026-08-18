// Shared vocabulary for account types and transaction kinds.

export const ACCOUNT_TYPES = {
  checking:   { label: 'Checking',   side: 'asset',     liquid: true,  order: 1 },
  savings:    { label: 'Savings',    side: 'asset',     liquid: false, order: 2 },
  cash:       { label: 'Cash',       side: 'asset',     liquid: true,  order: 3 },
  investment: { label: 'Investment', side: 'asset',     liquid: false, order: 4 },
  // Property is an asset so a mortgage does not read as pure debt: without the
  // home on the other side, net worth would be wrong by the value of the house.
  property:   { label: 'Property',   side: 'asset',     liquid: false, order: 5 },
  credit:     { label: 'Credit Card', side: 'liability', liquid: false, order: 6 },
  loan:       { label: 'Loan',       side: 'liability', liquid: false, order: 7 },
};

export const TRANSACTION_KINDS = ['expense', 'income', 'transfer'];

export const JOINT = 'joint';

export function isAsset(type) { return ACCOUNT_TYPES[type]?.side === 'asset'; }
export function isLiability(type) { return ACCOUNT_TYPES[type]?.side === 'liability'; }
export function isLiquid(type) { return ACCOUNT_TYPES[type]?.liquid === true; }
/** Accounts that count as "money set aside" when transferred into. */
export function isSavingsLike(type) { return type === 'savings' || type === 'investment'; }

export function accountTypeLabel(type) { return ACCOUNT_TYPES[type]?.label ?? type; }

export const DEFAULT_CATEGORIES = [
  { id: 'housing',       name: 'Housing & Rent',    kind: 'expense', color: '#6366f1' },
  { id: 'utilities',     name: 'Utilities',         kind: 'expense', color: '#0ea5e9' },
  { id: 'groceries',     name: 'Groceries',         kind: 'expense', color: '#10b981' },
  { id: 'dining',        name: 'Dining Out',        kind: 'expense', color: '#f59e0b' },
  { id: 'transport',     name: 'Transport & Fuel',  kind: 'expense', color: '#8b5cf6' },
  { id: 'insurance',     name: 'Insurance',         kind: 'expense', color: '#14b8a6' },
  { id: 'health',        name: 'Health & Medical',  kind: 'expense', color: '#ef4444' },
  { id: 'childcare',     name: 'Childcare',         kind: 'expense', color: '#ec4899' },
  { id: 'subscriptions', name: 'Subscriptions',     kind: 'expense', color: '#a855f7' },
  { id: 'shopping',      name: 'Shopping',          kind: 'expense', color: '#f43f5e' },
  { id: 'travel',        name: 'Travel',            kind: 'expense', color: '#06b6d4' },
  { id: 'debt',          name: 'Debt Payments',     kind: 'expense', color: '#dc2626' },
  { id: 'other',         name: 'Other',             kind: 'expense', color: '#64748b' },
  { id: 'salary',        name: 'Salary',            kind: 'income',  color: '#22c55e' },
  { id: 'bonus',         name: 'Bonus',             kind: 'income',  color: '#84cc16' },
  { id: 'interest',      name: 'Interest & Dividends', kind: 'income', color: '#eab308' },
  { id: 'other-income',  name: 'Other Income',      kind: 'income',  color: '#4ade80' },
];
