import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { categorizeTransactions, deleteAccount, deleteTransactions, reconcileAccount, setCleared, updateAccount } from '../actions';
import { categoryName, CategorySelect, MathInput, Modal, Money, useMediaQuery } from '../components/common';
import { ImportModal } from '../components/ImportModal';
import { TransactionFormModal, TransactionRowEditor } from '../components/TransactionEditor';
import { accountBalances, parts, uncategorized } from '../lib/budget';
import { formatMoney, parseMoney } from '../lib/money';
import { formatDate } from '../lib/month';
import { ACCOUNT_TYPE_LABELS, type Account, type BudgetData, type ClearedState, type Transaction } from '../types';

const REGISTER_CARDS_QUERY = '(max-width: 1279px)';

const NEXT_CLEARED: Record<ClearedState, ClearedState> = { uncleared: 'cleared', cleared: 'uncleared', reconciled: 'reconciled' };

export function AccountPage({ data }: { data: BudgetData }) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const account = data.accounts.find((a) => a.id === id);
  const filter = params.get('filter') ?? 'all';
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [settings, setSettings] = useState(false);
  // The table needs ~1280px of window to be readable; below that (tablets, narrow windows), use the card list.
  const isMobile = useMediaQuery(REGISTER_CARDS_QUERY);

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data]);
  const bal = account
    ? balances.get(account.id)!
    : [...balances.entries()]
        .filter(([aid]) => data.accounts.find((a) => a.id === aid)?.onBudget)
        .reduce((s, [, b]) => ({ cleared: s.cleared + b.cleared, uncleared: s.uncleared + b.uncleared, working: s.working + b.working }), {
          cleared: 0,
          uncleared: 0,
          working: 0,
        });

  const uncatIds = useMemo(() => new Set(uncategorized(data).map((t) => t.id)), [data]);
  const accountsById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);

  const rows = useMemo(() => {
    let txns = account ? data.transactions.filter((t) => t.accountId === account.id) : data.transactions;
    // Running balance per account, oldest first.
    const sortedAsc = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const running = new Map<string, number>();
    let r = 0;
    if (account) for (const t of sortedAsc) running.set(t.id, (r += t.amount));

    if (filter === 'uncategorized') txns = txns.filter((t) => uncatIds.has(t.id));
    if (filter === 'uncleared') txns = txns.filter((t) => t.cleared === 'uncleared');
    const q = search.trim().toLowerCase();
    if (q) {
      txns = txns.filter(
        (t) =>
          t.payee.toLowerCase().includes(q) ||
          (t.memo ?? '').toLowerCase().includes(q) ||
          parts(t).some((p) => categoryName(data, p.categoryId).toLowerCase().includes(q)) ||
          formatMoney(Math.abs(t.amount)).includes(q),
      );
    }
    return {
      list: [...txns].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
      running,
    };
  }, [data, account, filter, search, uncatIds]);

  if (id && !account) return <div className="page">Account not found.</div>;

  const toggle = (tid: string) => {
    const s = new Set(selected);
    if (s.has(tid)) s.delete(tid);
    else s.add(tid);
    setSelected(s);
  };
  const showAccount = !account;
  const cols = showAccount ? 10 : 9;
  const editingTxn = editing && editing !== 'new' ? data.transactions.find((t) => t.id === editing) : undefined;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{account?.name ?? 'All Accounts'}</h1>
          {account && <div className="muted">{ACCOUNT_TYPE_LABELS[account.type]}{account.closed && ' · Closed'}</div>}
        </div>
        <span className="spacer" />
        <div className="acct-summary">
          <div className="figure">
            <span className="k">Cleared</span>
            <span className="v">
              <Money cents={bal.cleared} />
            </span>
          </div>
          <div className="figure">
            <span className="k">Uncleared</span>
            <span className="v">
              <Money cents={bal.uncleared} />
            </span>
          </div>
          <div className="figure">
            <span className="k">Working balance</span>
            <span className="v">
              <Money cents={bal.working} />
            </span>
          </div>
        </div>
      </div>

      <div className="row register-toolbar">
        <button className="btn primary" onClick={() => setEditing('new')} disabled={data.accounts.length === 0}>
          + Add transaction
        </button>
        {account && (
          <>
            <button className="btn" onClick={() => setImporting(true)}>
              Import file
            </button>
            <button className="btn" onClick={() => setReconciling(true)}>
              Reconcile
            </button>
            <button className="btn" onClick={() => setSettings(true)}>
              Account settings
            </button>
          </>
        )}
        <span className="spacer hide-mobile" />
        <select value={filter} onChange={(e) => setParams(e.target.value === 'all' ? {} : { filter: e.target.value })} aria-label="Filter">
          <option value="all">All transactions</option>
          <option value="uncategorized">Needs category</option>
          <option value="uncleared">Uncleared</option>
        </select>
        <input className="register-search" type="search" placeholder="Search payee, memo, category…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {!isMobile && selected.size > 0 && <BulkBar data={data} ids={[...selected]} onDone={() => setSelected(new Set())} />}

      {isMobile ? (
        <>
          <MobileTxnList
            list={rows.list}
            data={data}
            accountsById={accountsById}
            showAccount={showAccount}
            running={rows.running}
            uncatIds={uncatIds}
            onEdit={setEditing}
            emptyText={`No transactions${filter !== 'all' || search ? ' match' : ' yet'}.`}
          />
          {editing && (
            <TransactionFormModal
              key={editing}
              data={data}
              txn={editingTxn}
              accountId={account?.id}
              showAccount={showAccount}
              onDone={() => setEditing(null)}
            />
          )}
        </>
      ) : (
        <table className="grid register">
          {/* Narrow columns are fixed; the text columns (account, payee, category, memo) share the rest. */}
          <colgroup>
            <col style={{ width: 34 }} />
            <col style={{ width: 38 }} />
            <col style={{ width: 132 }} />
            {showAccount && <col />}
            <col />
            <col />
            <col />
            <col style={{ width: 104 }} />
            <col style={{ width: 116 }} />
            <col style={{ width: 60 }} />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={rows.list.length > 0 && selected.size === rows.list.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.list.map((t) => t.id)) : new Set())}
                />
              </th>
              <th title="Cleared">
                C
              </th>
              <th>Date</th>
              {showAccount && <th>Account</th>}
              <th>Payee</th>
              <th>Category</th>
              <th>Memo</th>
              <th className="num">Outflow</th>
              <th className="num">{account ? 'Inflow / Balance' : 'Inflow'}</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {editing === 'new' && <TransactionRowEditor data={data} accountId={account?.id} showAccount={showAccount} onDone={() => setEditing(null)} />}
            {rows.list.map((t) =>
              editing === t.id ? (
                <TransactionRowEditor key={t.id} data={data} txn={t} showAccount={showAccount} onDone={() => setEditing(null)} />
              ) : (
                <TxnRow
                  key={t.id}
                  t={t}
                  data={data}
                  accountsById={accountsById}
                  showAccount={showAccount}
                  balance={rows.running.get(t.id)}
                  needsCategory={uncatIds.has(t.id)}
                  selected={selected.has(t.id)}
                  onToggle={() => toggle(t.id)}
                  onEdit={() => setEditing(t.id)}
                />
              ),
            )}
            {rows.list.length === 0 && editing !== 'new' && (
              <tr>
                <td colSpan={cols} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                  No transactions{filter !== 'all' || search ? ' match' : ' yet'}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {importing && account && <ImportModal data={data} account={account} onClose={() => setImporting(false)} />}
      {reconciling && account && <ReconcileModal account={account} cleared={bal.cleared} onClose={() => setReconciling(false)} />}
      {settings && account && <AccountSettings account={account} onClose={() => setSettings(false)} />}
    </div>
  );
}

