import { RTA, type Account, type BudgetData, type Category, type Cents, type MonthKey, type Transaction } from '../types';
import { addMonths, currentMonth, monthOf, monthRange } from './month';

/**
 * The budget engine. Pure functions over BudgetData, following YNAB's rules:
 *
 * - Income categorized to "Ready to Assign" (RTA) becomes money you can assign.
 * - Each category's Available = carryover + assigned + activity.
 * - Positive Available rolls into next month. Negative Available resets to zero next month:
 *   - Cash overspending (spending from checking/savings/cash) is taken out of next month's RTA.
 *   - Credit overspending (unfunded credit card spending) becomes card debt instead.
 * - Spending on a credit card moves the funded portion from the spending category into that
 *   card's payment category, so the money is set aside to pay the card. Payments from budget
 *   accounts to the card reduce the payment category.
 */

export interface CategoryMonth {
  carryIn: Cents;
  assigned: Cents;
  activity: Cents;
  available: Cents;
  /** Overspending covered by neither assigned money nor credit (reduces next month's RTA). */
  cashOverspent: Cents;
  /** Unfunded credit card spending (becomes debt; doesn't reduce RTA). */
  creditOverspent: Cents;
}

export interface MonthSummary {
  month: MonthKey;
  readyToAssign: Cents;
  /** Income to RTA dated in this month. */
  income: Cents;
  assigned: Cents;
  activity: Cents;
  available: Cents;
  /** Cash overspending from the previous month that came out of this month's RTA. */
  overspentLastMonth: Cents;
  categories: Map<string, CategoryMonth>;
}

const EMPTY: CategoryMonth = {
  carryIn: 0,
  assigned: 0,
  activity: 0,
  available: 0,
  cashOverspent: 0,
  creditOverspent: 0,
};

export function emptyCategoryMonth(): CategoryMonth {
  return { ...EMPTY };
}

/** A transaction's category parts, accounting for splits. */
export function parts(t: Transaction): { categoryId: string | null; amount: Cents }[] {
  if (t.splits && t.splits.length) return t.splits;
  return [{ categoryId: t.categoryId, amount: t.amount }];
}

interface MonthBuckets {
  /** categoryId -> net amount from non-credit budget accounts */
  cash: Map<string, Cents>;
  /** categoryId -> cardAccountId -> net amount */
  credit: Map<string, Map<string, Cents>>;
  /** cardAccountId -> net payments (transfers into the card from budget accounts; positive) */
  payments: Map<string, Cents>;
  income: Cents;
}

function bucketize(data: BudgetData): Map<MonthKey, MonthBuckets> {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const out = new Map<MonthKey, MonthBuckets>();
  const get = (m: MonthKey) => {
    let b = out.get(m);
    if (!b) {
      b = { cash: new Map(), credit: new Map(), payments: new Map(), income: 0 };
      out.set(m, b);
    }
    return b;
  };

  for (const t of data.transactions) {
    const acct = accounts.get(t.accountId);
    if (!acct || !acct.onBudget) continue;
    const b = get(monthOf(t.date));
    const isCard = acct.type === 'creditCard';

    if (t.transferAccountId) {
      const other = accounts.get(t.transferAccountId);
      // Payment to a card from another budget account: lowers that card's payment category.
      if (isCard && other?.onBudget && other.type !== 'creditCard') {
        b.payments.set(acct.id, (b.payments.get(acct.id) ?? 0) + t.amount);
      }
      // Budget-to-budget transfers have no category; budget-to-tracking transfers do (handled below).
      if (other?.onBudget) continue;
    }
    if (t.isStartingBalance && isCard) continue;

    for (const p of parts(t)) {
      if (p.categoryId === RTA) {
        b.income += p.amount;
      } else if (p.categoryId) {
        if (isCard) {
          let byCard = b.credit.get(p.categoryId);
          if (!byCard) b.credit.set(p.categoryId, (byCard = new Map()));
          byCard.set(acct.id, (byCard.get(acct.id) ?? 0) + p.amount);
        } else {
          b.cash.set(p.categoryId, (b.cash.get(p.categoryId) ?? 0) + p.amount);
        }
      }
    }
  }
  return out;
}

