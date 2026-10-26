/**
 * End-to-end encryption for the sync file. Data is gzipped, then encrypted with AES-GCM using a
 * key derived from the user's passphrase (PBKDF2-SHA256). Only the envelope below is uploaded,
 * so the storage provider never sees budget data or the passphrase.
 */

export interface Kdf {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  /** base64 */
  salt: string;
}

export interface Envelope {
  format: 'budget-sync';
  v: 1;
  kdf: Kdf;
  /** base64 AES-GCM nonce */
  iv: string;
  /** base64 ciphertext of gzipped JSON */
  ct: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("That passphrase doesn't unlock the synced data.");
  }
}

/** OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 600_000;
const AAD = new TextEncoder().encode('budget-sync/v1');

export function newKdf(iterations = DEFAULT_ITERATIONS): Kdf {
  return { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(crypto.getRandomValues(new Uint8Array(16))) };
}

/** Derive a non-extractable AES key. It can be stored in IndexedDB but never read back out. */
export async function deriveKey(passphrase: string, kdf: Kdf): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: kdf.hash, salt: fromB64(kdf.salt), iterations: kdf.iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(value: unknown, key: CryptoKey, kdf: Kdf): Promise<Envelope> {
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(value)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plain);
  return { format: 'budget-sync', v: 1, kdf, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function open<T = unknown>(env: Envelope, key: CryptoKey): Promise<T> {
  if (env?.format !== 'budget-sync' || env.v !== 1) throw new Error('The synced file is not in a format this app understands.');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv), additionalData: AAD }, key, fromB64(env.ct));
  } catch {
    // AES-GCM authentication fails for a wrong key (or a tampered file).
    throw new WrongPassphraseError();
  }
  return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(plain))));
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