function TxnRow({
  t,
  data,
  accountsById,
  showAccount,
  balance,
  needsCategory,
  selected,
  onToggle,
  onEdit,
}: {
  t: Transaction;
  data: BudgetData;
  accountsById: Map<string, Account>;
  showAccount: boolean;
  balance?: number;
  needsCategory: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const cat = t.splits?.length
    ? `Split (${t.splits.length})`
    : t.transferAccountId && !t.categoryId
      ? ''
      : categoryName(data, t.categoryId);
  return (
    <tr className="txn" onDoubleClick={onEdit}>
      <td>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label="Select" />
      </td>
      <td>
        <button
          className={`cleared-btn ${t.cleared}`}
          title={t.cleared === 'reconciled' ? 'Reconciled' : t.cleared === 'cleared' ? 'Cleared (click to unclear)' : 'Uncleared (click to clear)'}
          onClick={() => setCleared(t.id, NEXT_CLEARED[t.cleared])}
        >
          {t.cleared === 'reconciled' ? '🔒' : 'C'}
        </button>
      </td>
      <td onClick={onEdit}>{formatDate(t.date)}</td>
      {showAccount && <td onClick={onEdit}>{accountsById.get(t.accountId)?.name}</td>}
      <td onClick={onEdit} title={t.payee}>
        {t.payee}
      </td>
      <td onClick={onEdit}>
        {needsCategory ? <span className="uncat">Needs category</span> : cat}
        {t.splits?.length ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {t.splits.map((s) => `${categoryName(data, s.categoryId) || 'Uncategorized'} ${formatMoney(Math.abs(s.amount))}`).join(' · ')}
          </div>
        ) : null}
      </td>
      <td onClick={onEdit} className="muted" title={t.memo}>
        {t.memo}
      </td>
      <td className="num" onClick={onEdit}>
        {t.amount < 0 ? formatMoney(-t.amount) : ''}
      </td>
      <td className="num" onClick={onEdit}>
        {t.amount > 0 ? <span className="pos">{formatMoney(t.amount)}</span> : ''}
        {balance !== undefined && (
          <div className="muted" style={{ fontSize: 11 }}>
            {formatMoney(balance)}
          </div>
        )}
      </td>
      <td className="row-actions">
        <button className="icon-btn edit" onClick={onEdit} title="Edit" aria-label={`Edit ${t.payee}`}>
          ✎
        </button>
      </td>
    </tr>
  );
}