/** First month with any data, or the current month. */
export function firstMonth(data: BudgetData): MonthKey {
  let first = currentMonth();
  for (const t of data.transactions) if (monthOf(t.date) < first) first = monthOf(t.date);
  for (const a of data.assignments) if (a.month < first) first = a.month;
  return first;
}

/**
 * Compute month summaries from the first month with data through `through`.
 * Returns a map keyed by month.
 */
export function computeBudget(data: BudgetData, through: MonthKey, now: MonthKey = currentMonth()): Map<MonthKey, MonthSummary> {
  const start = firstMonth(data);
  const end = through < start ? start : through;
  const buckets = bucketize(data);

  const assigned = new Map<MonthKey, Map<string, Cents>>();
  let totalAssignedAllMonths = 0;
  for (const a of data.assignments) {
    let m = assigned.get(a.month);
    if (!m) assigned.set(a.month, (m = new Map()));
    m.set(a.categoryId, (m.get(a.categoryId) ?? 0) + a.amount);
    totalAssignedAllMonths += a.amount;
  }

  const paymentCats = data.categories.filter((c) => c.linkedAccountId);
  const regularCats = data.categories.filter((c) => !c.linkedAccountId);

  const result = new Map<MonthKey, MonthSummary>();
  let prev: Map<string, CategoryMonth> = new Map();
  let cumulativeIncome = 0;
  let cumulativeAssigned = 0;
  let cumulativeCashOverspent = 0;

  for (const month of monthRange(start, end)) {
    const b = buckets.get(month);
    const assignedThis = assigned.get(month) ?? new Map<string, Cents>();
    const cats = new Map<string, CategoryMonth>();
    const fundedToCard = new Map<string, Cents>();

    const carry = (id: string) => Math.max(0, prev.get(id)?.available ?? 0);

    for (const c of regularCats) {
      const carryIn = carry(c.id);
      const asg = assignedThis.get(c.id) ?? 0;
      const cashAct = b?.cash.get(c.id) ?? 0;
      const byCard = b?.credit.get(c.id);

      let funds = carryIn + asg + cashAct;
      let creditAct = 0;
      let unfundedCredit = 0;
      if (byCard) {
        const entries = [...byCard.entries()];
        // Refunds on a card first: money returns to the category, and leaves the payment category.
        for (const [card, amt] of entries) {
          if (amt > 0) {
            funds += amt;
            fundedToCard.set(card, (fundedToCard.get(card) ?? 0) - amt);
          }
        }
        for (const [card, amt] of entries) {
          creditAct += amt;
          if (amt >= 0) continue;
          const spend = -amt;
          const funded = Math.min(spend, Math.max(0, funds));
          funds -= spend;
          unfundedCredit += spend - funded;
          fundedToCard.set(card, (fundedToCard.get(card) ?? 0) + funded);
        }
      }

      const activity = cashAct + creditAct;
      const available = carryIn + asg + activity;
      let creditOverspent = 0;
      let cashOverspent = 0;
      if (available < 0) {
        creditOverspent = Math.min(-available, unfundedCredit);
        cashOverspent = -available - creditOverspent;
      }
      cats.set(c.id, { carryIn, assigned: asg, activity, available, cashOverspent, creditOverspent });
    }

    for (const c of paymentCats) {
      const card = c.linkedAccountId!;
      const carryIn = carry(c.id);
      const asg = assignedThis.get(c.id) ?? 0;
      const activity = (fundedToCard.get(card) ?? 0) - (b?.payments.get(card) ?? 0);
      const available = carryIn + asg + activity;
      const cashOverspent = available < 0 ? -available : 0;
      cats.set(c.id, { carryIn, assigned: asg, activity, available, cashOverspent, creditOverspent: 0 });
    }

    cumulativeIncome += b?.income ?? 0;
    for (const v of assignedThis.values()) cumulativeAssigned += v;
    // From the current month on, money assigned in later months is already spoken for.
    // Past months show RTA as it stood then.
    const assignedCounted = month >= now ? totalAssignedAllMonths : cumulativeAssigned;
    const overspentLastMonth = sumField(prev, 'cashOverspent');
    cumulativeCashOverspent += overspentLastMonth;

    const summary: MonthSummary = {
      month,
      readyToAssign: cumulativeIncome - assignedCounted - cumulativeCashOverspent,
      income: b?.income ?? 0,
      assigned: sumField(cats, 'assigned'),
      activity: sumField(cats, 'activity'),
      available: sumField(cats, 'available'),
      overspentLastMonth,
      categories: cats,
    };
    result.set(month, summary);
    prev = cats;
  }
  return result;
}

