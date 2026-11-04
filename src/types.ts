/** All money values are integer cents. Positive = inflow, negative = outflow. */
export type Cents = number;
/** 'YYYY-MM' */
export type MonthKey = string;
/** 'YYYY-MM-DD' */
export type DateKey = string;

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'creditCard'
  | 'asset'
  | 'liability';

export const ON_BUDGET_TYPES: AccountType[] = ['checking', 'savings', 'cash', 'creditCard'];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  creditCard: 'Credit Card',
  asset: 'Asset (tracking)',
  liability: 'Loan / Liability (tracking)',
};

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  onBudget: boolean;
  closed: boolean;
  note?: string;
  sortOrder: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
  sortOrder: number;
  hidden: boolean;
  /** The auto-managed "Credit Card Payments" group. */
  isCreditCardGroup?: boolean;
}

export type Target =
  /** Need `amount` each month. 'setAside' = assign amount every month; 'refill' = top up to amount. */
  | { type: 'monthly'; amount: Cents; mode: 'setAside' | 'refill' }
  /** Have a balance of `amount` by `month`. */
  | {
      type: 'byDate';
      amount: Cents;
      month: MonthKey;
      /** Exact (first) due date. Older targets only have `month`. */
      date?: DateKey;
      /** Repeats: after each due date, the next one is this far after it. */
      repeat?: TargetRepeat;
    }
  /** Build and keep a balance of `amount`, with no deadline. */
  | { type: 'balance'; amount: Cents };

export interface TargetRepeat {
  every: number;
  unit: 'month' | 'year';
}

export interface Category {
  id: string;
  groupId: string;
  name: string;
  sortOrder: number;
  hidden: boolean;
  note?: string;
  target?: Target;
  /** Set on credit card payment categories: the card this category pays. */
  linkedAccountId?: string;
}

export type ClearedState = 'uncleared' | 'cleared' | 'reconciled';

export interface Split {
  categoryId: string | null;
  amount: Cents;
  memo?: string;
}

/** Pseudo-category for income: "Inflow: Ready to Assign". */
export const RTA = 'rta';

export interface Transaction {
  id: string;
  accountId: string;
  date: DateKey;
  payee: string;
  /** RTA for income, a category id, or null (transfers between budget accounts / uncategorized). */
  categoryId: string | null;
  amount: Cents;
  memo?: string;
  cleared: ClearedState;
  flag?: string;
  /** For transfers: the other account and the paired transaction. */
  transferAccountId?: string;
  transferPairId?: string;
  splits?: Split[];
  /** Bank id (OFX FITID) or hash, used to skip duplicate imports. */
  importId?: string;
  /** Credit card starting balances don't affect Ready to Assign. */
  isStartingBalance?: boolean;
}

export interface Assignment {
  /** `${month}:${categoryId}` */
  id: string;
  month: MonthKey;
  categoryId: string;
  amount: Cents;
}

export interface BudgetData {
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
  assignments: Assignment[];
}
