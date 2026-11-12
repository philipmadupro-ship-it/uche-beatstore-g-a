/**
 * The browser's side of creative direction (LABEL-26): load an artist's
 * direction and references, save the document, add / edit / remove a
 * reference, and ask the pickers. Each answers in words a toast can show.
 * Pure of React.
 */
import type { ArtistDirection, ReferenceKind, ReferenceView } from './direction';
import type { FileChoice, TrackChoice } from './direction-store';

export type DirectionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export type DirectionPayload = {
  schemaReady: boolean;
  direction: ArtistDirection;
  updatedAt: string | null;
  references: ReferenceView[];
  restrictedReferences: number;
  permissions: { write: boolean; internal: boolean };
};

async function request<T>(url: string, init: RequestInit | undefined, failed: string, pick: (body: Record<string, unknown>) => T): Promise<DirectionResult<T>> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof body.error === 'string' ? body.error : failed };
    return { ok: true, ...pick(body) };
  } catch {
    return { ok: false, error: failed };
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const base = (orgId: string, contactId: string) => `/api/org/${orgId}/artists/${contactId}`;

export function fetchDirection(orgId: string, contactId: string) {
  return request(`${base(orgId, contactId)}/direction`, undefined, 'Could not load the direction.', (b) => ({ data: b as unknown as DirectionPayload }));
}

export function saveDirection(orgId: string, contactId: string, direction: ArtistDirection) {
  return request(
    `${base(orgId, contactId)}/direction`,
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ direction }) },
    'Could not save the direction.',
    (b) => ({ direction: (b.direction ?? {}) as ArtistDirection, updatedAt: (b.updatedAt as string | null) ?? null }),
  );
}

export type NewReferenceInput = {
  kind: ReferenceKind;
  title?: string;
  note?: string;
  url?: string;
  trackId?: string;
  assetId?: string;
  internal?: boolean;
};

/** The request body: only the keys the kind uses (the server refuses a stray pointer). */
export function referenceBody(i: NewReferenceInput): Record<string, unknown> {
  const body: Record<string, unknown> = { kind: i.kind, visibility: i.internal ? 'internal' : 'artist' };
  if (i.title?.trim()) body.title = i.title.trim();
  if (i.note?.trim()) body.note = i.note.trim();
  if (i.kind === 'link') body.url = i.url?.trim() ?? '';
  if (i.kind === 'track') body.track_id = i.trackId;
  if (i.kind === 'file') body.asset_id = i.assetId;
  return body;
}

export function addReference(orgId: string, contactId: string, input: NewReferenceInput) {
  return request(
    `${base(orgId, contactId)}/references`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(referenceBody(input)) },
    'Could not add the reference.',
    (b) => ({ reference: b.reference as ReferenceView | null }),
  );
}

export function patchReference(orgId: string, contactId: string, id: string, patch: { title?: string; note?: string | null; visibility?: 'artist' | 'internal' }) {
  return request(
    `${base(orgId, contactId)}/references/${id}`,
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) },
    'Could not update the reference.',
    (b) => ({ reference: b.reference as ReferenceView | null }),
  );
}

export function removeReference(orgId: string, contactId: string, id: string) {
  return request(`${base(orgId, contactId)}/references/${id}`, { method: 'DELETE' }, 'Could not remove the reference.', () => ({}));
}

export function fetchTrackChoices(orgId: string, contactId: string, q: string) {
  return request(`${base(orgId, contactId)}/references/choices?kind=track&q=${encodeURIComponent(q)}`, undefined, 'Could not search the tracks.', (b) => ({
    tracks: (Array.isArray(b.tracks) ? b.tracks : []) as TrackChoice[],
  }));
}

export function fetchFileChoices(orgId: string, contactId: string) {
  return request(`${base(orgId, contactId)}/references/choices?kind=file`, undefined, 'Could not load the files.', (b) => ({
    files: (Array.isArray(b.files) ? b.files : []) as FileChoice[],
  }));
}
