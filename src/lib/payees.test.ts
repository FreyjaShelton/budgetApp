import { describe, expect, it } from 'vitest';
import { RTA, type BudgetData, type Transaction } from '../types';
import { filterPayees, payeeHistory } from './payees';

let n = 0;
const tx = (p: Partial<Transaction> & Pick<Transaction, 'date' | 'payee'>): Transaction => ({
  id: `t${n++}`,
  accountId: 'chk',
  categoryId: null,
  amount: -100,
  cleared: 'cleared',
  ...p,
});

const data = (transactions: Transaction[]): BudgetData => ({
  accounts: [{ id: 'chk', name: 'Checking', type: 'checking', onBudget: true, closed: false, sortOrder: 0 }],
  groups: [],
  categories: [
    { id: 'groc', groupId: 'g', name: 'Groceries', sortOrder: 0, hidden: false },
    { id: 'dine', groupId: 'g', name: 'Dining', sortOrder: 1, hidden: false },
  ],
  transactions,
  assignments: [],
});

describe('payeeHistory', () => {
  it('lists each payee once, most recent first, with its last category', () => {
    const h = payeeHistory(
      data([
        tx({ date: '2026-01-01', payee: 'Safeway', categoryId: 'groc' }),
        tx({ date: '2026-03-01', payee: 'safeway ', categoryId: 'dine' }),
        tx({ date: '2026-02-01', payee: 'Acme Payroll', categoryId: RTA, amount: 5000 }),
        tx({ date: '2026-02-15', payee: 'Starting Balance', categoryId: RTA }),
        tx({ date: '2026-02-20', payee: 'Transfer : Savings', transferAccountId: 'sav' }),
      ]),
    );
    expect(h.map((p) => [p.name, p.categoryId, p.count])).toEqual([
      ['safeway', 'dine', 2],
      ['Acme Payroll', RTA, 1],
    ]);
  });

  it("keeps the last single category when the newest transaction is split or uncategorized", () => {
    const [p] = payeeHistory(
      data([
        tx({ date: '2026-01-01', payee: 'Target', categoryId: 'groc' }),
        tx({ date: '2026-02-01', payee: 'Target', splits: [{ categoryId: 'groc', amount: -50 }, { categoryId: 'dine', amount: -50 }] }),
        tx({ date: '2026-03-01', payee: 'Target', categoryId: null }),
        tx({ date: '2026-03-02', payee: 'Target', categoryId: 'deleted-category' }),
      ]),
    );
    expect(p).toMatchObject({ name: 'Target', categoryId: 'groc', lastDate: '2026-03-02', count: 4 });
  });
});

describe('filterPayees', () => {
  const list = payeeHistory(
    data([
      tx({ date: '2026-01-03', payee: 'Trader Joe’s' }),
      tx({ date: '2026-01-02', payee: 'Shell' }),
      tx({ date: '2026-01-01', payee: 'Pizza Shell Co' }),
    ]),
  );
  it('puts names starting with the text first, then ones containing it', () => {
    expect(filterPayees(list, 'shel').map((p) => p.name)).toEqual(['Shell', 'Pizza Shell Co']);
    expect(filterPayees(list, '').length).toBe(3);
    expect(filterPayees(list, 'zzz')).toEqual([]);
  });
});
