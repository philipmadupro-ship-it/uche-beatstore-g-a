/**
 * POST /api/org/[orgId]/releases/[releaseId]/marketing/assets — ask the
 * release's artist for material (artwork, photos, bio, video, other). The ask
 * is recorded, and the ONE account that stands for the artist is told through
 * the closed-union kind `asset_requested` (lib/labelos/marketing-asset-notify:
 * a role-`artist` member scoped to that contact, or the owner of an artist org —
 * the identity rule LABEL-71 used for consent; never a party's self-linked
 * account, never the asker). With nobody reachable the request is still
 * recorded and the answer says `notified: false` so the screen can say so.
 * Same write access as the timeline.
 */
import { NextRequest } from 'next/server';
import { MarketingAssetCreateBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { askArtistForAsset } from '@/lib/labelos/marketing-asset-notify';
import { PLAN_LIMITS } from '@/lib/labelos/marketing-plan';
import { MarketingNotReadyError, addAssetRequest } from '@/lib/labelos/marketing-plan-store';
import { askerName } from '@/lib/labelos/tasks-store';
import { readBody } from '@/lib/validate';
import { json, planWriteContext } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.marketing.assets');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await planWriteContext(access, { create: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  const parsed = await readBody(req, MarketingAssetCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    // Who is asked is worked out before the row, so the row records whether anyone could be reached.
    let recipientId: string | null = null;
    let failed = false;
    if (ctx.release.contactId) {
      const asked = await askArtistForAsset(ctx.admin, {
        orgId: ctx.orgId,
        askerId: ctx.access.userId,
        askerName: await askerName(ctx.admin, ctx.orgId, ctx.access.userId),
        releaseId: ctx.release.id,
        releaseTitle: ctx.release.title,
        artistContactId: ctx.release.contactId,
        kind: parsed.data.kind,
      });
      recipientId = asked.recipientId;
      failed = asked.failed;
    }
    const row = await addAssetRequest(ctx.admin, ctx.orgId, ctx.plan.id, ctx.access.userId, { kind: parsed.data.kind, note: parsed.data.note ?? null, recipientId });
    if (row === 'full') return json(409, { error: `A plan holds at most ${PLAN_LIMITS.assetRequests} requests.` });
    await ctx.touch();
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.asset_requested', ctx.subject, { requestId: row.id, kind: row.kind, notified: recipientId !== null });
    return json(201, { request: { id: row.id, kind: row.kind, note: row.note, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at, notified: recipientId !== null }, delivery: failed ? 'failed' : recipientId ? 'notified' : 'nobody_reachable' });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('asset request failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not record the request' });
  }
}
