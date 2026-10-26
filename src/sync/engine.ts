import { useSyncExternalStore } from 'react';
import { db } from '../db';
import type { BudgetData } from '../types';
import { deriveKey, newKdf, open, seal, type Envelope, type Kdf } from './crypto';
import * as drive from './drive';
import { TABLES, fingerprint, isEmpty, mergeSnapshots, stableStringify } from './merge';

/**
 * Keeps this device's IndexedDB in sync with one encrypted file in Google Drive.
 *
 * Each sync: read local data, download the remote copy (skipped if unchanged), three-way merge
 * against the last snapshot both sides agreed on, write the result locally and upload it.
 * Writes are guarded so that a local edit or another device's upload made mid-sync triggers
 * a retry instead of being overwritten.
 */

interface SyncConfig {
  key: 'config';
  cryptoKey: CryptoKey;
  kdf: Kdf;
}

interface SyncBase {
  key: 'base';
  data: BudgetData;
  /** Drive file version that `data` corresponds to. */
  version?: string;
  lastSyncAt: number;
}

export type SyncStatus = 'loading' | 'off' | 'needsAuth' | 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt?: number;
  error?: string;
  /** Records edited on both devices since the last sync; the version on this device was kept. */
  lastConflicts?: number;
}

/** Thrown by finishConnect when both this device and Drive already have different data. */
export class NeedsChoiceError extends Error {
  constructor() {
    super('Both this device and Google Drive have budget data.');
  }
}

async function readSnapshot(): Promise<BudgetData> {
  const [accounts, groups, categories, transactions, assignments] = await Promise.all(TABLES.map((t) => db[t].toArray()));
  return { accounts, groups, categories, transactions, assignments } as BudgetData;
}

/** Replace local data with `next`, but only if local still equals `expected` (atomic). */
async function writeSnapshotIfUnchanged(expected: BudgetData, next: BudgetData): Promise<boolean> {
  return db.transaction('rw', [db.accounts, db.groups, db.categories, db.transactions, db.assignments], async () => {
    const current = await readSnapshot();
    if (fingerprint(current) !== fingerprint(expected)) return false;
    for (const t of TABLES) {
      const table = db[t] as unknown as { bulkPut(rows: unknown[]): Promise<unknown>; bulkDelete(ids: string[]): Promise<void> };
      const cur = new Map((current[t] as { id: string }[]).map((r) => [r.id, stableStringify(r)]));
      const nextIds = new Set((next[t] as { id: string }[]).map((r) => r.id));
      const puts = (next[t] as { id: string }[]).filter((r) => cur.get(r.id) !== stableStringify(r));
      const dels = [...cur.keys()].filter((id) => !nextIds.has(id));
      if (puts.length) await table.bulkPut(puts);
      if (dels.length) await table.bulkDelete(dels);
    }
    return true;
  });
}

class SyncEngine {
  private state: SyncState = { status: 'loading' };
  private listeners = new Set<() => void>();
  private running = false;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Remote state captured between beginConnect and finishConnect. */
  private pending: { token: string; remote: drive.RemoteMeta | null; env?: Envelope } | null = null;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async init() {
    const [config, base] = await Promise.all([db.meta.get('config'), db.meta.get('base')]);
    if (!config) return this.set({ status: 'off' });
    drive.preloadGoogle().catch(() => {});
    this.set({ status: drive.currentToken() ? 'idle' : 'needsAuth', lastSyncAt: (base as SyncBase | undefined)?.lastSyncAt });
    if (drive.currentToken()) this.syncNow();
  }

  /** Call after any local data change; syncs a few seconds after edits settle. */
  notifyLocalChange() {
    if (this.state.status === 'off' || this.state.status === 'loading' || !drive.currentToken()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow(), 3000);
  }

  /** Sync if signed in (no popup). Used on app focus. */
  syncIfReady() {
    if (this.state.status !== 'off' && this.state.status !== 'loading' && drive.currentToken()) this.syncNow();
  }

  /** From a click: sign in again if needed, then sync. */
  async reconnect() {
    try {
      await drive.signIn();
      await this.syncNow();
    } catch (e) {
      this.set({ status: 'needsAuth', error: (e as Error).message });
    }
  }

