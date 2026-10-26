import { useMemo, useState, type KeyboardEvent } from 'react';
import { payeeCategoryMemory, saveTransaction } from '../actions';
import { today } from '../lib/month';
import { centsToInput, formatMoney, parseMoney } from '../lib/money';
import type { BudgetData, Transaction } from '../types';
import { CategorySelect } from './common';

const TRANSFER_RE = /^Transfer\s*:\s*(.+)$/i;

interface SplitDraft {
  categoryId: string | null;
  amount: string;
  memo: string;
}

/**
 * Inline register row for adding or editing a transaction.
 * Typing "Transfer : <account>" as payee makes it a transfer.
 */
export function TransactionEditor({
  data,
  txn,
  accountId,
  showAccount,
  onDone,
}: {
  data: BudgetData;
  txn?: Transaction;
  accountId?: string;
  showAccount: boolean;
  onDone: () => void;
}) {
  const [acct, setAcct] = useState(txn?.accountId ?? accountId ?? data.accounts.find((a) => !a.closed)?.id ?? '');
  const [date, setDate] = useState(txn?.date ?? today());
  const [payee, setPayee] = useState(
    txn?.transferAccountId ? `Transfer : ${data.accounts.find((a) => a.id === txn.transferAccountId)?.name ?? ''}` : (txn?.payee ?? ''),
  );
  const [categoryId, setCategoryId] = useState<string | null>(txn?.categoryId ?? null);
  const [memo, setMemo] = useState(txn?.memo ?? '');
  const [outflow, setOutflow] = useState(txn && txn.amount < 0 ? centsToInput(-txn.amount) : '');
  const [inflow, setInflow] = useState(txn && txn.amount > 0 ? centsToInput(txn.amount) : '');
  const [splits, setSplits] = useState<SplitDraft[] | null>(
    txn?.splits?.map((s) => ({ categoryId: s.categoryId, amount: centsToInput(Math.abs(s.amount)), memo: s.memo ?? '' })) ?? null,
  );
  const [error, setError] = useState('');

  const memory = useMemo(() => payeeCategoryMemory(data), [data]);
  const payees = useMemo(() => [...new Set(data.transactions.filter((t) => !t.transferAccountId).map((t) => t.payee))].sort(), [data.transactions]);
  const account = data.accounts.find((a) => a.id === acct);
  const transferTo = (() => {
    const m = payee.match(TRANSFER_RE);
    return m ? data.accounts.find((a) => a.id !== acct && a.name.toLowerCase() === m[1].trim().toLowerCase()) : undefined;
  })();
  // Categories only apply on budget accounts, and for transfers only when money leaves the budget.
  const needsCategory = !!account?.onBudget && (!transferTo || !transferTo.onBudget);

  const total = (parseMoney(inflow || '0') ?? 0) - Math.abs(parseMoney(outflow || '0') ?? 0);
  const sign = total < 0 ? -1 : 1;
  const splitSum = splits?.reduce((s, x) => s + Math.abs(parseMoney(x.amount || '0') ?? 0), 0) ?? 0;

  const save = async () => {
    const out = outflow.trim() ? parseMoney(outflow) : 0;
    const inn = inflow.trim() ? parseMoney(inflow) : 0;
    if (out === null || inn === null) return setError('Amounts must be numbers.');
    if (!acct) return setError('Pick an account.');
    if (TRANSFER_RE.test(payee) && !transferTo) return setError('No account with that name to transfer to.');
    const amount = inn - Math.abs(out);
    if (splits && needsCategory && !transferTo) {
      if (splitSum !== Math.abs(amount)) return setError(`Splits add up to ${formatMoney(splitSum)}, not ${formatMoney(Math.abs(amount))}.`);
    }
    await saveTransaction(
      {
        accountId: acct,
        date,
        payee: payee.trim() || 'Unknown',
        categoryId: needsCategory ? categoryId : null,
        amount,
        memo,
        transferAccountId: transferTo?.id,
        splits:
          splits && needsCategory && !transferTo
            ? splits.map((s) => ({ categoryId: s.categoryId, amount: sign * Math.abs(parseMoney(s.amount || '0') ?? 0), memo: s.memo || undefined }))
            : undefined,
      },
      txn?.id,
    );
    onDone();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      save();
    }
    if (e.key === 'Escape') onDone();
  };

  return (
    <tr className="editing" onKeyDown={onKey}>
      <td />
      <td />
      <td>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      </td>
      {showAccount && (
        <td>
          <select value={acct} onChange={(e) => setAcct(e.target.value)} aria-label="Account">
            {data.accounts
              .filter((a) => !a.closed || a.id === acct)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </td>
      )}
      <td>
        <input
          list="payee-list"
          value={payee}
          autoFocus
          placeholder="Payee"
          aria-label="Payee"
          onChange={(e) => setPayee(e.target.value)}
          onBlur={() => {
            const remembered = memory.get(payee.trim().toLowerCase());
            if (!categoryId && remembered) setCategoryId(remembered);
          }}
        />
        <datalist id="payee-list">
          {data.accounts
            .filter((a) => a.id !== acct && !a.closed)
            .map((a) => (
              <option key={a.id} value={`Transfer : ${a.name}`} />
            ))}
          {payees.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </td>
      <td>
        {!needsCategory ? (
          <span className="muted">{transferTo ? 'Transfer' : 'No category needed'}</span>
        ) : splits ? (
          <div className="split-list">
            {splits.map((s, i) => (
              <div className="split-row" key={i}>
                <CategorySelect
                  data={data}
                  value={s.categoryId}
                  onChange={(v) => setSplits(splits.map((x, j) => (j === i ? { ...x, categoryId: v } : x)))}
                />
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={s.amount}
                  onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                />
                <input placeholder="Memo" value={s.memo} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)))} />
                <button className="icon-btn" onClick={() => setSplits(splits.length > 1 ? splits.filter((_, j) => j !== i) : null)} aria-label="Remove split">
                  ✕
                </button>
              </div>
            ))}
            <div className="row">
              <button className="btn small" onClick={() => setSplits([...splits, { categoryId: null, amount: centsToInput(Math.max(0, Math.abs(total) - splitSum)), memo: '' }])}>
                + Split
              </button>
              <span className={splitSum === Math.abs(total) ? 'muted' : 'neg'} style={{ fontSize: 12 }}>
                {formatMoney(Math.abs(total) - splitSum)} left to split
              </span>
            </div>
          </div>
        ) : (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <CategorySelect data={data} value={categoryId} onChange={setCategoryId} />
            <button
              className="btn small"
              title="Split across categories"
              onClick={() =>
                setSplits([
                  { categoryId, amount: centsToInput(Math.abs(total)), memo: '' },
                  { categoryId: null, amount: '', memo: '' },
                ])
              }
            >
              Split
            </button>
          </div>
        )}
      </td>
      <td>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo" aria-label="Memo" />
      </td>
      <td>
        <input inputMode="decimal" value={outflow} onChange={(e) => setOutflow(e.target.value)} placeholder="Outflow" aria-label="Outflow" style={{ textAlign: 'right' }} />
      </td>
      <td>
        <input inputMode="decimal" value={inflow} onChange={(e) => setInflow(e.target.value)} placeholder="Inflow" aria-label="Inflow" style={{ textAlign: 'right' }} />
        <div className="row" style={{ marginTop: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          <button className="btn small" onClick={onDone}>
            Cancel
          </button>
          <button className="btn small primary" onClick={save}>
            Save
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </td>
    </tr>
  );
}
