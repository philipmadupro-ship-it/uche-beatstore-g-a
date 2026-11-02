/**
 * POST /api/org/[orgId]/releases/[releaseId]/press/links — add a link to the
 * kit (https only). `pr.write`. Event `press_kit.updated`: op + link id.
 */
import { NextRequest } from 'next/server';
import { PressLinkCreateBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { PRESS_LIMITS, cleanHttpsUrl } from '@/lib/labelos/press';
import { PressNotReadyError, addLink, touchKit, type KitRow } from '@/lib/labelos/press-store';
import { readBody } from '@/lib/validate';
import { json, pressWriteContext } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press.links');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  const parsed = await readBody(req, PressLinkCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const url = cleanHttpsUrl(parsed.data.url);
  if (!url) return json(400, { error: 'Use a full https:// address' });
  try {
    const kit = (await ctx.ensure()) as KitRow;
    const row = await addLink(ctx.admin, ctx.orgId, kit.id, { label: parsed.data.label, url });
    if (row === 'full') return json(409, { error: `A kit holds at most ${PRESS_LIMITS.links} links.` });
    await touchKit(ctx.admin, ctx.orgId, kit.id);
    await recordEvent(ctx.admin, ctx.actor, 'press_kit.updated', ctx.subject, { op: 'link_added', linkId: row.id });
    return json(201, { link: { id: row.id, label: row.label, url: row.url } });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press link create failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not add the link' });
  }
}
