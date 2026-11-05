import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createAccount } from '../actions';
import { today } from '../lib/month';
import { parseMoney } from '../lib/money';
import { ACCOUNT_TYPE_LABELS, type AccountType } from '../types';
import { MathInput, Modal } from './common';

export function AddAccountModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const isDebt = type === 'creditCard' || type === 'liability';

  const submit = async () => {
    if (!name.trim()) return setError('Give the account a name.');
    const amt = balance.trim() ? parseMoney(balance) : 0;
    if (amt === null) return setError('Balance must be a number.');
    // Debts are entered as positive amounts owed and stored as negative balances.
    const signed = isDebt ? -Math.abs(amt) : amt;
    const id = await createAccount(name.trim(), type, signed, date);
    onClose();
    navigate(`/accounts/${id}`);
  };

  return (
    <Modal
      title="Add account"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Add account
          </button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label>
          Account name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chase Checking" />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            <optgroup label="Budget accounts">
              {(['checking', 'savings', 'cash', 'creditCard'] as const).map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Tracking accounts (net worth only)">
              {(['asset', 'liability'] as const).map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="grid-2">
          <label>
            {isDebt ? 'Current amount owed' : 'Current balance'}
            <MathInput value={balance} onChange={setBalance} placeholder="0.00" />
          </label>
          <label>
            As of
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {type === 'creditCard'
            ? 'A payment category is created for this card. Card spending in budgeted categories moves money there so the bill is covered.'
            : isDebt || type === 'asset'
              ? "Tracking accounts count toward net worth but aren't part of your budget."
              : 'The starting balance goes to Ready to Assign so you can give it a job.'}
        </p>
        {error && <div className="error">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
