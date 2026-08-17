// JSON-file persistence. Small data (a household's ledger is thousands of rows
// at most), so the whole document is held in memory and written atomically.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CATEGORIES } from '../shared/model.js';

export const SCHEMA_VERSION = 1;

const MAX_BACKUPS = 20;

export function emptyDatabase() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      household: 'Our Household',
      currency: 'USD',
      locale: 'en-US',
      savingsTargetRate: 0.2,
      people: [
        { id: 'p1', name: 'Me', color: '#6366f1' },
        { id: 'p2', name: 'Partner', color: '#ec4899' },
      ],
    },
    accounts: [],
    snapshots: [],
    transactions: [],
    bills: [],
    payments: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, budget: null })),
  };
}

export class Store {
  constructor(file) {
    this.file = path.resolve(file);
    this.dir = path.dirname(this.file);
    this.backupDir = path.join(this.dir, 'backups');
    this.db = null;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.db = emptyDatabase();
      this.persist();
      return this.db;
    }
    const raw = fs.readFileSync(this.file, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Never silently discard a ledger we cannot parse.
      const rescued = path.join(this.dir, `corrupt-${Date.now()}.json`);
      fs.writeFileSync(rescued, raw);
      throw new Error(
        `Could not parse ${this.file} (${err.message}). The file was preserved at ${rescued}.`,
      );
    }
    this.db = migrate(parsed);
    return this.db;
  }

  /** Atomic: write to a temp file in the same directory, then rename over. */
  persist() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const payload = JSON.stringify(this.db, null, 2);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  /** Snapshot the current file before a mutating batch, keeping the last N. */
  backup() {
    if (!fs.existsSync(this.file)) return;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(this.file, path.join(this.backupDir, `finance-${stamp}.json`));
    const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort();
    for (const stale of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
      fs.unlinkSync(path.join(this.backupDir, stale));
    }
  }

  /**
   * Apply a mutation and persist. The mutator works on the live object; if it
   * throws, we restore the pre-mutation state so a bad request cannot leave
   * the in-memory ledger half-edited.
   */
  update(mutator) {
    const before = structuredClone(this.db);
    let result;
    try {
      result = mutator(this.db);
    } catch (err) {
      this.db = before;
      throw err;
    }
    this.backup();
    this.persist();
    return result;
  }

  replaceAll(nextDb) {
    const migrated = migrate(nextDb);
    this.backup();
    this.db = migrated;
    this.persist();
    return this.db;
  }
}

export function migrate(db) {
  const base = emptyDatabase();
  const out = {
    ...base,
    ...db,
    version: SCHEMA_VERSION,
    settings: { ...base.settings, ...(db.settings ?? {}) },
  };
  for (const key of ['accounts', 'snapshots', 'transactions', 'bills', 'payments', 'categories']) {
    if (!Array.isArray(out[key])) out[key] = base[key];
  }
  if (!Array.isArray(out.settings.people) || out.settings.people.length === 0) {
    out.settings.people = base.settings.people;
  }
  // Guarantee every row has an id -- everything downstream keys off it.
  for (const key of ['accounts', 'snapshots', 'transactions', 'bills', 'payments', 'categories']) {
    for (const row of out[key]) if (!row.id) row.id = newId();
  }
  return out;
}

export function newId() {
  return randomUUID();
}
