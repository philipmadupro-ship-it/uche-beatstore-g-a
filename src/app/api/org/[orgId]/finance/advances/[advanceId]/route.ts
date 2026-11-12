/**
 * PATCH …/finance/advances/[advanceId] (LABEL-64). `finance.write`.
 *
 * Body: any of `kind`, `amount_minor`, `paid_on` (null clears), `note` (null clears). Kind, amount
 * and date change only while NOTHING references the advance — no recoupment, no statement line —
 * else 409 `advance_referenced` (the same rows LABEL-62/63 freeze; the database refuses it too).
 * The note stays editable on a live advance. A void advance is final. Audited (advance.updated;
 * the event names the changed fields, never an amount).
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { OrgAdvancePatchBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { advanceView } from '@/lib/labelos/finance/advances';
import { assertAdvancesSchema, readAdvance } from '@/lib/labelos/finance-dashboard-store';
import { json } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.advance');

type Params = { params: Promise<{ orgId: string; advanceId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, advanceId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  if (!isUUID(advanceId)) return json(404, { error: 'Advance not found' });
  const body = await readBody(req, OrgAdvancePatchBodySchema);
  if (!body.ok) return body.res;
  try {
    await assertAdvancesSchema(access.admin);
    // 404 outside the org and outside a scoped member's artists.
    const before = await readAdvance(access.admin, access.orgId, advanceId, access.artistScope);
    if (!before) return json(404, { error: 'Advance not found' });
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'advanceUpdate', {
        p_org: access.orgId,
        p_actor: access.userId,
        p_advance: before.id,
        p_patch: body.data,
        p_payload: {},
      }),
      'advance update',
    );
    if (out.error === 'advance_referenced') {
      return json(409, { error: 'Money has already been recouped from this advance, or a statement uses it, so its kind, amount and date are fixed. The note can still change.', code: 'advance_referenced' });
    }
    if (out.error === 'advance_void') return json(409, { error: 'This advance is void.', code: 'advance_void' });
    if (out.error === 'no_change') return json(200, { updated: false });
    if (out.error === 'refused') return json(400, { error: 'The change was refused.' });
    if (out.error) return json(404, { error: 'Advance not found' });
    const after = await readAdvance(access.admin, access.orgId, before.id, access.artistScope);
    return json(200, { updated: true, advance: after ? advanceView(after, after.facts) : null });
  } catch (err) {
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY + ' Advances also need migration 182.' });
    log.error('advance update failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not change the advance' });
  }
}
