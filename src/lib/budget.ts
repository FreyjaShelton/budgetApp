import { RTA, type Account, type BudgetData, type Category, type Cents, type DateKey, type MonthKey, type Target, type TargetRepeat, type Transaction } from '../types';
import { addMonths, addMonthsToDate, currentMonth, endOfMonth, formatDate, formatMonth, monthDiff, monthOf, monthRange } from './month';

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

/** How one transaction (or split part) affects the budget. */
export type BudgetEntry =
  | { kind: 'income'; txn: Transaction; amount: Cents }
  /** Spending/refund in a category. `cardId` is set when it happened on a credit card. */
  | { kind: 'category'; txn: Transaction; amount: Cents; categoryId: string; cardId?: string; isSplit: boolean }
  /** Money moved from a budget account to a card (positive = payment). */
  | { kind: 'cardPayment'; txn: Transaction; amount: Cents; cardId: string };

/**
 * The single source of truth for which transactions count where. Used by the engine and by
 * anything that lists the transactions behind a number, so the two always agree.
 */
export function* budgetEntries(data: BudgetData): Generator<BudgetEntry> {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  for (const t of data.transactions) {
    const acct = accounts.get(t.accountId);
    if (!acct || !acct.onBudget) continue;
    const isCard = acct.type === 'creditCard';

    if (t.transferAccountId) {
      const other = accounts.get(t.transferAccountId);
      // Payment to a card from another budget account: lowers that card's payment category.
      if (isCard && other?.onBudget && other.type !== 'creditCard') yield { kind: 'cardPayment', txn: t, amount: t.amount, cardId: acct.id };
      // Budget-to-budget transfers have no category; budget-to-tracking transfers do (handled below).
      if (other?.onBudget) continue;
    }
    if (t.isStartingBalance && isCard) continue;

    const isSplit = !!t.splits?.length;
    for (const p of parts(t)) {
      if (p.categoryId === RTA) yield { kind: 'income', txn: t, amount: p.amount };
      else if (p.categoryId)
        yield { kind: 'category', txn: t, amount: p.amount, categoryId: p.categoryId, cardId: isCard ? acct.id : undefined, isSplit };
    }
  }
}

function bucketize(data: BudgetData): Map<MonthKey, MonthBuckets> {
  const out = new Map<MonthKey, MonthBuckets>();
  const get = (m: MonthKey) => {
    let b = out.get(m);
    if (!b) {
      b = { cash: new Map(), credit: new Map(), payments: new Map(), income: 0 };
      out.set(m, b);
    }
    return b;
  };

  for (const e of budgetEntries(data)) {
    const b = get(monthOf(e.txn.date));
    if (e.kind === 'income') b.income += e.amount;
    else if (e.kind === 'cardPayment') b.payments.set(e.cardId, (b.payments.get(e.cardId) ?? 0) + e.amount);
    else if (e.cardId) {
      let byCard = b.credit.get(e.categoryId);
      if (!byCard) b.credit.set(e.categoryId, (byCard = new Map()));
      byCard.set(e.cardId, (byCard.get(e.cardId) ?? 0) + e.amount);
    } else {
      b.cash.set(e.categoryId, (b.cash.get(e.categoryId) ?? 0) + e.amount);
    }
  }
  return out;
}

export interface ActivityLine {
  txn: Transaction;
  /** This category's part of the transaction (a split may be only part of it). */
  amount: Cents;
  isSplit: boolean;
}

/**
 * The transactions behind a category's Activity for a month, newest first.
 * For a credit card payment category, these are the payments to the card (shown as negative,
 * since they use up the set-aside money); the rest of its activity is budgeted card spending
 * moved in from other categories, which isn't a transaction of its own.
 */
