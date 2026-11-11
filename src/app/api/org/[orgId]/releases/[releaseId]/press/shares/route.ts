/**
 * POST /api/org/[orgId]/releases/[releaseId]/press/shares — make a share link
 * for the kit (a label for who it is for, an optional expiry). The opaque
 * token is in THIS response only and is never stored: only its SHA-256 is.
 * `pr.write`. A cancelled/withdrawn release is refused. Event
 * `press_kit.shared` is audit class (migration 199): the link and the event
 * commit in one function through `auditRpc`; share id + whether it expires, never the token.
 */
import { NextRequest } from 'next/server';
import { PressShareCreateBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { PRESS_LIMITS, releasePublishable } from '@/lib/labelos/press';
import { PressNotReadyError, createShareLegacy, mintShareToken, touchKit, type KitRow, type ShareRow } from '@/lib/labelos/press-store';
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
    const { token, tokenHash } = mintShareToken();
    const ev = { actor: ctx.actor, subject: ctx.subject };
    const rpc = await auditRpc(ctx.admin, 'pressShareCreate', {
      p_org: ctx.orgId, p_actor: ctx.access.userId, p_kit: kit.id, p_token_hash: tokenHash, p_label: parsed.data.label,
      p_expires_at: parsed.data.expires_at ?? null, p_max: PRESS_LIMITS.shares,
      p_ctx: { artist_id: ctx.subject.artistId, project_id: ctx.subject.projectId }, p_payload: {},
    });
    let share: ShareRow;
    if (!rpc.error) {
      const out = rpc.data as { share?: ShareRow; error?: string } | null;
      if (out?.error === 'full') return json(409, { error: `A kit holds at most ${PRESS_LIMITS.shares} live links. Revoke one first.` });
      if (out?.error === 'not_found' || !out?.share) return json(404, { error: 'Not found' });
      share = out.share;
    } else if (isMissingAuditRpc(rpc.error)) {
      // Migration 199 is not applied: change, then event, undone if the event cannot be written.
      const made = await createShareLegacy(ctx.admin, ctx.orgId, kit.id, ctx.access.userId, parsed.data, tokenHash, ev);
      if (made === 'full') return json(409, { error: `A kit holds at most ${PRESS_LIMITS.shares} live links. Revoke one first.` });
      share = made;
    } else {
      throw new Error(`share create: ${rpc.error.message}`);
    }
    await touchKit(ctx.admin, ctx.orgId, kit.id);
    return json(201, { share: { id: share.id, label: share.label, expiresAt: share.expires_at, createdAt: share.created_at }, path: `/press/${token}` });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press share create failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not make the link' });
  }
}
