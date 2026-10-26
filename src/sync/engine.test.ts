import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../types';
import { deriveKey, open, seal, type Envelope } from './crypto';

// In-memory stand-in for Google Drive.
const remote = vi.hoisted(() => ({ file: null as null | { id: string; version: number; env: unknown } }));
vi.mock('./drive', () => ({
  AuthError: class extends Error {},
  preloadGoogle: async () => {},
  currentToken: () => 'token',
  clearToken: () => {},
  signIn: async () => 'token',
  findFile: async () => (remote.file ? { id: remote.file.id, version: String(remote.file.version) } : null),
  getMeta: async () => ({ id: remote.file!.id, version: String(remote.file!.version) }),
  download: async () => structuredClone(remote.file!.env),
  createFile: async (_t: string, env: unknown) => {
    remote.file = { id: 'f1', version: 1, env: structuredClone(env) };
    return { id: 'f1', version: '1' };
  },
  updateFile: async (_t: string, _id: string, env: unknown) => {
    remote.file = { id: 'f1', version: remote.file!.version + 1, env: structuredClone(env) };
    return { id: 'f1', version: String(remote.file.version) };
  },
  deleteFile: async () => {
    remote.file = null;
  },
}));

const { db } = await import('../db');
const { syncEngine, NeedsChoiceError } = await import('./engine');
const { EMPTY_DATA } = await import('./merge');

const acct = (id: string, name: string): Account => ({ id, name, type: 'checking', onBudget: true, closed: false, sortOrder: 0 });
const PASS = 'test passphrase 123';

async function remoteData() {
  const env = remote.file!.env as Envelope;
  return open<typeof EMPTY_DATA>(env, await deriveKey(PASS, env.kdf));
}

/** Simulate another device editing the Drive copy. */
async function editRemote(fn: (d: typeof EMPTY_DATA) => void) {
  const env = remote.file!.env as Envelope;
  const key = await deriveKey(PASS, env.kdf);
  const data = await open<typeof EMPTY_DATA>(env, key);
  fn(data);
  remote.file = { id: 'f1', version: remote.file!.version + 1, env: await seal(data, key, env.kdf) };
}

const localNames = async () => (await db.accounts.toArray()).map((a) => a.name).sort();

describe('sync engine', () => {
  beforeEach(async () => {
    remote.file = null;
    await syncEngine.disconnect();
    await Promise.all([db.accounts.clear(), db.groups.clear(), db.categories.clear(), db.transactions.clear(), db.assignments.clear()]);
  });

  it('first device uploads encrypted data; later edits on both sides merge', { timeout: 20000 }, async () => {
    await db.accounts.add(acct('a', 'Checking'));
    expect((await syncEngine.beginConnect()).remoteExists).toBe(false);
    await syncEngine.finishConnect(PASS);
    expect(JSON.stringify(remote.file!.env)).not.toContain('Checking');
    expect((await remoteData()).accounts.map((a) => a.name)).toEqual(['Checking']);

    await db.accounts.add(acct('b', 'Savings (this device)'));
    await editRemote((d) => d.accounts.push(acct('c', 'Card (other device)')));
    await syncEngine.syncNow();

    expect(syncEngine.getState().status).toBe('idle');
    const expected = ['Card (other device)', 'Checking', 'Savings (this device)'];
    expect(await localNames()).toEqual(expected);
    expect((await remoteData()).accounts.map((a) => a.name).sort()).toEqual(expected);
  });

  it('deletions propagate, and an unchanged sync does not re-upload', { timeout: 20000 }, async () => {
    await db.accounts.bulkAdd([acct('a', 'A'), acct('b', 'B')]);
    await syncEngine.beginConnect();
    await syncEngine.finishConnect(PASS);

    await editRemote((d) => (d.accounts = d.accounts.filter((x) => x.id !== 'a')));
    await syncEngine.syncNow();
    expect(await localNames()).toEqual(['B']);

    const version = remote.file!.version;
    await syncEngine.syncNow();
    expect(remote.file!.version).toBe(version);
  });

  it('a new empty device pulls the Drive copy; wrong passphrase is rejected', { timeout: 20000 }, async () => {
    await db.accounts.add(acct('a', 'From laptop'));
    await syncEngine.beginConnect();
    await syncEngine.finishConnect(PASS);

    // "Phone": fresh device with no data.
    await syncEngine.disconnect();
    await db.accounts.clear();
    expect((await syncEngine.beginConnect()).remoteExists).toBe(true);
    await expect(syncEngine.finishConnect('wrong passphrase')).rejects.toThrow(/passphrase/);
    await syncEngine.finishConnect(PASS);
    expect(await localNames()).toEqual(['From laptop']);
  });

  it('asks before replacing when both sides already have different data', { timeout: 20000 }, async () => {
    await db.accounts.add(acct('a', 'Laptop data'));
    await syncEngine.beginConnect();
    await syncEngine.finishConnect(PASS);

    await syncEngine.disconnect();
    await db.accounts.clear();
    await db.accounts.add(acct('z', 'Phone data'));
    await syncEngine.beginConnect();
    await expect(syncEngine.finishConnect(PASS)).rejects.toBeInstanceOf(NeedsChoiceError);
    expect(await localNames()).toEqual(['Phone data']); // nothing replaced yet

    await syncEngine.finishConnect(PASS, 'useDrive');
    expect(await localNames()).toEqual(['Laptop data']);
  });
});
