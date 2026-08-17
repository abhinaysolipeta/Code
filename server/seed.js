// Generates a realistic demo household: two earners, joint and personal
// accounts, credit cards, recurring bills and 14 months of history so the
// trend charts have something to show. Deterministic, so runs are comparable.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { addMonths, currentMonth, dayInMonth, daysInMonth } from '../shared/dates.js';
import { isLiability } from '../shared/model.js';
import { Store, emptyDatabase, newId } from './store.js';

/* A tiny deterministic PRNG -- reproducible demo data beats random noise. */
function mulberry32(seed) {
  return function rand() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260817);
const between = (min, max) => Math.round(min + rand() * (max - min));
const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];

const MONTHS = 14;

const PEOPLE = [
  { id: 'p1', name: 'Alex', colorSlot: 0 },
  { id: 'p2', name: 'Sam', colorSlot: 1 },
];

const ACCOUNTS = [
  { key: 'joint-checking', name: 'Joint Checking',    institution: 'First National', type: 'checking',   ownerId: 'joint', last4: '4021', open: 8_400_00 },
  { key: 'alex-checking',  name: 'Alex Everyday',     institution: 'First National', type: 'checking',   ownerId: 'p1',    last4: '7719', open: 5_500_00 },
  { key: 'sam-checking',   name: 'Sam Everyday',      institution: 'Metro Credit Union', type: 'checking', ownerId: 'p2',  last4: '3308', open: 4_800_00 },
  { key: 'emergency',      name: 'Emergency Fund',    institution: 'Ally',           type: 'savings',    ownerId: 'joint', last4: '9006', open: 21_000_00, interestRate: 4.2 },
  { key: 'house-fund',     name: 'House Down Payment',institution: 'Ally',           type: 'savings',    ownerId: 'joint', last4: '9012', open: 34_500_00, interestRate: 4.2 },
  { key: 'alex-roth',      name: 'Alex Roth IRA',     institution: 'Vanguard',       type: 'investment', ownerId: 'p1',    last4: '1180', open: 48_200_00 },
  { key: 'sam-roth',       name: 'Sam Roth IRA',      institution: 'Fidelity',       type: 'investment', ownerId: 'p2',    last4: '5540', open: 41_600_00 },
  { key: 'sapphire',       name: 'Sapphire Rewards',  institution: 'Chase',          type: 'credit',     ownerId: 'p1',    last4: '8842', open: 1_240_00, creditLimit: 18_000_00, apr: 21.24, dueDay: 14 },
  { key: 'amex',           name: 'Everyday Cash',     institution: 'Amex',           type: 'credit',     ownerId: 'p2',    last4: '2207', open: 860_00,  creditLimit: 12_000_00, apr: 19.99, dueDay: 22 },
  { key: 'joint-visa',     name: 'Household Visa',    institution: 'Costco',         type: 'credit',     ownerId: 'joint', last4: '6633', open: 2_100_00, creditLimit: 15_000_00, apr: 18.49, dueDay: 8, autopay: true },
  { key: 'car-loan',       name: 'Car Loan',          institution: 'Metro Credit Union', type: 'loan',   ownerId: 'joint', last4: '4417', open: 18_400_00, apr: 5.9, dueDay: 5 },
];

