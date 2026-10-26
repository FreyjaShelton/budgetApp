import { db } from './db';
import type { ImportedTxn } from './lib/importers';
import { today } from './lib/month';
import {
  ON_BUDGET_TYPES,
  RTA,
  type Account,
  type AccountType,
  type BudgetData,
  type Category,
  type Cents,
  type ClearedState,
  type MonthKey,
  type Split,
  type Target,
  type Transaction,
} from './types';

export const uid = () => crypto.randomUUID();

const CC_GROUP_ID = 'credit-card-payments';

// ---------- Accounts ----------

export async function createAccount(name: string, type: AccountType, startingBalance: Cents, date = today()) {
  const id = uid();
  const onBudget = ON_BUDGET_TYPES.includes(type);
  await db.transaction('rw', db.accounts, db.transactions, db.groups, db.categories, async () => {
    const sortOrder = await db.accounts.count();
    await db.accounts.add({ id, name, type, onBudget, closed: false, sortOrder });
    if (startingBalance !== 0) {
      const isCard = type === 'creditCard';
      await db.transactions.add({
        id: uid(),
        accountId: id,
        date,
        payee: 'Starting Balance',
        // Cash starting balances are money to assign; card debt and tracking balances aren't.
        categoryId: onBudget && !isCard ? RTA : null,
        amount: startingBalance,
        cleared: 'reconciled',
        isStartingBalance: true,
      });
    }
    if (type === 'creditCard') await ensurePaymentCategory(id, name);
  });
  return id;
}

async function ensurePaymentCategory(accountId: string, name: string) {
  if (!(await db.groups.get(CC_GROUP_ID))) {
    await db.groups.add({ id: CC_GROUP_ID, name: 'Credit Card Payments', sortOrder: -1, hidden: false, isCreditCardGroup: true });
  }
  const existing = await db.categories.where('linkedAccountId').equals(accountId).first();
  if (existing) return;
  const sortOrder = await db.categories.where('groupId').equals(CC_GROUP_ID).count();
  await db.categories.add({ id: uid(), groupId: CC_GROUP_ID, name, sortOrder, hidden: false, linkedAccountId: accountId });
}

export async function updateAccount(id: string, changes: Partial<Pick<Account, 'name' | 'note' | 'closed'>>) {
  await db.transaction('rw', db.accounts, db.categories, async () => {
    await db.accounts.update(id, changes);
    const payCat = await db.categories.where('linkedAccountId').equals(id).first();
    if (payCat) {
      await db.categories.update(payCat.id, {
        ...(changes.name ? { name: changes.name } : {}),
        ...(changes.closed !== undefined ? { hidden: changes.closed } : {}),
      });
    }
  });
}

export async function deleteAccount(id: string) {
  await db.transaction('rw', db.accounts, db.transactions, db.categories, db.assignments, async () => {
    const txns = await db.transactions.where('accountId').equals(id).toArray();
    // Unlink the other side of transfers so they don't point at a missing account.
    for (const t of txns) {
      if (t.transferPairId) await db.transactions.update(t.transferPairId, { transferAccountId: undefined, transferPairId: undefined });
    }
    await db.transactions.where('accountId').equals(id).delete();
    const payCat = await db.categories.where('linkedAccountId').equals(id).first();
    if (payCat) {
      await db.assignments.where('categoryId').equals(payCat.id).delete();
      await db.categories.delete(payCat.id);
    }
    await db.accounts.delete(id);
  });
}

// ---------- Transactions ----------

export interface TxnInput {
  accountId: string;
  date: string;
  payee: string;
  categoryId: string | null;
  amount: Cents;
  memo?: string;
  cleared?: ClearedState;
  flag?: string;
  splits?: Split[];
  /** When set, this is a transfer to/from that account (payee is ignored). */
  transferAccountId?: string;
}

/**
 * Create or update a transaction. Transfers are stored as two linked transactions,
 * one per account, kept in sync here.
 */
