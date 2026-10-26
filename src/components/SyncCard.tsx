import { useEffect, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '../config';
import { isPersisted, requestPersist } from '../lib/persist';
import { preloadGoogle } from '../sync/drive';
import { NeedsChoiceError, syncEngine, useSyncState } from '../sync/engine';
import { Modal } from './common';

export function timeAgo(ts?: number): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Date(ts).toLocaleString();
}

export function SyncCard() {
  const sync = useSyncState();
  const [step, setStep] = useState<'none' | 'passphrase' | 'choice'>('none');
  const [remoteExists, setRemoteExists] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (GOOGLE_CLIENT_ID) preloadGoogle().catch(() => {});
  }, []);

  const close = () => {
    setStep('none');
    setPass('');
    setPass2('');
    setError('');
    syncEngine.cancelConnect();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const { remoteExists } = await syncEngine.beginConnect();
      setRemoteExists(remoteExists);
      setStep('passphrase');
    });

  const submitPassphrase = (choice?: 'useDrive' | 'useDevice') =>
    run(async () => {
      if (!remoteExists && !choice) {
        if (pass.length < 10) throw new Error('Use at least 10 characters. A few random words works well.');
        if (pass !== pass2) throw new Error("The two passphrases don't match.");
      }
      try {
        await syncEngine.finishConnect(pass, choice);
        close();
      } catch (e) {
        if (e instanceof NeedsChoiceError) setStep('choice');
        else throw e;
      }
    });

  if (!GOOGLE_CLIENT_ID) {
    return (
      <div className="card stack">
        <h2>Sync with Google Drive</h2>
        <p className="muted" style={{ margin: 0 }}>
          Sync isn't set up for this site yet: it needs a Google OAuth client ID (<code>VITE_GOOGLE_CLIENT_ID</code>).
        </p>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h2>Sync with Google Drive</h2>
      <p className="muted" style={{ margin: 0 }}>
        Keeps your budget the same on every device. Data is encrypted with your passphrase before it leaves this browser, and stored in a hidden app folder in your
        Google Drive. Google can't read it, and this app can't see your other Drive files.
      </p>

      {sync.status === 'off' || sync.status === 'loading' ? (
        <div>
          <button className="btn primary" disabled={busy || sync.status === 'loading'} onClick={connect}>
            {busy ? 'Connecting…' : 'Connect Google Drive'}
          </button>
        </div>
      ) : (
        <>
          <div>
            <div className="stat">
              <span className="muted">Status</span>
              <span>
                {sync.status === 'syncing'
                  ? 'Syncing…'
                  : sync.status === 'needsAuth'
                    ? 'Paused: sign in to Google again'
                    : sync.status === 'error'
                      ? 'Error'
                      : 'On'}
              </span>
            </div>
            <div className="stat">
              <span className="muted">Last synced</span>
              <span>{timeAgo(sync.lastSyncAt)}</span>
            </div>
          </div>
          {sync.error && <div className="error">{sync.error}</div>}
          {sync.lastConflicts ? (
            <div className="muted" style={{ fontSize: 13 }}>
              {sync.lastConflicts} item(s) were edited on two devices at once; this device's version was kept.
            </div>
          ) : null}
          <div className="row">
            {sync.status === 'needsAuth' ? (
              <button className="btn primary" onClick={() => syncEngine.reconnect()}>
                Sign in &amp; sync
              </button>
            ) : (
              <button className="btn" disabled={sync.status === 'syncing'} onClick={() => syncEngine.syncNow()}>
                Sync now
              </button>
            )}
            <button
              className="btn"
              onClick={() => {
                if (confirm('Stop syncing on this device? Your data stays here and in Google Drive.')) syncEngine.disconnect();
              }}
            >
              Stop syncing here
            </button>
            <button
              className="btn danger"
              onClick={() =>
                run(async () => {
                  if (
                    confirm(
                      'Delete the encrypted copy from Google Drive? Use this if you forgot your passphrase. Data on your devices is kept; reconnect afterwards to start fresh with a new passphrase.',
                    )
                  )
                    await syncEngine.deleteRemote();
                })
              }
            >
              Delete Drive copy
            </button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Google sign-in lasts about an hour per visit. When it expires, use the ☁ button in the sidebar to continue syncing.
          </p>
        </>
      )}
      {error && step === 'none' && <div className="error">{error}</div>}

      {step === 'passphrase' && (
        <Modal
          title={remoteExists ? 'Unlock your synced budget' : 'Create a sync passphrase'}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy || !pass} onClick={() => submitPassphrase()}>
                {busy ? 'Working…' : remoteExists ? 'Unlock' : 'Encrypt & upload'}
              </button>
            </>
          }
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              submitPassphrase();
            }}
          >
            {remoteExists ? (
              <p style={{ margin: 0 }}>Google Drive already has an encrypted budget. Enter the passphrase you created on your other device.</p>
            ) : (
              <p style={{ margin: 0 }}>
                This passphrase encrypts your budget. You'll enter it once on each device. <strong>It can't be recovered</strong>, so store it in your password
                manager.
              </p>
            )}
            <label>
              Passphrase
              <input type="password" autoFocus autoComplete={remoteExists ? 'current-password' : 'new-password'} value={pass} onChange={(e) => setPass(e.target.value)} />
            </label>
            {!remoteExists && (
              <label>
                Confirm passphrase
                <input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
              </label>
            )}
            {error && <div className="error">{error}</div>}
            <button type="submit" hidden />
          </form>
        </Modal>
      )}

      {step === 'choice' && (
        <Modal title="Which budget should this device use?" onClose={close}>
          <p style={{ margin: 0 }}>Both this device and Google Drive already have budget data, and they're different. Pick one to keep. The other will be replaced.</p>
          <div className="stack">
            <button className="btn primary" disabled={busy} onClick={() => submitPassphrase('useDrive')}>
              Use Google Drive's budget (replace this device)
            </button>
            <button className="btn" disabled={busy} onClick={() => submitPassphrase('useDevice')}>
              Use this device's budget (replace Google Drive)
            </button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Not sure? Cancel, download a backup from this page first, then connect again.
          </p>
          {error && <div className="error">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

export function StorageCard() {
  const [persisted, setPersisted] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    isPersisted().then(setPersisted);
  }, []);
  return (
    <div className="card stack">
      <h2>Storage on this device</h2>
      {persisted === true && <div className="muted">✓ Your browser will keep this budget's data. It won't clear it automatically to free up space.</div>}
      {persisted === null && <div className="muted">This browser doesn't support persistent storage.</div>}
      {persisted === false && (
        <>
          <div className="muted">Your browser may delete this site's data when storage runs low.</div>
          <div>
            <button className="btn" onClick={async () => setPersisted(await requestPersist())}>
              Keep my data on this device
            </button>
          </div>
        </>
      )}
      <div className="muted" style={{ fontSize: 13 }}>
        Firefox: also make sure <em>Delete cookies and site data when Firefox is closed</em> is off, or add this site as an exception. Private windows never keep
        data.
      </div>
    </div>
  );
}
