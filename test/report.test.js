import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { buildMonthlyReport, cashFlow, paymentsDue, creditReport, positionsForMonth, resolveSnapshot, indexSnapshots } from '../shared/report.js';
import { emptyDatabase } from '../server/store.js';

/** A deliberately small household we can reason about by hand. */
function fixture() {
  const db = emptyDatabase();
  db.settings.people = [
    { id: 'p1', name: 'Ana', color: '#111111' },
    { id: 'p2', name: 'Ben', color: '#222222' },
  ];
  db.accounts = [
    { id: 'chk-j', name: 'Joint Checking', type: 'checking', ownerId: 'joint' },
    { id: 'chk-a', name: 'Ana Checking', type: 'checking', ownerId: 'p1' },
    { id: 'sav',   name: 'Savings', type: 'savings', ownerId: 'joint' },
    { id: 'inv',   name: 'Brokerage', type: 'investment', ownerId: 'p2' },
    { id: 'cc-a',  name: 'Ana Card', type: 'credit', ownerId: 'p1', creditLimit: 1000_00, dueDay: 10 },
    { id: 'cc-b',  name: 'Ben Card', type: 'credit', ownerId: 'p2', creditLimit: 500_00, dueDay: 20, autopay: true },
  ];
  db.snapshots = [
    { id: 's1', accountId: 'chk-j', month: '2026-07', balance: 1000_00 },
    { id: 's2', accountId: 'chk-j', month: '2026-08', balance: 1200_00 },
    { id: 's3', accountId: 'chk-a', month: '2026-08', balance: 300_00 },
    { id: 's4', accountId: 'sav',   month: '2026-07', balance: 5000_00 },
    { id: 's5', accountId: 'sav',   month: '2026-08', balance: 5600_00 },
    { id: 's6', accountId: 'cc-a',  month: '2026-08', balance: 250_00, statementBalance: 240_00, minimumPayment: 25_00, dueDate: '2026-09-10' },
    { id: 's7', accountId: 'cc-b',  month: '2026-08', balance: 100_00, statementBalance: 100_00, minimumPayment: 25_00, dueDate: '2026-08-10' },
  ];
  db.transactions = [
    { id: 't1', date: '2026-08-01', accountId: 'chk-a', kind: 'income',   amount: 4000_00, category: 'salary', ownerId: 'p1', description: 'Payroll' },
    { id: 't2', date: '2026-08-02', accountId: 'chk-j', kind: 'expense',  amount: -900_00, category: 'housing', ownerId: 'joint', description: 'Rent' },
    { id: 't3', date: '2026-08-03', accountId: 'cc-a',  kind: 'expense',  amount: -150_00, category: 'groceries', ownerId: 'p1', description: 'Market' },
    { id: 't4', date: '2026-08-04', accountId: 'chk-j', kind: 'transfer', amount: -500_00, transferAccountId: 'sav', ownerId: 'joint', description: 'To savings' },
    { id: 't5', date: '2026-08-05', accountId: 'chk-a', kind: 'transfer', amount: -200_00, transferAccountId: 'inv', ownerId: 'p1', description: 'To brokerage' },
    { id: 't6', date: '2026-08-06', accountId: 'chk-a', kind: 'transfer', amount: -240_00, transferAccountId: 'cc-a', ownerId: 'p1', description: 'Card payment' },
    { id: 't7', date: '2026-07-15', accountId: 'chk-j', kind: 'expense',  amount: -100_00, category: 'dining', ownerId: 'joint', description: 'Last month' },
  ];
  db.bills = [
    { id: 'b1', name: 'Rent', amount: 900_00, dueDay: 2, accountId: 'chk-j', category: 'housing', ownerId: 'joint', autopay: false, active: true },
    { id: 'b2', name: 'Internet', amount: 60_00, dueDay: 22, accountId: 'chk-j', category: 'utilities', ownerId: 'joint', autopay: true, active: true },
    { id: 'b3', name: 'Old gym', amount: 30_00, dueDay: 5, accountId: 'chk-j', ownerId: 'p2', autopay: false, active: false },
  ];
  return db;
}