const BILLS = [
  { name: 'Mortgage',           amount: 2_450_00, dueDay: 1,  category: 'housing',       ownerId: 'joint', account: 'joint-checking', autopay: true },
  { name: 'Electricity',        amount: 165_00,   dueDay: 12, category: 'utilities',     ownerId: 'joint', account: 'joint-checking', autopay: true },
  { name: 'Water & Waste',      amount: 78_00,    dueDay: 15, category: 'utilities',     ownerId: 'joint', account: 'joint-checking', autopay: true },
  { name: 'Internet',           amount: 89_00,    dueDay: 18, category: 'utilities',     ownerId: 'joint', account: 'joint-visa',     autopay: true },
  { name: 'Mobile (family)',    amount: 128_00,   dueDay: 20, category: 'utilities',     ownerId: 'joint', account: 'joint-visa',     autopay: true },
  { name: 'Car Insurance',      amount: 196_00,   dueDay: 6,  category: 'insurance',     ownerId: 'joint', account: 'joint-checking', autopay: true },
  { name: 'Health Insurance',   amount: 340_00,   dueDay: 3,  category: 'insurance',     ownerId: 'joint', account: 'joint-checking', autopay: true },
  { name: 'Daycare',            amount: 1_180_00, dueDay: 2,  category: 'childcare',     ownerId: 'joint', account: 'joint-checking', autopay: false },
  { name: 'Streaming bundle',   amount: 46_00,    dueDay: 9,  category: 'subscriptions', ownerId: 'p1',    account: 'sapphire',       autopay: true },
  { name: 'Gym (both)',         amount: 72_00,    dueDay: 11, category: 'subscriptions', ownerId: 'joint', account: 'amex',           autopay: true },
  { name: 'Car Loan Payment',   amount: 412_00,   dueDay: 5,  category: 'debt',          ownerId: 'joint', account: 'joint-checking', autopay: true },
];

const VARIABLE_SPEND = [
  { category: 'groceries', account: 'joint-visa',    owner: 'joint', count: [9, 14], amount: [4_200, 16_500], names: ['Green Market', 'Costco', 'Trader Grocers', 'Corner Deli'] },
  { category: 'dining',    account: 'sapphire',      owner: 'p1',    count: [4, 9],  amount: [1_800, 9_500],  names: ['Tacos Al Norte', 'Blue Bottle', 'Ramen House', 'Pizzeria Uno'] },
  { category: 'dining',    account: 'amex',          owner: 'p2',    count: [3, 8],  amount: [1_500, 8_000],  names: ['Sweetgreen', 'Thai Basil', 'Local Cafe', 'Sushi Bar'] },
  { category: 'transport', account: 'joint-visa',    owner: 'joint', count: [4, 8],  amount: [3_000, 8_500],  names: ['Shell', 'Chevron', 'City Transit', 'Ride Share'] },
  { category: 'shopping',  account: 'sapphire',      owner: 'p1',    count: [2, 5],  amount: [2_500, 22_000], names: ['Uniqlo', 'Amazon', 'Home Depot', 'REI'] },
  { category: 'shopping',  account: 'amex',          owner: 'p2',    count: [2, 5],  amount: [2_500, 18_000], names: ['Target', 'Amazon', 'Sephora', 'Bookshop'] },
  { category: 'health',    account: 'joint-checking',owner: 'joint', count: [0, 3],  amount: [2_000, 18_000], names: ['Family Clinic', 'Pharmacy', 'Dental Group'] },
  { category: 'other',     account: 'joint-visa',    owner: 'joint', count: [1, 4],  amount: [1_200, 9_000],  names: ['Hardware Store', 'Post Office', 'Pet Supply'] },
];

