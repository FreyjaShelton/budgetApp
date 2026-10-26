import { useMemo, useState } from 'react';
import { importTransactions } from '../actions';
import { applyCsvMapping, findDuplicates, guessMapping, parseCsvRows, parseOfx, type CsvMapping, type ImportedTxn } from '../lib/importers';
import { formatMoney } from '../lib/money';
import { formatDate } from '../lib/month';
import type { Account, BudgetData } from '../types';
import { Modal } from './common';

export function ImportModal({ data, account, onClose }: { data: BudgetData; account: Account; onClose: () => void }) {
  const [csvRows, setCsvRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [ofxTxns, setOfxTxns] = useState<ImportedTxn[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const parsed = useMemo(() => {
    if (ofxTxns) return { txns: ofxTxns, errors: 0 };
    if (csvRows && mapping) return applyCsvMapping(csvRows, mapping);
    return null;
  }, [ofxTxns, csvRows, mapping]);

  const split = useMemo(() => {
    if (!parsed) return null;
    const existing = data.transactions.filter((t) => t.accountId === account.id);
    const { fresh, dupes } = findDuplicates(parsed.txns, existing);
    return { fresh, dupes };
  }, [parsed, data.transactions, account.id]);

  // Duplicates start unchecked.
  const isIncluded = (t: ImportedTxn, dupe: boolean) => (dupe ? skipped.has(`+${t.importId}`) : !skipped.has(t.importId));
  const toggle = (t: ImportedTxn, dupe: boolean) => {
    const key = dupe ? `+${t.importId}` : t.importId;
    const s = new Set(skipped);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    setSkipped(s);
  };

  const onFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    setSkipped(new Set());
    const text = await file.text();
    if (/\.(ofx|qfx)$/i.test(file.name) || /<OFX>/i.test(text)) {
      const t = parseOfx(text);
      if (!t.length) return setError('No transactions found in that file.');
      setOfxTxns(t);
      setCsvRows(null);
    } else {
      const rows = parseCsvRows(text);
      if (rows.length < 1) return setError('That file looks empty.');
      setCsvRows(rows);
      setMapping(guessMapping(rows));
      setOfxTxns(null);
    }
  };

  const toImport = split ? [...split.fresh.filter((t) => isIncluded(t, false)), ...split.dupes.filter((t) => isIncluded(t, true))] : [];

  const doImport = async () => {
    await importTransactions(account.id, toImport, data);
    onClose();
  };

  const colCount = csvRows ? Math.max(...csvRows.slice(0, 5).map((r) => r.length)) : 0;
  const colOptions = (allowNone: boolean) => (
    <>
      {allowNone && <option value="">(none)</option>}
      {Array.from({ length: colCount }, (_, i) => (
        <option key={i} value={i}>
          {mapping?.hasHeader ? csvRows![0][i] || `Column ${i + 1}` : `Column ${i + 1}`}
        </option>
      ))}
    </>
  );
  const setCol = (key: keyof CsvMapping, v: string) => setMapping({ ...mapping!, [key]: v === '' ? null : Number(v) });

  return (
    <Modal
      wide
      title={`Import into ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!toImport.length} onClick={doImport}>
            Import {toImport.length} transaction{toImport.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <label>
        Bank file (CSV, OFX or QFX)
        <input type="file" accept=".csv,.ofx,.qfx,.txt" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {fileName && <div className="muted">{fileName}</div>}
      {error && <div className="error">{error}</div>}

      {csvRows && mapping && (
        <div className="card stack">
          <h3>Match the columns</h3>
          <label className="row" style={{ display: 'flex' }}>
            <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setMapping({ ...mapping, hasHeader: e.target.checked })} />
            First row is a header
          </label>
          <div className="grid-2">
            <label>
              Date
              <select value={mapping.date} onChange={(e) => setCol('date', e.target.value)}>
                {colOptions(false)}
              </select>
            </label>
            <label>
              Date format
              <select value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as CsvMapping['dateFormat'] })}>
                <option value="MDY">MM/DD/YYYY</option>
                <option value="DMY">DD/MM/YYYY</option>
                <option value="YMD">YYYY-MM-DD</option>
              </select>
            </label>
            <label>
              Payee
              <select value={mapping.payee} onChange={(e) => setCol('payee', e.target.value)}>
                {colOptions(false)}
              </select>
            </label>
            <label>
              Memo
              <select value={mapping.memo ?? ''} onChange={(e) => setCol('memo', e.target.value)}>
                {colOptions(true)}
              </select>
            </label>
            <label>
              Amount (one column, signed)
              <select
                value={mapping.amount ?? ''}
                onChange={(e) =>
                  setMapping({ ...mapping, amount: e.target.value === '' ? null : Number(e.target.value), ...(e.target.value !== '' ? { outflow: null, inflow: null } : {}) })
                }
              >
                {colOptions(true)}
              </select>
            </label>
            {mapping.amount === null && (
              <>
                <label>
                  Outflow / debit
                  <select value={mapping.outflow ?? ''} onChange={(e) => setCol('outflow', e.target.value)}>
                    {colOptions(true)}
                  </select>
                </label>
                <label>
                  Inflow / credit
                  <select value={mapping.inflow ?? ''} onChange={(e) => setCol('inflow', e.target.value)}>
                    {colOptions(true)}
                  </select>
                </label>
              </>
            )}
          </div>
          <label className="row" style={{ display: 'flex' }}>
            <input type="checkbox" checked={mapping.invert} onChange={(e) => setMapping({ ...mapping, invert: e.target.checked })} />
            Flip signs (my bank shows spending as positive)
          </label>
          {parsed && parsed.errors > 0 && <div className="error">{parsed.errors} row(s) couldn't be read and will be skipped.</div>}
        </div>
      )}

      {split && (
        <div>
          <h3 style={{ marginBottom: 8 }}>
            {split.fresh.length} new{split.dupes.length > 0 && `, ${split.dupes.length} look like duplicates (unchecked)`}
          </h3>
          <div style={{ maxHeight: 340, overflow: 'auto' }}>
            <table className="grid register">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Memo</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[...split.fresh.map((t) => [t, false] as const), ...split.dupes.map((t) => [t, true] as const)].map(([t, dupe]) => (
                  <tr key={(dupe ? '+' : '') + t.importId} style={dupe ? { opacity: 0.6 } : undefined}>
                    <td>
                      <input type="checkbox" checked={isIncluded(t, dupe)} onChange={() => toggle(t, dupe)} />
                    </td>
                    <td>{formatDate(t.date)}</td>
                    <td>
                      {t.payee}
                      {dupe && <span className="muted"> (duplicate?)</span>}
                    </td>
                    <td className="muted">{t.memo}</td>
                    <td className={`num ${t.amount < 0 ? '' : 'pos'}`}>{formatMoney(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Imported transactions are marked cleared. Payees you've used before get their last category automatically.
          </p>
        </div>
      )}
    </Modal>
  );
}
