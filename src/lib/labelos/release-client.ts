/**
 * Browser calls to the release routes (LABEL-16 / LABEL-33). Each answers a
 * tagged result instead of throwing, so a screen can show the server's own
 * words ("Say why the release is delivered before it is ready") rather than
 * a generic failure. Nothing here decides anything: every rule is the
 * server's.
 */
import type { MasterCandidate } from './master-choice';

export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; field?: string; body?: Record<string, unknown> };

async function send<T extends object>(url: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}`,
        ...(typeof json.field === 'string' ? { field: json.field } : {}),
        body: json,
      };
    }
    return { ok: true, ...(json as T) };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

const base = (orgId: string, releaseId: string) => `/api/org/${orgId}/releases/${releaseId}`;

/** `masterId` omitted = the song's own mix; the chooser (`master-choice`) decides what is sent. */
export const addReleaseItem = (orgId: string, releaseId: string, songId: string, masterId?: string) =>
  send<{ item: { id: string } }>(`${base(orgId, releaseId)}/items`, 'POST', { song_track_id: songId, ...(masterId ? { master_track_id: masterId } : {}) });

export type MasterOptions = { songId: string; options: MasterCandidate[]; defaultId: string | null; ask: boolean };

export const getMasterOptions = (orgId: string, releaseId: string, songId: string) =>
  send<MasterOptions>(`${base(orgId, releaseId)}/master-options?song_track_id=${encodeURIComponent(songId)}`, 'GET');

export const setItemMaster = (orgId: string, releaseId: string, itemId: string, masterId: string) =>
  send<object>(`${base(orgId, releaseId)}/items/${itemId}`, 'PATCH', { master_track_id: masterId });

export const setItemExplicit = (orgId: string, releaseId: string, itemId: string, explicit: boolean) =>
  send<object>(`${base(orgId, releaseId)}/items/${itemId}`, 'PATCH', { explicit });

/** One or more release fields; the server's words (and the field at fault) come back on a refusal. */
export const patchRelease = (orgId: string, releaseId: string, body: Record<string, unknown>) => send<object>(base(orgId, releaseId), 'PATCH', body);

/** "New release": a draft. Without a project the route makes one for it. */
export const createRelease = (orgId: string, body: Record<string, unknown>) =>
  send<{ release: { id: string } }>(`/api/org/${orgId}/releases`, 'POST', body);

export const reorderReleaseItems = (orgId: string, releaseId: string, order: string[]) =>
  send<object>(`${base(orgId, releaseId)}/items`, 'PATCH', { order });

export const removeReleaseItem = (orgId: string, releaseId: string, itemId: string) =>
  send<object>(`${base(orgId, releaseId)}/items/${itemId}`, 'DELETE');

export const setReleaseArtwork = (orgId: string, releaseId: string, assetId: string | null) =>
  send<object>(base(orgId, releaseId), 'PATCH', { artwork_asset_id: assetId });

export const cancelRelease = (orgId: string, releaseId: string) => send<object>(base(orgId, releaseId), 'PATCH', { state: 'cancelled' });
export const reopenRelease = (orgId: string, releaseId: string) => send<object>(base(orgId, releaseId), 'PATCH', { state: 'draft' });

export type DeliverInput = { distributor: string; deliveredOn?: string; override?: boolean; overrideNote?: string };

export const deliverRelease = (orgId: string, releaseId: string, input: DeliverInput) =>
  send<{ override: boolean }>(`${base(orgId, releaseId)}/deliver`, 'POST', {
    distributor: input.distributor,
    ...(input.deliveredOn ? { delivered_on: input.deliveredOn } : {}),
    ...(input.override ? { override: true, override_note: input.overrideNote ?? '' } : {}),
  });

/* ── The store bridge (LABEL-42) ─────────────────────────────────────── */

export type StoreState = {
  listed: boolean;
  listedAt: string | null;
  playback: 'preview' | 'full';
  /** Whether the playback choice can be stored (migration 158). */
  playbackChoice: boolean;
  canList: { ok: true } | { ok: false; error: string; field: string | null };
  unlist: { askToDeletePreviews: boolean };
};

export const getReleaseStore = (orgId: string, releaseId: string) => send<StoreState>(`${base(orgId, releaseId)}/store`, 'GET');

export const listReleaseOnStore = (orgId: string, releaseId: string, playback: 'preview' | 'full') =>
  send<{ listed: true; playback: string; promoted: number }>(`${base(orgId, releaseId)}/store`, 'PUT', { listed: true, playback });

export const unlistReleaseFromStore = (orgId: string, releaseId: string, deletePreviews: boolean) =>
  send<{ listed: false; previewsDeleted: boolean }>(`${base(orgId, releaseId)}/store`, 'PUT', { listed: false, delete_previews: deletePreviews });

export type ImportInput = { title: string; contactId: string; type: string; releaseDate: string; upc?: string };

/** "Already released": a release that skips every gate. Owner / admin only (the server decides). */
export const importReleasedRelease = (orgId: string, input: ImportInput) =>
  send<{ release: { id: string } }>(`/api/org/${orgId}/releases`, 'POST', {
    title: input.title,
    contact_id: input.contactId,
    type: input.type,
    release_date: input.releaseDate,
    ...(input.upc ? { upc: input.upc } : {}),
    imported_released: true,
  });
