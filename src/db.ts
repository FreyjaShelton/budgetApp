import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Account, Assignment, BudgetData, Category, CategoryGroup, Transaction } from './types';

class BudgetDB extends Dexie {
  accounts!: Table<Account, string>;
  groups!: Table<CategoryGroup, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  assignments!: Table<Assignment, string>;
  /** Device-local settings (sync config, last synced snapshot). Never synced or exported. */
  meta!: Table<{ key: string }, string>;

  constructor() {
    super('budget-app');
    this.version(1).stores({
      accounts: 'id, sortOrder',
      groups: 'id, sortOrder',
      categories: 'id, groupId, linkedAccountId',
      transactions: 'id, accountId, date, transferPairId, importId',
      assignments: 'id, month, categoryId',
    });
    this.version(2).stores({ meta: 'key' });
  }
}

export const db = new BudgetDB();

/** Live snapshot of everything; re-renders on any change. Undefined while loading. */
export function useBudgetData(): BudgetData | undefined {
  return useLiveQuery(async () => {
    const [accounts, groups, categories, transactions, assignments] = await Promise.all([
      db.accounts.orderBy('sortOrder').toArray(),
      db.groups.orderBy('sortOrder').toArray(),
      db.categories.toArray(),
      db.transactions.toArray(),
      db.assignments.toArray(),
    ]);
    categories.sort((a, b) => a.sortOrder - b.sortOrder);
    return { accounts, groups, categories, transactions, assignments };
  });
}