export async function saveTransaction(input: TxnInput, existingId?: string) {
  await db.transaction('rw', db.transactions, db.accounts, async () => {
    const existing = existingId ? await db.transactions.get(existingId) : undefined;
    const id = existing?.id ?? uid();
    const base: Transaction = {
      ...(existing ?? {}),
      id,
      accountId: input.accountId,
      date: input.date,
      payee: input.payee,
      categoryId: input.splits?.length ? null : input.categoryId,
      amount: input.amount,
      memo: input.memo || undefined,
      cleared: input.cleared ?? existing?.cleared ?? 'uncleared',
      flag: input.flag,
      splits: input.splits?.length ? input.splits : undefined,
      transferAccountId: undefined,
      transferPairId: undefined,
    } as Transaction;

    if (input.transferAccountId) {
      const [from, to] = await Promise.all([db.accounts.get(input.accountId), db.accounts.get(input.transferAccountId)]);
      if (!from || !to) throw new Error('Transfer account not found');
      // A category is only meaningful when money leaves the budget (budget -> tracking account).
      const needsCategory = from.onBudget && !to.onBudget;
      const pairId = existing?.transferPairId ?? uid();
      base.transferAccountId = to.id;
      base.transferPairId = pairId;
      base.payee = `Transfer : ${to.name}`;
      base.splits = undefined;
      base.categoryId = needsCategory ? input.categoryId : null;
      const prevPair = existing?.transferPairId ? await db.transactions.get(existing.transferPairId) : undefined;
      await db.transactions.put({
        id: pairId,
        accountId: to.id,
        date: input.date,
        payee: `Transfer : ${from.name}`,
        // Money arriving in the budget from a tracking account (e.g. a loan) is income to assign.
        categoryId: to.onBudget && !from.onBudget ? RTA : null,
        amount: -input.amount,
        memo: input.memo || undefined,
        cleared: prevPair?.cleared ?? 'uncleared',
        transferAccountId: from.id,
        transferPairId: id,
      });
    } else if (existing?.transferPairId) {
      // Was a transfer, no longer is.
      await db.transactions.delete(existing.transferPairId);
    }
    await db.transactions.put(base);
  });
}

export async function deleteTransactions(ids: string[]) {
  await db.transaction('rw', db.transactions, async () => {
    for (const id of ids) {
      const t = await db.transactions.get(id);
      if (t?.transferPairId) await db.transactions.delete(t.transferPairId);
      await db.transactions.delete(id);
    }
  });
}

export async function setCleared(id: string, cleared: ClearedState) {
  await db.transactions.update(id, { cleared });
}

export async function categorizeTransactions(ids: string[], categoryId: string) {
  await db.transactions.where('id').anyOf(ids).modify((t) => {
    t.categoryId = categoryId;
    t.splits = undefined;
  });
}

/**
 * Reconcile: lock in all cleared transactions. If the cleared balance doesn't match the
 * statement, add an adjustment for the difference first.
 */
export async function reconcileAccount(accountId: string, statementBalance: Cents, clearedBalance: Cents) {
  await db.transaction('rw', db.transactions, db.accounts, async () => {
    const diff = statementBalance - clearedBalance;
    if (diff !== 0) {
      const acct = await db.accounts.get(accountId);
      await db.transactions.add({
        id: uid(),
        accountId,
        date: today(),
        payee: 'Reconciliation Balance Adjustment',
        categoryId: acct?.onBudget ? RTA : null,
        amount: diff,
        cleared: 'reconciled',
      });
    }
    await db.transactions
      .where('accountId')
      .equals(accountId)
      .filter((t) => t.cleared === 'cleared')
      .modify({ cleared: 'reconciled' });
  });
}