  async syncNow(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    const config = (await db.meta.get('config')) as SyncConfig | undefined;
    if (!config) return this.set({ status: 'off' });
    const token = drive.currentToken();
    if (!token) return this.set({ status: 'needsAuth' });

    this.running = true;
    this.set({ status: 'syncing', error: undefined });
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const base = (await db.meta.get('base')) as SyncBase | undefined;
        const local = await readSnapshot();
        const meta = await drive.findFile(token);

        let remote: BudgetData;
        if (!meta) remote = base?.data ?? local; // file missing (e.g. reset elsewhere): re-upload ours
        else if (base && meta.version === base.version) remote = base.data; // unchanged since our last sync
        else remote = await open<BudgetData>(await drive.download(token, meta.id), config.cryptoKey);

        const { merged, conflicts } = mergeSnapshots(base?.data ?? null, local, remote);
        const fp = fingerprint(merged);

        if (fp !== fingerprint(local) && !(await writeSnapshotIfUnchanged(local, merged))) continue; // edited mid-sync

        let version = meta?.version;
        if (!meta || fp !== fingerprint(remote)) {
          if (meta && (await drive.getMeta(token, meta.id)).version !== meta.version) continue; // another device just uploaded
          const env = await seal(merged, config.cryptoKey, config.kdf);
          version = (meta ? await drive.updateFile(token, meta.id, env) : await drive.createFile(token, env)).version;
        }

        const lastSyncAt = Date.now();
        const newBase: SyncBase = { key: 'base', data: merged, version, lastSyncAt };
        await db.meta.put(newBase);
        this.set({ status: 'idle', lastSyncAt, lastConflicts: conflicts || undefined });
        return;
      }
      throw new Error('Data kept changing during sync. It will try again shortly.');
    } catch (e) {
      if (e instanceof drive.AuthError) this.set({ status: 'needsAuth' });
      else this.set({ status: 'error', error: (e as Error).message });
    } finally {
      this.running = false;
      if (this.rerun) {
        this.rerun = false;
        this.notifyLocalChange();
      }
    }
  }

  /** Step 1 of connecting (from a click): sign in and see whether Drive already has a synced budget. */
  async beginConnect(): Promise<{ remoteExists: boolean }> {
    const token = await drive.signIn();
    const remote = await drive.findFile(token);
    this.pending = { token, remote, env: remote ? await drive.download(token, remote.id) : undefined };
    return { remoteExists: !!remote };
  }

  /**
   * Step 2: unlock (existing) or create (new) the encrypted file with the passphrase.
   * If both sides have data, throws NeedsChoiceError until called again with a choice.
   */
  async finishConnect(passphrase: string, choice?: 'useDrive' | 'useDevice'): Promise<void> {
    const p = this.pending;
    if (!p) throw new Error('Start by connecting Google Drive.');
    const local = await readSnapshot();
    let kdf: Kdf;
    let cryptoKey: CryptoKey;
    let base: SyncBase;

    if (p.remote && p.env) {
      kdf = p.env.kdf;
      cryptoKey = await deriveKey(passphrase, kdf);
      const remoteData = await open<BudgetData>(p.env, cryptoKey); // throws WrongPassphraseError
      let use: 'drive' | 'device' | 'same';
      if (fingerprint(local) === fingerprint(remoteData)) use = 'same';
      else if (choice) use = choice === 'useDrive' ? 'drive' : 'device';
      else if (isEmpty(local)) use = 'drive';
      else if (isEmpty(remoteData)) use = 'device';
      else throw new NeedsChoiceError();

      if (use === 'drive') {
        if (!(await writeSnapshotIfUnchanged(local, remoteData))) throw new Error('Data changed while connecting. Please try again.');
        base = { key: 'base', data: remoteData, version: p.remote.version, lastSyncAt: Date.now() };
      } else if (use === 'device') {
        const meta = await drive.updateFile(p.token, p.remote.id, await seal(local, cryptoKey, kdf));
        base = { key: 'base', data: local, version: meta.version, lastSyncAt: Date.now() };
      } else {
        base = { key: 'base', data: local, version: p.remote.version, lastSyncAt: Date.now() };
      }
    } else {
      kdf = newKdf();
      cryptoKey = await deriveKey(passphrase, kdf);
      const meta = await drive.createFile(p.token, await seal(local, cryptoKey, kdf));
      base = { key: 'base', data: local, version: meta.version, lastSyncAt: Date.now() };
    }

    const config: SyncConfig = { key: 'config', cryptoKey, kdf };
    await db.meta.bulkPut([config, base]);
    this.pending = null;
    this.set({ status: 'idle', lastSyncAt: base.lastSyncAt, error: undefined });
  }

  cancelConnect() {
    this.pending = null;
  }

  /** Stop syncing on this device. Local data and the Drive copy are both kept. */
  async disconnect() {
    await db.meta.bulkDelete(['config', 'base']);
    drive.clearToken();
    this.set({ status: 'off', lastSyncAt: undefined, error: undefined });
  }

  /** Delete the encrypted file from Drive (e.g. forgotten passphrase), then stop syncing here. */
  async deleteRemote() {
    const token = drive.currentToken() ?? (await drive.signIn());
    const meta = await drive.findFile(token);
    if (meta) await drive.deleteFile(token, meta.id);
    await this.disconnect();
  }
}

export const syncEngine = new SyncEngine();

export function useSyncState(): SyncState {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getState);
}

