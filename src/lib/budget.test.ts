import { describe, expect, it } from 'vitest';
import { RTA, type Account, type BudgetData, type Transaction } from '../types';
import { activityLines, assignedHistory, computeBudget, nextDueDate, targetStatus, uncategorized } from './budget';

const checking: Account = { id: 'chk', name: 'Checking', type: 'checking', onBudget: true, closed: false, sortOrder: 0 };
const card: Account = { id: 'cc', name: 'Visa', type: 'creditCard', onBudget: true, closed: false, sortOrder: 1 };
const car: Account = { id: 'car', name: 'Car loan', type: 'liability', onBudget: false, closed: false, sortOrder: 2 };

let n = 0;
function tx(p: Partial<Transaction> & Pick<Transaction, 'accountId' | 'date' | 'amount'>): Transaction {
  return { id: `t${n++}`, payee: 'x', categoryId: null, cleared: 'cleared', ...p };
}

function data(over: Partial<BudgetData> = {}): BudgetData {
  return {
    accounts: [checking, card, car],
    groups: [{ id: 'g', name: 'Bills', sortOrder: 0, hidden: false }],
    categories: [
      { id: 'groc', groupId: 'g', name: 'Groceries', sortOrder: 0, hidden: false },
      { id: 'rent', groupId: 'g', name: 'Rent', sortOrder: 1, hidden: false },
      { id: 'ccpay', groupId: 'ccg', name: 'Visa', sortOrder: 0, hidden: false, linkedAccountId: 'cc' },
    ],
    transactions: [],
    assignments: [],
    ...over,
  };
}

const asg = (month: string, categoryId: string, amount: number) => ({ id: `${month}:${categoryId}`, month, categoryId, amount });