const TODAY = '2026-08-17';
const report = () => buildMonthlyReport(fixture(), '2026-08', { today: TODAY });

describe('snapshot resolution', () => {
  test('uses the exact month when present', () => {
    const idx = indexSnapshots(fixture().snapshots);
    const s = resolveSnapshot(idx, 'chk-j', '2026-08');
    assert.equal(s.balance, 1200_00);
    assert.equal(s.stale, false);
  });

  test('carries the last known balance forward and flags it stale', () => {
    const idx = indexSnapshots(fixture().snapshots);
    const s = resolveSnapshot(idx, 'chk-j', '2026-09');
    assert.equal(s.balance, 1200_00);
    assert.equal(s.stale, true);
    assert.equal(s.staleSince, '2026-08');
  });

  test('never reads a future snapshot into an earlier month', () => {
    const idx = indexSnapshots(fixture().snapshots);
    assert.equal(resolveSnapshot(idx, 'chk-a', '2026-07'), null);
  });
});

describe('positions', () => {
  test('sums checking across owners', () => {
    const pos = positionsForMonth(fixture(), '2026-08');
    assert.equal(pos.groups.checking.total, 1500_00);
    const byOwner = Object.fromEntries(pos.groups.checking.byOwner.map((o) => [o.ownerId, o.amount]));
    assert.equal(byOwner.joint, 1200_00);
    assert.equal(byOwner.p1, 300_00);
    assert.equal(byOwner.p2, 0);
  });

  test('net worth nets liabilities off assets', () => {
    const pos = positionsForMonth(fixture(), '2026-08');
    // 1200 + 300 + 5600 assets, 250 + 100 owed. Brokerage has no snapshot yet.
    assert.equal(pos.assets, 7100_00);
    assert.equal(pos.liabilities, 350_00);
    assert.equal(pos.net, 6750_00);
  });

  test('liquid counts checking but not savings', () => {
    assert.equal(positionsForMonth(fixture(), '2026-08').liquid, 1500_00);
  });

  test('reports accounts that were never updated', () => {
    const pos = positionsForMonth(fixture(), '2026-08');
    assert.ok(pos.missing.some((m) => m.accountId === 'inv'));
  });
});