export function activityLines(data: BudgetData, category: Category, month: MonthKey): ActivityLine[] {
  const out: ActivityLine[] = [];
  for (const e of budgetEntries(data)) {
    if (monthOf(e.txn.date) !== month) continue;
    if (category.linkedAccountId) {
      if (e.kind === 'cardPayment' && e.cardId === category.linkedAccountId) out.push({ txn: e.txn, amount: -e.amount, isSplit: false });
    } else if (e.kind === 'category' && e.categoryId === category.id) {
      out.push({ txn: e.txn, amount: e.amount, isSplit: e.isSplit });
    }
  }
  return out.sort((a, b) => b.txn.date.localeCompare(a.txn.date) || b.txn.id.localeCompare(a.txn.id));
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

/** Lookup of one category's assigned amount by month, from computeBudget's result. */
export function assignedHistory(months: Map<MonthKey, MonthSummary>, categoryId: string): (m: MonthKey) => Cents {
  return (m) => months.get(m)?.categories.get(categoryId)?.assigned ?? 0;
}

export function getMonth(data: BudgetData, month: MonthKey): MonthSummary {
  const all = computeBudget(data, month);
  return all.get(month)!;
}

// ---------- Targets ----------

/**
 * True when a category has a target, needs nothing more this month, and holds more than the
 * target amount: money set aside beyond the goal.
 */
export function isAboveTarget(cat: Category, cm: CategoryMonth, status: TargetStatus | null): boolean {
  return !!cat.target && !!status && status.needed === 0 && cm.available > cat.target.amount;
}

export interface TargetStatus {
  /** Amount still to assign this month to stay on track. */
  needed: Cents;
  /** 0..1 progress toward the target. */
  progress: number;
  label: string;
}

/**
 * `assignedIn(m)` gives this category's assigned amount in an earlier month m. Repeating targets
 * need it: after the first due date, each cycle asks for a fresh full amount to be set aside,
 * whatever balance is left over (e.g. the bill hasn't been recorded as paid).
 */
export function targetStatus(
  cat: Category,
  cm: CategoryMonth,
  month: MonthKey,
  assignedIn: (m: MonthKey) => Cents = () => 0,
): TargetStatus | null {
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
      const { due, previousDue } = dueDates(t, month);
      const monthsLeft = Math.max(1, monthsBetweenInclusive(month, monthOf(due)));
      const by = t.date || t.repeat ? formatDate(due) : formatMonth(t.month);
      const label = `Have ${fmtShort(t.amount)} by ${by}${t.repeat ? `, ${repeatLabel(t.repeat)}` : ''}`;

      if (previousDue) {
        // Later cycle of a repeating target: count only money assigned since the last due date.
        let setAside = 0;
        for (let m = addMonths(monthOf(previousDue), 1); m < month; m = addMonths(m, 1)) setAside += assignedIn(m);
        const perMonth = Math.ceil(Math.max(0, t.amount - setAside) / monthsLeft);
        return {
          needed: Math.max(0, perMonth - cm.assigned),
          progress: ratio(setAside + cm.assigned, t.amount),
          label,
        };
      }

      // First (or only) cycle: money already in the category counts toward the goal.
      const perMonth = Math.ceil(Math.max(0, t.amount - cm.carryIn) / monthsLeft);
      return {
        needed: Math.max(0, perMonth - cm.assigned),
        progress: ratio(cm.available, t.amount),
        label,
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

/**
 * The due date that applies to `month`: the target's date, or for a repeating target the first
 * occurrence (date, date + interval, ...) that falls in or after `month`.
 */
export function nextDueDate(t: Extract<Target, { type: 'byDate' }>, month: MonthKey): DateKey {
  return dueDates(t, month).due;
}

/** The due date for `month`, and for a repeating target past its first cycle, the one before it. */
function dueDates(t: Extract<Target, { type: 'byDate' }>, month: MonthKey): { due: DateKey; previousDue?: DateKey } {
  const first = t.date ?? endOfMonth(t.month);
  if (!t.repeat) return { due: first };
  const step = repeatMonths(t.repeat);
  const behind = monthDiff(monthOf(first), month);
  const k = behind > 0 ? Math.ceil(behind / step) : 0;
  return { due: addMonthsToDate(first, k * step), previousDue: k > 0 ? addMonthsToDate(first, (k - 1) * step) : undefined };
}

export function repeatMonths(r: TargetRepeat): number {
  return Math.max(1, Math.round(r.every)) * (r.unit === 'year' ? 12 : 1);
}

export function repeatLabel(r: TargetRepeat): string {
  if (r.every === 1) return r.unit === 'year' ? 'every year' : 'every month';
  return `every ${r.every} ${r.unit}s`;
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