describe('computeBudget', () => {
  it('income becomes Ready to Assign, assigning reduces it', () => {
    const d = data({
      transactions: [tx({ accountId: 'chk', date: '2026-01-01', amount: 300000, categoryId: RTA })],
      assignments: [asg('2026-01', 'rent', 150000), asg('2026-01', 'groc', 50000)],
    });
    const jan = computeBudget(d, '2026-01').get('2026-01')!;
    expect(jan.readyToAssign).toBe(100000);
    expect(jan.categories.get('rent')!.available).toBe(150000);
  });

  it('positive balances roll over; assignments in future months reduce RTA now', () => {
    const d = data({
      transactions: [
        tx({ accountId: 'chk', date: '2026-01-01', amount: 100000, categoryId: RTA }),
        tx({ accountId: 'chk', date: '2026-02-10', amount: -30000, categoryId: 'groc' }),
      ],
      assignments: [asg('2026-01', 'groc', 50000), asg('2026-02', 'groc', 10000)],
    });
    // Viewed while January is the current month, February's assignment is already spoken for.
    expect(computeBudget(d, '2026-02', '2026-01').get('2026-01')!.readyToAssign).toBe(40000);
    // Looking back at January from later, it shows RTA as it stood then.
    const months = computeBudget(d, '2026-02', '2026-03');
    expect(months.get('2026-01')!.readyToAssign).toBe(50000);
    expect(months.get('2026-02')!.readyToAssign).toBe(40000);
    const feb = months.get('2026-02')!.categories.get('groc')!;
    expect(feb.carryIn).toBe(50000);
    expect(feb.available).toBe(30000);
  });

  it('cash overspending resets to zero and comes out of next month RTA', () => {
    const d = data({
      transactions: [
        tx({ accountId: 'chk', date: '2026-01-01', amount: 100000, categoryId: RTA }),
        tx({ accountId: 'chk', date: '2026-01-05', amount: -12000, categoryId: 'groc' }),
      ],
      assignments: [asg('2026-01', 'groc', 10000)],
    });
    const months = computeBudget(d, '2026-02');
    const jan = months.get('2026-01')!;
    expect(jan.categories.get('groc')!.available).toBe(-2000);
    expect(jan.categories.get('groc')!.cashOverspent).toBe(2000);
    expect(jan.readyToAssign).toBe(90000);
    const feb = months.get('2026-02')!;
    expect(feb.categories.get('groc')!.carryIn).toBe(0);
    expect(feb.overspentLastMonth).toBe(2000);
    expect(feb.readyToAssign).toBe(88000);
  });

  it('funded credit card spending moves money to the payment category', () => {
    const d = data({
      transactions: [
        tx({ accountId: 'chk', date: '2026-01-01', amount: 100000, categoryId: RTA }),
        tx({ accountId: 'cc', date: '2026-01-03', amount: -4000, categoryId: 'groc' }),
      ],
      assignments: [asg('2026-01', 'groc', 10000)],
    });
    const jan = computeBudget(d, '2026-01').get('2026-01')!;
    expect(jan.categories.get('groc')!.available).toBe(6000);
    expect(jan.categories.get('ccpay')!.activity).toBe(4000);
    expect(jan.categories.get('ccpay')!.available).toBe(4000);
  });

  it('unfunded credit spending is credit overspending and does not hit RTA', () => {
    const d = data({
      transactions: [
        tx({ accountId: 'chk', date: '2026-01-01', amount: 100000, categoryId: RTA }),
        tx({ accountId: 'cc', date: '2026-01-03', amount: -15000, categoryId: 'groc' }),
      ],
      assignments: [asg('2026-01', 'groc', 10000)],
    });
    const months = computeBudget(d, '2026-02');
    const jan = months.get('2026-01')!;
    const g = jan.categories.get('groc')!;
    expect(g.available).toBe(-5000);
    expect(g.creditOverspent).toBe(5000);
    expect(g.cashOverspent).toBe(0);
    expect(jan.categories.get('ccpay')!.available).toBe(10000);
    expect(months.get('2026-02')!.readyToAssign).toBe(90000);
  });

  it('a card payment from checking reduces the payment category', () => {
    const d = data({
      transactions: [
        tx({ accountId: 'chk', date: '2026-01-01', amount: 100000, categoryId: RTA }),
        tx({ accountId: 'cc', date: '2026-01-03', amount: -4000, categoryId: 'groc' }),
        tx({ accountId: 'chk', date: '2026-01-20', amount: -4000, transferAccountId: 'cc' }),
        tx({ accountId: 'cc', date: '2026-01-20', amount: 4000, transferAccountId: 'chk' }),
      ],
      assignments: [asg('2026-01', 'groc', 10000)],
    });
    const jan = computeBudget(d, '2026-01').get('2026-01')!;
    expect(jan.categories.get('ccpay')!.activity).toBe(0);
    expect(jan.categories.get('ccpay')!.available).toBe(0);
    expect(jan.readyToAssign).toBe(90000);
    expect(uncategorized(d)).toHaveLength(0);
  });

  it('card refunds return money from the payment category', () => {
    const d = data({
      transactions: [
        tx({ accountId: 'cc', date: '2026-01-03', amount: -4000, categoryId: 'groc' }),
        tx({ accountId: 'cc', date: '2026-01-04', amount: 1000, categoryId: 'groc' }),
      ],
      assignments: [asg('2026-01', 'groc', 10000)],
    });
    const jan = computeBudget(d, '2026-01').get('2026-01')!;
    expect(jan.categories.get('groc')!.available).toBe(7000);
    expect(jan.categories.get('ccpay')!.available).toBe(3000);
  });

  it('splits are counted per category; tracking accounts are ignored', () => {
    const d = data({
      transactions: [
        tx({
          accountId: 'chk',
          date: '2026-01-03',
          amount: -5000,
          splits: [
            { categoryId: 'groc', amount: -3000 },
            { categoryId: 'rent', amount: -2000 },
          ],
        }),
        tx({ accountId: 'car', date: '2026-01-03', amount: -999999, categoryId: null }),
      ],
    });
    const jan = computeBudget(d, '2026-01').get('2026-01')!;
    expect(jan.categories.get('groc')!.activity).toBe(-3000);
    expect(jan.categories.get('rent')!.activity).toBe(-2000);
  });

  it('a credit card starting balance does not affect RTA', () => {
    const d = data({
      transactions: [tx({ accountId: 'cc', date: '2026-01-01', amount: -50000, isStartingBalance: true })],
    });
    expect(computeBudget(d, '2026-01').get('2026-01')!.readyToAssign).toBe(0);
    expect(uncategorized(d)).toHaveLength(0);
  });
});

