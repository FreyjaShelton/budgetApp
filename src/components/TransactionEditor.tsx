import { useMemo, useState, type KeyboardEvent } from 'react';
import { deleteTransactions, payeeCategoryMemory, saveTransaction } from '../actions';
import { today } from '../lib/month';
import { centsToInput, formatMoney, parseMoney } from '../lib/money';
import type { BudgetData, Transaction } from '../types';
import { CategorySelect, MathInput, Modal } from './common';

const TRANSFER_RE = /^Transfer\s*:\s*(.+)$/i;

interface SplitDraft {
  categoryId: string | null;
  amount: string;
  memo: string;
}

interface EditorProps {
  data: BudgetData;
  txn?: Transaction;
  accountId?: string;
  onDone: () => void;
}

/**
 * Form state and saving for one transaction, shared by the desktop row editor and the
 * mobile form. Typing "Transfer : <account>" as payee makes it a transfer.
 */
function useTxnForm({ data, txn, accountId, onDone }: EditorProps) {
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

  const rememberCategory = () => {
    const remembered = memory.get(payee.trim().toLowerCase());
    if (!categoryId && remembered) setCategoryId(remembered);
  };

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

  return {
    acct, setAcct, date, setDate, payee, setPayee, categoryId, setCategoryId, memo, setMemo,
    outflow, setOutflow, inflow, setInflow, splits, setSplits, error,
    payees, transferTo, needsCategory, total, splitSum, rememberCategory, save,
  };
}

type Form = ReturnType<typeof useTxnForm>;