function sumField(m: Map<string, CategoryMonth>, f: keyof CategoryMonth): Cents {
  let s = 0;
  for (const v of m.values()) s += v[f];
  return s;
}

export function getMonth(data: BudgetData, month: MonthKey): MonthSummary {
  const all = computeBudget(data, month);
  return all.get(month)!;
}

// ---------- Targets ----------

export interface TargetStatus {
  /** Amount still to assign this month to stay on track. */
  needed: Cents;
  /** 0..1 progress toward the target. */
  progress: number;
  label: string;
}

export function targetStatus(cat: Category, cm: CategoryMonth, month: MonthKey): TargetStatus | null {
  const t = cat.target;
  if (!t) return null;
  const ratio = (num: number, den: number) => (den <= 0 ? 1 : Math.max(0, Math.min(1, num / den)));

  switch (t.type) {
    case 'monthly': {
      if (t.mode === 'refill') {
        const have = cm.carryIn + cm.assigned;
        return {
          needed: Math.max(0, t.amount - have),
          progress: ratio(have, t.amount),
          label: `Refill up to ${fmtShort(t.amount)} each month`,
        };
      }
      return {
        needed: Math.max(0, t.amount - cm.assigned),
        progress: ratio(cm.assigned, t.amount),
        label: `Set aside ${fmtShort(t.amount)} each month`,
      };
    }
    case 'byDate': {
      const monthsLeft = Math.max(1, monthsBetweenInclusive(month, t.month));
      const remaining = Math.max(0, t.amount - cm.carryIn);
      const perMonth = Math.ceil(remaining / monthsLeft);
      return {
        needed: Math.max(0, perMonth - cm.assigned),
        progress: ratio(cm.available, t.amount),
        label: `Have ${fmtShort(t.amount)} by ${t.month}`,
      };
    }
    case 'balance':
      return {
        needed: 0,
        progress: ratio(cm.available, t.amount),
        label: `Save ${fmtShort(t.amount)}`,
      };
  }
}

function monthsBetweenInclusive(from: MonthKey, to: MonthKey): number {
  let n = 0;
  for (let m = from; m <= to; m = addMonths(m, 1)) n++;
  return n;
}

function fmtShort(c: Cents) {
  return `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ---------- Account balances ----------

export interface AccountBalance {
  cleared: Cents;
  uncleared: Cents;
  working: Cents;
}

export function accountBalances(accounts: Account[], txns: Transaction[]): Map<string, AccountBalance> {
  const out = new Map<string, AccountBalance>(accounts.map((a) => [a.id, { cleared: 0, uncleared: 0, working: 0 }]));
  for (const t of txns) {
    const b = out.get(t.accountId);
    if (!b) continue;
    if (t.cleared === 'uncleared') b.uncleared += t.amount;
    else b.cleared += t.amount;
    b.working += t.amount;
  }
  return out;
}

/** Transactions on budget accounts that still need a category. */
export function uncategorized(data: BudgetData): Transaction[] {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  return data.transactions.filter((t) => {
    const acct = accounts.get(t.accountId);
    if (!acct?.onBudget || t.isStartingBalance) return false;
    if (t.transferAccountId && accounts.get(t.transferAccountId)?.onBudget) return false;
    return parts(t).some((p) => !p.categoryId);
  });
}
