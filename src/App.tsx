import { useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AddAccountModal } from './components/AddAccountModal';
import { Money } from './components/common';
import { PersistBanner } from './components/PersistBanner';
import { SyncChip } from './components/SyncChip';
import { syncEngine } from './sync/engine';
import { useBudgetData } from './db';
import { accountBalances } from './lib/budget';
import { AccountPage } from './pages/AccountPage';
import { BudgetPage } from './pages/BudgetPage';
import { LoanPage } from './pages/LoanPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Welcome } from './pages/Welcome';
import type { Account, BudgetData } from './types';

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const data = useBudgetData();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setMenuOpen(false);
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    syncEngine.init();
    const onVisible = () => document.visibilityState === 'visible' && syncEngine.syncIfReady();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  useEffect(() => {
    if (data) syncEngine.notifyLocalChange();
  }, [data]);

  if (!data) return null;
  const isEmpty = data.accounts.length === 0 && data.groups.length === 0;

  return (
    <div className="app">
      <Sidebar data={data} open={menuOpen} />
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <main className="main" ref={mainRef}>
        <button className="btn ghost menu-toggle" style={{ margin: '10px 12px 0' }} onClick={() => setMenuOpen(true)}>
          ☰ Menu
        </button>
        <PersistBanner hasData={!isEmpty} />
        {isEmpty && location.pathname !== '/settings' ? (
          <Welcome />
        ) : (
          <Routes>
            <Route path="/" element={<BudgetPage data={data} />} />
            <Route path="/accounts" element={<AccountPage data={data} />} />
            <Route path="/accounts/:id" element={<AccountPage data={data} />} />
            <Route path="/reports" element={<ReportsPage data={data} />} />
            <Route path="/loan" element={<LoanPage data={data} />} />
            <Route path="/settings" element={<SettingsPage data={data} />} />
          </Routes>
        )}
      </main>
    </div>
  );
}

function Sidebar({ data, open }: { data: BudgetData; open: boolean }) {
  const [adding, setAdding] = useState(false);
  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data]);
  const open_ = data.accounts.filter((a) => !a.closed);
  const sections: [string, Account[]][] = [
    ['Budget', open_.filter((a) => a.onBudget)],
    ['Tracking', open_.filter((a) => !a.onBudget)],
    ['Closed', data.accounts.filter((a) => a.closed)],
  ];
  const total = (accts: Account[]) => accts.reduce((s, a) => s + (balances.get(a.id)?.working ?? 0), 0);

  return (
    <nav className={`sidebar${open ? ' open' : ''}`}>
      <div className="brand">◆ Budget</div>
      <SyncChip />
      <NavLink to="/" end className="nav">
        ▦ Plan
      </NavLink>
      <NavLink to="/reports" className="nav">
        ◔ Reflect
      </NavLink>
      <NavLink to="/accounts" end className="nav">
        ≡ All Accounts
      </NavLink>
      <NavLink to="/loan" className="nav">
        % Loan Planner
      </NavLink>
      <NavLink to="/settings" className="nav">
        ⚙ Settings
      </NavLink>

      {sections.map(
        ([title, accts]) =>
          accts.length > 0 && (
            <div className="section" key={title}>
              <div className="section-title">
                <span>{title}</span>
                {title !== 'Closed' && <Money cents={total(accts)} />}
              </div>
              {accts.map((a) => (
                <NavLink key={a.id} to={`/accounts/${a.id}`} className="nav acct">
                  <span>{a.name}</span>
                  <span className="bal">
                    <Money cents={balances.get(a.id)?.working ?? 0} />
                  </span>
                </NavLink>
              ))}
            </div>
          ),
      )}
      <button className="add-acct" onClick={() => setAdding(true)}>
        + Add Account
      </button>
      {adding && <AddAccountModal onClose={() => setAdding(false)} />}
    </nav>
  );
}
