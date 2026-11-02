/**
 * PATCH | DELETE /api/org/[orgId]/releases/[releaseId]/marketing/items/[itemId]
 * — change (title, day, phase, done) or remove one milestone. Same access as
 * adding one. The event names the changed FIELDS, never their values.
 */
import { NextRequest } from 'next/server';
import { MarketingItemPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { MarketingNotReadyError, patchItem, removeItem } from '@/lib/labelos/marketing-plan-store';
import { readBody } from '@/lib/validate';
import { badId, json, planWriteContext } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.marketing.items');
type Params = { params: Promise<{ orgId: string; releaseId: string; itemId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, releaseId, itemId } = await params;
  const made = await planWriteContext(orgId, releaseId, { create: false });
  if (!made.ok) return made.res;
  if (badId(itemId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  const parsed = await readBody(req, MarketingItemPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const out = await patchItem(ctx.admin, ctx.orgId, ctx.plan.id, itemId.toLowerCase(), parsed.data);
    if (!out) return json(404, { error: 'Not found' });
    await ctx.touch();
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.item_changed', ctx.subject, { op: 'updated', itemId: out.row.id, fields: out.fields });
    const r = out.row;
    return json(200, { item: { id: r.id, phase: r.phase, title: r.title, dueOn: r.due_on, doneAt: r.done_at } });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('milestone update failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not change the milestone' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId, itemId } = await params;
  const made = await planWriteContext(orgId, releaseId, { create: false });
  if (!made.ok) return made.res;
  if (badId(itemId)) return json(404, { error: 'Not found' });
  const { ctx } = made;
  try {
    if (!(await removeItem(ctx.admin, ctx.orgId, ctx.plan.id, itemId.toLowerCase()))) return json(404, { error: 'Not found' });
    await ctx.touch();
    await recordEvent(ctx.admin, ctx.actor, 'marketing_plan.item_changed', ctx.subject, { op: 'removed', itemId: itemId.toLowerCase() });
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof MarketingNotReadyError) return json(503, { error: err.message });
    log.error('milestone delete failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not remove the milestone' });
  }
}
