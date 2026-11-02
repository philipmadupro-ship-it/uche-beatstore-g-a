/**
 * DELETE /api/org/[orgId]/releases/[releaseId]/press/shares/[shareId] — revoke
 * a share link. The page behind it answers 404 from the next request. `pr.write`.
 */
import { NextRequest } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { PressNotReadyError, revokeShare, type KitRow } from '@/lib/labelos/press-store';
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
    const row = await revokeShare(ctx.admin, ctx.orgId, kit.id, shareId.toLowerCase(), ctx.access.userId);
    if (!row) return json(404, { error: 'Not found' });
    await recordEvent(ctx.admin, ctx.actor, 'press_kit.share_revoked', ctx.subject, { shareId: row.id });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press share revoke failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not revoke the link' });
  }
}
