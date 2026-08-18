// The monthly report engine. Pure functions over a plain data object -- no I/O,
// so it runs identically on the server and under `node --test`.

import { addMonths, dayInMonth, daysBetween, isDateKey, monthOf, monthRange, todayKey } from './dates.js';
import { ratio, sum } from './money.js';
import { ACCOUNT_TYPES, JOINT, isAsset, isLiability, isLiquid, isSavingsLike } from './model.js';

/* ------------------------------------------------------------------ *
 * Snapshot resolution
 * ------------------------------------------------------------------ */

/**
 * Index snapshots by account, sorted by month, so we can answer
 * "what was this account's balance as of month M?" cheaply.
 */
export function indexSnapshots(snapshots = []) {
  const byAccount = new Map();
  for (const s of snapshots) {
    if (!byAccount.has(s.accountId)) byAccount.set(s.accountId, []);
    byAccount.get(s.accountId).push(s);
  }
  for (const list of byAccount.values()) list.sort((a, b) => a.month.localeCompare(b.month));
  return byAccount;
}

/**
 * The account's position as of `month`. When no snapshot exists for that exact
 * month we carry the most recent earlier one forward and mark it stale -- a
 * forgotten update should not silently drop an account out of the report.
 */
export function resolveSnapshot(index, accountId, month) {
  const list = index.get(accountId);
  if (!list || list.length === 0) return null;
  let found = null;
  for (const s of list) {
    if (s.month <= month) found = s;
    else break;
  }
  if (!found) return null;
  return { ...found, stale: found.month !== month, staleSince: found.month };
}

/* ------------------------------------------------------------------ *
 * Grouping helpers
 * ------------------------------------------------------------------ */

function ownerBuckets(people) {
  const buckets = new Map();
  for (const p of people) buckets.set(p.id, 0);
  buckets.set(JOINT, 0);
  return buckets;
}

/** Chart colour for a person: a palette slot reference, resolved by the theme. */
export function personColor(person) {
  const slot = Number.isInteger(person?.colorSlot) ? person.colorSlot : 0;
  return `var(--series-${slot + 1})`;
}

function bucketsToArray(buckets, people) {
  const byId = new Map(people.map((p) => [p.id, p]));
  return [...buckets.entries()].map(([ownerId, amount]) => ({
    ownerId,
    name: ownerId === JOINT ? 'Joint' : byId.get(ownerId)?.name ?? 'Unassigned',
    color: ownerId === JOINT ? 'var(--text-muted)' : personColor(byId.get(ownerId)),
    amount,
  }));
}

function normalizeOwner(ownerId, people) {
  if (ownerId === JOINT) return JOINT;
  return people.some((p) => p.id === ownerId) ? ownerId : JOINT;
}

/* ------------------------------------------------------------------ *
 * Balance rollup for a single month
 * ------------------------------------------------------------------ */

/**
 * Roll every active account up into per-type totals for `month`.
 * Credit/loan balances are stored positive (= amount owed).
 */
export function positionsForMonth(db, month) {
  const people = db.settings?.people ?? [];
  const index = indexSnapshots(db.snapshots);
  const groups = {};
  for (const type of Object.keys(ACCOUNT_TYPES)) {
    groups[type] = { type, total: 0, accounts: [], byOwner: ownerBuckets(people) };
  }

  const missing = [];
  for (const account of db.accounts ?? []) {
    if (account.archived) continue;
    const group = groups[account.type];
    if (!group) continue;

    const snap = resolveSnapshot(index, account.id, month);
    const balance = snap ? snap.balance : 0;
    const owner = normalizeOwner(account.ownerId, people);

    if (!snap || snap.stale) {
      missing.push({
        accountId: account.id,
        name: account.name,
        type: account.type,
        lastSeen: snap?.staleSince ?? null,
      });
    }

    group.total += balance;
    group.byOwner.set(owner, (group.byOwner.get(owner) ?? 0) + balance);
    group.accounts.push({
      accountId: account.id,
      name: account.name,
      institution: account.institution ?? '',
      last4: account.last4 ?? '',
      type: account.type,
      ownerId: owner,
      balance,
      stale: snap ? snap.stale : true,
      staleSince: snap?.staleSince ?? null,
      snapshot: snap,
      creditLimit: account.creditLimit ?? null,
      apr: account.apr ?? null,
      dueDay: account.dueDay ?? null,
    });
  }

  for (const group of Object.values(groups)) {
    group.accounts.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    group.byOwner = bucketsToArray(group.byOwner, people);
  }

  const assets = sum(Object.values(groups).filter((g) => isAsset(g.type)).map((g) => g.total));
  const liabilities = sum(Object.values(groups).filter((g) => isLiability(g.type)).map((g) => g.total));
  const liquid = sum(Object.values(groups).filter((g) => isLiquid(g.type)).map((g) => g.total));

  return { groups, assets, liabilities, net: assets - liabilities, liquid, missing };
}

