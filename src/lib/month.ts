import type { DateKey, MonthKey } from '../types';

export function monthOf(date: DateKey): MonthKey {
  return date.slice(0, 7);
}

export function currentMonth(now = new Date()): MonthKey {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function today(now = new Date()): DateKey {
  return `${currentMonth(now)}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Number of months from a to b (b - a). */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Add months to a date, keeping the day but clamping to the month's end (Aug 31 + 6 -> Feb 28). */
export function addMonthsToDate(date: DateKey, n: number): DateKey {
  const month = addMonths(monthOf(date), n);
  const lastDay = Number(endOfMonth(month).slice(8));
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), lastDay)).padStart(2, '0')}`;
}

/** Last day of the month, e.g. '2026-02' -> '2026-02-28'. */
export function endOfMonth(month: MonthKey): DateKey {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function formatMonth(month: MonthKey, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: style,
    year: 'numeric',
  });
}

export function formatDate(date: DateKey): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
