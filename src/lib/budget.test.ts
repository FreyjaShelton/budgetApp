import { describe, expect, it } from 'vitest';
import { RTA, type Account, type BudgetData, type Transaction } from '../types';
import { computeBudget, targetStatus, uncategorized } from './budget';

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
});
