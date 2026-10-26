import type { BudgetData } from '../types';

export const TABLES = ['accounts', 'groups', 'categories', 'transactions', 'assignments'] as const;
export type TableName = (typeof TABLES)[number];

export const EMPTY_DATA: BudgetData = { accounts: [], groups: [], categories: [], transactions: [], assignments: [] };

/** JSON with sorted object keys and undefined dropped, so equal records compare equal. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(',')}}`;
}

/** Order-independent fingerprint of a whole snapshot. */
export function fingerprint(data: BudgetData): string {
  return stableStringify(TABLES.map((t) => [...(data[t] as { id: string }[])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))));
}

export function isEmpty(data: BudgetData): boolean {
  return TABLES.every((t) => data[t].length === 0);
}

export interface MergeResult {
  merged: BudgetData;
  /** Records changed on both sides in different ways. The local version was kept. */
  conflicts: number;
}

/**
 * Three-way merge at the record level. `base` is the snapshot both sides last agreed on.
 * - Changed on one side only: take that side (including deletions).
 * - Changed on both sides: keep local, unless one side deleted it and the other edited it,
 *   in which case the edit wins (so nothing is lost silently).
 * With no base (first sync), this is a union where local wins on collisions.
 */
export function mergeSnapshots(base: BudgetData | null, local: BudgetData, remote: BudgetData): MergeResult {
  let conflicts = 0;
  const merged = {} as BudgetData;
  for (const table of TABLES) {
    const b = byId(base?.[table]);
    const l = byId(local[table]);
    const r = byId(remote[table]);
    const ids = new Set([...l.keys(), ...r.keys(), ...b.keys()]);
    const out: unknown[] = [];
    for (const id of ids) {
      const [bv, lv, rv] = [b.get(id), l.get(id), r.get(id)];
      const localChanged = bv?.s !== lv?.s;
      const remoteChanged = bv?.s !== rv?.s;
      let pick: Rec | undefined;
      if (!localChanged) pick = rv;
      else if (!remoteChanged || lv?.s === rv?.s) pick = lv;
      else {
        conflicts++;
        pick = lv ?? rv;
      }
      if (pick) out.push(pick.v);
    }
    (merged as unknown as Record<string, unknown[]>)[table] = out;
  }
  return { merged, conflicts };
}

interface Rec {
  v: unknown;
  s: string;
}

function byId(rows: readonly { id: string }[] | undefined): Map<string, Rec> {
  const m = new Map<string, Rec>();
  for (const row of rows ?? []) m.set(row.id, { v: row, s: stableStringify(row) });
  return m;
}
