import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { syncEngine, useSyncState } from '../sync/engine';
import { timeAgo } from './SyncCard';

/** Small sync status line in the sidebar. Turns into a button when sign-in is needed. */
export function SyncChip() {
  const sync = useSyncState();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (sync.status === 'off' || sync.status === 'loading') return null;
  if (sync.status === 'needsAuth') {
    return (
      <button className="sync-chip action" onClick={() => syncEngine.reconnect()} title="Google sign-in expired. Click to continue syncing.">
        ☁ Sync paused · Sign in
      </button>
    );
  }
  if (sync.status === 'error') {
    return (
      <Link className="sync-chip error" to="/settings" title={sync.error}>
        ☁ Sync problem · Details
      </Link>
    );
  }
  return (
    <button className="sync-chip" onClick={() => syncEngine.syncNow()} title="Sync now">
      ☁ {sync.status === 'syncing' ? 'Syncing…' : `Synced ${timeAgo(sync.lastSyncAt)}`}
    </button>
  );
}