/* ------------------------------------------------------------------ *
 * Credit cards & payments due
 * ------------------------------------------------------------------ */

function cardStatus(daysUntilDue, autopay) {
  if (daysUntilDue === null) return 'unscheduled';
  if (daysUntilDue < 0) return autopay ? 'paid-auto' : 'overdue';
  if (daysUntilDue <= 7) return 'due-soon';
  return 'upcoming';
}

export function creditReport(db, month, positions, today) {
  const people = db.settings?.people ?? [];
  const group = positions.groups.credit;
  const cards = group.accounts.map((entry) => {
    const account = (db.accounts ?? []).find((a) => a.id === entry.accountId) ?? {};
    const snap = entry.snapshot ?? {};
    const dueDate = snap.dueDate && isDateKey(snap.dueDate)
      ? snap.dueDate
      : account.dueDay
        ? dayInMonth(addMonths(month, 1), account.dueDay)
        : null;
    const daysUntilDue = dueDate ? daysBetween(today, dueDate) : null;
    const statementBalance = snap.statementBalance ?? entry.balance;
    const minimumPayment = snap.minimumPayment ?? null;
    const creditLimit = account.creditLimit ?? null;

    return {
      accountId: entry.accountId,
      name: entry.name,
      institution: entry.institution,
      last4: entry.last4,
      ownerId: entry.ownerId,
      balance: entry.balance,
      statementBalance,
      minimumPayment,
      dueDate,
      daysUntilDue,
      creditLimit,
      available: creditLimit === null ? null : creditLimit - entry.balance,
      utilization: creditLimit ? ratio(entry.balance, creditLimit) : null,
      apr: account.apr ?? null,
      autopay: Boolean(account.autopay),
      stale: entry.stale,
      status: cardStatus(daysUntilDue, account.autopay),
    };
  });

  cards.sort((a, b) => {
    if (a.daysUntilDue === null) return 1;
    if (b.daysUntilDue === null) return -1;
    return a.daysUntilDue - b.daysUntilDue;
  });

  const totalLimit = sum(cards.map((c) => c.creditLimit ?? 0));
  const totalBalance = sum(cards.map((c) => c.balance));

  return {
    cards,
    totalBalance,
    totalLimit,
    totalAvailable: totalLimit ? totalLimit - totalBalance : null,
    utilization: totalLimit ? ratio(totalBalance, totalLimit) : null,
    totalStatement: sum(cards.map((c) => c.statementBalance ?? 0)),
    totalMinimum: sum(cards.map((c) => c.minimumPayment ?? 0)),
    byOwner: bucketsToArray(
      cards.reduce((acc, c) => {
        acc.set(c.ownerId, (acc.get(c.ownerId) ?? 0) + c.balance);
        return acc;
      }, ownerBuckets(people)),
      people,
    ),
  };
}

/**
 * Everything with a due date in the reporting window: card statements plus
 * recurring bills. This is the "what do we actually owe" list.
 */