export function buildSeed(endMonth = currentMonth()) {
  const db = emptyDatabase();
  db.settings.household = 'The Demo Household';
  db.settings.people = PEOPLE;
  db.settings.savingsTargetRate = 0.2;

  const idOf = new Map();
  for (const spec of ACCOUNTS) {
    const id = newId();
    idOf.set(spec.key, id);
    db.accounts.push({
      id,
      name: spec.name,
      institution: spec.institution,
      last4: spec.last4,
      type: spec.type,
      ownerId: spec.ownerId,
      creditLimit: spec.creditLimit ?? null,
      apr: spec.apr ?? null,
      dueDay: spec.dueDay ?? null,
      interestRate: spec.interestRate ?? null,
      autopay: Boolean(spec.autopay),
      notes: '',
      archived: false,
      createdAt: new Date().toISOString(),
    });
  }

  for (const bill of BILLS) {
    db.bills.push({
      id: newId(),
      name: bill.name,
      amount: bill.amount,
      dueDay: bill.dueDay,
      accountId: idOf.get(bill.account),
      category: bill.category,
      ownerId: bill.ownerId,
      autopay: bill.autopay,
      active: true,
      notes: '',
    });
  }

  // Running balances: assets hold cash, liabilities hold amount owed.
  const balance = new Map();
  for (const spec of ACCOUNTS) balance.set(spec.key, spec.open);

  const typeOf = new Map(ACCOUNTS.map((a) => [a.key, a.type]));
  const apply = (key, signedCents) => {
    const delta = isLiability(typeOf.get(key)) ? -signedCents : signedCents;
    balance.set(key, balance.get(key) + delta);
  };

  const tx = (date, key, amount, opts = {}) => {
    db.transactions.push({
      id: newId(),
      date,
      accountId: idOf.get(key),
      kind: opts.kind ?? (amount >= 0 ? 'income' : 'expense'),
      amount,
      category: opts.category ?? null,
      description: opts.description ?? '',
      ownerId: opts.ownerId ?? 'joint',
      transferAccountId: opts.to ? idOf.get(opts.to) : null,
      createdAt: new Date().toISOString(),
    });
    apply(key, amount);
    if (opts.to) apply(opts.to, Math.abs(amount));
  };

  const months = [];
  for (let i = MONTHS - 1; i >= 0; i--) months.push(addMonths(endMonth, -i));

  // Statement balances carried from the prior month drive "payments due".
  const lastStatement = new Map();

  months.forEach((month, monthIndex) => {
    const lastDay = daysInMonth(month);
    const raise = monthIndex >= 8 ? 1.04 : 1; // a mid-history pay rise

    // --- Income: two salaries, paid on the 15th and the last day ---
    const alexPay = Math.round(3_180_00 * raise);
    const samPay = Math.round(2_740_00 * raise);
    for (const [day, label] of [[15, 'first half'], [lastDay, 'second half']]) {
      tx(dayInMonth(month, day), 'alex-checking', alexPay, {
        kind: 'income', category: 'salary', ownerId: 'p1', description: `Payroll — Northwind (${label})`,
      });
      tx(dayInMonth(month, day), 'sam-checking', samPay, {
        kind: 'income', category: 'salary', ownerId: 'p2', description: `Payroll — Halcyon Labs (${label})`,
      });
    }
    if (month.endsWith('-12')) {
      tx(dayInMonth(month, 20), 'alex-checking', 4_800_00, {
        kind: 'income', category: 'bonus', ownerId: 'p1', description: 'Year-end bonus',
      });
    }

    // Interest on savings.
    for (const key of ['emergency', 'house-fund']) {
      const interest = Math.round(balance.get(key) * 0.042 / 12);
      tx(dayInMonth(month, lastDay), key, interest, {
        kind: 'income', category: 'interest', ownerId: 'joint', description: 'Interest paid',
      });
    }

    // --- Each partner funds the joint account ---
    tx(dayInMonth(month, 2), 'alex-checking', -4_400_00, {
      kind: 'transfer', to: 'joint-checking', ownerId: 'p1', description: 'Share of household costs',
    });
    tx(dayInMonth(month, 2), 'sam-checking', -3_900_00, {
      kind: 'transfer', to: 'joint-checking', ownerId: 'p2', description: 'Share of household costs',
    });

    // --- Recurring bills ---
    for (const bill of BILLS) {
      tx(dayInMonth(month, bill.dueDay), bill.account, -bill.amount, {
        category: bill.category, ownerId: bill.ownerId, description: bill.name,
      });
    }

    // --- Variable spending ---
    for (const spec of VARIABLE_SPEND) {
      const count = between(spec.count[0], spec.count[1]);
      for (let i = 0; i < count; i++) {
        tx(dayInMonth(month, between(1, lastDay)), spec.account, -between(spec.amount[0], spec.amount[1]), {
          category: spec.category, ownerId: spec.owner, description: pickOne(spec.names),
        });
      }
    }
    // An occasional trip.
    if (rand() < 0.28) {
      tx(dayInMonth(month, between(5, 24)), 'sapphire', -between(45_000, 180_000), {
        category: 'travel', ownerId: 'joint', description: pickOne(['Flights', 'Hotel stay', 'Rental car']),
      });
    }

    // --- Deliberate saving ---
    tx(dayInMonth(month, 3), 'joint-checking', -1_400_00, {
      kind: 'transfer', to: 'house-fund', ownerId: 'joint', description: 'Monthly house fund',
    });
    tx(dayInMonth(month, 3), 'joint-checking', -450_00, {
      kind: 'transfer', to: 'emergency', ownerId: 'joint', description: 'Emergency top-up',
    });
    tx(dayInMonth(month, 16), 'alex-checking', -583_00, {
      kind: 'transfer', to: 'alex-roth', ownerId: 'p1', description: 'Roth IRA contribution',
    });
    tx(dayInMonth(month, 16), 'sam-checking', -583_00, {
      kind: 'transfer', to: 'sam-roth', ownerId: 'p2', description: 'Roth IRA contribution',
    });

    // Investments drift with the market.
    for (const key of ['alex-roth', 'sam-roth']) {
      balance.set(key, balance.get(key) + Math.round(balance.get(key) * (rand() * 0.03 - 0.006)));
    }

    // --- Pay off last month's card statements ---
    for (const card of ['sapphire', 'amex', 'joint-visa']) {
      const owed = lastStatement.get(card) ?? 0;
      if (owed <= 0) continue;
      const source = card === 'sapphire' ? 'alex-checking' : card === 'amex' ? 'sam-checking' : 'joint-checking';
      tx(dayInMonth(month, ACCOUNTS.find((a) => a.key === card).dueDay), source, -owed, {
        kind: 'transfer', to: card, ownerId: 'joint', description: `Payment — ${card}`,
      });
    }

    // Loan principal reduction (the payment itself is recorded as an expense).
    balance.set('car-loan', Math.max(0, balance.get('car-loan') - 322_00));

    // --- Month-end snapshots: the figures you would read off a statement ---
    for (const spec of ACCOUNTS) {
      const bal = Math.round(balance.get(spec.key));
      const snapshot = {
        id: newId(),
        accountId: idOf.get(spec.key),
        month,
        balance: bal,
        statementBalance: null,
        minimumPayment: null,
        dueDate: null,
        updatedAt: new Date().toISOString(),
      };
      if (spec.type === 'credit') {
        snapshot.statementBalance = bal;
        snapshot.minimumPayment = Math.max(2_500, Math.round(bal * 0.02));
        snapshot.dueDate = dayInMonth(addMonths(month, 1), spec.dueDay);
        lastStatement.set(spec.key, bal);
      }
      if (spec.type === 'loan') {
        snapshot.minimumPayment = 412_00;
        snapshot.dueDate = dayInMonth(addMonths(month, 1), spec.dueDay);
      }
      db.snapshots.push(snapshot);
    }

    // History is settled; the newest month stays open so the dashboard has a
    // live payments-due list to work through.
    if (monthIndex < months.length - 1) {
      for (const bill of BILLS) {
        db.payments.push({
          id: newId(),
          month,
          source: 'bill',
          refId: db.bills.find((b) => b.name === bill.name).id,
          paidOn: dayInMonth(month, bill.dueDay),
          amount: bill.amount,
        });
      }
      for (const card of ['sapphire', 'amex', 'joint-visa']) {
        db.payments.push({
          id: newId(),
          month,
          source: 'card',
          refId: idOf.get(card),
          paidOn: dayInMonth(month, ACCOUNTS.find((a) => a.key === card).dueDay),
          amount: lastStatement.get(card) ?? 0,
        });
      }
    }
  });

  db.transactions.sort((a, b) => a.date.localeCompare(b.date));
  return db;
}

/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = process.env.FINANCE_DATA || path.join(here, '..', 'data', 'finance.json');
  const force = process.argv.includes('--force');

  if (fs.existsSync(file) && !force) {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if ((existing.accounts ?? []).length > 0) {
      console.error(`Refusing to overwrite ${file}, which already has ${existing.accounts.length} account(s).`);
      console.error('Re-run with --force if you really want to replace it (a backup is kept in data/backups).');
      process.exit(1);
    }
  }

  const store = new Store(file);
  store.load();
  const db = store.replaceAll(buildSeed());
  console.log(`Seeded ${file}`);
  console.log(`  ${db.accounts.length} accounts, ${db.snapshots.length} monthly snapshots, ${db.transactions.length} transactions, ${db.bills.length} bills`);
}
