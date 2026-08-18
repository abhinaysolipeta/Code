/* Applies setup/household.json to the ledger.
 *
 * Idempotent by (name, owner) for accounts and by name for bills, so adding a
 * line to the JSON and re-running only creates what is missing. It never edits
 * or deletes anything you have already set up by hand.
 *
 *   node scripts/setup-household.js            # apply
 *   node scripts/setup-household.js --dry-run  # show what would happen
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACCOUNT_TYPES, JOINT } from '../shared/model.js';
import { toCents } from '../shared/money.js';
import { Store, newId } from '../server/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DEFINITION = process.env.HOUSEHOLD_FILE || path.join(ROOT, 'setup', 'household.json');
const DATA_FILE = process.env.FINANCE_DATA || path.join(ROOT, 'data', 'finance.json');
const dryRun = process.argv.includes('--dry-run');

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(DEFINITION)) fail(`No definition found at ${DEFINITION}`);

let definition;
try {
  definition = JSON.parse(fs.readFileSync(DEFINITION, 'utf8'));
} catch (err) {
  fail(`${DEFINITION} is not valid JSON: ${err.message}`);
}

const store = new Store(DATA_FILE);
store.load();

const created = { accounts: [], bills: [] };
const skipped = { accounts: [], bills: [] };
const renamed = [];
const warnings = [];

const apply = (db) => {
  /* ---- settings & people ------------------------------------------- */
  // Generic role words are names this tooling put there, never ones a person
  // chose, so they are safe to replace. Anything else is treated as deliberate
  // and left alone, so a re-run cannot undo a rename made in Settings.
  const PLACEHOLDER_NAMES = new Set(['me', 'partner', 'wife', 'husband', 'spouse', 'person 1', 'person 2']);
  const PLACEHOLDER_HOUSEHOLD = new Set(['our household', 'household']);

  const wantedHousehold = definition.settings?.household;
  if (wantedHousehold && wantedHousehold !== db.settings.household) {
    if (PLACEHOLDER_HOUSEHOLD.has(db.settings.household.trim().toLowerCase())) {
      renamed.push(`household: "${db.settings.household}" -> "${wantedHousehold}"`);
      db.settings.household = wantedHousehold;
    } else {
      warnings.push(`Household is already named "${db.settings.household}"; left as is. Change it in Settings if you want "${wantedHousehold}".`);
    }
  }

  for (const person of definition.people ?? []) {
    const existing = db.settings.people.find((p) => p.id === person.id);
    if (!existing) {
      db.settings.people.push({
        id: person.id,
        name: person.name ?? person.id,
        colorSlot: person.colorSlot ?? db.settings.people.length % 8,
      });
      renamed.push(`added ${person.id}: "${person.name}"`);
      continue;
    }
    if (!person.name || existing.name === person.name) continue;

    if (PLACEHOLDER_NAMES.has(existing.name.trim().toLowerCase())) {
      renamed.push(`${person.id}: "${existing.name}" -> "${person.name}"`);
      existing.name = person.name;
      if (Number.isInteger(person.colorSlot)) existing.colorSlot = person.colorSlot;
    } else {
      warnings.push(`${person.id} is already named "${existing.name}"; left as is. Rename in Settings if you want "${person.name}".`);
    }
  }

  const validOwners = new Set([JOINT, ...db.settings.people.map((p) => p.id)]);

  /* ---- accounts ---------------------------------------------------- */
  for (const spec of definition.accounts ?? []) {
    const name = String(spec.name ?? '').trim();
    const owner = spec.owner ?? JOINT;

    if (!name) { warnings.push('An account with no name was skipped.'); continue; }
    if (!ACCOUNT_TYPES[spec.type]) {
      warnings.push(`"${name}": unknown type "${spec.type}" — skipped.`);
      continue;
    }
    if (!validOwners.has(owner)) {
      warnings.push(`"${name}": unknown owner "${owner}" — skipped.`);
      continue;
    }

    // The same card name can legitimately exist for each of you, so identity
    // is the pair, not the name alone.
    const already = db.accounts.find(
      (a) => a.name.toLowerCase() === name.toLowerCase() && a.ownerId === owner,
    );
    if (already) { skipped.accounts.push(`${name} (${owner})`); continue; }

    const isCredit = spec.type === 'credit' || spec.type === 'loan';
    db.accounts.push({
      id: newId(),
      name,
      institution: spec.institution ?? '',
      last4: String(spec.last4 ?? '').replace(/\D/g, '').slice(0, 4),
      type: spec.type,
      ownerId: owner,
      creditLimit: isCredit && spec.creditLimit != null ? toCents(spec.creditLimit) : null,
      apr: isCredit && spec.apr != null ? Number(spec.apr) : null,
      dueDay: isCredit && spec.dueDay != null ? Number(spec.dueDay) : null,
      interestRate: !isCredit && spec.interestRate != null ? Number(spec.interestRate) : null,
      autopay: Boolean(spec.autopay),
      notes: spec.notes ?? '',
      archived: false,
      createdAt: new Date().toISOString(),
    });
    created.accounts.push(`${name} (${owner})`);
  }

  /* ---- bills ------------------------------------------------------- */
  const accountByName = new Map(db.accounts.map((a) => [a.name.toLowerCase(), a.id]));
  for (const spec of definition.bills ?? []) {
    const name = String(spec.name ?? '').trim();
    if (!name) { warnings.push('A bill with no name was skipped.'); continue; }

    if (db.bills.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      skipped.bills.push(name);
      continue;
    }

    const amount = spec.amount == null ? null : toCents(spec.amount);
    // A bill with no amount yet would otherwise show up as an overdue $0
    // obligation, so it stays inactive until there is a real figure on it.
    const ready = amount !== null && amount > 0 && spec.dueDay != null;

    db.bills.push({
      id: newId(),
      name,
      amount: amount ?? 0,
      dueDay: spec.dueDay != null ? Number(spec.dueDay) : 1,
      accountId: spec.paidFrom ? accountByName.get(String(spec.paidFrom).toLowerCase()) ?? null : null,
      category: spec.category ?? null,
      ownerId: validOwners.has(spec.owner) ? spec.owner : JOINT,
      autopay: Boolean(spec.autopay),
      active: ready,
      notes: ready ? (spec.notes ?? '') : 'Set the amount and due day, then tick Active.',
    });
    created.bills.push(ready ? name : `${name} (inactive — needs amount and due day)`);
  }
};

