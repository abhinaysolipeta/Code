// Minimal RFC-4180 CSV handling: quoted fields, escaped quotes, embedded
// newlines, and the BOM that spreadsheet exports like to leave behind.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Parse into objects keyed by a normalised header (lowercase, no punctuation). */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { headers: rows[0] ?? [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const keys = headers.map(normaliseHeader);
  const records = rows.slice(1).map((r) => {
    const obj = {};
    keys.forEach((k, i) => { obj[k] = (r[i] ?? '').trim(); });
    obj.__raw = r;
    return obj;
  });
  return { headers, records };
}

export function normaliseHeader(h) {
  return String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\n');
}

function escapeCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