export function paymentsDue(db, month, credit, today) {
  const people = db.settings?.people ?? [];
  const accounts = new Map((db.accounts ?? []).map((a) => [a.id, a]));
  const paidIndex = new Map(
    (db.payments ?? [])
      .filter((p) => p.month === month)
      .map((p) => [`${p.source}|${p.refId}`, p]),
  );
  const items = [];

  const settle = (item) => {
    const paid = paidIndex.get(`${item.source}|${item.id}`);
    if (paid) return { ...item, paid: true, paidOn: paid.paidOn ?? null, status: 'paid' };
    return { ...item, paid: false, paidOn: null };
  };

  for (const card of credit.cards) {
    if (!card.dueDate) continue;
    const amount = card.statementBalance ?? card.balance;
    if (amount <= 0) continue;
    items.push(settle({
      source: 'card',
      id: card.accountId,
      name: card.name,
      accountName: card.institution || card.name,
      ownerId: card.ownerId,
      amount,
      minimum: card.minimumPayment,
      dueDate: card.dueDate,
      daysUntilDue: card.daysUntilDue,
      autopay: card.autopay,
      status: card.status,
    }));
  }

  // Recurring bills are projected into the month being reported on.
  for (const bill of db.bills ?? []) {
    if (bill.active === false) continue;
    const dueDate = dayInMonth(month, bill.dueDay ?? 1);
    const daysUntilDue = daysBetween(today, dueDate);
    const account = accounts.get(bill.accountId);
    items.push(settle({
      source: 'bill',
      id: bill.id,
      name: bill.name,
      accountName: account?.name ?? '—',
      ownerId: normalizeOwner(bill.ownerId, people),
      amount: bill.amount ?? 0,
      minimum: null,
      dueDate,
      daysUntilDue,
      autopay: Boolean(bill.autopay),
      category: bill.category ?? null,
      status: cardStatus(daysUntilDue, bill.autopay),
    }));
  }

  items.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

  const cardTotal = sum(items.filter((i) => i.source === 'card').map((i) => i.amount));
  const billTotal = sum(items.filter((i) => i.source === 'bill').map((i) => i.amount));
  // "Outstanding" excludes anything settled -- explicitly ticked off, or an
  // autopay item whose date has already passed.
  const outstanding = items.filter((i) => !i.paid && i.status !== 'paid-auto');

  return {
    items,
    total: cardTotal + billTotal,
    cardTotal,
    billTotal,
    paidTotal: sum(items.filter((i) => i.paid).map((i) => i.amount)),
    outstandingTotal: sum(outstanding.map((i) => i.amount)),
    minimumTotal: sum(items.map((i) => i.minimum ?? 0)),
    overdue: outstanding.filter((i) => i.status === 'overdue'),
    next7: outstanding.filter((i) => i.daysUntilDue !== null && i.daysUntilDue >= 0 && i.daysUntilDue <= 7),
    next30: outstanding.filter((i) => i.daysUntilDue !== null && i.daysUntilDue >= 0 && i.daysUntilDue <= 30),
    byOwner: bucketsToArray(
      items.reduce((acc, i) => {
        acc.set(i.ownerId, (acc.get(i.ownerId) ?? 0) + i.amount);
        return acc;
      }, ownerBuckets(people)),
      people,
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Cash flow from transactions
 * ------------------------------------------------------------------ */

export function cashFlow(db, month) {
  const people = db.settings?.people ?? [];
  const accounts = new Map((db.accounts ?? []).map((a) => [a.id, a]));
  const categories = new Map((db.categories ?? []).map((c) => [c.id, c]));
  const txs = (db.transactions ?? []).filter((t) => monthOf(t.date) === month);

  let income = 0;
  let expenses = 0;
  let savingsContributions = 0;
  let debtPayments = 0;

  const byCategory = new Map();
  const byOwner = new Map();
  const byMerchant = new Map();

  const ownerRow = (ownerId) => {
    if (!byOwner.has(ownerId)) {
      byOwner.set(ownerId, { income: 0, expenses: 0, savings: 0, txCount: 0 });
    }
    return byOwner.get(ownerId);
  };
  for (const p of people) ownerRow(p.id);
  ownerRow(JOINT);

  for (const tx of txs) {
    const account = accounts.get(tx.accountId);
    const owner = normalizeOwner(tx.ownerId ?? account?.ownerId ?? JOINT, people);
    const row = ownerRow(owner);
    row.txCount += 1;

    if (tx.kind === 'transfer') {
      const target = accounts.get(tx.transferAccountId);
      const moved = Math.abs(tx.amount ?? 0);
      if (target && isSavingsLike(target.type)) {
        savingsContributions += moved;
        row.savings += moved;
      } else if (target && isLiability(target.type)) {
        debtPayments += moved;
      }
      // Transfers never count as income or expense -- money did not leave the household.
      continue;
    }

    const amount = tx.amount ?? 0;
    if (amount >= 0) {
      income += amount;
      row.income += amount;
    } else {
      const spent = -amount;
      expenses += spent;
      row.expenses += spent;

      const catId = tx.category ?? 'other';
      if (!byCategory.has(catId)) byCategory.set(catId, { amount: 0, txCount: 0 });
      const cat = byCategory.get(catId);
      cat.amount += spent;
      cat.txCount += 1;

      const merchant = (tx.description || 'Uncategorised').trim();
      byMerchant.set(merchant, (byMerchant.get(merchant) ?? 0) + spent);
    }
  }

  const categoryRows = [...byCategory.entries()]
    .map(([id, v]) => ({
      categoryId: id,
      name: categories.get(id)?.name ?? id,
      color: categories.get(id)?.color ?? '#64748b',
      budget: categories.get(id)?.budget ?? null,
      amount: v.amount,
      txCount: v.txCount,
      share: ratio(v.amount, expenses),
    }))
    .sort((a, b) => b.amount - a.amount);

  const names = new Map(people.map((p) => [p.id, p]));
  const ownerRows = [...byOwner.entries()].map(([ownerId, v]) => ({
    ownerId,
    name: ownerId === JOINT ? 'Joint' : names.get(ownerId)?.name ?? 'Unassigned',
    color: ownerId === JOINT ? 'var(--text-muted)' : personColor(names.get(ownerId)),
    ...v,
    net: v.income - v.expenses,
  }));

  return {
    income,
    expenses,
    net: income - expenses,
    savingsContributions,
    debtPayments,
    savingsRate: ratio(savingsContributions, income),
    netFlowRate: ratio(income - expenses, income),
    byCategory: categoryRows,
    byOwner: ownerRows,
    topMerchants: [...byMerchant.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8),
    transactionCount: txs.length,
  };
}

/* ------------------------------------------------------------------ *
 * Trends
 * ------------------------------------------------------------------ */

export function trends(db, month, count = 12) {
  const months = monthRange(month, count);
  const series = {
    months,
    checking: [], savings: [], credit: [], investment: [],
    netWorth: [], liquid: [],
    income: [], expenses: [], savingsContributions: [], savingsGrowth: [], savingsRate: [],
  };

  let prevSavings = null;
  for (const m of months) {
    const pos = positionsForMonth(db, m);
    const flow = cashFlow(db, m);
    const savings = pos.groups.savings.total;

    series.checking.push(pos.groups.checking.total);
    series.savings.push(savings);
    series.credit.push(pos.groups.credit.total);
    series.investment.push(pos.groups.investment.total);
    series.netWorth.push(pos.net);
    series.liquid.push(pos.liquid);
    series.income.push(flow.income);
    series.expenses.push(flow.expenses);
    series.savingsContributions.push(flow.savingsContributions);
    series.savingsGrowth.push(prevSavings === null ? 0 : savings - prevSavings);
    series.savingsRate.push(flow.savingsRate);
    prevSavings = savings;
  }
  return series;
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

function buildAlerts({ positions, credit, due, flow, settings, month }) {
  const alerts = [];
  const targetRate = settings?.savingsTargetRate ?? null;

  // One alert per overdue item reads fine for a couple, but a household with a
  // dozen bills would bury every other alert, so past a handful they collapse
  // into a single line naming them.
  if (due.overdue.length > 3) {
    alerts.push({
      level: 'danger',
      title: `${due.overdue.length} payments are past due`,
      detail: `Past their due date and not yet ticked off: ${due.overdue.map((i) => i.name).join(', ')}.`,
    });
  } else {
    for (const item of due.overdue) {
      alerts.push({
        level: 'danger',
        title: `${item.name} is past due`,
        detail: `Due ${item.dueDate}. ${item.source === 'card' ? 'Statement balance' : 'Amount'} outstanding.`,
      });
    }
  }

  const dueSoon = sum(due.next7.map((i) => i.amount));
  if (dueSoon > positions.liquid) {
    alerts.push({
      level: 'danger',
      title: 'Payments due in 7 days exceed liquid cash',
      detail: 'Checking and cash on hand will not cover what is due this week.',
    });
  }

  if (credit.utilization !== null && credit.utilization > 0.3) {
    alerts.push({
      level: 'warning',
      title: `Credit utilisation at ${(credit.utilization * 100).toFixed(0)}%`,
      detail: 'Sustained utilisation above 30% typically weighs on credit scores.',
    });
  }

  for (const card of credit.cards) {
    if (card.utilization !== null && card.utilization > 0.7) {
      alerts.push({
        level: 'warning',
        title: `${card.name} is ${(card.utilization * 100).toFixed(0)}% utilised`,
        detail: 'This card is close to its limit.',
      });
    }
  }

  if (flow.income > 0 && flow.net < 0) {
    alerts.push({
      level: 'warning',
      title: 'Spending exceeded income this month',
      detail: 'Expenses were higher than income for the reporting period.',
    });
  }

  if (targetRate && flow.income > 0 && (flow.savingsRate ?? 0) < targetRate) {
    alerts.push({
      level: 'info',
      title: `Savings rate below the ${(targetRate * 100).toFixed(0)}% target`,
      detail: `Recorded ${((flow.savingsRate ?? 0) * 100).toFixed(1)}% of income moved to savings.`,
    });
  }

  if (positions.missing.length) {
    alerts.push({
      level: 'info',
      title: `${positions.missing.length} account${positions.missing.length === 1 ? '' : 's'} not updated for ${month}`,
      detail: `Carried forward: ${positions.missing.map((m) => m.name).join(', ')}.`,
    });
  }

  return alerts;
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export function buildMonthlyReport(db, month, options = {}) {
  const today = options.today ?? todayKey();
  const trendMonths = options.trendMonths ?? 12;
  const settings = db.settings ?? {};
  const people = settings.people ?? [];
  const prevMonth = addMonths(month, -1);

  const positions = positionsForMonth(db, month);
  const prev = positionsForMonth(db, prevMonth);
  const credit = creditReport(db, month, positions, today);
  const due = paymentsDue(db, month, credit, today);
  const flow = cashFlow(db, month);

  const savingsGrowth = positions.groups.savings.total - prev.groups.savings.total;
  const dueSoonTotal = sum(due.next30.map((i) => i.amount));
  const dueThisWeek = sum(due.next7.map((i) => i.amount));

  const delta = (type) => positions.groups[type].total - prev.groups[type].total;

  return {
    month,
    prevMonth,
    generatedAt: new Date().toISOString(),
    today,
    currency: settings.currency ?? 'USD',
    locale: settings.locale ?? 'en-US',
    household: settings.household ?? 'Household',
    people,
    targetRate: settings.savingsTargetRate ?? null,

    cash: {
      checking: { ...positions.groups.checking, delta: delta('checking') },
      savings: { ...positions.groups.savings, delta: delta('savings') },
      cash: { ...positions.groups.cash, delta: delta('cash') },
      investment: { ...positions.groups.investment, delta: delta('investment') },
      liquid: positions.liquid,
      liquidDelta: positions.liquid - prev.liquid,
    },

    credit: {
      ...credit,
      delta: delta('credit'),
      loans: { ...positions.groups.loan, delta: delta('loan') },
    },

    paymentsDue: due,

    flow: {
      ...flow,
      savingsGrowth,
      // Growth beyond what was deliberately transferred in -- interest, market moves.
      savingsPassiveGrowth: savingsGrowth - flow.savingsContributions,
    },

    netWorth: {
      assets: positions.assets,
      liabilities: positions.liabilities,
      net: positions.net,
      prevNet: prev.net,
      delta: positions.net - prev.net,
    },

    coverage: {
      liquid: positions.liquid,
      dueNext7: dueThisWeek,
      dueNext30: dueSoonTotal,
      freeAfterDue: positions.liquid - dueSoonTotal,
      // How many months of recorded expenses the liquid balance would cover.
      runwayMonths: flow.expenses > 0 ? positions.liquid / flow.expenses : null,
    },

    trends: trends(db, month, trendMonths),
    alerts: buildAlerts({ positions, credit, due, flow, settings, month }),
    dataQuality: {
      month,
      missingSnapshots: positions.missing,
      accountCount: (db.accounts ?? []).filter((a) => !a.archived).length,
      transactionCount: flow.transactionCount,
    },
  };
}