describe('activityLines', () => {
  it("lists exactly the transactions behind a category's activity", () => {
    const d = data({
      transactions: [
        tx({ accountId: 'chk', date: '2026-01-01', amount: 300000, categoryId: RTA }),
        tx({ accountId: 'chk', date: '2026-01-05', amount: -4000, categoryId: 'groc', payee: 'Market' }),
        tx({ accountId: 'cc', date: '2026-01-06', amount: -2500, categoryId: 'groc', payee: 'On card' }),
        tx({ accountId: 'cc', date: '2026-01-07', amount: 500, categoryId: 'groc', payee: 'Refund' }),
        tx({
          accountId: 'chk',
          date: '2026-01-08',
          amount: -5000,
          payee: 'Big store',
          splits: [
            { categoryId: 'groc', amount: -3000 },
            { categoryId: 'rent', amount: -2000 },
          ],
        }),
        tx({ accountId: 'chk', date: '2026-02-01', amount: -9999, categoryId: 'groc', payee: 'Next month' }),
        // Card payment from checking: counts for the card's payment category only.
        tx({ accountId: 'chk', date: '2026-01-20', amount: -2000, transferAccountId: 'cc' }),
        tx({ accountId: 'cc', date: '2026-01-20', amount: 2000, transferAccountId: 'chk', payee: 'Payment' }),
      ],
      assignments: [asg('2026-01', 'groc', 20000)],
    });
    const jan = computeBudget(d, '2026-01').get('2026-01')!;
    const groc = activityLines(d, d.categories[0], '2026-01');
    expect(groc.map((l) => l.txn.payee)).toEqual(['Big store', 'Refund', 'On card', 'Market']);
    expect(groc.find((l) => l.txn.payee === 'Big store')).toMatchObject({ amount: -3000, isSplit: true });
    expect(groc.reduce((s, l) => s + l.amount, 0)).toBe(jan.categories.get('groc')!.activity);

    // Payment category: payments are listed; the rest is spending moved in from categories.
    const pay = activityLines(d, d.categories[2], '2026-01');
    expect(pay.map((l) => [l.txn.payee, l.amount])).toEqual([['Payment', -2000]]);
    const payActivity = jan.categories.get('ccpay')!.activity;
    expect(payActivity - pay.reduce((s, l) => s + l.amount, 0)).toBe(2000); // $25 spent - $5 refund on the card
  });
});

