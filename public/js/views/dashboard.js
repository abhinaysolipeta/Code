/* The monthly report. Ordered to answer the questions in the order they get
 * asked: what have we got, what do we owe, what did we put away. */

import { api } from '../api.js';
import { barListChart, donutChart, groupedBarChart, lineChart } from '../charts.js';
import {
  card, dateLabel, deltaBadge, h, icon, money, monthLabel,
  ownerName, pct, pill, shortMonth, statTile, toast,
} from '../ui.js';

export function renderDashboard(ctx) {
  const { report } = ctx;
  if (report.dataQuality.accountCount === 0) return gettingStarted(ctx);

  // h() drops nullish children; native append() would stringify them as "null".
  return h('div', { class: 'stack' },
    alertsSection(report),
    headlineTiles(report),
    cashSection(report),
    creditSection(report),
    loansSection(report),
    paymentsSection(ctx),
    savingsSection(report),
    chartsSection(report),
  );
}

/* A first run has nothing to report on, so ask for the one thing that unblocks
 * everything else rather than showing ten empty cards. */
function gettingStarted(ctx) {
  const step = (n, title, body, action) => h('div', { class: 'card' },
    h('div', { class: 'card-body' },
      h('div', { class: 'row-tight', style: { marginBottom: '8px' } },
        h('span', {
          style: {
            width: '22px', height: '22px', borderRadius: '50%', flex: 'none',
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'grid', placeItems: 'center', fontSize: '12px', fontWeight: '700',
          },
        }, String(n)),
        h('h3', {}, title)),
      h('p', { class: 'secondary', style: { fontSize: '13px', marginBottom: '12px' } }, body),
      action));

  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('div', { class: 'card-body', style: { padding: '30px 26px' } },
        h('h2', { style: { fontSize: '19px', marginBottom: '6px' } }, 'Set up your monthly report'),
        h('p', { class: 'secondary', style: { maxWidth: '620px' } },
          'Three short steps. Once your accounts are in, the monthly routine is entering one balance per account — everything on this page is built from those numbers.'))),
    h('div', { class: 'grid grid-3' },
      step(1, 'Add your accounts',
        'Checking, savings, credit cards and loans — for each of you and any joint ones.',
        h('a', { class: 'btn btn-primary', href: '#accounts' }, 'Add accounts')),
      step(2, 'Record this month’s balances',
        'Copy the figure from each statement. Cards also take the statement balance and due date.',
        h('a', { class: 'btn', href: '#update' }, 'Update balances')),
      step(3, 'Add your recurring bills',
        'Rent, utilities and subscriptions become your payments-due checklist every month.',
        h('a', { class: 'btn', href: '#bills' }, 'Add bills'))),
    h('div', { class: 'card' },
      h('div', { class: 'card-body' },
        h('h3', { style: { marginBottom: '6px' } }, 'Want to see it with data first?'),
        h('p', { class: 'secondary', style: { fontSize: '13px' } },
          'Stop the server and run npm run seed to load a demo household, then npm start again. Run npm run seed:force to replace data you have already entered.'))),
  );
}

/* ---------------------------------------------------------------- */

function alertsSection(report) {
  if (!report.alerts.length) return null;
  const order = { danger: 0, warning: 1, info: 2 };
  const sorted = [...report.alerts].sort((a, b) => order[a.level] - order[b.level]);
  return h('div', { class: 'stack', style: { gap: '8px' } },
    ...sorted.map((a) => h('div', { class: `alert ${a.level}` },
      h('span', { class: 'alert-icon' }, icon(a.level === 'info' ? 'info' : 'alert', 17)),
      h('div', {},
        h('div', { class: 'alert-title' }, a.title),
        h('div', { class: 'alert-detail' }, a.detail)))),
  );
}

