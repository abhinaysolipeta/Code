// Month keys are 'YYYY-MM'. Day keys are 'YYYY-MM-DD'. Everything is treated as
// a local calendar date -- no timezone maths, because a statement date is a
// calendar fact, not an instant.

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isMonthKey(v) { return typeof v === 'string' && MONTH_RE.test(v); }
export function isDateKey(v) { return typeof v === 'string' && DATE_RE.test(v); }

export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function monthOf(dateKey) {
  return typeof dateKey === 'string' ? dateKey.slice(0, 7) : null;
}

/** Shift a month key by n months (n may be negative). */
export function addMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${pad((total % 12) + 1)}`;
}

/** Inclusive list of month keys ending at `endMonth`, `count` long. */
export function monthRange(endMonth, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(endMonth, -i));
  return out;
}

export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Clamp a day-of-month (e.g. a due day of 31) into a real date in that month. */
export function dayInMonth(monthKey, day) {
  const max = daysInMonth(monthKey);
  const d = Math.min(Math.max(Number(day) || 1, 1), max);
  return `${monthKey}-${pad(d)}`;
}

/** Whole days from `fromKey` to `toKey`; negative when `toKey` is in the past. */
export function daysBetween(fromKey, toKey) {
  const a = parseDate(fromKey);
  const b = parseDate(toKey);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

export function parseDate(dateKey) {
  if (!isDateKey(dateKey)) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatMonth(monthKey, { long = false, locale = 'en-US' } = {}) {
  if (!isMonthKey(monthKey)) return String(monthKey ?? '');
  const [y, m] = monthKey.split('-').map(Number);
  try {
    return new Date(y, m - 1, 1).toLocaleDateString(locale, {
      month: long ? 'long' : 'short',
      year: 'numeric',
    });
  } catch {
    return monthKey;
  }
}

export function formatDate(dateKey, { locale = 'en-US' } = {}) {
  const d = parseDate(dateKey);
  if (!d) return String(dateKey ?? '');
  try {
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateKey;
  }
}

function pad(n) { return String(n).padStart(2, '0'); }