describe('targetStatus', () => {
  const base = { carryIn: 0, assigned: 0, activity: 0, available: 0, cashOverspent: 0, creditOverspent: 0 };
  const cat = { id: 'c', groupId: 'g', name: 'c', sortOrder: 0, hidden: false };

  it('monthly set-aside needs the full amount each month', () => {
    const s = targetStatus({ ...cat, target: { type: 'monthly', amount: 10000, mode: 'setAside' } }, { ...base, assigned: 4000 }, '2026-01');
    expect(s!.needed).toBe(6000);
  });

  it('refill counts the carried-over balance', () => {
    const s = targetStatus({ ...cat, target: { type: 'monthly', amount: 10000, mode: 'refill' } }, { ...base, carryIn: 7000 }, '2026-01');
    expect(s!.needed).toBe(3000);
  });

  it('by-date spreads the remainder over the months left', () => {
    const s = targetStatus({ ...cat, target: { type: 'byDate', amount: 120000, month: '2026-12' } }, { ...base, carryIn: 0 }, '2026-01');
    expect(s!.needed).toBe(10000);
  });

  it('repeating by-date: car insurance of $600 every 6 months', () => {
    const insurance = { type: 'byDate' as const, amount: 60000, month: '2026-12', date: '2026-12-15', repeat: { every: 6, unit: 'month' as const } };
    const c = { ...cat, target: insurance };
    // Starting in Nov: two months (Nov, Dec) to save the first $600.
    expect(targetStatus(c, base, '2026-11')!.needed).toBe(30000);
    // After paying in Dec, January starts the next cycle: due Jun 15, spread over Jan..Jun.
    expect(nextDueDate(insurance, '2027-01')).toBe('2027-06-15');
    const jan = targetStatus(c, base, '2027-01')!;
    expect(jan.needed).toBe(10000);
    expect(jan.label).toBe('Have $600 by Jun 15, 2027, every 6 months');
    // Halfway through a cycle, having set aside $100 in Jan, Feb and Mar: still $100/month.
    const history = (m: string) => (['2027-01', '2027-02', '2027-03'].includes(m) ? 10000 : 0);
    expect(targetStatus(c, { ...base, carryIn: 30000, available: 30000 }, '2027-04', history)!.needed).toBe(10000);
    // Due month itself still points at that month's date; the next cycle is Dec again.
    expect(nextDueDate(insurance, '2027-06')).toBe('2027-06-15');
    expect(nextDueDate(insurance, '2027-07')).toBe('2027-12-15');
  });

  it('repeating by-date asks for a fresh amount each cycle even if money is left over', () => {
    // $600 due Mar 15, 2027, every 6 months; the March bill was never recorded, so $600 carries into April.
    const t = { type: 'byDate' as const, amount: 60000, month: '2027-03', date: '2027-03-15', repeat: { every: 6, unit: 'month' as const } };
    const c = { ...cat, target: t };
    const april = targetStatus(c, { ...base, carryIn: 60000, available: 60000 }, '2027-04')!;
    expect(april.label).toBe('Have $600 by Sep 15, 2027, every 6 months');
    expect(april.needed).toBe(10000); // $600 over Apr..Sep
    // Once April's $100 is assigned, nothing more is needed that month.
    expect(targetStatus(c, { ...base, carryIn: 60000, assigned: 10000, available: 70000 }, '2027-04')!.needed).toBe(0);
    // The first cycle still counts money already in the category.
    expect(targetStatus(c, { ...base, carryIn: 60000, available: 60000 }, '2027-02')!.needed).toBe(0);
  });

  it('repeating targets read earlier assignments from the computed budget', () => {
    const target = { type: 'byDate' as const, amount: 60000, month: '2027-03', date: '2027-03-15', repeat: { every: 6, unit: 'month' as const } };
    const d = data({
      transactions: [tx({ accountId: 'chk', date: '2026-10-01', amount: 500000, categoryId: RTA })],
      categories: [{ id: 'ins', groupId: 'g', name: 'Car insurance', sortOrder: 0, hidden: false, target }],
      // Saved $600 for March (never recorded as spent), then $100 in April and May for September.
      assignments: [asg('2026-10', 'ins', 60000), asg('2027-04', 'ins', 10000), asg('2027-05', 'ins', 10000)],
    });
    const months = computeBudget(d, '2027-06', '2027-06');
    const cat = d.categories[0];
    const status = (m: string) => targetStatus(cat, months.get(m)!.categories.get('ins')!, m, assignedHistory(months, 'ins'))!;
    expect(status('2027-04').needed).toBe(0); // $100 already assigned in April
    expect(status('2027-06').needed).toBe(10000); // $400 left over Jun..Sep
    expect(months.get('2027-06')!.categories.get('ins')!.available).toBe(80000);
  });

  it('repeating by-date handles years and short months', () => {
    const yearly = { type: 'byDate' as const, amount: 12000, month: '2026-03', date: '2026-03-01', repeat: { every: 1, unit: 'year' as const } };
    expect(nextDueDate(yearly, '2026-04')).toBe('2027-03-01');
    expect(targetStatus({ ...cat, target: yearly }, base, '2026-04')!.label).toMatch(/every year$/);
    const endOfMonth = { type: 'byDate' as const, amount: 100, month: '2026-08', date: '2026-08-31', repeat: { every: 6, unit: 'month' as const } };
    expect(nextDueDate(endOfMonth, '2026-09')).toBe('2027-02-28');
    // A non-repeating target past its date stays put (asks for the rest now).
    const once = { type: 'byDate' as const, amount: 5000, month: '2026-01', date: '2026-01-10' };
    expect(nextDueDate(once, '2026-05')).toBe('2026-01-10');
    expect(targetStatus({ ...cat, target: once }, base, '2026-05')!.needed).toBe(5000);
  });

  it('by-date uses the exact date in its label and the month for the math', () => {
    const withDate = targetStatus({ ...cat, target: { type: 'byDate', amount: 120000, month: '2026-12', date: '2026-12-15' } }, base, '2026-01');
    expect(withDate!.needed).toBe(10000);
    expect(withDate!.label).toMatch(/Dec 15, 2026/);
    // Targets saved before exact dates existed still work.
    const legacy = targetStatus({ ...cat, target: { type: 'byDate', amount: 120000, month: '2026-12' } }, base, '2026-01');
    expect(legacy!.needed).toBe(10000);
    expect(legacy!.label).toMatch(/December 2026/);
  });
});
