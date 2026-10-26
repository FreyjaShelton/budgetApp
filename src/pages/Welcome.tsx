import { useState } from 'react';
import { CATEGORY_TEMPLATES, applyTemplate, replaceAll } from '../actions';
import { AddAccountModal } from '../components/AddAccountModal';
import { sampleData } from '../lib/sample';

export function Welcome() {
  const [template, setTemplate] = useState(Object.keys(CATEGORY_TEMPLATES)[0]);
  const [addingAccount, setAddingAccount] = useState(false);

  return (
    <div className="page">
      <div className="welcome stack">
        <h1>Welcome to your budget</h1>
        <p className="muted" style={{ margin: 0 }}>
          This app uses zero-based budgeting: give every dollar you have a job before you spend it. Your data stays in this browser. Use Settings → Backup to save a
          copy.
        </p>
        <div className="card stack">
          <h2>1. Pick starting categories</h2>
          <div className="row">
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              {Object.keys(CATEGORY_TEMPLATES).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button className="btn primary" onClick={() => applyTemplate(template)}>
              Use this template
            </button>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {Object.entries(CATEGORY_TEMPLATES[template])
              .map(([g, cats]) => `${g}: ${cats.join(', ')}`)
              .join(' · ')}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            You can rename, add, hide or delete categories anytime.
          </div>
        </div>
        <div className="card stack">
          <h2>…or add an account first</h2>
          <div>
            <button className="btn" onClick={() => setAddingAccount(true)}>
              + Add account
            </button>
          </div>
        </div>
        <div className="card stack">
          <h2>Just exploring?</h2>
          <p className="muted" style={{ margin: 0 }}>
            Load three months of demo data. Clear it later in Settings.
          </p>
          <div>
            <button className="btn" onClick={() => replaceAll(sampleData())}>
              Load sample budget
            </button>
          </div>
        </div>
      </div>
      {addingAccount && <AddAccountModal onClose={() => setAddingAccount(false)} />}
    </div>
  );
}
