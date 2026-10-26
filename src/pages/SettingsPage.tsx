import { useState } from 'react';
import { CATEGORY_TEMPLATES, applyTemplate, clearAll, exportAll, replaceAll } from '../actions';
import { downloadFile } from '../components/common';
import { StorageCard, SyncCard } from '../components/SyncCard';
import { sampleData } from '../lib/sample';
import { today } from '../lib/month';
import type { BudgetData } from '../types';

export function SettingsPage({ data }: { data: BudgetData }) {
  const [msg, setMsg] = useState('');
  const [template, setTemplate] = useState(Object.keys(CATEGORY_TEMPLATES)[0]);

  const backup = async () => {
    downloadFile(`budget-backup-${today()}.json`, JSON.stringify(await exportAll(), null, 2));
    setMsg('Backup downloaded.');
  };

  const restore = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!confirm('Replace ALL current data with this backup?')) return;
      await replaceAll(parsed);
      setMsg('Backup restored.');
    } catch (e) {
      setMsg(`Couldn't restore: ${(e as Error).message}`);
    }
  };

  const exportCsv = () => {
    const accts = new Map(data.accounts.map((a) => [a.id, a.name]));
    const cats = new Map(data.categories.map((c) => [c.id, c.name]));
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [
      'Account,Date,Payee,Category,Memo,Amount,Cleared',
      ...[...data.transactions]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) =>
          [
            esc(accts.get(t.accountId) ?? ''),
            t.date,
            esc(t.payee),
            esc(t.splits ? 'Split' : t.categoryId === 'rta' ? 'Ready to Assign' : (cats.get(t.categoryId ?? '') ?? '')),
            esc(t.memo ?? ''),
            (t.amount / 100).toFixed(2),
            t.cleared,
          ].join(','),
        ),
    ];
    downloadFile(`transactions-${today()}.csv`, lines.join('\n'), 'text/csv');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>
      <div className="stack" style={{ maxWidth: 720 }}>
        {msg && <div className="banner warn">{msg}</div>}
        <SyncCard />
        <StorageCard />
        <div className="card stack">
          <h2>Backup & restore</h2>
          <p className="muted" style={{ margin: 0 }}>
            All data lives in this browser only. Download a backup regularly. Clearing browser data deletes your budget.
          </p>
          <div className="row">
            <button className="btn primary" onClick={backup}>
              Download backup (JSON)
            </button>
            <label className="btn" style={{ display: 'inline-flex', color: 'var(--text)' }}>
              Restore from backup…
              <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
            </label>
            <button className="btn" onClick={exportCsv}>
              Export transactions (CSV)
            </button>
          </div>
        </div>
        <div className="card stack">
          <h2>Category templates</h2>
          <p className="muted" style={{ margin: 0 }}>
            Add a preset set of category groups to your budget.
          </p>
          <div className="row">
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              {Object.keys(CATEGORY_TEMPLATES).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button
              className="btn"
              onClick={async () => {
                await applyTemplate(template);
                setMsg(`Added the "${template}" categories.`);
              }}
            >
              Add categories
            </button>
          </div>
        </div>
        <div className="card stack">
          <h2>Danger zone</h2>
          <div className="row">
            <button
              className="btn"
              onClick={async () => {
                if (confirm('Replace all data with the sample budget? If sync is on, this replaces it on your other devices too.')) {
                  await replaceAll(sampleData());
                  setMsg('Sample data loaded.');
                }
              }}
            >
              Load sample data
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                if (confirm('Delete ALL accounts, categories, and transactions? If sync is on, this also deletes them on your other devices. Download a backup first if you might want them.')) {
                  await clearAll();
                  setMsg('All data deleted.');
                }
              }}
            >
              Delete all data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
