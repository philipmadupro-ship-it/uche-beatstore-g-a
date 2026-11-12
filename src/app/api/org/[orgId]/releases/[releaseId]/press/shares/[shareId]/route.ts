/**
 * DELETE /api/org/[orgId]/releases/[releaseId]/press/shares/[shareId] — revoke
 * a share link. The page behind it answers 404 from the next request. `pr.write`.
 * `press_kit.share_revoked` is audit class (migration 199).
 */
import { NextRequest } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { PressNotReadyError, revokeShareLegacy, type KitRow } from '@/lib/labelos/press-store';
import { badId, json, pressWriteContext } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press.shares');
type Params = { params: Promise<{ orgId: string; releaseId: string; shareId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId, shareId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: false });
  if (!made.ok) return made.res;
  if (badId(shareId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  try {
    const kit = (await ctx.ensure()) as KitRow;
    // Audit class (migration 199): the revoke and `press_kit.share_revoked` commit in one function.
    const rpc = await auditRpc(ctx.admin, 'pressShareRevoke', {
      p_org: ctx.orgId, p_actor: ctx.access.userId, p_kit: kit.id, p_share: shareId.toLowerCase(),
      p_ctx: { artist_id: ctx.subject.artistId, project_id: ctx.subject.projectId }, p_payload: {},
    });
    if (!rpc.error) {
      const out = rpc.data as { share?: { id: string }; error?: string } | null;
      if (out?.error === 'not_found' || !out?.share) return json(404, { error: 'Not found' });
    } else if (isMissingAuditRpc(rpc.error)) {
      const row = await revokeShareLegacy(ctx.admin, ctx.orgId, kit.id, shareId.toLowerCase(), ctx.access.userId, { actor: ctx.actor, subject: ctx.subject });
      if (!row) return json(404, { error: 'Not found' });
    } else {
      throw new Error(`share revoke: ${rpc.error.message}`);
    }
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press share revoke failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not revoke the link' });
  }
}