describe('cash flow', () => {
  test('separates income, expenses and transfers', () => {
    const flow = cashFlow(fixture(), '2026-08');
    assert.equal(flow.income, 4000_00);
    assert.equal(flow.expenses, 1050_00); // rent + groceries only
    assert.equal(flow.net, 2950_00);
  });

  test('transfers into savings and investments count as saving', () => {
    const flow = cashFlow(fixture(), '2026-08');
    assert.equal(flow.savingsContributions, 700_00); // 500 savings + 200 brokerage
  });

  test('a card payment is debt repayment, not saving or spending', () => {
    const flow = cashFlow(fixture(), '2026-08');
    assert.equal(flow.debtPayments, 240_00);
    assert.ok(!flow.byCategory.some((c) => c.amount === 240_00));
  });

  test('savings rate is contributions over income', () => {
    assert.equal(cashFlow(fixture(), '2026-08').savingsRate, 700_00 / 4000_00);
  });

  test('ignores transactions outside the month', () => {
    const flow = cashFlow(fixture(), '2026-08');
    assert.ok(!flow.byCategory.some((c) => c.categoryId === 'dining'));
  });

  test('attributes spending to the right person', () => {
    const byOwner = Object.fromEntries(cashFlow(fixture(), '2026-08').byOwner.map((o) => [o.ownerId, o]));
    assert.equal(byOwner.p1.income, 4000_00);
    assert.equal(byOwner.p1.expenses, 150_00);
    assert.equal(byOwner.p1.savings, 200_00);
    assert.equal(byOwner.joint.expenses, 900_00);
    assert.equal(byOwner.joint.savings, 500_00);
  });

  test('category shares total 100%', () => {
    const flow = cashFlow(fixture(), '2026-08');
    const total = flow.byCategory.reduce((a, c) => a + c.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  test('income with no transactions yields a null rate rather than dividing by zero', () => {
    const db = fixture();
    db.transactions = [];
    const flow = cashFlow(db, '2026-08');
    assert.equal(flow.savingsRate, null);
    assert.equal(flow.income, 0);
  });
});

describe('credit cards', () => {
  test('computes utilisation per card and overall', () => {
    const r = report();
    const ana = r.credit.cards.find((c) => c.accountId === 'cc-a');
    assert.equal(ana.utilization, 250_00 / 1000_00);
    assert.equal(r.credit.utilization, 350_00 / 1500_00);
    assert.equal(r.credit.totalAvailable, 1150_00);
  });

  test('orders cards by how soon they are due', () => {
    const r = report();
    assert.deepEqual(r.credit.cards.map((c) => c.accountId), ['cc-b', 'cc-a']);
  });

  test('derives a due date from the account when the snapshot omits one', () => {
    const db = fixture();
    db.snapshots.find((s) => s.id === 's6').dueDate = null;
    const pos = positionsForMonth(db, '2026-08');
    const credit = creditReport(db, '2026-08', pos, TODAY);
    assert.equal(credit.cards.find((c) => c.accountId === 'cc-a').dueDate, '2026-09-10');
  });

  test('a due day of 31 is clamped into short months', () => {
    const db = fixture();
    db.accounts.find((a) => a.id === 'cc-a').dueDay = 31;
    db.snapshots.find((s) => s.id === 's6').dueDate = null;
    const pos = positionsForMonth(db, '2026-01');
    db.snapshots.push({ id: 'x', accountId: 'cc-a', month: '2026-01', balance: 10_00 });
    const credit = creditReport(db, '2026-01', positionsForMonth(db, '2026-01'), TODAY);
    assert.equal(credit.cards.find((c) => c.accountId === 'cc-a').dueDate, '2026-02-28');
    assert.ok(pos);
  });
});

describe('payments due', () => {
  test('lists card statements and active bills, skipping inactive ones', () => {
    const r = report();
    const names = r.paymentsDue.items.map((i) => i.name).sort();
    assert.deepEqual(names, ['Ana Card', 'Ben Card', 'Internet', 'Rent']);
  });

  test('flags a past-due non-autopay bill as overdue', () => {
    const r = report();
    assert.deepEqual(r.paymentsDue.overdue.map((i) => i.name), ['Rent']);
  });

  test('a past-due autopay card is treated as settled', () => {
    const r = report();
    const ben = r.paymentsDue.items.find((i) => i.name === 'Ben Card');
    assert.equal(ben.status, 'paid-auto');
    assert.ok(!r.paymentsDue.overdue.includes(ben));
  });

  test('ticking an item off removes it from what is outstanding', () => {
    const db = fixture();
    const before = paymentsDue(db, '2026-08', creditReport(db, '2026-08', positionsForMonth(db, '2026-08'), TODAY), TODAY);
    db.payments = [{ id: 'pay1', month: '2026-08', source: 'bill', refId: 'b1', paidOn: '2026-08-02', amount: 900_00 }];
    const after = paymentsDue(db, '2026-08', creditReport(db, '2026-08', positionsForMonth(db, '2026-08'), TODAY), TODAY);

    assert.equal(after.total, before.total, 'the obligation itself has not changed');
    assert.equal(after.paidTotal, 900_00);
    assert.equal(after.outstandingTotal, before.outstandingTotal - 900_00);
    assert.equal(after.overdue.length, 0);
  });

  test('a payment marked in another month does not settle this one', () => {
    const db = fixture();
    db.payments = [{ id: 'pay1', month: '2026-07', source: 'bill', refId: 'b1', amount: 900_00 }];
    const due = paymentsDue(db, '2026-08', creditReport(db, '2026-08', positionsForMonth(db, '2026-08'), TODAY), TODAY);
    assert.equal(due.overdue.length, 1);
  });

  test('many overdue items collapse into one alert instead of flooding', () => {
    const db = fixture();
    // A household with a dozen utility bills, none ticked off yet.
    db.bills = ['Water', 'Gas', 'Electricity', 'Internet', 'HOA', 'Phone'].map((name, i) => ({
      id: `late-${i}`, name, amount: 50_00, dueDay: 1, accountId: 'chk-j',
      ownerId: 'joint', autopay: false, active: true,
    }));
    const r = buildMonthlyReport(db, '2026-08', { today: TODAY });
    const danger = r.alerts.filter((a) => a.level === 'danger');

    assert.equal(r.paymentsDue.overdue.length, 6);
    assert.equal(danger.length, 1, 'six overdue bills produce one alert, not six');
    assert.match(danger[0].title, /6 payments are past due/);
    assert.match(danger[0].detail, /Water/);
  });

  test('a couple of overdue items are still named individually', () => {
    const db = fixture();
    db.bills = ['Water', 'Gas'].map((name, i) => ({
      id: `late-${i}`, name, amount: 50_00, dueDay: 1, accountId: 'chk-j',
      ownerId: 'joint', autopay: false, active: true,
    }));
    const r = buildMonthlyReport(db, '2026-08', { today: TODAY });
    const danger = r.alerts.filter((a) => a.level === 'danger');
    assert.equal(danger.length, 2);
    assert.match(danger[0].title, /is past due/);
  });

  test('windows the next 7 and 30 days from today', () => {
    const r = report();
    assert.deepEqual(r.paymentsDue.next7.map((i) => i.name), ['Internet']); // due the 22nd, 5 days out
    assert.ok(r.paymentsDue.next30.some((i) => i.name === 'Ana Card'));
  });
});

describe('monthly report', () => {
  test('reports month-over-month deltas', () => {
    const r = report();
    // July had only the joint account on file (1000), August has both (1500).
    assert.equal(r.cash.checking.delta, 500_00);
    assert.equal(r.cash.savings.delta, 600_00);
  });

  test('separates deliberate saving from passive growth', () => {
    const r = report();
    assert.equal(r.flow.savingsContributions, 700_00);
    assert.equal(r.flow.savingsGrowth, 600_00);
    // Savings grew 600 while 500 was transferred in; the rest is interest.
    assert.equal(r.flow.savingsPassiveGrowth, 600_00 - 700_00);
  });

  test('coverage shows what is left after near-term obligations', () => {
    const r = report();
    assert.equal(r.coverage.liquid, 1500_00);
    assert.equal(r.coverage.freeAfterDue, 1500_00 - r.coverage.dueNext30);
  });

  test('builds a trend series of the requested length ending on the report month', () => {
    const r = buildMonthlyReport(fixture(), '2026-08', { today: TODAY, trendMonths: 6 });
    assert.equal(r.trends.months.length, 6);
    assert.equal(r.trends.months.at(-1), '2026-08');
    assert.equal(r.trends.months[0], '2026-03');
    assert.equal(r.trends.checking.length, 6);
  });

  test('warns when the week ahead costs more than the cash on hand', () => {
    const db = fixture();
    db.snapshots.find((s) => s.id === 's2').balance = 10_00;
    db.snapshots.find((s) => s.id === 's3').balance = 10_00;
    const r = buildMonthlyReport(db, '2026-08', { today: TODAY });
    assert.ok(r.alerts.some((a) => a.title.includes('exceed liquid cash')));
  });

  test('survives an empty ledger', () => {
    const r = buildMonthlyReport(emptyDatabase(), '2026-08', { today: TODAY });
    assert.equal(r.cash.checking.total, 0);
    assert.equal(r.netWorth.net, 0);
    assert.equal(r.flow.savingsRate, null);
    assert.equal(r.paymentsDue.items.length, 0);
  });
});
