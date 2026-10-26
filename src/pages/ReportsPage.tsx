import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Money } from '../components/common';
import { firstMonth } from '../lib/budget';
import { formatMoney } from '../lib/money';
import { addMonths, currentMonth, formatMonth, monthRange } from '../lib/month';
import { incomeVsExpense, netWorth, spendingBy } from '../lib/reports';
import type { BudgetData, MonthKey } from '../types';

type Range = 'month' | '3' | '6' | '12' | 'ytd' | 'all';
const RANGES: [Range, string][] = [
  ['month', 'This month'],
  ['3', 'Last 3 months'],
  ['6', 'Last 6 months'],
  ['12', 'Last 12 months'],
  ['ytd', 'Year to date'],
  ['all', 'All time'],
];

function rangeMonths(range: Range, data: BudgetData): MonthKey[] {
  const now = currentMonth();
  const from =
    range === 'month' ? now : range === 'ytd' ? `${now.slice(0, 4)}-01` : range === 'all' ? firstMonth(data) : addMonths(now, -(Number(range) - 1));
  // Don't count months before there was any data (that would skew averages).
  const start = firstMonth(data);
  return monthRange(from < start ? start : from, now);
}

const axisTick = { fill: 'var(--axis)', fontSize: 12 };
const compact = (cents: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);
const tooltipProps = {
  formatter: (v: number) => formatMoney(v),
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' },
  labelStyle: { color: 'var(--muted)' },
  cursor: { fill: 'var(--surface-2)' },
};