if (dryRun) {
  apply(structuredClone(store.db));
} else {
  store.update(apply);
}

/* ---- report ------------------------------------------------------- */
const list = (items) => items.map((i) => `      ${i}`).join('\n');

console.log(`\n  ${dryRun ? 'Dry run — nothing was written' : 'Applied'}: ${DATA_FILE}\n`);

if (renamed.length) {
  console.log('  Names:');
  console.log(list(renamed));
  console.log('');
}
if (created.accounts.length) {
  console.log(`  Added ${created.accounts.length} account(s):`);
  console.log(list(created.accounts));
}
if (created.bills.length) {
  console.log(`\n  Added ${created.bills.length} bill(s):`);
  console.log(list(created.bills));
}
if (skipped.accounts.length || skipped.bills.length) {
  console.log(`\n  Already present, left untouched: ${skipped.accounts.length} account(s), ${skipped.bills.length} bill(s).`);
}
if (warnings.length) {
  console.log('\n  Warnings:');
  console.log(list(warnings));
}
if (!created.accounts.length && !created.bills.length && !renamed.length) {
  console.log('  Nothing new to add — the ledger already matches the definition.');
}

const needsAmounts = (definition.bills ?? []).filter((b) => b.amount == null).length;
if (!dryRun && created.bills.length && needsAmounts) {
  console.log(`\n  Next: open Bills and give ${needsAmounts} bill(s) an amount and due day, then tick Active.`);
  console.log('  Then open Accounts to add credit limits, which turn on the utilisation meters.\n');
} else {
  console.log('');
}
