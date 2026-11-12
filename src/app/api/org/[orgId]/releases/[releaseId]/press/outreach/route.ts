/**
 * POST /api/org/[orgId]/releases/[releaseId]/press/outreach — put a press
 * contact (an org contact with role `press`) on the release's tracker.
 * `pr.write` + the whole-org view. `opened` is recorded by hand: nothing here
 * sends mail. Event `press_outreach.added`: ids only, never a name or address.
 */
import { NextRequest } from 'next/server';
import { PressOutreachCreateBodySchema } from '@/lib/contracts';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { outreachStage } from '@/lib/labelos/press';
import { PressNotReadyError, addOutreach } from '@/lib/labelos/press-store';
import { readBody } from '@/lib/validate';
import { json, pressWriteContext } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.press.outreach');
type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const made = await pressWriteContext(access, { create: false, outreach: true });
  if (!made.ok) return made.res;
  const { ctx } = made;
  const parsed = await readBody(req, PressOutreachCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  try {
    const out = await addOutreach(ctx.admin, ctx.orgId, ctx.release.id, ctx.access.userId, { ...parsed.data, contact_id: parsed.data.contact_id.toLowerCase() }, new Date());
    if (out === 'not_press_contact') return json(400, { error: 'Choose a contact in this organization whose role is press.' });
    if (out === 'duplicate') return json(409, { error: 'That contact is already on this release.' });
    await recordEvent(ctx.admin, ctx.actor, 'press_outreach.added', ctx.subject, { outreachId: out.id, contactId: out.contact_id, stage: outreachStage(out) });
    return json(201, { outreach: { id: out.id, contactId: out.contact_id, stage: outreachStage(out) } });
  } catch (err) {
    if (err instanceof PressNotReadyError) return json(503, { error: err.message });
    log.error('press outreach add failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not add the contact' });
  }
}