/** Phone layout: transactions as compact cards grouped under date headings. */
function MobileTxnList({
  list,
  data,
  accountsById,
  showAccount,
  running,
  uncatIds,
  onEdit,
  emptyText,
}: {
  list: Transaction[];
  data: BudgetData;
  accountsById: Map<string, Account>;
  showAccount: boolean;
  running: Map<string, number>;
  uncatIds: Set<string>;
  onEdit: (id: string) => void;
  emptyText: string;
}) {
  if (!list.length) {
    return (
      <div className="card muted" style={{ textAlign: 'center' }}>
        {emptyText}
      </div>
    );
  }
  const out: ReactNode[] = [];
  let lastDate = '';
  for (const t of list) {
    if (t.date !== lastDate) {
      lastDate = t.date;
      out.push(
        <div key={`d-${t.date}`} className="txn-date">
          {formatDate(t.date)}
        </div>,
      );
    }
    const category = uncatIds.has(t.id)
      ? null
      : t.splits?.length
        ? `Split (${t.splits.length})`
        : t.transferAccountId && !t.categoryId
          ? 'Transfer'
          : categoryName(data, t.categoryId);
    const balance = running.get(t.id);
    const details = [showAccount ? accountsById.get(t.accountId)?.name : '', t.memo].filter(Boolean).join(' · ');
    out.push(
      <div key={t.id} className="txn-card">
        <button
          className={`cleared-btn ${t.cleared}`}
          aria-label={t.cleared === 'reconciled' ? 'Reconciled' : t.cleared === 'cleared' ? 'Cleared, tap to unclear' : 'Uncleared, tap to clear'}
          onClick={() => setCleared(t.id, NEXT_CLEARED[t.cleared])}
        >
          {t.cleared === 'reconciled' ? '🔒' : 'C'}
        </button>
        <button className="txn-main" onClick={() => onEdit(t.id)}>
          <span className="txn-top">
            <span className="txn-payee">{t.payee}</span>
            <span className={`txn-amt${t.amount > 0 ? ' pos' : ''}`}>{formatMoney(t.amount)}</span>
          </span>
          <span className="txn-meta">
            <span className="txn-cat">
              {category === null ? <span className="uncat">Needs category</span> : category}
              {details && ` · ${details}`}
            </span>
            {balance !== undefined && <span className="txn-bal">{formatMoney(balance)}</span>}
          </span>
        </button>
      </div>,
    );
  }
  return <div className="txn-list">{out}</div>;
}

