/** DELETE /api/org/[orgId]/releases/[releaseId]/press/links/[linkId] — remove one link. `pr.write`. */
import { NextRequest } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { PressNotReadyError, removeLink, touchKit, type KitRow } from '@/lib/labelos/press-store';
import { badId, json, pressWriteContext } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press.links');
type Params = { params: Promise<{ orgId: string; releaseId: string; linkId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId, linkId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: false });
  if (!made.ok) return made.res;
  if (badId(linkId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  try {
    const kit = (await ctx.ensure()) as KitRow;
    if (!(await removeLink(ctx.admin, ctx.orgId, kit.id, linkId.toLowerCase()))) return json(404, { error: 'Not found' });
    await touchKit(ctx.admin, ctx.orgId, kit.id);
    await recordEvent(ctx.admin, ctx.actor, 'press_kit.updated', ctx.subject, { op: 'link_removed', linkId: linkId.toLowerCase() });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press link delete failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not remove the link' });
  }
}
