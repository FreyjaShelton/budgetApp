import { useEffect, useState } from 'react';
import { isPersisted, requestPersist } from '../lib/persist';

const DISMISS_KEY = 'budget.persistDismissed';

/** Asks once (per device) to keep the budget data from being cleared automatically. */
export function PersistBanner({ hasData }: { hasData: boolean }) {
  const [state, setState] = useState<'hidden' | 'ask' | 'denied'>('hidden');

  useEffect(() => {
    if (!hasData) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (dismissed) return;
    isPersisted().then((p) => p === false && setState('ask'));
  }, [hasData]);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setState('hidden');
  };

  if (state === 'hidden') return null;
  return (
    <div className="banner warn" style={{ margin: '12px 24px 0' }}>
      {state === 'ask' ? (
        <>
          <span>
            <strong>Keep your budget safe on this device.</strong> Without permission, your browser may delete this site's data when storage runs low.
          </span>
          <button
            className="btn small primary"
            onClick={async () => {
              if (await requestPersist()) setState('hidden');
              else setState('denied');
            }}
          >
            Keep my data
          </button>
          <button className="btn small ghost" onClick={dismiss}>
            Not now
          </button>
        </>
      ) : (
        <>
          <span>
            The browser didn't allow it. In Firefox, click the icon left of the address bar → <em>Permissions</em> → allow <em>Store data in persistent storage</em>.
          </span>
          <button className="btn small ghost" onClick={dismiss}>
            OK
          </button>
        </>
      )}
    </div>
  );
}
