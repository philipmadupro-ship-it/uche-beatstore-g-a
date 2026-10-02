/**
 * Browser-side helper for the buyer's magic-link session.
 *
 * The buyer's identity = the HMAC-signed token from /store/account/[token].
 * When the buyer lands on that page we persist the token to localStorage
 * so subsequent /store visits know who they are and can sync favourites
 * + log listening history to Supabase (migration 060).
 *
 * No token = anonymous mode. Every helper degrades gracefully: returns
 * null / no-ops. Callers don't have to check.
 *
 * The token expires after 24h (see lib/buyer-tokens.ts). When that
 * happens the API returns 400 'Invalid or expired link' and we clear
 * the stored token so the next visit goes back to anonymous mode.
 *
 * A signed-in buyer (/store/account/me sets the persistent marker) is
 * identified by their Supabase session instead, which does not share the
 * token's 24h lifetime. When both exist the session wins.
 */

import type { BuyerLibraryShape } from '@/lib/store/buyer-library';

const KEY = 'antigravity-buyer-token';
const SESSION_MODE_KEY = 'antigravity-buyer-session-mode';

export function getBuyerToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setBuyerToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* noop */
  }
}

export function clearBuyerToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

export function setPersistentBuyerSession(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) window.localStorage.setItem(SESSION_MODE_KEY, '1');
    else window.localStorage.removeItem(SESSION_MODE_KEY);
  } catch {
    /* noop */
  }
}

function hasPersistentBuyerSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SESSION_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Make the device's "a buyer is signed in" marker agree with the Supabase
 * session cookie, which is the real source of truth.
 *
 * The marker was only ever written by /store/account/me, so it was lost
 * whenever localStorage was (Safari purges it after a week of no visits; a
 * cleared site-data prompt) or cleared by one transient 400, while the auth
 * cookie lived on. The buyer then looked signed in everywhere except to
 * `buyerIdentityQuery`: hearts were dropped with "No buyer session" and the
 * account's hearts never came back. Called from the store layout on every
 * navigation, before the wishlist syncs. Returns true when it changed.
 */
export function reconcileSessionMarker(hasSession: boolean): boolean {
  if (hasPersistentBuyerSession() === hasSession) return false;
  setPersistentBuyerSession(hasSession);
  return true;
}

interface BuyerActionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Generic mutation dispatcher. Swallows network errors so a flaky
 * connection never breaks playback. Returns { ok: false } when there's
 * no token or the API rejects.
 */
/**
 * Which identity /api/store/me should key this device's writes on.
 *
 * The signed-in account wins over a legacy delivery token. A token is
 * whatever email the last delivery link was for; the session is who is
 * actually signed in. Preferring the token meant a buyer who opened an
 * order link for one address and then signed in as another kept writing
 * hearts and plays into the first address's library.
 */
export function buyerIdentityQuery(): { query: string; mode: 'session' | 'token' } | null {
  if (hasPersistentBuyerSession()) return { query: 'session=1', mode: 'session' };
  const token = getBuyerToken();
  if (token) return { query: `token=${encodeURIComponent(token)}`, mode: 'token' };
  return null;
}

/** Sign-out: forget every buyer identity this device holds. */
export function clearBuyerIdentity(): void {
  clearBuyerToken();
  setPersistentBuyerSession(false);
}

async function dispatch(action: Record<string, unknown>): Promise<BuyerActionResult> {
  const identity = buyerIdentityQuery();
  if (!identity) return { ok: false, error: 'No buyer session' };
  try {
    const res = await fetch(`/api/store/me?${identity.query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (res.status === 400) {
      // Token expired or invalid → wipe so future calls are no-ops.
      if (identity.mode === 'token') clearBuyerToken();
      else setPersistentBuyerSession(false);
      return { ok: false, error: 'Token expired' };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'Network error' };
  }
}

export const logPlay = (track_id: string) => dispatch({ action: 'log_play', track_id });
/** Idempotent: sends the state the heart now shows, never a flip. */
export const setFavorite = (track_id: string, favorited: boolean) =>
  dispatch({ action: 'set_favorite', track_id, favorited });
export const createPlaylist = (name: string) => dispatch({ action: 'create_playlist', name });
export const addToPlaylist = (playlist_id: string, track_id: string) =>
  dispatch({ action: 'add_to_playlist', playlist_id, track_id });
export const removeFromPlaylist = (playlist_id: string, track_id: string) =>
  dispatch({ action: 'remove_from_playlist', playlist_id, track_id });
export const deletePlaylist = (playlist_id: string) =>
  dispatch({ action: 'delete_playlist', playlist_id });

/**
 * The buyer's whole library (history, favourites, playlists) for whichever
 * identity this device holds, or null when there is none or the read
 * failed. Null means "unknown", never "empty".
 */
export async function fetchBuyerLibrary(): Promise<BuyerLibraryShape | null> {
  const identity = buyerIdentityQuery();
  if (!identity) return null;
  try {
    const res = await fetch(`/api/store/me?${identity.query}`);
    if (res.status === 400) {
      if (identity.mode === 'token') clearBuyerToken();
      else setPersistentBuyerSession(false);
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BuyerLibraryShape>;
    if (!Array.isArray(data.favorites) || !Array.isArray(data.playlists)) return null;
    return data as BuyerLibraryShape;
  } catch {
    return null;
  }
}

/**
 * The account's favourite track ids, or null when there is no buyer
 * identity on this device or the read failed. Null means "unknown", never
 * "none" — callers must not treat it as an empty account.
 */
export async function fetchBuyerFavoriteIds(): Promise<string[] | null> {
  const library = await fetchBuyerLibrary();
  if (!library) return null;
  return library.favorites
    .map((f) => f.track_id)
    .filter((id): id is string => typeof id === 'string');
}
