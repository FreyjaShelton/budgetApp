import Papa from 'papaparse';
import type { Cents, DateKey } from '../types';
import { parseMoney } from './money';

/** A transaction parsed from a bank file, before it's assigned to an account. */
export interface ImportedTxn {
  date: DateKey;
  payee: string;
  amount: Cents;
  memo?: string;
  importId: string;
}

// ---------- OFX / QFX ----------

/** Parses OFX 1.x (SGML) and 2.x (XML) statements; both use <STMTTRN> blocks. */
export function parseOfx(text: string): ImportedTxn[] {
  const out: ImportedTxn[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) ?? [];
  for (const block of blocks) {
    const field = (name: string) => {
      const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
      return m ? decodeEntities(m[1].trim()) : undefined;
    };
    const dt = field('DTPOSTED');
    const amt = field('TRNAMT');
    if (!dt || !amt) continue;
    const amount = parseMoney(amt);
    if (amount === null) continue;
    const date = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const name = field('NAME') ?? field('PAYEE') ?? '';
    const memo = field('MEMO');
    const fitid = field('FITID');
    out.push({
      date,
      payee: name || memo || 'Unknown',
      amount,
      memo: name && memo && memo !== name ? memo : undefined,
      importId: fitid ? `ofx:${fitid}` : fallbackId(date, amount, name),
    });
  }
  return out;
}

function decodeEntities(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------- CSV ----------

export function parseCsvRows(text: string): string[][] {
  const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  return res.data;
}

export type DateFormat = 'YMD' | 'MDY' | 'DMY';

export interface CsvMapping {
  hasHeader: boolean;
  date: number;
  payee: number;
  memo: number | null;
  /** Either one signed amount column, or separate outflow/inflow columns. */
  amount: number | null;
  outflow: number | null;
  inflow: number | null;
  dateFormat: DateFormat;
  /** Flip signs, for banks that export spending as positive numbers. */
  invert: boolean;
}

/** Best guess at column mapping from header names. */
export function guessMapping(rows: string[][]): CsvMapping {
  const header = (rows[0] ?? []).map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => /date|amount|description|payee/.test(h));
  const find = (re: RegExp) => {
    if (!hasHeader) return null;
    const i = header.findIndex((h) => re.test(h));
    return i >= 0 ? i : null;
  };
  const outflow = find(/debit|outflow|withdraw/);
  const inflow = find(/credit|inflow|deposit/);
  const split = outflow !== null && inflow !== null;
  const date = find(/date/) ?? 0;
  const sample = rows.slice(hasHeader ? 1 : 0).map((r) => r[date] ?? '');
  return {
    hasHeader,
    date,
    payee: find(/payee|description|name|merchant/) ?? 1,
    memo: find(/memo|note/),
    amount: split ? null : (find(/amount/) ?? 2),
    outflow: split ? outflow : null,
    inflow: split ? inflow : null,
    dateFormat: guessDateFormat(sample),
    invert: false,
  };
}

export function guessDateFormat(samples: string[]): DateFormat {
  let firstOver12 = false;
  for (const s of samples) {
    if (/^\d{4}[-/.]/.test(s.trim())) return 'YMD';
    const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})/);
    if (m && Number(m[1]) > 12) firstOver12 = true;
  }
  return firstOver12 ? 'DMY' : 'MDY';
}

export function parseDate(s: string, fmt: DateFormat): DateKey | null {
  const nums = s.trim().match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  const [a, b, c] = nums.map(Number);
  let y: number, m: number, d: number;
  if (fmt === 'YMD') [y, m, d] = [a, b, c];
  else if (fmt === 'MDY') [m, d, y] = [a, b, c];
  else [d, m, y] = [a, b, c];
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function applyCsvMapping(rows: string[][], map: CsvMapping): { txns: ImportedTxn[]; errors: number } {
  const out: ImportedTxn[] = [];
  let errors = 0;
  const seen = new Map<string, number>();
  for (const row of rows.slice(map.hasHeader ? 1 : 0)) {
    const date = parseDate(row[map.date] ?? '', map.dateFormat);
    let amount: Cents | null;
    if (map.amount !== null) {
      amount = parseMoney(row[map.amount] ?? '');
    } else {
      const outV = map.outflow !== null ? parseMoney(row[map.outflow] ?? '') : null;
      const inV = map.inflow !== null ? parseMoney(row[map.inflow] ?? '') : null;
      amount = outV === null && inV === null ? null : Math.abs(inV ?? 0) - Math.abs(outV ?? 0);
    }
    if (!date || amount === null) {
      errors++;
      continue;
    }
    if (map.invert) amount = -amount;
    const payee = (row[map.payee] ?? '').trim() || 'Unknown';
    const memo = map.memo !== null ? row[map.memo]?.trim() || undefined : undefined;
    // Identical rows in one file are distinct transactions; number them so they don't collide.
    const base = fallbackId(date, amount, payee);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ date, payee, amount, memo, importId: `${base}:${n}` });
  }
  return { txns: out, errors };
}

function fallbackId(date: string, amount: Cents, payee: string) {
  return `h:${date}:${amount}:${payee.toLowerCase().replace(/\s+/g, ' ').slice(0, 40)}`;
}

/**
 * Split imported rows into new vs. likely duplicates of existing transactions.
 * A duplicate matches by importId, or has the same amount within 3 days of an existing
 * hand-entered transaction.
 */
export function findDuplicates(
  incoming: ImportedTxn[],
  existing: { date: DateKey; amount: Cents; importId?: string }[],
): { fresh: ImportedTxn[]; dupes: ImportedTxn[] } {
  const ids = new Set(existing.map((e) => e.importId).filter(Boolean));
  const manual = existing.filter((e) => !e.importId).map((e) => ({ ...e, used: false }));
  const fresh: ImportedTxn[] = [];
  const dupes: ImportedTxn[] = [];
  for (const t of incoming) {
    if (ids.has(t.importId)) {
      dupes.push(t);
      continue;
    }
    const match = manual.find((e) => !e.used && e.amount === t.amount && Math.abs(daysBetween(e.date, t.date)) <= 3);
    if (match) {
      match.used = true;
      dupes.push(t);
    } else fresh.push(t);
  }
  return { fresh, dupes };
}

function daysBetween(a: DateKey, b: DateKey) {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