function headlineTiles(report) {
  const { cash, credit, paymentsDue, flow } = report;
  return h('div', { class: 'grid grid-4' },
    statTile({
      label: 'Available in checking',
      value: money(cash.checking.total),
      delta: deltaBadge(cash.checking.delta),
    }),
    statTile({
      label: 'Moved to savings',
      value: money(flow.savingsContributions),
      foot: flow.savingsRate === null
        ? 'No income recorded this month'
        : `${pct(flow.savingsRate)} of income`,
    }),
    statTile({
      label: 'Credit card balance',
      value: money(credit.totalBalance),
      // A falling card balance is the good direction, so the delta is inverted.
      delta: deltaBadge(credit.delta, { invert: true }),
    }),
    statTile({
      label: 'Due in the next 30 days',
      value: money(paymentsDue.next30.reduce((a, i) => a + i.amount, 0)),
      foot: `${paymentsDue.next30.length} payment${paymentsDue.next30.length === 1 ? '' : 's'} outstanding`,
    }),
  );
}

/* ---- cash --------------------------------------------------------------- */

function cashSection(report) {
  const { cash, people } = report;
  const accounts = [
    ...cash.checking.accounts.map((a) => ({ ...a, group: 'Checking' })),
    ...cash.cash.accounts.map((a) => ({ ...a, group: 'Cash' })),
    ...cash.savings.accounts.map((a) => ({ ...a, group: 'Savings' })),
    ...cash.investment.accounts.map((a) => ({ ...a, group: 'Investment' })),
    ...(cash.property?.accounts ?? []).map((a) => ({ ...a, group: 'Property' })),
  ];

  const table = h('table', { class: 'data' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Account'),
      h('th', {}, 'Type'),
      h('th', {}, 'Owner'),
      h('th', { class: 'num' }, 'Balance'))),
    h('tbody', {}, ...accounts.map((a) => h('tr', {},
      h('td', { class: 'name' },
        a.name,
        a.institution ? h('div', { class: 'muted', style: { fontSize: '11.5px' } },
          a.institution + (a.last4 ? ` ····${a.last4}` : '')) : null),
      h('td', {}, h('span', { class: 'chip' }, a.group)),
      h('td', {}, ownerName(people, a.ownerId)),
      h('td', { class: 'num' },
        money(a.balance),
        a.stale ? h('div', { class: 'muted', style: { fontSize: '11px' } },
          a.staleSince ? `as of ${shortMonth(a.staleSince)}` : 'never updated') : null),
    ))),
  );

  // Liquid cash split by whose account it sits in.
  const ownerSlices = cash.checking.byOwner
    .concat(cash.cash.byOwner)
    .reduce((acc, o) => {
      const found = acc.find((x) => x.ownerId === o.ownerId);
      if (found) found.value += o.amount;
      else acc.push({ ownerId: o.ownerId, label: o.name, value: o.amount, color: o.color });
      return acc;
    }, [])
    .filter((s) => s.value > 0);

  return h('div', { class: 'grid grid-2-1' },
    card('What you have', { note: `Balances as recorded for ${monthLabel(report.month, true)}` },
      accounts.length
        ? h('div', { class: 'table-wrap' }, table)
        : h('div', { class: 'chart-empty' }, 'No accounts yet — add one to get started.')),
    card('Whose account it sits in', { note: 'Checking and cash only', center: true },
      donutChart({
        slices: ownerSlices,
        format: (c, compact) => money(c, compact),
        centerValue: money(cash.liquid, true),
        centerLabel: 'liquid',
      })),
  );
}

/* ---- credit ------------------------------------------------------------- */

function utilisationTone(u) {
  if (u === null) return { tone: 'neutral', label: 'No limit set', icon: '' };
  if (u >= 0.7) return { tone: 'critical', label: 'High', icon: '▲' };
  if (u >= 0.3) return { tone: 'warning', label: 'Elevated', icon: '▲' };
  return { tone: 'good', label: 'Healthy', icon: '✓' };
}

