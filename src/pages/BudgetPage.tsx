import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addCategory, addGroup, assignMany, deleteGroup, moveGroup, renameGroup, setAssigned } from '../actions';
import { CategoryInspector } from '../components/CategoryInspector';
import { Money, MoneyInput } from '../components/common';
import { categoryBar, type SegmentKind } from '../lib/bars';
import { assignedHistory, computeBudget, emptyCategoryMonth, targetStatus, uncategorized, type CategoryMonth, type MonthSummary } from '../lib/budget';
import { formatMoney } from '../lib/money';
import { addMonths, currentMonth, formatMonth } from '../lib/month';
import type { BudgetData, Category, MonthKey } from '../types';

const MONTH_KEY = 'budget.month';

function loadMonth(): MonthKey {
  try {
    const m = sessionStorage.getItem(MONTH_KEY);
    if (m && /^\d{4}-\d{2}$/.test(m)) return m;
  } catch {
    /* storage unavailable */
  }
  return currentMonth();
}

export function BudgetPage({ data }: { data: BudgetData }) {
  const [month, setMonthState] = useState<MonthKey>(loadMonth);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const setMonth = (m: MonthKey) => {
    setMonthState(m);
    try {
      sessionStorage.setItem(MONTH_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const months = useMemo(() => computeBudget(data, month), [data, month]);
  const summary = months.get(month)!;
  const prevSummary = months.get(addMonths(month, -1));
  const uncat = useMemo(() => uncategorized(data).length, [data]);

  const cm = (id: string): CategoryMonth => summary.categories.get(id) ?? emptyCategoryMonth();

  const underfunded = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data.categories) {
      if (c.hidden) continue;
      const s = targetStatus(c, summary.categories.get(c.id) ?? emptyCategoryMonth(), month, assignedHistory(months, c.id));
      if (s && s.needed > 0) m.set(c.id, s.needed);
    }
    return m;
  }, [data.categories, summary, month, months]);
  const underfundedTotal = [...underfunded.values()].reduce((a, b) => a + b, 0);

  const overspent = data.categories.filter((c) => (summary.categories.get(c.id)?.available ?? 0) < 0);
  const selectedCat = data.categories.find((c) => c.id === selected);

  const assignUnderfunded = () => {
    const next = new Map<string, number>();
    for (const [id, need] of underfunded) next.set(id, cm(id).assigned + need);
    assignMany(month, next);
  };

  const rtaClass = summary.readyToAssign > 0 ? 'positive' : summary.readyToAssign < 0 ? 'negative' : 'zero';

  return (
    <div className="page">
      <div className="budget-top">
        <div className="month-nav">
          <button className="btn ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
            ‹
          </button>
          <h1>{formatMonth(month)}</h1>
          <button className="btn ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
            ›
          </button>
          {month !== currentMonth() && (
            <button className="btn small" onClick={() => setMonth(currentMonth())}>
              Today
            </button>
          )}
        </div>
        <div className={`rta ${rtaClass}`}>
          <span className="amt">{formatMoney(summary.readyToAssign)}</span>
          <span className="lbl">
            {summary.readyToAssign < 0 ? 'Assigned more than you have' : summary.readyToAssign > 0 ? 'Ready to Assign' : 'All money assigned'}
          </span>
        </div>
        <span className="spacer" />
        <div className="row">
          <button className="btn" disabled={underfundedTotal === 0} onClick={assignUnderfunded} title="Assign what every target needs this month">
            Assign underfunded {underfundedTotal > 0 && `(${formatMoney(underfundedTotal)})`}
          </button>
          <button
            className="btn"
            onClick={() => {
              const name = prompt('New category group name');
              if (name?.trim()) addGroup(name.trim());
            }}
          >
            + Group
          </button>
        </div>
      </div>

      {overspent.length > 0 && (
        <div className="banner neg">
          <strong>
            {overspent.length} overspent {overspent.length === 1 ? 'category' : 'categories'}
          </strong>
          <span>Cover it by moving money from another category, or it comes out of next month.</span>
          <button className="btn small" onClick={() => setSelected(overspent[0].id)}>
            Show me
          </button>
        </div>
      )}
      {uncat > 0 && (
        <div className="banner warn">
          <strong>
            {uncat === 1 ? '1 transaction needs' : `${uncat} transactions need`} a category.
          </strong>
          <Link to="/accounts?filter=uncategorized">Categorize</Link>
        </div>
      )}

      <div className="budget-layout">
        <div>
          <table className="grid">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Assigned</th>
                <th className="num hide-mobile">Activity</th>
                <th className="num">Available</th>
              </tr>
            </thead>
            <tbody>
              {data.groups
                .filter((g) => showHidden || !g.hidden)
                .map((g) => {
                  const cats = data.categories.filter((c) => c.groupId === g.id && (showHidden || !c.hidden));
                  if (g.isCreditCardGroup && cats.length === 0) return null;
                  const sum = (f: keyof CategoryMonth) => cats.reduce((s, c) => s + cm(c.id)[f], 0);
                  return (
                    <GroupRows
                      key={g.id}
                      name={g.name}
                      locked={!!g.isCreditCardGroup}
                      totals={{ assigned: sum('assigned'), activity: sum('activity'), available: sum('available') }}
                      onRename={(n) => renameGroup(g.id, n)}
                      onAdd={async (n) => setSelected(await addCategory(g.id, n))}
                      onMove={(d) => moveGroup(g.id, d)}
                      onDelete={() => {
                        if (confirm(`Delete "${g.name}" and its ${cats.length} categories? Their transactions become uncategorized.`)) deleteGroup(g.id);
                      }}
                    >
                      {cats.map((c) => (
                        <CategoryRow
                          key={c.id}
                          cat={c}
                          cm={cm(c.id)}
                          month={month}
                          assignedIn={assignedHistory(months, c.id)}
                          selected={selected === c.id}
                          onSelect={() => setSelected(selected === c.id ? null : c.id)}
                        />
                      ))}
                    </GroupRows>
                  );
                })}
            </tbody>
          </table>
          <label className="row" style={{ marginTop: 10, display: 'flex' }}>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Show hidden categories
          </label>
        </div>

        <aside className="inspector">
          {selectedCat ? (
            <CategoryInspector
              key={selectedCat.id}
              data={data}
              cat={selectedCat}
              month={month}
              cm={cm(selectedCat.id)}
              prev={prevSummary?.categories.get(selectedCat.id)}
              allMonths={months}
              onClose={() => setSelected(null)}
            />
          ) : (
            <MonthOverview summary={summary} />
          )}
        </aside>
      </div>
    </div>
  );
}

