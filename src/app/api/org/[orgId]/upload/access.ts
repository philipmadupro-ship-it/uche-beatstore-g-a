/**
 * Who may upload what into an org (LABEL-14), shared by the
 * `/api/org/[orgId]/upload/*` routes. Not a route itself.
 *
 *  - The INTENT (lib/labelos/org-upload): a new song for a roster artist
 *    needs `catalog.write` on that artist (requireObjectAccess on the
 *    contact: another org's or an out-of-scope artist is 404); material for
 *    a song needs `catalog.write` on the song (same, through its projects),
 *    and the target must be a song. Checked at init, before a byte moves,
 *    and again at complete.
 *  - The SESSION: an org route first checks the caller still holds
 *    `catalog.write` in the org (403 otherwise), then only touches a session
 *    whose object key was minted for this org (`orgs/<org>/tracks/…`) by
 *    this caller. Anything else is 404, as for another user's producer
 *    session.
 */
import { NextResponse } from 'next/server';
import { requireObjectAccess, type OrgAccessOk } from '@/lib/auth/org-access';
import type { OwnershipFail } from '@/lib/auth/ownership';
import { isOrgUploadKey, type OrgUploadIntent } from '@/lib/labelos/org-upload';
import type { UploadSession } from '@/lib/storage/upload-sessions';
import type { AuthorizeUploadSession } from '@/lib/upload/part-route';

const fail = (status: number, error: string): OwnershipFail => ({ ok: false, res: NextResponse.json({ error }, { status }) });

export type IntentAccess = { ok: true; access: OrgAccessOk };

export async function authorizeOrgUploadIntent(orgId: string, intent: OrgUploadIntent): Promise<IntentAccess | OwnershipFail> {
  if (intent.kind === 'song') {
    const a = await requireObjectAccess({ table: 'contacts', id: intent.contactId, cap: 'catalog.write', orgId });
    return a.ok ? { ok: true, access: a } : a;
  }
  const a = await requireObjectAccess({ table: 'tracks', id: intent.songId, cap: 'catalog.write', orgId });
  if (!a.ok) return a;
  const { data, error } = await a.admin.from('tracks').select('type, song_stage').eq('id', intent.songId).eq('org_id', a.orgId).maybeSingle();
  if (error) return fail(500, 'Could not check the song');
  if (!data) return fail(404, 'Not found');
  // A song has a stage; a song-type master or demo linked to one has none, and is material, not a song.
  const song = data as { type: string | null; song_stage: string | null };
  if (song.type !== 'song' || song.song_stage === null) return fail(409, 'Material can only be added to a song');
  return { ok: true, access: a };
}

/**
 * The org upload session gate: given the caller's org access (the route
 * checked `catalog.write` first), may they touch this session? For the
 * shared part handlers and the other session routes.
 */
export function orgSessionAuthorizer(access: OrgAccessOk): AuthorizeUploadSession {
  return async (session: UploadSession) => {
    if (!isOrgUploadKey(session.key, access.orgId)) return fail(404, 'Upload session not found');
    // The session's own identity (who started it), not a tenancy filter.
    if (!session.userId || session.userId !== access.userId) return fail(404, 'Upload session not found');
    return { ok: true };
  };
}
