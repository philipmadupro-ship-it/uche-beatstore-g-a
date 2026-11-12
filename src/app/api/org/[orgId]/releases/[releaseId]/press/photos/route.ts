/**
 * POST /api/org/[orgId]/releases/[releaseId]/press/photos — add a photo to the
 * kit. The file must be an unrestricted artwork/photo raster image of the
 * release's OWN project that the caller may open (the same rule as the release
 * artwork); anything else is 400. `pr.write`. Event `press_kit.updated`: op +
 * photo id, never a caption.
 */
import { NextRequest } from 'next/server';
import { PressPhotoCreateBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { PRESS_LIMITS } from '@/lib/labelos/press';
import { PressNotReadyError, addPhoto, touchKit, type KitRow } from '@/lib/labelos/press-store';
import { readBody } from '@/lib/validate';
import { json, pressWriteContext } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press.photos');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  if (!ctx.release.projectId) return json(400, { error: 'This release has no project to take photos from.' });
  const parsed = await readBody(req, PressPhotoCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const kit = (await ctx.ensure()) as KitRow;
    const out = await addPhoto(ctx.admin, ctx.orgId, kit.id, ctx.release.projectId, ctx.access.capabilities, { ...parsed.data, asset_id: parsed.data.asset_id.toLowerCase() });
    if (out === 'not_allowed') return json(400, { error: 'Choose an unrestricted photo or artwork image from this release’s project.' });
    if (out === 'duplicate') return json(409, { error: 'That photo is already in the kit.' });
    if (out === 'full') return json(409, { error: `A kit holds at most ${PRESS_LIMITS.photos} photos.` });
    await touchKit(ctx.admin, ctx.orgId, kit.id);
    await recordEvent(ctx.admin, ctx.actor, 'press_kit.updated', ctx.subject, { op: 'photo_added', photoId: out.id, preEmbargo: out.pre_embargo });
    return json(201, { photo: { id: out.id, caption: out.caption, preEmbargo: out.pre_embargo } });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press photo add failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not add the photo' });
  }
}
