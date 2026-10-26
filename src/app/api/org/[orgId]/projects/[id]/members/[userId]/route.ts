/**
 * PATCH / DELETE /api/org/[orgId]/projects/[id]/members/[userId] (LABEL-21) —
 * change or end one external member's access. Capability `share.external` on
 * the project (requireObjectAccess); an external member is 404 here.
 *
 *  PATCH  — role, `allow_downloads`, `expires_at` (null clears it). Only what
 *           changes is written; `project.member_changed` is an audit event
 *           written by the database function (migration 148) in the same
 *           transaction as the change.
 *  DELETE — remove them. Access ends on their very next request (membership
 *           is read live). What they uploaded stays in the project, credited
 *           to them (D3: it carries `tracks.created_by`, not the membership).
 *           `project.member_removed` is audit-class and atomic with the delete.
 */
import { NextRequest, NextResponse } from 'next/server';
import { projectMemberRows, requireObjectAccess } from '@/lib/auth/org-access';
import { OrgProjectMemberPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { PROJECT_MEMBERS_NOT_READY, auditRpc, isMissingProjectMembers } from '@/lib/labelos/audit-rpc';
import { planProjectMemberChange } from '@/lib/labelos/project-members';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.members.user');

type Params = { params: Promise<{ orgId: string; id: string; userId: string }> };
type Current = { role: string; allow_downloads: boolean | null; expires_at: string | null };

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, id, userId } = await params;
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'share.external', orgId });
  if (!access.ok) return access.res;
  if (!isUUID(userId)) return notFound();

  const parsed = await readBody(req, OrgProjectMemberPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  const { admin } = access;
  try {
    const { data, error } = await projectMemberRows(admin, access, id).one(userId, 'role, allow_downloads, expires_at').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return notFound();
    const plan = planProjectMemberChange(data as unknown as Current, {
      role: parsed.data.role,
      allowDownloads: parsed.data.allow_downloads,
      expiresAt: parsed.data.expires_at,
    });
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

    const { data: result, error: rpcErr } = await auditRpc(admin, 'projectMemberUpdate', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_project: id,
      p_user: userId,
      p_patch: plan.patch,
      p_payload: { project_id: id, changes: JSON.parse(JSON.stringify(plan.payload)) },
    });
    if (isMissingProjectMembers(rpcErr)) return NextResponse.json({ error: PROJECT_MEMBERS_NOT_READY }, { status: 503 });
    if (rpcErr) throw new Error(rpcErr.message);
    if (result?.error === 'not_found') return notFound();
    return NextResponse.json({ member: result?.member ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('change project member failed', { orgId: access.orgId, projectId: id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not change the member' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, id, userId } = await params;
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'share.external', orgId });
  if (!access.ok) return access.res;
  if (!isUUID(userId)) return notFound();

  const { admin } = access;
  try {
    const { data, error } = await projectMemberRows(admin, access, id).one(userId, 'role').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return notFound();
    const { data: result, error: rpcErr } = await auditRpc(admin, 'projectMemberRemove', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_project: id,
      p_user: userId,
      p_payload: { project_id: id, role: (data as unknown as { role: string }).role },
    });
    if (isMissingProjectMembers(rpcErr)) return NextResponse.json({ error: PROJECT_MEMBERS_NOT_READY }, { status: 503 });
    if (rpcErr) throw new Error(rpcErr.message);
    if (result?.error === 'not_found') return notFound();
    return NextResponse.json({ removed: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('remove project member failed', { orgId: access.orgId, projectId: id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not remove the member' }, { status: 500 });
  }
}