function GroupRows({
  name,
  locked,
  totals,
  children,
  onRename,
  onAdd,
  onMove,
  onDelete,
}: {
  name: string;
  locked: boolean;
  totals: { assigned: number; activity: number; available: number };
  children: ReactNode;
  onRename: (n: string) => void;
  onAdd: (n: string) => void;
  onMove: (d: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr className="group">
        <td>
          <div className="row" style={{ gap: 2 }}>
            <span>{name}</span>
            {!locked && (
              <>
                <button
                  className="icon-btn"
                  title="Add category"
                  onClick={() => {
                    const n = prompt(`New category in ${name}`);
                    if (n?.trim()) onAdd(n.trim());
                  }}
                >
                  +
                </button>
                <button
                  className="icon-btn"
                  title="Rename group"
                  onClick={() => {
                    const n = prompt('Rename group', name);
                    if (n?.trim()) onRename(n.trim());
                  }}
                >
                  ✎
                </button>
                <button className="icon-btn hide-mobile" title="Move up" onClick={() => onMove(-1)}>
                  ↑
                </button>
                <button className="icon-btn hide-mobile" title="Move down" onClick={() => onMove(1)}>
                  ↓
                </button>
                <button className="icon-btn hide-mobile" title="Delete group" onClick={onDelete}>
                  🗑
                </button>
              </>
            )}
          </div>
        </td>
        <td className="num">{formatMoney(totals.assigned)}</td>
        <td className="num hide-mobile">{formatMoney(totals.activity)}</td>
        <td className="num">{formatMoney(totals.available)}</td>
      </tr>
      {children}
    </>
  );
}

const PILL_TITLES: Record<string, string> = {
  positive: 'Funded',
  zero: 'Nothing available',
  cash: 'Overspent: comes out of next month unless covered',
  credit: 'Overspent on credit: became card debt',
  under: 'Underfunded: target needs more this month',
};

const SEGMENT_LABELS: Record<SegmentKind, string> = {
  spent: 'spent',
  available: 'available',
  needed: 'still needed for target',
  overCash: 'overspent',
  overCredit: 'overspent on credit',
};

/** Striped = spent, solid = still available, pale = still needed for the target. */
function CategoryBar({ cm, needed }: { cm: CategoryMonth; needed: number }) {
  const segments = categoryBar(cm, needed);
  if (!segments.length) return null;
  const label = segments.map((s) => `${formatMoney(s.amount)} ${SEGMENT_LABELS[s.kind]}`).join(' · ');
  return (
    <div className="cat-bar" title={label} role="img" aria-label={label}>
      {segments.map((s) => (
        <div key={s.kind} className={`seg ${s.kind}`} style={{ flexGrow: s.fraction }} />
      ))}
    </div>
  );
}

function CategoryRow({
  cat,
  cm,
  month,
  assignedIn,
  selected,
  onSelect,
}: {
  cat: Category;
  cm: CategoryMonth;
  month: MonthKey;
  assignedIn: (m: MonthKey) => number;
  selected: boolean;
  onSelect: () => void;
}) {
  const ts = targetStatus(cat, cm, month, assignedIn);
  let pill = cm.available > 0 ? 'positive' : 'zero';
  if (cm.available < 0) pill = cm.cashOverspent > 0 ? 'cash' : 'credit';
  else if (ts && ts.needed > 0) pill = 'under';

  return (
    <tr className={`cat${selected ? ' selected' : ''}`} onClick={onSelect}>
      <td>
        <div className="cat-name">
          <span>
            {cat.name}
            {cat.hidden && <span className="muted"> (hidden)</span>}
          </span>
          <CategoryBar cm={cm} needed={ts?.needed ?? 0} />
          {ts && ts.needed > 0 && <span className="muted" style={{ fontSize: 12 }}>{formatMoney(ts.needed)} more needed this month</span>}
        </div>
      </td>
      <td className="num assigned" onClick={(e) => e.stopPropagation()}>
        <MoneyInput value={cm.assigned} onCommit={(v) => setAssigned(month, cat.id, v)} ariaLabel={`Assigned to ${cat.name}`} />
      </td>
      <td className="num hide-mobile">
        <Money cents={cm.activity} />
      </td>
      <td className="num">
        <span className={`pill ${pill}`} title={PILL_TITLES[pill]}>
          {pill === 'cash' && (
            <span className="icon" aria-hidden>
              !
            </span>
          )}
          {pill === 'credit' && (
            <span className="icon" aria-hidden>
              ⚠
            </span>
          )}
          {formatMoney(cm.available)}
          <span className="sr-only"> {PILL_TITLES[pill]}</span>
        </span>
      </td>
    </tr>
  );
}

function MonthOverview({ summary }: { summary: MonthSummary }) {
  return (
    <div className="card stack">
      <h2>{formatMonth(summary.month)} summary</h2>
      <div>
        <div className="stat">
          <span className="muted">Income this month</span>
          <Money cents={summary.income} />
        </div>
        <div className="stat">
          <span className="muted">Assigned this month</span>
          <Money cents={summary.assigned} />
        </div>
        <div className="stat">
          <span className="muted">Activity</span>
          <Money cents={summary.activity} />
        </div>
        {summary.overspentLastMonth > 0 && (
          <div className="stat">
            <span className="muted">Overspent last month</span>
            <Money cents={-summary.overspentLastMonth} />
          </div>
        )}
        <div className="stat total">
          <span>Total available in categories</span>
          <Money cents={summary.available} />
        </div>
        <div className="stat total">
          <span>Ready to Assign</span>
          <Money cents={summary.readyToAssign} colored />
        </div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Click a category to see details, set a target, or move money. Type math like <code>200+45</code> into Assigned. Bars: striped = spent, solid = still available, pale yellow = still needed for the target.
      </p>
    </div>
  );
}