function AccountSelect({ data, form }: { data: BudgetData; form: Form }) {
  return (
    <select value={form.acct} onChange={(e) => form.setAcct(e.target.value)} aria-label="Account">
      {data.accounts
        .filter((a) => !a.closed || a.id === form.acct)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </select>
  );
}

function PayeeInput({ data, form, autoFocus }: { data: BudgetData; form: Form; autoFocus?: boolean }) {
  return (
    <>
      <input
        list="payee-list"
        value={form.payee}
        autoFocus={autoFocus}
        placeholder="Payee"
        aria-label="Payee"
        onChange={(e) => form.setPayee(e.target.value)}
        onBlur={form.rememberCategory}
      />
      <datalist id="payee-list">
        {data.accounts
          .filter((a) => a.id !== form.acct && !a.closed)
          .map((a) => (
            <option key={a.id} value={`Transfer : ${a.name}`} />
          ))}
        {form.payees.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </>
  );
}

function CategoryField({ data, form }: { data: BudgetData; form: Form }) {
  const { splits, setSplits, total, splitSum } = form;
  if (!form.needsCategory) return <span className="muted">{form.transferTo ? 'Transfer' : 'No category needed'}</span>;
  if (!splits) {
    return (
      <div className="cat-field">
        <CategorySelect data={data} value={form.categoryId} onChange={form.setCategoryId} />
        <button
          className="btn small"
          type="button"
          title="Split across categories"
          onClick={() =>
            setSplits([
              { categoryId: form.categoryId, amount: centsToInput(Math.abs(total)), memo: '' },
              { categoryId: null, amount: '', memo: '' },
            ])
          }
        >
          Split
        </button>
      </div>
    );
  }
  const update = (i: number, patch: Partial<SplitDraft>) => setSplits(splits.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="split-list">
      {splits.map((s, i) => (
        <div className="split-row" key={i}>
          <CategorySelect data={data} value={s.categoryId} onChange={(v) => update(i, { categoryId: v })} />
          <MathInput placeholder="0.00" aria-label="Split amount" value={s.amount} onChange={(v) => update(i, { amount: v })} />
          <input placeholder="Memo" aria-label="Split memo" value={s.memo} onChange={(e) => update(i, { memo: e.target.value })} />
          <button
            className="icon-btn"
            type="button"
            onClick={() => setSplits(splits.length > 1 ? splits.filter((_, j) => j !== i) : null)}
            aria-label="Remove split"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button
          className="btn small"
          type="button"
          onClick={() => setSplits([...splits, { categoryId: null, amount: centsToInput(Math.max(0, Math.abs(total) - splitSum)), memo: '' }])}
        >
          + Split
        </button>
        <span className={splitSum === Math.abs(total) ? 'muted' : 'neg'} style={{ fontSize: 12 }}>
          {formatMoney(Math.abs(total) - splitSum)} left to split
        </span>
      </div>
    </div>
  );
}

/**
 * Desktop: edits in place, in the same fixed-width columns as a normal row, with Save/Cancel
 * in the row's own actions column, so nothing around it moves.
 */
export function TransactionRowEditor({ showAccount, ...props }: EditorProps & { showAccount: boolean }) {
  const form = useTxnForm(props);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      form.save();
    }
    if (e.key === 'Escape') props.onDone();
  };
  const cols = showAccount ? 10 : 9;

  return (
    <>
      <tr className="editing" onKeyDown={onKey}>
        <td />
        <td />
        <td>
          <input type="date" value={form.date} onChange={(e) => form.setDate(e.target.value)} aria-label="Date" />
        </td>
        {showAccount && (
          <td>
            <AccountSelect data={props.data} form={form} />
          </td>
        )}
        <td>
          <PayeeInput data={props.data} form={form} autoFocus />
        </td>
        <td className="wrap">
          <CategoryField data={props.data} form={form} />
        </td>
        <td>
          <input value={form.memo} onChange={(e) => form.setMemo(e.target.value)} placeholder="Memo" aria-label="Memo" />
        </td>
        <td>
          <MathInput className="num-input" value={form.outflow} onChange={form.setOutflow} placeholder="Outflow" aria-label="Outflow" />
        </td>
        <td>
          <MathInput className="num-input" value={form.inflow} onChange={form.setInflow} placeholder="Inflow" aria-label="Inflow" />
        </td>
        <td className="row-actions">
          <button className="icon-btn save" onClick={form.save} title="Save (Enter)" aria-label="Save">
            ✓
          </button>
          <button className="icon-btn" onClick={props.onDone} title="Cancel (Esc)" aria-label="Cancel">
            ✕
          </button>
        </td>
      </tr>
      {form.error && (
        <tr className="editing">
          <td colSpan={cols} className="error" style={{ textAlign: 'right' }}>
            {form.error}
          </td>
        </tr>
      )}
    </>
  );
}

/** Mobile: a full-screen form with one large field per line. */
export function TransactionFormModal({ showAccount, ...props }: EditorProps & { showAccount: boolean }) {
  const form = useTxnForm(props);
  const [direction, setDirection] = useState<'out' | 'in'>(props.txn && props.txn.amount > 0 ? 'in' : 'out');
  const amount = direction === 'out' ? form.outflow : form.inflow;
  const setAmount = (v: string) => {
    if (direction === 'out') {
      form.setOutflow(v);
      form.setInflow('');
    } else {
      form.setInflow(v);
      form.setOutflow('');
    }
  };
  const flip = (d: 'out' | 'in') => {
    setDirection(d);
    if (d === 'out') {
      form.setOutflow(amount);
      form.setInflow('');
    } else {
      form.setInflow(amount);
      form.setOutflow('');
    }
  };

  return (
    <Modal
      title={props.txn ? 'Edit transaction' : 'New transaction'}
      onClose={props.onDone}
      footer={
        <>
          {props.txn && (
            <button
              className="btn danger"
              onClick={async () => {
                if (confirm('Delete this transaction?')) {
                  await deleteTransactions([props.txn!.id]);
                  props.onDone();
                }
              }}
            >
              Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={props.onDone}>
            Cancel
          </button>
          <button className="btn primary" onClick={form.save}>
            Save
          </button>
        </>
      }
    >
      <form
        className="stack txn-form"
        onSubmit={(e) => {
          e.preventDefault();
          form.save();
        }}
      >
        <div className="segmented" role="radiogroup" aria-label="Money in or out">
          <button type="button" role="radio" aria-checked={direction === 'out'} className={direction === 'out' ? 'on' : ''} onClick={() => flip('out')}>
            − Outflow
          </button>
          <button type="button" role="radio" aria-checked={direction === 'in'} className={direction === 'in' ? 'on' : ''} onClick={() => flip('in')}>
            + Inflow
          </button>
        </div>
        <label>
          Amount
          <MathInput className="amount-input" autoFocus={!props.txn} value={amount} onChange={setAmount} placeholder="0.00" />
        </label>
        <label>
          Payee
          <PayeeInput data={props.data} form={form} />
        </label>
        <label>
          Category
          <CategoryField data={props.data} form={form} />
        </label>
        <div className="grid-2">
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => form.setDate(e.target.value)} />
          </label>
          {showAccount && (
            <label>
              Account
              <AccountSelect data={props.data} form={form} />
            </label>
          )}
        </div>
        <label>
          Memo
          <input value={form.memo} onChange={(e) => form.setMemo(e.target.value)} />
        </label>
        {form.error && <div className="error">{form.error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