function BulkBar({ data, ids, onDone }: { data: BudgetData; ids: string[]; onDone: () => void }) {
  const [cat, setCat] = useState<string | null>(null);
  return (
    <div className="banner warn" style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}>
      <strong>{ids.length} selected</strong>
      <CategorySelect data={data} value={cat} onChange={setCat} noneLabel="Categorize as…" />
      <button
        className="btn small"
        disabled={!cat}
        onClick={async () => {
          await categorizeTransactions(ids, cat!);
          onDone();
        }}
      >
        Apply
      </button>
      <button
        className="btn small"
        onClick={async () => {
          for (const id of ids) {
            const t = data.transactions.find((x) => x.id === id);
            if (t && t.cleared === 'uncleared') await setCleared(id, 'cleared');
          }
          onDone();
        }}
      >
        Mark cleared
      </button>
      <button
        className="btn small danger"
        onClick={async () => {
          if (confirm(`Delete ${ids.length} transaction(s)?`)) {
            await deleteTransactions(ids);
            onDone();
          }
        }}
      >
        Delete
      </button>
      <button className="btn small ghost" onClick={onDone}>
        Clear selection
      </button>
    </div>
  );
}

function ReconcileModal({ account, cleared, onClose }: { account: Account; cleared: number; onClose: () => void }) {
  const [step, setStep] = useState<'ask' | 'enter'>('ask');
  const [stmt, setStmt] = useState('');
  const parsed = parseMoney(stmt);
  const isDebt = account.type === 'creditCard' || account.type === 'liability';

  const finish = async (statement: number) => {
    await reconcileAccount(account.id, statement, cleared);
    onClose();
  };

  return (
    <Modal title={`Reconcile ${account.name}`} onClose={onClose}>
      {step === 'ask' ? (
        <>
          <p style={{ margin: 0 }}>
            Is your current cleared balance <strong>{formatMoney(cleared)}</strong> what your bank shows?
          </p>
          <div className="row">
            <button className="btn primary" onClick={() => finish(cleared)}>
              Yes, lock it in
            </button>
            <button className="btn" onClick={() => setStep('enter')}>
              No
            </button>
          </div>
        </>
      ) : (
        <>
          <label>
            Balance your bank shows{isDebt ? ' (enter debt as negative, e.g. -450.00)' : ''}
            <MathInput autoFocus value={stmt} onChange={setStmt} />
          </label>
          {parsed !== null && stmt && (
            <p className="muted" style={{ margin: 0 }}>
              Difference: {formatMoney(parsed - cleared)}. Check for missing or uncleared transactions first. Otherwise an adjustment for the difference will be
              added.
            </p>
          )}
          <div className="row">
            <button className="btn primary" disabled={parsed === null || !stmt} onClick={() => finish(parsed!)}>
              {parsed === cleared ? 'Finish' : 'Add adjustment & finish'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function AccountSettings({ account, onClose }: { account: Account; onClose: () => void }) {
  const [name, setName] = useState(account.name);
  const [note, setNote] = useState(account.note ?? '');
  const navigate = useNavigate();
  return (
    <Modal
      title="Account settings"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn danger"
            onClick={async () => {
              if (confirm(`Permanently delete "${account.name}" and all its transactions?`)) {
                await deleteAccount(account.id);
                onClose();
                navigate('/accounts');
              }
            }}
          >
            Delete account
          </button>
          <span className="spacer" />
          <button
            className="btn"
            onClick={async () => {
              await updateAccount(account.id, { closed: !account.closed });
              onClose();
            }}
          >
            {account.closed ? 'Reopen account' : 'Close account'}
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              await updateAccount(account.id, { name: name.trim() || account.name, note });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Note
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Modal>
  );
}
