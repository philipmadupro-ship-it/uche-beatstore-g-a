/**
 * PATCH | DELETE /api/org/[orgId]/releases/[releaseId]/press/outreach/[outreachId]
 * — move a press contact along the tracker (sent / opened / replied, each
 * stamped once; clearing a step clears the later ones), set or clear the
 * coverage URL (https only), or take the contact off the release.
 * `pr.write` + the whole-org view. The events name stages and fields, never a
 * URL or a name.
 */
import { NextRequest } from 'next/server';
import { PressOutreachPatchBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { cleanHttpsUrl, outreachStage } from '@/lib/labelos/press';
import { PressNotReadyError, patchOutreach, removeOutreach } from '@/lib/labelos/press-store';
import { readBody } from '@/lib/validate';
import { badId, json, pressWriteContext } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press.outreach');
type Params = { params: Promise<{ orgId: string; releaseId: string; outreachId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, releaseId, outreachId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: false, outreach: true });
  if (!made.ok) return made.res;
  if (badId(outreachId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  const parsed = await readBody(req, PressOutreachPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const coverage = parsed.data.coverage_url === undefined ? undefined : parsed.data.coverage_url === null ? null : cleanHttpsUrl(parsed.data.coverage_url);
  if (coverage === null && parsed.data.coverage_url !== null) return json(400, { error: 'Use a full https:// address' });
  try {
    const out = await patchOutreach(ctx.admin, ctx.orgId, ctx.release.id, outreachId.toLowerCase(), { ...parsed.data, coverage_url: coverage }, new Date());
    if (!out) return json(404, { error: 'Not found' });
    if (out.fields.length > 0) await recordEvent(ctx.admin, ctx.actor, 'press_outreach.updated', ctx.subject, { outreachId: out.row.id, fields: out.fields, stage: outreachStage(out.row) });
    return json(200, { outreach: { id: out.row.id, stage: outreachStage(out.row), coverageUrl: out.row.coverage_url } });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press outreach update failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not change the contact' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId, outreachId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: false, outreach: true });
  if (!made.ok) return made.res;
  if (badId(outreachId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  try {
    if (!(await removeOutreach(ctx.admin, ctx.orgId, ctx.release.id, outreachId.toLowerCase()))) return json(404, { error: 'Not found' });
    await recordEvent(ctx.admin, ctx.actor, 'press_outreach.removed', ctx.subject, { outreachId: outreachId.toLowerCase() });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press outreach delete failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not remove the contact' });
  }
}
