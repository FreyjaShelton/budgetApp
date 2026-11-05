import { useState } from 'react';
import { deleteCategory, moveCategory, moveMoney, setAssigned, setTarget, updateCategory } from '../actions';
import { assignedHistory, targetStatus, type CategoryMonth, type MonthSummary } from '../lib/budget';
import { centsToInput, formatMoney, parseMoney } from '../lib/money';
import { addMonths, currentMonth, endOfMonth, monthOf, today } from '../lib/month';
import type { BudgetData, Category, Cents, MonthKey, Target } from '../types';
import { CategorySelect, Money } from './common';

export function CategoryInspector({
  data,
  cat,
  month,
  cm,
  prev,
  allMonths,
  onClose,
  onShowActivity,
}: {
  data: BudgetData;
  cat: Category;
  month: MonthKey;
  cm: CategoryMonth;
  prev?: CategoryMonth;
  allMonths: Map<MonthKey, MonthSummary>;
  onClose: () => void;
  onShowActivity: () => void;
}) {
  const ts = targetStatus(cat, cm, month, assignedHistory(allMonths, cat.id));
  const isPayment = !!cat.linkedAccountId;

  // Average assigned / spent over the 3 months before this one.
  const lastN = [1, 2, 3].map((i) => allMonths.get(addMonths(month, -i))?.categories.get(cat.id)).filter(Boolean) as CategoryMonth[];
  const avg = (f: (c: CategoryMonth) => number) => (lastN.length ? Math.round(lastN.reduce((s, c) => s + f(c), 0) / lastN.length) : 0);

  const quick: [string, Cents][] = [];
  if (ts && ts.needed > 0) quick.push(['Underfunded', cm.assigned + ts.needed]);
  if (prev) {
    quick.push(['Assigned last month', prev.assigned]);
    quick.push(['Spent last month', Math.max(0, -prev.activity)]);
  }
  if (lastN.length > 1) {
    quick.push(['Average assigned', avg((c) => c.assigned)]);
    quick.push(['Average spent', Math.max(0, -avg((c) => c.activity))]);
  }
  if (cm.available < 0) quick.push(['Cover overspending', cm.assigned - cm.available]);
  quick.push(['Reset to zero', 0]);

  return (
    <>
      <div className="card stack">
        <div className="row">
          <h2 style={{ flex: 1 }}>{cat.name}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div>
          <div className="stat">
            <span className="muted">Carried over</span>
            <Money cents={cm.carryIn} />
          </div>
          <div className="stat">
            <span className="muted">Assigned</span>
            <Money cents={cm.assigned} />
          </div>
          <div className="stat">
            <span className="muted">Activity</span>
            <button className="link-btn" onClick={onShowActivity} title="Show this month's transactions">
              <Money cents={cm.activity} />
            </button>
          </div>
          <div className="stat total">
            <span>Available</span>
            <Money cents={cm.available} colored />
          </div>
        </div>
        {cm.cashOverspent > 0 && (
          <div className="banner neg" style={{ margin: 0 }}>
            Overspent by {formatMoney(cm.cashOverspent)}. If not covered, it's taken from next month's Ready to Assign.
          </div>
        )}
        {cm.creditOverspent > 0 && (
          <div className="banner warn" style={{ margin: 0 }}>
            {formatMoney(cm.creditOverspent)} of card spending isn't covered, so it's now card debt. Assign money here to cover it.
          </div>
        )}
        <div>
          <h3 style={{ marginBottom: 6 }}>Quick assign</h3>
          <div className="row">
            {quick.map(([label, amt]) => (
              <button key={label} className="btn small" onClick={() => setAssigned(month, cat.id, amt)} title={`Set assigned to ${formatMoney(amt)}`}>
                {label}: {formatMoney(amt)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <MoveMoney data={data} cat={cat} month={month} available={cm.available} />

      <TargetEditor cat={cat} statusLabel={ts?.label} />

      <div className="card stack">
        <h3>Details</h3>
        {!isPayment && (
          <label>
            Name
            <input defaultValue={cat.name} onBlur={(e) => e.target.value.trim() && e.target.value !== cat.name && updateCategory(cat.id, { name: e.target.value.trim() })} />
          </label>
        )}
        {!isPayment && (
          <label>
            Group
            <select value={cat.groupId} onChange={(e) => updateCategory(cat.id, { groupId: e.target.value })}>
              {data.groups
                .filter((g) => !g.isCreditCardGroup)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Note
          <textarea rows={2} defaultValue={cat.note ?? ''} onBlur={(e) => e.target.value !== (cat.note ?? '') && updateCategory(cat.id, { note: e.target.value })} />
        </label>
        <div className="row">
          <button className="btn small" onClick={() => moveCategory(cat.id, -1)}>
            ↑ Move up
          </button>
          <button className="btn small" onClick={() => moveCategory(cat.id, 1)}>
            ↓ Move down
          </button>
          {!isPayment && (
            <>
              <button className="btn small" onClick={() => updateCategory(cat.id, { hidden: !cat.hidden })}>
                {cat.hidden ? 'Unhide' : 'Hide'}
              </button>
              <button
                className="btn small danger"
                onClick={() => {
                  if (confirm(`Delete "${cat.name}"? Its transactions become uncategorized and its assigned money returns to Ready to Assign.`)) {
                    deleteCategory(cat.id);
                    onClose();
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function MoveMoney({ data, cat, month, available }: { data: BudgetData; cat: Category; month: MonthKey; available: Cents }) {
  const overspent = available < 0;
  const [amount, setAmount] = useState(available !== 0 ? centsToInput(Math.abs(available)) : '');
  const [other, setOther] = useState<string | null>(null);
  const [error, setError] = useState('');

  const submit = () => {
    const amt = parseMoney(amount);
    if (!amt || amt <= 0) return setError('Enter a positive amount.');
    // Overspent: pull money in from `other` (null = Ready to Assign). Otherwise: push money out.
    if (overspent) moveMoney(month, other, cat.id, amt);
    else moveMoney(month, cat.id, other, amt);
    setError('');
  };

  return (
    <div className="card stack">
      <h3>{overspent ? 'Cover overspending' : 'Move money'}</h3>
      <div className="grid-2">
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          {overspent ? 'From' : 'To'}
          <CategorySelect data={data} value={other} onChange={setOther} includeRta={false} includePayment noneLabel="Ready to Assign" />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div>
        <button className="btn primary small" onClick={submit}>
          {overspent ? 'Cover' : 'Move'}
        </button>
      </div>
    </div>
  );
}

function TargetEditor({ cat, statusLabel }: { cat: Category; statusLabel?: string }) {
  const t = cat.target;
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<Target['type']>(t?.type ?? 'monthly');
  const [amount, setAmount] = useState(t ? centsToInput(t.amount) : '');
  const [mode, setMode] = useState<'setAside' | 'refill'>(t?.type === 'monthly' ? t.mode : 'setAside');
  const [repeats, setRepeats] = useState(t?.type === 'byDate' && !!t.repeat);
  const [every, setEvery] = useState(String(t?.type === 'byDate' && t.repeat ? t.repeat.every : 6));
  const [unit, setUnit] = useState<'month' | 'year'>(t?.type === 'byDate' && t.repeat ? t.repeat.unit : 'month');
  const [byDate, setByDate] = useState(t?.type === 'byDate' ? (t.date ?? endOfMonth(t.month)) : endOfMonth(addMonths(currentMonth(), 6)));
  const [error, setError] = useState('');

  const save = () => {
    const amt = parseMoney(amount);
    if (!amt || amt <= 0) return setError('Enter a target amount.');
    if (type === 'byDate' && !/^\d{4}-\d{2}-\d{2}$/.test(byDate)) return setError('Pick the date you need the money by.');
    const everyN = Number(every);
    if (type === 'byDate' && repeats && !(Number.isInteger(everyN) && everyN >= 1 && everyN <= 120))
      return setError('Repeat every must be a whole number from 1 to 120.');
    const target: Target =
      type === 'monthly' ? { type, amount: amt, mode } : type === 'byDate'
          ? { type, amount: amt, month: monthOf(byDate), date: byDate, repeat: repeats ? { every: everyN, unit } : undefined } : { type, amount: amt };
    setTarget(cat.id, target);
    setEditing(false);
    setError('');
  };

  if (!editing) {
    return (
      <div className="card stack">
        <h3>Target</h3>
        <div className="muted">{statusLabel ?? 'No target. Targets tell you how much to assign each month.'}</div>
        <div className="row">
          <button className="btn small" onClick={() => setEditing(true)}>
            {t ? 'Edit target' : 'Create target'}
          </button>
          {t && (
            <button className="btn small danger" onClick={() => setTarget(cat.id, undefined)}>
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h3>Target</h3>
      <label>
        I need
        <select value={type} onChange={(e) => setType(e.target.value as Target['type'])}>
          <option value="monthly">A set amount every month</option>
          <option value="byDate">A balance by a certain date</option>
          <option value="balance">A savings balance, no deadline</option>
        </select>
      </label>
      <label>
        Amount
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </label>
      {type === 'monthly' && (
        <label>
          Each month
          <select value={mode} onChange={(e) => setMode(e.target.value as 'setAside' | 'refill')}>
            <option value="setAside">Set aside this amount (rolls over)</option>
            <option value="refill">Refill up to this amount</option>
          </select>
        </label>
      )}
      {type === 'byDate' && (
        <label>
          By
          <input type="date" value={byDate} min={today()} onChange={(e) => setByDate(e.target.value)} />
        </label>
      )}
      {type === 'byDate' && (
        <>
          <label className="row" style={{ display: 'flex' }}>
            <input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} />
            Repeat (for bills like insurance or renewals)
          </label>
          {repeats && (
            <div className="repeat-row">
              <span className="muted">Every</span>
              <input type="number" min={1} max={120} step={1} inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} aria-label="Repeat every" />
              <select value={unit} onChange={(e) => setUnit(e.target.value as 'month' | 'year')} aria-label="Repeat unit">
                <option value="month">{every === '1' ? 'month' : 'months'}</option>
                <option value="year">{every === '1' ? 'year' : 'years'}</option>
              </select>
            </div>
          )}
          {repeats && (
            <div className="muted" style={{ fontSize: 13 }}>
              After each due date, the target moves to the next one and asks you to set the money aside again.
            </div>
          )}
        </>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary small" onClick={save}>
          Save target
        </button>
        <button className="btn small" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
