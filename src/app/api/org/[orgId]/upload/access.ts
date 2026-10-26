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
 *
 * External project members (LABEL-21, 06 §2.6) upload through the same
 * wrapper, narrowly: a NEW VERSION of a song that sits in a project they are
 * a live contributor / editor of (`planExternalUpload`), and it lands in
 * THAT project only — never the song's other projects, never a new song for
 * an artist (they have no artist scope), never master / instrumental
 * material. The session routes admit them while they hold an upload-capable
 * membership in the org; the session itself is still bound to this org's key
 * and to its starter. D3: the track carries `created_by` = them, so it stays
 * in the project, credited to them, if they leave.
 */
import { NextResponse } from 'next/server';
import { requireExternalTrack, requireObjectAccess, type OrgAccessOk } from '@/lib/auth/org-access';
import type { OwnershipFail } from '@/lib/auth/ownership';
import { isOrgUploadKey, type OrgUploadIntent } from '@/lib/labelos/org-upload';
import { planExternalUpload } from '@/lib/labelos/project-members';
import type { UploadSession } from '@/lib/storage/upload-sessions';
import type { AuthorizeUploadSession } from '@/lib/upload/part-route';

const fail = (status: number, error: string): OwnershipFail => ({ ok: false, res: NextResponse.json({ error }, { status }) });

/** What the upload routes need of whoever is uploading: an org member, or an external member (`external` set). */
export type UploadActor = Pick<OrgAccessOk, 'orgId' | 'userId' | 'admin'>;
export type IntentAccess = {
  ok: true;
  access: UploadActor;
  /** Set for an external member: the projects the new version may be added to, and no others. */
  external: { projectIds: string[] } | null;
};

export async function authorizeOrgUploadIntent(orgId: string, intent: OrgUploadIntent): Promise<IntentAccess | OwnershipFail> {
  if (intent.kind === 'song') {
    const a = await requireObjectAccess({ table: 'contacts', id: intent.contactId, cap: 'catalog.write', orgId });
    return a.ok ? { ok: true, access: a, external: null } : a;
  }
  const a = await requireObjectAccess({ table: 'tracks', id: intent.songId, cap: 'catalog.write', orgId });
  if (!a.ok) {
    // Not an org member who may write here: a live external member of a project the song sits in?
    if (a.res.status === 401) return a;
    return (await authorizeExternalVersion(orgId, intent)) ?? a;
  }
  const { data, error } = await a.admin.from('tracks').select('type, song_stage').eq('id', intent.songId).eq('org_id', a.orgId).maybeSingle();
  if (error) return fail(500, 'Could not check the song');
  if (!data) return fail(404, 'Not found');
  // A song has a stage; a song-type master or demo linked to one has none, and is material, not a song.
  const song = data as { type: string | null; song_stage: string | null };
  if (song.type !== 'song' || song.song_stage === null) return fail(409, 'Material can only be added to a song');
  return { ok: true, access: a, external: null };
}

/**
 * The external path of a `link` intent. Null = not an external member of a
 * project this song sits in (the caller answers with the ORG failure, so
 * nothing about external membership is revealed to a stranger). A member who
 * IS one gets the planner's answer: 403 for a role that cannot upload or a
 * kind they may not add, else the projects the version lands in.
 */
async function authorizeExternalVersion(orgId: string, intent: Extract<OrgUploadIntent, { kind: 'link' }>): Promise<IntentAccess | OwnershipFail | null> {
  const ext = await requireExternalTrack({ trackId: intent.songId, orgId });
  if (!ext.ok) return ext.res.status >= 500 ? ext : null;
  const { data, error } = await ext.admin.from('tracks').select('type, song_stage').eq('id', intent.songId).eq('org_id', ext.orgId).maybeSingle();
  if (error) return fail(500, 'Could not check the song');
  const song = data as { type: string | null; song_stage: string | null } | null;
  if (!song) return null;
  if (song.type !== 'song' || song.song_stage === null) return fail(409, 'Material can only be added to a song');
  const plan = planExternalUpload(ext.memberships, ext.memberships.map((m) => m.projectId), intent.relation);
  if (!plan.ok) return fail(plan.status, plan.error);
  return { ok: true, access: ext, external: { projectIds: plan.projectIds } };
}

/**
 * The org upload session gate: given the caller's org access (the route
 * checked `catalog.write` first), may they touch this session? For the
 * shared part handlers and the other session routes.
 */
export function orgSessionAuthorizer(access: UploadActor): AuthorizeUploadSession {
  return async (session: UploadSession) => {
    if (!isOrgUploadKey(session.key, access.orgId)) return fail(404, 'Upload session not found');
    // The session's own identity (who started it), not a tenancy filter.
    if (!session.userId || session.userId !== access.userId) return fail(404, 'Upload session not found');
    return { ok: true };
  };
}