function utilisationColor(u) {
  if (u === null) return 'var(--text-muted)';
  if (u >= 0.7) return 'var(--critical)';
  if (u >= 0.3) return 'var(--warning)';
  return 'var(--good)';
}

function creditSection(report) {
  const { credit, people } = report;
  if (!credit.cards.length) {
    return card('Credit cards', {}, h('div', { class: 'chart-empty' }, 'No credit cards on file.'));
  }

  const meters = credit.cards.map((c) => {
    const status = utilisationTone(c.utilization);
    return h('div', { class: 'meter' },
      h('div', { class: 'meter-head' },
        h('span', { class: 'name' }, c.name),
        h('span', { class: 'tabular secondary' }, money(c.balance)),
        // Icon + label always accompany a status colour.
        pill(c.utilization === null ? 'No limit' : `${pct(c.utilization, 0)} ${status.label}`, status.tone, status.icon)),
      h('div', { class: 'meter-track' },
        h('div', {
          class: 'meter-fill',
          style: {
            width: `${Math.min((c.utilization ?? 0) * 100, 100)}%`,
            background: utilisationColor(c.utilization),
          },
        })),
      h('div', { class: 'meter-foot' },
        h('span', {}, ownerName(people, c.ownerId)),
        h('span', {}, '·'),
        h('span', {}, c.creditLimit ? `${money(c.available)} available of ${money(c.creditLimit)}` : 'No limit recorded'),
        c.apr ? h('span', {}, `· ${c.apr}% APR`) : null),
    );
  });

  return h('div', { class: 'grid grid-2-1' },
    card('Credit cards', { note: 'Utilisation against each card’s limit' },
      h('div', { class: 'stack', style: { gap: '16px' } }, ...meters)),
    h('div', { class: 'grid', style: { gap: '16px', alignContent: 'start' } },
      statTile({
        label: 'Total owed',
        value: money(credit.totalBalance),
        foot: credit.totalLimit ? `of ${money(credit.totalLimit)} in limits` : null,
      }),
      statTile({
        label: 'Overall utilisation',
        value: credit.utilization === null ? '—' : pct(credit.utilization, 1),
        foot: credit.totalAvailable !== null ? `${money(credit.totalAvailable)} available` : null,
      }),
      statTile({
        label: 'Minimum payments',
        value: money(credit.totalMinimum),
        foot: 'If you only paid the minimums',
      }),
    ),
  );
}

/* ---- loans and leases --------------------------------------------------- */

/**
 * Loans sit in net worth but have no card statement and no utilisation, so
 * they get their own card. The monthly payment shows up under payments due as
 * an ordinary bill -- these two never double-count, because only bills and
 * card statements become obligations.
 */
function loansSection(report) {
  const loans = report.credit.loans;
  if (!loans.accounts.length) return null;
  const { people } = report;

  const rows = loans.accounts.map((loan) => h('tr', {},
      h('td', { class: 'name' },
        loan.name,
        loan.institution ? h('div', { class: 'muted', style: { fontSize: '11.5px' } }, loan.institution) : null),
      h('td', {}, ownerName(people, loan.ownerId)),
      h('td', { class: 'num' },
        money(loan.balance),
        loan.stale
          ? h('div', { class: 'muted', style: { fontSize: '11px' } },
              loan.staleSince ? `as of ${shortMonth(loan.staleSince)}` : 'not recorded yet')
          : null)));

  return h('div', { class: 'grid grid-2-1' },
    card('Loans and leases', { note: 'What is still owed — the monthly payments appear under payments due' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Account'),
            h('th', {}, 'Owner'),
            h('th', { class: 'num' }, 'Balance owed'))),
          h('tbody', {}, ...rows)))),
    h('div', { class: 'grid', style: { gap: '16px', alignContent: 'start' } },
      statTile({
        label: 'Total still owed',
        value: money(loans.total),
        delta: deltaBadge(loans.delta, { invert: true }),
      }),
      statTile({
        label: 'Paid down this month',
        value: money(Math.max(-loans.delta, 0)),
        foot: loans.delta > 0
          ? 'Balances rose this month'
          : loans.delta === 0
            ? 'No change recorded'
            : 'Reduction in principal owed',
      })),
  );
}

