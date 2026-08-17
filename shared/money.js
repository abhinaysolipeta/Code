// All monetary values are stored and computed as integer cents.
// Never let a float touch a balance.

/** Parse arbitrary user/CSV input into integer cents. Returns null when unparseable. */
export function toCents(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = String(input).trim();
  if (!s) return null;

  // Accounting negatives: (1,234.56)
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  s = s.replace(/[$£€¥\s,_]/g, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;

  const [whole = '0', frac = ''] = s.split('.');
  const cents =
    Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2) || '0');
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Integer cents -> plain decimal string, e.g. -123456 => "-1234.56" */
export function centsToDecimal(cents) {
  const n = Math.trunc(cents || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatMoney(cents, { currency = 'USD', locale = 'en-US', signed = false, compact = false } = {}) {
  const n = Math.trunc(cents || 0) / 100;
  const opts = { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (compact && Math.abs(n) >= 10000) {
    opts.notation = 'compact';
    opts.minimumFractionDigits = 0;
    opts.maximumFractionDigits = 1;
  }
  let out;
  try {
    out = new Intl.NumberFormat(locale, opts).format(n);
  } catch {
    out = `${currency} ${n.toFixed(2)}`;
  }
  if (signed && cents > 0) out = `+${out}`;
  return out;
}

export const sum = (values) => values.reduce((a, b) => a + (b || 0), 0);

/** Percentage as a float, guarding divide-by-zero. */
export function ratio(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}
