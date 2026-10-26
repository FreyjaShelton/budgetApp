import { RTA, type Assignment, type BudgetData, type Category, type CategoryGroup, type Transaction } from '../types';
import { addMonths, currentMonth } from './month';

/** A realistic demo budget covering the last three months. */
export function sampleData(): BudgetData {
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const thisMonth = currentMonth();
  const months = [addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth];
  const todayDay = new Date().getDate();

  const accounts = [
    { id: 'acc-chk', name: 'Checking', type: 'checking' as const, onBudget: true, closed: false, sortOrder: 0 },
    { id: 'acc-sav', name: 'Savings', type: 'savings' as const, onBudget: true, closed: false, sortOrder: 1 },
    { id: 'acc-cc', name: 'Visa', type: 'creditCard' as const, onBudget: true, closed: false, sortOrder: 2 },
    { id: 'acc-car', name: 'Car Loan', type: 'liability' as const, onBudget: false, closed: false, sortOrder: 3 },
  ];

  const groups: CategoryGroup[] = [
    { id: 'credit-card-payments', name: 'Credit Card Payments', sortOrder: -1, hidden: false, isCreditCardGroup: true },
  ];
  const categories: Category[] = [
    { id: 'cat-ccpay', groupId: 'credit-card-payments', name: 'Visa', sortOrder: 0, hidden: false, linkedAccountId: 'acc-cc' },
  ];
  const cat: Record<string, string> = {};
  const layout: [string, [string, Category['target']?][]][] = [
    [
      'Bills',
      [
        ['Rent', { type: 'monthly', amount: 165000, mode: 'setAside' }],
        ['Electric', { type: 'monthly', amount: 9000, mode: 'refill' }],
        ['Internet', { type: 'monthly', amount: 6500, mode: 'setAside' }],
        ['Phone', { type: 'monthly', amount: 4500, mode: 'setAside' }],
        ['Car Payment', { type: 'monthly', amount: 32000, mode: 'setAside' }],
      ],
    ],
    [
      'Needs',
      [
        ['Groceries', { type: 'monthly', amount: 60000, mode: 'refill' }],
        ['Gas', { type: 'monthly', amount: 18000, mode: 'refill' }],
      ],
    ],
    ['Wants', [['Dining Out', { type: 'monthly', amount: 20000, mode: 'refill' }], ['Entertainment'], ['Subscriptions', { type: 'monthly', amount: 3500, mode: 'setAside' }]]],
    [
      'Savings Goals',
      [
        ['Emergency Fund', { type: 'balance', amount: 1000000 }],
        ['Vacation', { type: 'byDate', amount: 240000, month: addMonths(thisMonth, 8) }],
        ['Car Maintenance', { type: 'monthly', amount: 5000, mode: 'setAside' }],
      ],
    ],
  ];
  layout.forEach(([gName, cats], gi) => {
    const gid = id('grp');
    groups.push({ id: gid, name: gName, sortOrder: gi, hidden: false });
    cats.forEach(([name, target], ci) => {
      const cid = id('cat');
      cat[name] = cid;
      categories.push({ id: cid, groupId: gid, name, sortOrder: ci, hidden: false, target });
    });
  });

  const transactions: Transaction[] = [];
  const t = (accountId: string, date: string, payee: string, categoryId: string | null, amount: number, extra: Partial<Transaction> = {}) =>
    transactions.push({ id: id('tx'), accountId, date, payee, categoryId, amount, cleared: 'cleared', ...extra });

  const start = `${months[0]}-01`;
  t('acc-chk', start, 'Starting Balance', RTA, 245000, { isStartingBalance: true, cleared: 'reconciled' });
  t('acc-sav', start, 'Starting Balance', RTA, 400000, { isStartingBalance: true, cleared: 'reconciled' });
  t('acc-cc', start, 'Starting Balance', null, -38000, { isStartingBalance: true, cleared: 'reconciled' });
  t('acc-car', start, 'Starting Balance', null, -1450000, { isStartingBalance: true, cleared: 'reconciled' });

  const transfer = (from: string, to: string, date: string, amount: number, categoryId: string | null = null) => {
    const a = id('tx');
    const b = id('tx');
    const name = (x: string) => accounts.find((ac) => ac.id === x)!.name;
    transactions.push({ id: a, accountId: from, date, payee: `Transfer : ${name(to)}`, categoryId, amount: -amount, cleared: 'cleared', transferAccountId: to, transferPairId: b });
    transactions.push({ id: b, accountId: to, date, payee: `Transfer : ${name(from)}`, categoryId: null, amount, cleared: 'cleared', transferAccountId: from, transferPairId: a });
  };

  const assignments: Assignment[] = [];
  const assign = (month: string, name: string, amount: number) => {
    const cid = name === 'Visa' ? 'cat-ccpay' : cat[name];
    assignments.push({ id: `${month}:${cid}`, month, categoryId: cid, amount });
  };

  months.forEach((m, i) => {
    const isCurrent = m === thisMonth;
    const d = (day: number) => `${m}-${String(day).padStart(2, '0')}`;
    const ok = (day: number) => !isCurrent || day <= todayDay;
    const v = (base: number, k: number) => base + ((i * 7919 + k * 104729) % 2000) - 1000;

    if (ok(1)) t('acc-chk', d(1), 'Acme Corp Payroll', RTA, 285000);
    if (ok(15)) t('acc-chk', d(15), 'Acme Corp Payroll', RTA, 285000);
    if (ok(1)) t('acc-chk', d(1), 'Parkview Apartments', cat['Rent'], -165000);
    if (ok(5)) t('acc-chk', d(5), 'City Power', cat['Electric'], -v(8000, 1));
    if (ok(8)) t('acc-cc', d(8), 'Fiber Internet', cat['Internet'], -6500);
    if (ok(12)) t('acc-cc', d(12), 'Mobile Co', cat['Phone'], -4500);
    if (ok(10)) transfer('acc-chk', 'acc-car', d(10), 32000, cat['Car Payment']);
    if (ok(3)) t('acc-cc', d(3), 'Netflix', cat['Subscriptions'], -1599);
    if (ok(18)) t('acc-cc', d(18), 'Spotify', cat['Subscriptions'], -1199);
    [4, 11, 18, 25].forEach((day, k) => ok(day) && t('acc-cc', d(day), k % 2 ? 'Trader Joe’s' : 'Safeway', cat['Groceries'], -v(13500, k)));
    [6, 20].forEach((day, k) => ok(day) && t('acc-cc', d(day), 'Shell', cat['Gas'], -v(5200, k + 3)));
    [9, 16, 23].forEach((day, k) => ok(day) && t('acc-cc', d(day), ['Taqueria', 'Thai Basil', 'Pizza Place'][k], cat['Dining Out'], -v(4200, k + 5)));
    if (ok(14)) t('acc-cc', d(14), 'Cinema', cat['Entertainment'], -3200);
    if (i === 1 && ok(21)) t('acc-chk', d(21), 'Jiffy Lube', cat['Car Maintenance'], -8900);
    // Pay last month's card bill.
    if (i > 0 && ok(22)) transfer('acc-chk', 'acc-cc', d(22), i === 1 ? 38000 + 72000 : 76000);
    // Monthly transfer to savings stays inside the budget (no category).
    if (ok(16)) transfer('acc-chk', 'acc-sav', d(16), 20000);
    // Some recent ones still uncleared, one uncategorized.
    if (isCurrent) {
      transactions.slice(-3).forEach((x) => (x.cleared = 'uncleared'));
      if (ok(2)) t('acc-cc', d(2), 'Amazon', null, -2899, { cleared: 'uncleared' });
    }

    assign(m, 'Rent', 165000);
    assign(m, 'Electric', 9000);
    assign(m, 'Internet', 6500);
    assign(m, 'Phone', 4500);
    assign(m, 'Car Payment', 32000);
    assign(m, 'Groceries', i === 2 ? 50000 : 60000);
    assign(m, 'Gas', 18000);
    assign(m, 'Dining Out', 15000);
    assign(m, 'Entertainment', 5000);
    assign(m, 'Subscriptions', 3500);
    assign(m, 'Car Maintenance', 5000);
    assign(m, 'Vacation', 25000);
    if (i === 0) {
      assign(m, 'Emergency Fund', 400000);
      assign(m, 'Visa', 38000);
    }
  });

  return { accounts, groups, categories, transactions, assignments };
}