/* ---- payments due ------------------------------------------------------- */

function dueTone(item) {
  if (item.paid) return { tone: 'good', label: 'Paid', icon: '✓' };
  if (item.status === 'paid-auto') return { tone: 'good', label: 'Autopaid', icon: '✓' };
  if (item.status === 'overdue') return { tone: 'critical', label: 'Overdue', icon: '▲' };
  if (item.status === 'due-soon') return { tone: 'warning', label: `Due in ${item.daysUntilDue}d`, icon: '▲' };
  if (item.daysUntilDue === null) return { tone: 'neutral', label: 'No date', icon: '' };
  return { tone: 'neutral', label: `In ${item.daysUntilDue}d`, icon: '' };
}

function paymentsSection(ctx) {
  const { report } = ctx;
  const { paymentsDue, people } = report;

  if (!paymentsDue.items.length) {
    return card('Payments due', {}, h('div', { class: 'chart-empty' },
      'No bills or card statements are due — add recurring bills to track them here.'));
  }

  const toggle = async (item, checked) => {
    try {
      if (checked) {
        await api.markPaid({
          month: report.month, source: item.source, refId: item.id,
          amount: item.amount, paidOn: report.today,
        });
      } else {
        await api.unmarkPaid(report.month, item.source, item.id);
      }
      toast(checked ? `${item.name} marked paid` : `${item.name} reopened`);
      await ctx.refresh();
    } catch (err) {
      toast(err.message, 'error');
      await ctx.refresh();
    }
  };

  const rows = paymentsDue.items.map((item) => {
    const tone = dueTone(item);
    return h('tr', { style: item.paid ? { opacity: '0.6' } : null },
      h('td', {},
        h('label', { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: item.paid,
            'aria-label': `Mark ${item.name} as paid`,
            onchange: (e) => toggle(item, e.target.checked),
          }))),
      h('td', { class: 'name' },
        item.name,
        h('div', { class: 'muted', style: { fontSize: '11.5px' } },
          `${item.source === 'card' ? 'Card statement' : 'Bill'} · ${item.accountName}`)),
      h('td', {}, ownerName(people, item.ownerId)),
      h('td', {}, item.dueDate ? dateLabel(item.dueDate) : '—'),
      h('td', {}, pill(tone.label, tone.tone, tone.icon)),
      h('td', { class: 'num' },
        money(item.amount),
        item.minimum ? h('div', { class: 'muted', style: { fontSize: '11px' } }, `min ${money(item.minimum)}`) : null),
    );
  });

  const outstanding = paymentsDue.outstandingTotal;
  return card('Payments due', {
    note: `${monthLabel(report.month, true)} — tick items off as you pay them`,
    actions: h('div', { class: 'row-tight' },
      pill(`${money(outstanding)} outstanding`, outstanding > 0 ? 'warning' : 'good', outstanding > 0 ? '▲' : '✓'),
      pill(`${money(paymentsDue.paidTotal)} settled`, 'neutral')),
  },
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', { style: { width: '34px' } }, h('span', { class: 'sr-only' }, 'Paid')),
          h('th', {}, 'Payment'),
          h('th', {}, 'Owner'),
          h('th', {}, 'Due'),
          h('th', {}, 'Status'),
          h('th', { class: 'num' }, 'Amount'))),
        h('tbody', {}, ...rows))),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('span', { class: 'muted', style: { fontSize: '12.5px' } },
        `Cash on hand ${money(report.coverage.liquid)} · after the next 30 days of payments, ${money(report.coverage.freeAfterDue)} would remain.`)),
  );
}

/* ---- savings ------------------------------------------------------------ */

