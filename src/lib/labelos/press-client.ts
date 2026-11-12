/**
 * The browser's side of the press kit (LABEL-66): every call answers in words a
 * toast can show. Pure of React; the server decides everything.
 */
import type { OwnerPressView } from './press-store';

export type PressResult<T> = ({ ok: true } & T) | { ok: false; error: string };
export type PressState = { schemaReady: false } | (OwnerPressView & { me: { canWrite: boolean; canUseOutreach: boolean } });

const JSON_HEADERS = { 'content-type': 'application/json' };
const base = (orgId: string, releaseId: string) => `/api/org/${orgId}/releases/${releaseId}/press`;
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: JSON_HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function call<T>(url: string, init: RequestInit | undefined, failed: string, pick: (b: Record<string, unknown>) => T): Promise<PressResult<T>> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof body.error === 'string' ? body.error : failed };
    return { ok: true, ...pick(body) };
  } catch {
    return { ok: false, error: failed };
  }
}

export const fetchPress = (orgId: string, releaseId: string) =>
  call(base(orgId, releaseId), { cache: 'no-store' }, 'Could not load the press kit.', (b) => ({ state: b as unknown as PressState }));
export const saveKit = (orgId: string, releaseId: string, body: { headline?: string | null; bio?: string | null; pre_embargo_note?: string | null; embargo_at?: string | null }) =>
  call(base(orgId, releaseId), send('PUT', body), 'Could not save the press kit.', () => ({}));
export const addKitLink = (orgId: string, releaseId: string, body: { label: string; url: string }) =>
  call(`${base(orgId, releaseId)}/links`, send('POST', body), 'Could not add the link.', () => ({}));
export const removeKitLink = (orgId: string, releaseId: string, id: string) =>
  call(`${base(orgId, releaseId)}/links/${id}`, send('DELETE'), 'Could not remove the link.', () => ({}));
export const addKitPhoto = (orgId: string, releaseId: string, body: { asset_id: string; pre_embargo?: boolean }) =>
  call(`${base(orgId, releaseId)}/photos`, send('POST', body), 'Could not add the photo.', () => ({}));
export const patchKitPhoto = (orgId: string, releaseId: string, id: string, body: { caption?: string | null; pre_embargo?: boolean }) =>
  call(`${base(orgId, releaseId)}/photos/${id}`, send('PATCH', body), 'Could not change the photo.', () => ({}));
export const removeKitPhoto = (orgId: string, releaseId: string, id: string) =>
  call(`${base(orgId, releaseId)}/photos/${id}`, send('DELETE'), 'Could not remove the photo.', () => ({}));
export const createKitShare = (orgId: string, releaseId: string, body: { label: string; expires_at?: string | null }) =>
  call(`${base(orgId, releaseId)}/shares`, send('POST', body), 'Could not make the link.', (b) => ({ path: typeof b.path === 'string' ? b.path : '' }));
export const revokeKitShare = (orgId: string, releaseId: string, id: string) =>
  call(`${base(orgId, releaseId)}/shares/${id}`, send('DELETE'), 'Could not revoke the link.', () => ({}));
export const addOutreachRow = (orgId: string, releaseId: string, body: { contact_id: string; sent?: boolean }) =>
  call(`${base(orgId, releaseId)}/outreach`, send('POST', body), 'Could not add the contact.', () => ({}));
export const patchOutreachRow = (orgId: string, releaseId: string, id: string, body: { sent?: boolean; opened?: boolean; replied?: boolean; coverage_url?: string | null }) =>
  call(`${base(orgId, releaseId)}/outreach/${id}`, send('PATCH', body), 'Could not change the contact.', () => ({}));
export const removeOutreachRow = (orgId: string, releaseId: string, id: string) =>
  call(`${base(orgId, releaseId)}/outreach/${id}`, send('DELETE'), 'Could not remove the contact.', () => ({}));
