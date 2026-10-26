import { describe, expect, it } from 'vitest';
import type { Account, BudgetData } from '../types';
import { deriveKey, newKdf, open, seal, WrongPassphraseError } from './crypto';
import { EMPTY_DATA, fingerprint, mergeSnapshots, stableStringify } from './merge';

const acct = (id: string, name: string): Account => ({ id, name, type: 'checking', onBudget: true, closed: false, sortOrder: 0 });
const data = (...accounts: Account[]): BudgetData => ({ ...EMPTY_DATA, accounts });
const names = (d: BudgetData) => d.accounts.map((a) => a.name).sort();

describe('crypto', () => {
  it('round-trips and rejects the wrong passphrase', async () => {
    const kdf = newKdf(1000); // low iteration count keeps the test fast
    const key = await deriveKey('correct horse battery staple', kdf);
    const payload = data(acct('a', 'Checking ✓'));
    const env = await seal(payload, key, kdf);
    expect(env.ct).not.toContain('Checking');
    expect(await open(env, key)).toEqual(payload);
    // Same passphrase on another device (same salt from the file) unlocks it.
    expect(await open(env, await deriveKey('correct horse battery staple', env.kdf))).toEqual(payload);
    await expect(open(env, await deriveKey('wrong', env.kdf))).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('uses a fresh nonce for every upload', async () => {
    const kdf = newKdf(1000);
    const key = await deriveKey('pw', kdf);
    const [a, b] = await Promise.all([seal({ x: 1 }, key, kdf), seal({ x: 1 }, key, kdf)]);
    expect(a.iv).not.toBe(b.iv);
  });
});

describe('mergeSnapshots', () => {
  const base = data(acct('a', 'A'), acct('b', 'B'), acct('c', 'C'));

  it('combines independent edits from both devices', () => {
    const local = data(acct('a', 'A local'), acct('b', 'B'), acct('c', 'C'), acct('d', 'D new local'));
    const remote = data(acct('a', 'A'), acct('b', 'B remote'), acct('e', 'E new remote'));
    const { merged, conflicts } = mergeSnapshots(base, local, remote);
    // c was deleted remotely and untouched locally -> deleted.
    expect(names(merged)).toEqual(['A local', 'B remote', 'D new local', 'E new remote']);
    expect(conflicts).toBe(0);
  });

  it('keeps local on a true conflict, and an edit beats a delete', () => {
    const local = data(acct('a', 'A local'), acct('c', 'C'));
    const remote = data(acct('a', 'A remote'), acct('b', 'B remote edit'), acct('c', 'C'));
    const { merged, conflicts } = mergeSnapshots(base, local, remote);
    expect(names(merged)).toEqual(['A local', 'B remote edit', 'C']);
    expect(conflicts).toBe(2);
  });

  it('is a no-op when nothing changed', () => {
    const { merged } = mergeSnapshots(base, base, base);
    expect(fingerprint(merged)).toBe(fingerprint(base));
  });

  it('ignores key order and undefined fields when comparing', () => {
    expect(stableStringify({ b: 1, a: undefined, c: [{ y: 2, x: 1 }] })).toBe(stableStringify({ c: [{ x: 1, y: 2 }], b: 1 }));
  });
});
