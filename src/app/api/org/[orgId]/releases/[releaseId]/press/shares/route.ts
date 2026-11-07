/**
 * POST /api/org/[orgId]/releases/[releaseId]/press/shares — make a share link
 * for the kit (a label for who it is for, an optional expiry). The opaque
 * token is in THIS response only and is never stored: only its SHA-256 is.
 * `pr.write`. A cancelled/withdrawn release is refused. Event
 * `press_kit.shared`: share id + whether it expires, never the token.
 */
import { NextRequest } from 'next/server';
import { PressShareCreateBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { PRESS_LIMITS, releasePublishable } from '@/lib/labelos/press';
import { PressNotReadyError, createShare, touchKit, type KitRow } from '@/lib/labelos/press-store';
import { readBody } from '@/lib/validate';
import { json, pressWriteContext } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press.shares');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  if (!releasePublishable(ctx.release.state)) return json(409, { error: 'A withdrawn release cannot be shared.' });
  const parsed = await readBody(req, PressShareCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  if (parsed.data.expires_at && Date.parse(parsed.data.expires_at) <= Date.now()) return json(400, { error: 'The expiry must be in the future.' });
  try {
    const kit = (await ctx.ensure()) as KitRow;
    const out = await createShare(ctx.admin, ctx.orgId, kit.id, ctx.access.userId, parsed.data);
    if (out === 'full') return json(409, { error: `A kit holds at most ${PRESS_LIMITS.shares} live links. Revoke one first.` });
    await touchKit(ctx.admin, ctx.orgId, kit.id);
    await recordEvent(ctx.admin, ctx.actor, 'press_kit.shared', ctx.subject, { shareId: out.share.id, expires: !!out.share.expires_at });
    return json(201, { share: { id: out.share.id, label: out.share.label, expiresAt: out.share.expires_at, createdAt: out.share.created_at }, path: `/press/${out.token}` });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press share create failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not make the link' });
  }
}
