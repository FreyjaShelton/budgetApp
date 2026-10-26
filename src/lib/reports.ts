import { RTA, type BudgetData, type Cents, type DateKey, type MonthKey } from '../types';
import { parts } from './budget';
import { monthOf } from './month';

/** Transactions parts that count as budget spending/income (on-budget, not budget-to-budget transfers). */
function* budgetParts(data: BudgetData, from: DateKey, to: DateKey) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const paymentCats = new Set(data.categories.filter((c) => c.linkedAccountId).map((c) => c.id));
  for (const t of data.transactions) {
    if (t.date < from || t.date > to) continue;
    const acct = accounts.get(t.accountId);
    if (!acct?.onBudget || t.isStartingBalance) continue;
    if (t.transferAccountId && accounts.get(t.transferAccountId)?.onBudget) continue;
    for (const p of parts(t)) {
      if (!p.categoryId || paymentCats.has(p.categoryId)) continue;
      yield { month: monthOf(t.date), categoryId: p.categoryId, amount: p.amount };
    }
  }
}

export interface SpendingRow {
  id: string;
  name: string;
  /** Net spending as a positive number (refunds reduce it). */
  spent: Cents;
}

/** Net spending per category (or per group) between two dates, largest first. */
export function spendingBy(data: BudgetData, from: DateKey, to: DateKey, by: 'category' | 'group'): SpendingRow[] {
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const groups = new Map(data.groups.map((g) => [g.id, g]));
  const totals = new Map<string, Cents>();
  for (const p of budgetParts(data, from, to)) {
    if (p.categoryId === RTA) continue;
    const key = by === 'category' ? p.categoryId : (cats.get(p.categoryId)?.groupId ?? '?');
    totals.set(key, (totals.get(key) ?? 0) - p.amount);
  }
  return [...totals.entries()]
    .map(([id, spent]) => ({
      id,
      spent,
      name: (by === 'category' ? cats.get(id)?.name : groups.get(id)?.name) ?? 'Deleted',
    }))
    .filter((r) => r.spent > 0)
    .sort((a, b) => b.spent - a.spent);
}

export interface IncomeExpenseRow {
  month: MonthKey;
  income: Cents;
  expenses: Cents;
  net: Cents;
}

export function incomeVsExpense(data: BudgetData, months: MonthKey[]): IncomeExpenseRow[] {
  const rows = new Map(months.map((m) => [m, { month: m, income: 0, expenses: 0, net: 0 }]));
  for (const p of budgetParts(data, `${months[0]}-01`, `${months[months.length - 1]}-31`)) {
    const r = rows.get(p.month);
    if (!r) continue;
    if (p.categoryId === RTA) r.income += p.amount;
    else r.expenses -= p.amount;
  }
  for (const r of rows.values()) r.net = r.income - r.expenses;
  return [...rows.values()];
}

export interface NetWorthRow {
  month: MonthKey;
  assets: Cents;
  /** Positive number: total owed. */
  debts: Cents;
  netWorth: Cents;
}

/** End-of-month balances across all accounts (budget and tracking). */
export function netWorth(data: BudgetData, months: MonthKey[]): NetWorthRow[] {
  const sorted = [...data.transactions].sort((a, b) => a.date.localeCompare(b.date));
  const bal = new Map<string, Cents>();
  let i = 0;
  return months.map((m) => {
    while (i < sorted.length && monthOf(sorted[i].date) <= m) {
      const t = sorted[i++];
      bal.set(t.accountId, (bal.get(t.accountId) ?? 0) + t.amount);
    }
    let assets = 0;
    let debts = 0;
    for (const v of bal.values()) {
      if (v >= 0) assets += v;
      else debts -= v;
    }
    return { month: m, assets, debts, netWorth: assets - debts };
  });
}
