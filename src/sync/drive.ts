import { GOOGLE_CLIENT_ID } from '../config';
import type { Envelope } from './crypto';

/**
 * Minimal Google Drive client for one file in the hidden per-app folder ("appDataFolder").
 * The drive.appdata scope can't see or touch any of the user's other Drive files.
 * Sign-in uses Google Identity Services' token flow: short-lived (1 hour) access tokens,
 * no client secret, nothing stored server-side.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'budget-sync.json';
const TOKEN_KEY = 'budget.gdriveToken';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export class AuthError extends Error {}

export interface RemoteMeta {
  id: string;
  /** Increments on every change; used to detect concurrent writes. */
  version: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number | string;
  error?: string;
  error_description?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: { type: string; message?: string }) => void;
          }): { requestAccessToken(overrides?: { prompt?: string }): void };
        };
      };
    };
  }
}

let gis: Promise<void> | null = null;

/** Load Google's sign-in script ahead of time so the sign-in popup opens straight from a click. */
export function preloadGoogle(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  gis ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gis = null;
      reject(new Error("Couldn't load Google sign-in. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return gis;
}

/** A still-valid access token from earlier in this browser session, if any. */
export function currentToken(): string | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null');
    if (t && t.exp > Date.now() + 60_000) return t.token;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Opens Google's consent popup. Must be called from a click handler. */
export async function signIn(): Promise<string> {
  await preloadGoogle();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        try {
          sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, exp: Date.now() + Number(resp.expires_in) * 1000 }));
        } catch {
          /* token just won't survive a reload */
        }
        resolve(resp.access_token);
      },
      error_callback: (err) =>
        reject(
          new Error(
            err.type === 'popup_closed'
              ? 'The Google sign-in window was closed.'
              : err.type === 'popup_failed_to_open'
                ? 'Your browser blocked the Google sign-in popup. Allow popups for this site and try again.'
                : err.message || 'Google sign-in failed.',
          ),
        ),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function api(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (r.status === 401) {
    clearToken();
    throw new AuthError('Google sign-in expired.');
  }
  if (!r.ok) throw new Error(`Google Drive error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

export async function findFile(token: string): Promise<RemoteMeta | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await api(token, `${API}?spaces=appDataFolder&q=${q}&fields=files(id,version)&orderBy=modifiedTime desc&pageSize=1`);
  const j = (await r.json()) as { files?: RemoteMeta[] };
  return j.files?.[0] ?? null;
}

export async function getMeta(token: string, id: string): Promise<RemoteMeta> {
  return (await api(token, `${API}/${id}?fields=id,version`)).json();
}

export async function download(token: string, id: string): Promise<Envelope> {
  return (await api(token, `${API}/${id}?alt=media`)).json();
}

export async function createFile(token: string, content: Envelope): Promise<RemoteMeta> {
  const boundary = `budget${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
  const meta = { name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(content)}\r\n--${boundary}--`;
  const r = await api(token, `${UPLOAD}?uploadType=multipart&fields=id,version`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return r.json();
}

export async function updateFile(token: string, id: string, content: Envelope): Promise<RemoteMeta> {
  const r = await api(token, `${UPLOAD}/${id}?uploadType=media&fields=id,version`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content),
  });
  return r.json();
}

export async function deleteFile(token: string, id: string): Promise<void> {
  await api(token, `${API}/${id}`, { method: 'DELETE' });
}