export function ReportsPage({ data }: { data: BudgetData }) {
  const [tab, setTab] = useState<'spending' | 'income' | 'networth'>('spending');
  const [range, setRange] = useState<Range>('6');
  const months = useMemo(() => rangeMonths(range, data), [range, data]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Reflect</h1>
        <span className="spacer" />
        <select value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Date range">
          {RANGES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="tabs">
        {(
          [
            ['spending', 'Spending'],
            ['income', 'Income vs Expense'],
            ['networth', 'Net Worth'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'spending' && <Spending data={data} months={months} />}
      {tab === 'income' && <IncomeExpense data={data} months={months} />}
      {tab === 'networth' && <NetWorth data={data} months={months} />}
    </div>
  );
}

function Spending({ data, months }: { data: BudgetData; months: MonthKey[] }) {
  const [by, setBy] = useState<'category' | 'group'>('category');
  const from = `${months[0]}-01`;
  const to = `${months[months.length - 1]}-31`;
  const rows = useMemo(() => spendingBy(data, from, to, by), [data, from, to, by]);
  const total = rows.reduce((s, r) => s + r.spent, 0);
  const monthly = useMemo(() => incomeVsExpense(data, months), [data, months]);
  const top = rows.slice(0, 12);

  if (!rows.length) return <div className="card muted">No categorized spending in this range.</div>;

  return (
    <div className="stack">
      <div className="kpis">
        <div className="card kpi">
          <div className="k">Total spending</div>
          <div className="v">{formatMoney(total)}</div>
        </div>
        <div className="card kpi">
          <div className="k">Average per month</div>
          <div className="v">{formatMoney(Math.round(total / months.length))}</div>
        </div>
        <div className="card kpi">
          <div className="k">Top {by}</div>
          <div className="v" style={{ fontSize: 16 }}>
            {rows[0].name} · {formatMoney(rows[0].spent)}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2>Spending by {by}</h2>
          <span className="spacer" />
          <select value={by} onChange={(e) => setBy(e.target.value as 'category' | 'group')} aria-label="Group by">
            <option value="category">By category</option>
            <option value="group">By group</option>
          </select>
        </div>
        <div style={{ height: Math.max(200, top.length * 34 + 40) }}>
          <ResponsiveContainer>
            <BarChart data={top} layout="vertical" margin={{ left: 10, right: 24 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke="var(--grid-line)" />
              <XAxis type="number" tickFormatter={compact} tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={140} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="spent" name="Spent" fill="var(--series-1)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {rows.length > top.length && <p className="muted">Showing top {top.length}; all are listed below.</p>}
      </div>

      {months.length > 1 && (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Spending per month</h2>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={monthly.map((r) => ({ ...r, label: formatMonth(r.month, 'short') }))} barCategoryGap="25%">
                <CartesianGrid vertical={false} stroke="var(--grid-line)" />
                <XAxis dataKey="label" tick={axisTick} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                <YAxis tickFormatter={compact} tick={axisTick} axisLine={false} tickLine={false} width={70} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="expenses" name="Spending" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <table className="grid">
        <thead>
          <tr>
            <th>{by === 'category' ? 'Category' : 'Group'}</th>
            <th className="num">Spent</th>
            <th className="num">Monthly avg</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td className="num">{formatMoney(r.spent)}</td>
              <td className="num">{formatMoney(Math.round(r.spent / months.length))}</td>
              <td className="num">{((r.spent / total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncomeExpense({ data, months }: { data: BudgetData; months: MonthKey[] }) {
  const rows = useMemo(() => incomeVsExpense(data, months), [data, months]);
  const tot = rows.reduce((s, r) => ({ income: s.income + r.income, expenses: s.expenses + r.expenses }), { income: 0, expenses: 0 });
  return (
    <div className="stack">
      <div className="kpis">
        <div className="card kpi">
          <div className="k">Income</div>
          <div className="v">{formatMoney(tot.income)}</div>
        </div>
        <div className="card kpi">
          <div className="k">Expenses</div>
          <div className="v">{formatMoney(tot.expenses)}</div>
        </div>
        <div className="card kpi">
          <div className="k">Net</div>
          <div className="v">
            <Money cents={tot.income - tot.expenses} colored />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="chart-box">
          <ResponsiveContainer>
            <BarChart data={rows.map((r) => ({ ...r, label: formatMonth(r.month, 'short') }))} barGap={2} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--grid-line)" />
              <XAxis dataKey="label" tick={axisTick} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              <YAxis tickFormatter={compact} tick={axisTick} axisLine={false} tickLine={false} width={70} />
              <Tooltip {...tooltipProps} />
              <Legend formatter={(v: string) => <span style={{ color: 'var(--text)' }}>{v}</span>} />
              <Bar dataKey="income" name="Income" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Income</th>
            <th className="num">Expenses</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>{formatMonth(r.month)}</td>
              <td className="num">{formatMoney(r.income)}</td>
              <td className="num">{formatMoney(r.expenses)}</td>
              <td className="num">
                <Money cents={r.net} colored />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NetWorth({ data, months }: { data: BudgetData; months: MonthKey[] }) {
  const rows = useMemo(() => netWorth(data, months), [data, months]);
  const last = rows[rows.length - 1];
  const change = last.netWorth - rows[0].netWorth;
  return (
    <div className="stack">
      <div className="kpis">
        <div className="card kpi">
          <div className="k">Net worth</div>
          <div className="v">
            <Money cents={last.netWorth} />
          </div>
        </div>
        <div className="card kpi">
          <div className="k">Assets</div>
          <div className="v">{formatMoney(last.assets)}</div>
        </div>
        <div className="card kpi">
          <div className="k">Debts</div>
          <div className="v">{formatMoney(last.debts)}</div>
        </div>
        <div className="card kpi">
          <div className="k">Change over range</div>
          <div className="v">
            <Money cents={change} colored />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="chart-box">
          <ResponsiveContainer>
            <ComposedChart
              data={rows.map((r) => ({ ...r, debtsNeg: -r.debts, label: formatMonth(r.month, 'short') }))}
              stackOffset="sign"
              barCategoryGap="25%"
            >
              <CartesianGrid vertical={false} stroke="var(--grid-line)" />
              <XAxis dataKey="label" tick={axisTick} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              <YAxis tickFormatter={compact} tick={axisTick} axisLine={false} tickLine={false} width={70} />
              <Tooltip {...tooltipProps} />
              <Legend formatter={(v: string) => <span style={{ color: 'var(--text)' }}>{v}</span>} />
              <Bar dataKey="assets" name="Assets" stackId="nw" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="debtsNeg" name="Debts" stackId="nw" fill="var(--series-2)" radius={[0, 0, 4, 4]} />
              <Line dataKey="netWorth" name="Net worth" stroke="var(--text)" strokeWidth={2} dot={{ r: 4, fill: 'var(--surface)', strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Assets</th>
            <th className="num">Debts</th>
            <th className="num">Net worth</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>{formatMonth(r.month)}</td>
              <td className="num">{formatMoney(r.assets)}</td>
              <td className="num">{formatMoney(r.debts)}</td>
              <td className="num">
                <Money cents={r.netWorth} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
