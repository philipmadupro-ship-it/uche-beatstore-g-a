/**
 * Browser calls to the release routes (LABEL-16 / LABEL-33). Each answers a
 * tagged result instead of throwing, so a screen can show the server's own
 * words ("Say why the release is delivered before it is ready") rather than
 * a generic failure. Nothing here decides anything: every rule is the
 * server's.
 */
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

export const addReleaseItem = (orgId: string, releaseId: string, songId: string) =>
  send<{ item: { id: string } }>(`${base(orgId, releaseId)}/items`, 'POST', { song_track_id: songId });

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