/** Import parsed bank rows. Payees seen before get their most recent category. */
export async function importTransactions(accountId: string, rows: ImportedTxn[], data: BudgetData) {
  const memory = payeeCategoryMemory(data);
  await db.transactions.bulkAdd(
    rows.map((r) => ({
      id: uid(),
      accountId,
      date: r.date,
      payee: r.payee,
      categoryId: memory.get(r.payee.toLowerCase()) ?? null,
      amount: r.amount,
      memo: r.memo,
      cleared: 'cleared' as const,
      importId: r.importId,
    })),
  );
}

/** Lowercased payee -> category of the most recent transaction with that payee. */
export function payeeCategoryMemory(data: BudgetData): Map<string, string> {
  const sorted = [...data.transactions].sort((a, b) => a.date.localeCompare(b.date));
  const m = new Map<string, string>();
  for (const t of sorted) if (t.categoryId && !t.transferAccountId) m.set(t.payee.toLowerCase(), t.categoryId);
  return m;
}

// ---------- Budget ----------

export async function setAssigned(month: MonthKey, categoryId: string, amount: Cents) {
  const id = `${month}:${categoryId}`;
  if (amount === 0) await db.assignments.delete(id);
  else await db.assignments.put({ id, month, categoryId, amount });
}

export async function assignMany(month: MonthKey, amounts: Map<string, Cents>) {
  await db.transaction('rw', db.assignments, async () => {
    for (const [categoryId, amount] of amounts) await setAssigned(month, categoryId, amount);
  });
}

/** Move available money between categories in a month by adjusting what's assigned. */
export async function moveMoney(month: MonthKey, fromId: string | null, toId: string | null, amount: Cents) {
  await db.transaction('rw', db.assignments, async () => {
    for (const [cat, delta] of [
      [fromId, -amount],
      [toId, amount],
    ] as const) {
      if (!cat) continue; // null = Ready to Assign, which is derived
      const cur = (await db.assignments.get(`${month}:${cat}`))?.amount ?? 0;
      await setAssigned(month, cat, cur + delta);
    }
  });
}

// ---------- Categories ----------

export async function addGroup(name: string) {
  const sortOrder = await db.groups.count();
  await db.groups.add({ id: uid(), name, sortOrder, hidden: false });
}

export async function addCategory(groupId: string, name: string) {
  const sortOrder = await db.categories.where('groupId').equals(groupId).count();
  const id = uid();
  await db.categories.add({ id, groupId, name, sortOrder, hidden: false });
  return id;
}

export async function updateCategory(id: string, changes: Partial<Pick<Category, 'name' | 'note' | 'hidden' | 'groupId'>>) {
  await db.categories.update(id, changes);
}

export async function setTarget(id: string, target: Target | undefined) {
  await db.categories.update(id, { target });
}

export async function renameGroup(id: string, name: string) {
  await db.groups.update(id, { name });
}

/** Delete a category; its transactions become uncategorized and its assignments are dropped. */
export async function deleteCategory(id: string) {
  await db.transaction('rw', db.categories, db.transactions, db.assignments, async () => {
    await db.transactions.filter((t) => t.categoryId === id || !!t.splits?.some((s) => s.categoryId === id)).modify((t) => {
      if (t.categoryId === id) t.categoryId = null;
      t.splits = t.splits?.map((s) => (s.categoryId === id ? { ...s, categoryId: null } : s));
    });
    await db.assignments.where('categoryId').equals(id).delete();
    await db.categories.delete(id);
  });
}

export async function deleteGroup(id: string) {
  const cats = await db.categories.where('groupId').equals(id).toArray();
  for (const c of cats) await deleteCategory(c.id);
  await db.groups.delete(id);
}

