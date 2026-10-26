/**
 * Google OAuth client ID for Drive sync (Google Cloud Console -> APIs & Services -> Credentials).
 * Client IDs aren't secret; they're visible to anyone who loads the page. Set it in `.env`.
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