function savingsSection(report) {
  const { flow, cash, people } = report;
  const bySaver = flow.byOwner.filter((o) => o.savings > 0);

  return h('div', { class: 'grid grid-4' },
    statTile({
      label: 'Transferred to savings',
      value: money(flow.savingsContributions),
      foot: 'Deliberate transfers this month',
    }),
    statTile({
      label: 'Savings balance grew',
      value: money(flow.savingsGrowth),
      foot: flow.savingsPassiveGrowth >= 0
        ? `${money(flow.savingsPassiveGrowth)} from interest and growth`
        : `${money(Math.abs(flow.savingsPassiveGrowth))} drawn back out`,
    }),
    statTile({
      label: 'Savings rate',
      value: flow.savingsRate === null ? '—' : pct(flow.savingsRate),
      foot: bySaver.length
        ? bySaver.map((o) => `${o.name} ${money(o.savings)}`).join(' · ')
        : 'No transfers recorded',
    }),
    statTile({
      label: 'Total saved & invested',
      value: money(cash.savings.total + cash.investment.total),
      delta: deltaBadge(cash.savings.delta + cash.investment.delta),
    }),
  );
}

/* ---- charts ------------------------------------------------------------- */

function chartsSection(report) {
  const { trends, flow, people } = report;
  const labels = trends.months.map((m) => shortMonth(m));
  const fmt = (c, compact) => money(c, compact);

  const cashTrend = card('Cash and savings over time', {},
    lineChart({
      labels,
      series: [
        { name: 'Checking', values: trends.checking },
        { name: 'Savings', values: trends.savings },
        { name: 'Investments', values: trends.investment },
      ],
      format: fmt,
      height: 250,
    }));

  const flowChart = card('Money in, money out, money saved', {},
    groupedBarChart({
      labels,
      series: [
        { name: 'Income', values: trends.income },
        { name: 'Expenses', values: trends.expenses },
        { name: 'To savings', values: trends.savingsContributions },
      ],
      format: fmt,
      height: 260,
    }));

  const categories = card('Where the money went', { note: monthLabel(report.month, true), center: true },
    barListChart({
      rows: flow.byCategory.slice(0, 9).map((c) => ({
        label: c.name,
        value: c.amount,
        detail: { label: 'Share of spending', value: pct(c.share) },
      })),
      format: fmt,
      height: 240,
    }));

  const savingsRate = card('Savings rate', { note: 'Share of income moved into savings each month' },
    lineChart({
      labels,
      series: [{ name: 'Savings rate', values: trends.savingsRate.map((r) => (r === null ? null : Math.round(r * 1000))) }],
      format: (v, compact) => `${(v / 10).toFixed(compact ? 0 : 1)}%`,
      height: 220,
      refLine: report.targetRate
        ? { value: Math.round(report.targetRate * 1000), label: `${(report.targetRate * 100).toFixed(0)}% target` }
        : null,
      showArea: true,
    }));

  const netWorth = card('Net worth', { note: 'Everything owned, less everything owed' },
    lineChart({
      labels,
      series: [{ name: 'Net worth', values: trends.netWorth }],
      format: fmt,
      height: 220,
      showArea: true,
    }));

  const spendByPerson = card('Spending by person', { note: monthLabel(report.month, true) },
    barListChart({
      rows: flow.byOwner
        .filter((o) => o.expenses > 0)
        .sort((a, b) => b.expenses - a.expenses)
        .map((o) => ({
          label: o.name,
          value: o.expenses,
          color: o.color,
          detail: { label: 'Transactions', value: String(o.txCount) },
        })),
      format: fmt,
      height: 150,
      labelHeader: 'Person',
    }));

  return h('div', { class: 'stack' },
    h('div', { class: 'grid grid-2' }, cashTrend, flowChart),
    h('div', { class: 'grid grid-2' }, categories, h('div', { class: 'stack' }, savingsRate, spendByPerson)),
    netWorth,
  );
}