export async function moveCategory(id: string, direction: -1 | 1) {
  const cat = await db.categories.get(id);
  if (!cat) return;
  const siblings = (await db.categories.where('groupId').equals(cat.groupId).toArray()).sort((a, b) => a.sortOrder - b.sortOrder);
  const i = siblings.findIndex((c) => c.id === id);
  const j = i + direction;
  if (j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  await db.transaction('rw', db.categories, async () => {
    for (let k = 0; k < siblings.length; k++) await db.categories.update(siblings[k].id, { sortOrder: k });
  });
}

export async function moveGroup(id: string, direction: -1 | 1) {
  const groups = (await db.groups.toArray()).filter((g) => !g.isCreditCardGroup).sort((a, b) => a.sortOrder - b.sortOrder);
  const i = groups.findIndex((g) => g.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= groups.length) return;
  [groups[i], groups[j]] = [groups[j], groups[i]];
  await db.transaction('rw', db.groups, async () => {
    for (let k = 0; k < groups.length; k++) await db.groups.update(groups[k].id, { sortOrder: k });
  });
}

// ---------- Templates, backup ----------

export const CATEGORY_TEMPLATES: Record<string, Record<string, string[]>> = {
  'Starter (YNAB-style)': {
    Bills: ['Rent / Mortgage', 'Electric', 'Water', 'Internet', 'Phone', 'Insurance'],
    Needs: ['Groceries', 'Transportation', 'Medical'],
    Wants: ['Dining Out', 'Entertainment', 'Shopping', 'Subscriptions'],
    'True Expenses': ['Car Maintenance', 'Home Maintenance', 'Gifts', 'Annual Fees', 'Clothing'],
    Savings: ['Emergency Fund', 'Vacation'],
  },
  Minimal: {
    Essentials: ['Housing', 'Utilities', 'Groceries', 'Transportation'],
    Lifestyle: ['Fun Money', 'Dining Out'],
    Savings: ['Emergency Fund'],
  },
  Family: {
    Home: ['Mortgage', 'Utilities', 'Home Maintenance', 'Insurance'],
    Kids: ['Childcare', 'School', 'Activities', 'Kids Clothing'],
    Everyday: ['Groceries', 'Gas', 'Household Supplies', 'Dining Out'],
    Health: ['Medical', 'Pharmacy', 'Dental'],
    Goals: ['Emergency Fund', 'College Savings', 'Vacation', 'Holidays'],
  },
};

export async function applyTemplate(name: string) {
  const tpl = CATEGORY_TEMPLATES[name];
  await db.transaction('rw', db.groups, db.categories, async () => {
    let gOrder = await db.groups.count();
    for (const [groupName, cats] of Object.entries(tpl)) {
      const groupId = uid();
      await db.groups.add({ id: groupId, name: groupName, sortOrder: gOrder++, hidden: false });
      await db.categories.bulkAdd(cats.map((name, i) => ({ id: uid(), groupId, name, sortOrder: i, hidden: false })));
    }
  });
}

export async function exportAll(): Promise<BudgetData & { version: 1; exportedAt: string }> {
  const [accounts, groups, categories, transactions, assignments] = await Promise.all([
    db.accounts.toArray(),
    db.groups.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.assignments.toArray(),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), accounts, groups, categories, transactions, assignments };
}

export async function replaceAll(data: BudgetData) {
  for (const key of ['accounts', 'groups', 'categories', 'transactions', 'assignments'] as const) {
    if (!Array.isArray(data[key])) throw new Error(`Backup file is missing "${key}"`);
  }
  await db.transaction('rw', [db.accounts, db.groups, db.categories, db.transactions, db.assignments], async () => {
    await Promise.all([db.accounts.clear(), db.groups.clear(), db.categories.clear(), db.transactions.clear(), db.assignments.clear()]);
    await db.accounts.bulkAdd(data.accounts);
    await db.groups.bulkAdd(data.groups);
    await db.categories.bulkAdd(data.categories);
    await db.transactions.bulkAdd(data.transactions);
    await db.assignments.bulkAdd(data.assignments);
  });
}

export async function clearAll() {
  await replaceAll({ accounts: [], groups: [], categories: [], transactions: [], assignments: [] });
}
