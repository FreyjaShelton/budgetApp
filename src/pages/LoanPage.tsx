import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { accountBalances } from '../lib/budget';
import { amortizedPayment, payoff } from '../lib/loan';
import { centsToInput, formatMoney, parseMoney } from '../lib/money';
import { addMonths, currentMonth, formatMonth } from '../lib/month';
import type { BudgetData } from '../types';

const axisTick = { fill: 'var(--axis)', fontSize: 12 };

function duration(months: number) {
  if (!Number.isFinite(months)) return 'Never';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(' ') || '0 mo';
}

export function LoanPage({ data }: { data: BudgetData }) {
  const debts = data.accounts.filter((a) => !a.closed && (a.type === 'liability' || a.type === 'creditCard'));
  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data]);

  const [balance, setBalance] = useState('10000');
  const [apr, setApr] = useState('6.5');
  const [payment, setPayment] = useState('');
  const [extra, setExtra] = useState('100');

  const bal = parseMoney(balance) ?? 0;
  const rate = Number(apr) || 0;
  const pmt = payment.trim() ? (parseMoney(payment) ?? 0) : amortizedPayment(bal, rate, 60);
  const ext = parseMoney(extra || '0') ?? 0;

  const base = useMemo(() => payoff(bal, rate, pmt), [bal, rate, pmt]);
  const faster = useMemo(() => payoff(bal, rate, pmt + ext), [bal, rate, pmt, ext]);

  const chartData = useMemo(() => {
    const n = Math.max(base.schedule.length, faster.schedule.length);
    const step = Math.max(1, Math.ceil(n / 120));
    const out = [];
    for (let i = 0; i < n; i += step) {
      out.push({ label: formatMonth(addMonths(currentMonth(), i), 'short'), current: base.schedule[i] ?? 0, extra: faster.schedule[i] ?? 0 });
    }
    return out;
  }, [base, faster]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Loan Planner</h1>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>
        See how extra payments change your payoff date and the interest you pay.
      </p>

      <div className="card stack" style={{ marginBottom: 16 }}>
        {debts.length > 0 && (
          <label style={{ maxWidth: 320 }}>
            Start from an account
            <select
              defaultValue=""
              onChange={(e) => {
                const b = balances.get(e.target.value);
                if (b) setBalance(centsToInput(Math.abs(b.working)));
              }}
            >
              <option value="">Choose…</option>
              {debts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatMoney(Math.abs(balances.get(a.id)?.working ?? 0))})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid-2">
          <label>
            Balance owed
            <input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
          </label>
          <label>
            Interest rate (APR %)
            <input inputMode="decimal" value={apr} onChange={(e) => setApr(e.target.value)} />
          </label>
          <label>
            Monthly payment
            <input inputMode="decimal" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder={`${centsToInput(pmt)} (5-yr payoff)`} />
          </label>
          <label>
            Extra each month
            <input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </label>
        </div>
      </div>

      {base.neverPaysOff ? (
        <div className="banner neg">A payment of {formatMoney(pmt)} doesn't cover the monthly interest, so this balance never gets paid off.</div>
      ) : (
        <>
          <div className="kpis">
            <div className="card kpi">
              <div className="k">Payoff now</div>
              <div className="v">{duration(base.months)}</div>
              <div className="muted">{formatMoney(base.totalInterest)} interest</div>
            </div>
            <div className="card kpi">
              <div className="k">With {formatMoney(ext)} extra</div>
              <div className="v">{duration(faster.months)}</div>
              <div className="muted">{formatMoney(faster.totalInterest)} interest</div>
            </div>
            <div className="card kpi">
              <div className="k">Time saved</div>
              <div className="v pos">{duration(base.months - faster.months)}</div>
            </div>
            <div className="card kpi">
              <div className="k">Interest saved</div>
              <div className="v pos">{formatMoney(base.totalInterest - faster.totalInterest)}</div>
            </div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>Balance over time</h2>
            <div className="chart-box">
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid vertical={false} stroke="var(--grid-line)" />
                  <XAxis dataKey="label" tick={axisTick} axisLine={{ stroke: 'var(--border)' }} tickLine={false} minTickGap={30} />
                  <YAxis
                    tickFormatter={(v: number) => formatMoney(v).replace(/\.\d+$/, '')}
                    tick={axisTick}
                    axisLine={false}
                    tickLine={false}
                    width={80}
                  />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v)}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                  />
                  <Legend formatter={(v: string) => <span style={{ color: 'var(--text)' }}>{v}</span>} />
                  <Line dataKey="current" name="Current payment" stroke="var(--series-1)" strokeWidth={2} dot={false} />
                  <Line dataKey="extra" name="With extra" stroke="var(--series-2)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
