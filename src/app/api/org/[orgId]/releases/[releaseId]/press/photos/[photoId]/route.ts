/**
 * PATCH | DELETE /api/org/[orgId]/releases/[releaseId]/press/photos/[photoId]
 * — change a photo's caption / pre-embargo mark, or remove it. `pr.write`.
 * The event names the changed FIELDS, never the caption.
 */
import { NextRequest } from 'next/server';
import { PressPhotoPatchBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { PressNotReadyError, patchPhoto, removePhoto, touchKit, type KitRow } from '@/lib/labelos/press-store';
import { readBody } from '@/lib/validate';
import { badId, json, pressWriteContext } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press.photos');
type Params = { params: Promise<{ orgId: string; releaseId: string; photoId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, releaseId, photoId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: false });
  if (!made.ok) return made.res;
  if (badId(photoId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  const parsed = await readBody(req, PressPhotoPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const kit = (await ctx.ensure()) as KitRow;
    const out = await patchPhoto(ctx.admin, ctx.orgId, kit.id, photoId.toLowerCase(), parsed.data);
    if (!out) return json(404, { error: 'Not found' });
    await touchKit(ctx.admin, ctx.orgId, kit.id);
    await recordEvent(ctx.admin, ctx.actor, 'press_kit.updated', ctx.subject, { op: 'photo_updated', photoId: out.row.id, fields: out.fields });
    return json(200, { photo: { id: out.row.id, caption: out.row.caption, preEmbargo: out.row.pre_embargo } });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press photo update failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not change the photo' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId, photoId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: false });
  if (!made.ok) return made.res;
  if (badId(photoId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  try {
    const kit = (await ctx.ensure()) as KitRow;
    if (!(await removePhoto(ctx.admin, ctx.orgId, kit.id, photoId.toLowerCase()))) return json(404, { error: 'Not found' });
    await touchKit(ctx.admin, ctx.orgId, kit.id);
    await recordEvent(ctx.admin, ctx.actor, 'press_kit.updated', ctx.subject, { op: 'photo_removed', photoId: photoId.toLowerCase() });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press photo delete failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not remove the photo' });
  }
}
