/**
 * GET | PUT /api/org/[orgId]/releases/[releaseId]/press — the release's press
 * kit (LABEL-66): bio, headline, embargo, links, photos, share links and, for
 * a caller who may use it, the outreach tracker. Authorised like the release
 * (`catalog.read`, artist scope) in an org licensed for `pr`, then `pr.read`
 * (GET) / `pr.write` (PUT); see ./access.ts.
 *
 * `kit: null` = nothing written yet (a kit is made by the first write).
 * Migration 184 missing: `{ schemaReady: false }`. PUT's event names the
 * changed FIELDS, never their text.
 */
import { NextRequest } from 'next/server';
import { PressKitPutBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { mayUseOutreach, mayWritePress } from '@/lib/labelos/press';
import { PressNotReadyError, findKit, loadOwnerView, updateKit, type KitRow } from '@/lib/labelos/press-store';
import { readBody } from '@/lib/validate';
import { json, pressReadAccess, pressWriteContext } from './access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const authorised = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!authorised.ok) return authorised.res;
  const read = await pressReadAccess(authorised);
  if (!read.ok) return read.res;
  const { access } = read;
  if (!read.ready) return json(200, { schemaReady: false });
  try {
    const rel = await access.admin.from('releases').select('id, project_id').eq('org_id', access.orgId).eq('id', access.object.id).maybeSingle();
    if (rel.error || !rel.data) return json(404, { error: 'Not found' });
    const kit = await findKit(access.admin, access.orgId, access.object.id);
    const view = await loadOwnerView(access.admin, access.orgId, { id: access.object.id, projectId: (rel.data as { project_id: string | null }).project_id }, kit, {
      caps: access.capabilities, withOutreach: mayUseOutreach(access.artistScope), now: new Date(),
    });
    return json(200, { ...view, me: { canWrite: mayWritePress(access.capabilities, access.role), canUseOutreach: mayUseOutreach(access.artistScope) } });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(200, { schemaReady: false });
    log.error('press read failed', { orgId: access.orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the press kit' });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  const parsed = await readBody(req, PressKitPutBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const kit = (await ctx.ensure()) as KitRow;
    const { row, fields } = await updateKit(ctx.admin, ctx.orgId, kit.id, parsed.data);
    await recordEvent(ctx.admin, ctx.actor, 'press_kit.updated', ctx.subject, { op: 'details', fields });
    return json(200, { kit: { headline: row.headline, bio: row.bio, preEmbargoNote: row.pre_embargo_note, embargoAt: row.embargo_at } });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press update failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the press kit' });
  }
}
