import { RTA, type BudgetData, type DateKey } from '../types';

/** Payees the app writes itself; they aren't real payees to suggest. */
const SYSTEM_PAYEES = new Set(['starting balance', 'reconciliation balance adjustment', 'unknown']);

export interface PayeeInfo {
  /** Spelling from the most recent transaction. */
  name: string;
  /** Category of the most recent categorized transaction with this payee (null if none). */
  categoryId: string | null;
  lastDate: DateKey;
  count: number;
}

/**
 * Every payee used before (case-insensitive), most recently used first, with the category it
 * last used. Transfers and split transactions don't set a payee's category.
 */
export function payeeHistory(data: BudgetData): PayeeInfo[] {
  const validCategory = new Set([RTA, ...data.categories.map((c) => c.id)]);
  const byKey = new Map<string, PayeeInfo & { catDate: DateKey }>();
  const sorted = [...data.transactions].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    if (t.transferAccountId) continue;
    const name = t.payee.trim();
    const key = name.toLowerCase();
    if (!name || SYSTEM_PAYEES.has(key)) continue;
    const info = byKey.get(key) ?? { name, categoryId: null, lastDate: t.date, count: 0, catDate: '' };
    info.name = name;
    info.lastDate = t.date;
    info.count++;
    if (t.categoryId && !t.splits?.length && validCategory.has(t.categoryId)) {
      info.categoryId = t.categoryId;
      info.catDate = t.date;
    }
    byKey.set(key, info);
  }
  return [...byKey.values()]
    .map(({ catDate: _catDate, ...p }) => p)
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}

/** Suggestions for what's typed so far: names starting with it first, then names containing it. */
export function filterPayees(payees: PayeeInfo[], query: string): PayeeInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return payees;
  const starts = payees.filter((p) => p.name.toLowerCase().startsWith(q));
  const contains = payees.filter((p) => !p.name.toLowerCase().startsWith(q) && p.name.toLowerCase().includes(q));
  return [...starts, ...contains];
}
