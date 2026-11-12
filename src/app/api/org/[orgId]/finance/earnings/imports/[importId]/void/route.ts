/**
 * POST …/finance/earnings/imports/[importId]/void (LABEL-63, from LABEL-62's notes). `finance.write`,
 * whole-organization only.
 *
 * Voids an imported file. Allowed ONLY while no APPROVED or ISSUED statement includes one of its
 * lines (409 `statement_exists`: void that statement first). It releases the import's allocations
 * and recoupments — so the advances they recouped have that much left again — and discards the
 * DRAFT statements that included them, all in one transaction with its audit event. The lines stay,
 * marked void with their import, and leave the needs-review queue.
 */
import { NextRequest } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { auditRpc, type AuditRpcAdmin } from '@/lib/labelos/audit-rpc';
import { EARNINGS_NOT_READY, EarningsNotReadyError, readImport } from '@/lib/labelos/earnings-store';
import { json } from '@/lib/labelos/statement-route';
import { rpcAnswer, STATEMENTS_NOT_READY, StatementsNotReadyError } from '@/lib/labelos/statement-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.earnings.import.void');

type Params = { params: Promise<{ orgId: string; importId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, importId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  if (access.artistScope !== null) return json(403, { error: 'Voiding an import needs finance access to the whole organization.' });
  if (!isUUID(importId)) return json(404, { error: 'Import not found' });
  try {
    const imp = await readImport(access.admin, access.orgId, importId);
    if (!imp) return json(404, { error: 'Import not found' });
    const out = rpcAnswer(
      await auditRpc(access.admin as unknown as AuditRpcAdmin, 'earningsImportVoid', { p_org: access.orgId, p_actor: access.userId, p_import: imp.id, p_payload: {} }),
      'import void',
    );
    if (out.error === 'period_closed') return json(409, { error: 'This file belongs to a closed period. Ask an owner to reopen the period first.', code: 'period_closed' });
    if (out.error === 'statement_exists') return json(409, { error: 'An approved or issued statement includes this file’s earnings. Void that statement first.', code: 'statement_exists' });
    if (out.error === 'already_void') return json(409, { error: 'This file is already void.', code: 'already_void' });
    if (out.error) return json(404, { error: 'Import not found' });
    return json(200, { voided: true, allocations: out.data.allocations, recoupments: out.data.recoupments, drafts_discarded: out.data.drafts });
  } catch (err) {
    if (err instanceof EarningsNotReadyError) return json(503, { error: EARNINGS_NOT_READY });
    if (err instanceof StatementsNotReadyError) return json(503, { error: STATEMENTS_NOT_READY });
    log.error('import void failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not void the import' });
  }
}
