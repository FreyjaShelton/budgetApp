/**
 * Persistent storage: without it, browsers may delete this site's data when the disk is
 * nearly full. Firefox asks the user; Chrome decides on its own.
 */

/** true/false, or null if the browser doesn't support asking. */
export async function isPersisted(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
