/**
 * /api/org/[orgId]/finance/statements (LABEL-61, read only).
 *
 *   GET   the statements, with their lines, that the caller may read.
 *         · `finance.read` (never a roster artist): every statement of the org
 *           in their artist scope, drafts included.
 *         · a roster artist (or the owner of an artist org, for its one
 *           artist) who does NOT hold finance.read: only the ISSUED statements
 *           of their OWN payee — the payees whose snapshot artist they stand
 *           for. Never a draft, never another artist's. A party linked to their
 *           account proves nothing.
 *         · everyone else, and an org without the finance module: 404 / 403.
 *
 * Money leaves as strings of minor units. Generating, approving and issuing a
 * statement are LABEL-63's; this route only proves what each reader may see.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { FinanceNotReadyError, listStatements, ownPayeeIds } from '@/lib/labelos/finance-store';
import { statementView } from '@/lib/labelos/finance/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.finance.statements');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance');
  if (!access.ok) return access.res;

  const staff = access.role !== 'artist' && access.capabilities.has('finance.read');
  try {
    let own = false;
    let loaded;
    if (staff) {
      loaded = await listStatements(access.admin, access.orgId, { kind: 'staff', artists: access.artistScope });
    } else {
      const payeeIds = await ownPayeeIds(access.admin, access.orgId, access.userId);
      // Nothing of one's own is an empty list, not an error; someone who is neither staff nor anybody's payee is refused.
      if (payeeIds.length === 0) {
        if (access.role === 'artist') return json(200, { schemaReady: true, own: true, statements: [] });
        return json(403, { error: 'Not allowed' });
      }
      own = true;
      loaded = await listStatements(access.admin, access.orgId, { kind: 'own', payeeIds });
    }
    const byStatement = new Map<string, typeof loaded.lines>();
    for (const l of loaded.lines) byStatement.set(l.statement_id, [...(byStatement.get(l.statement_id) ?? []), l]);
    return json(200, {
      schemaReady: true,
      own,
      statements: loaded.statements.map((s) => statementView(s, byStatement.get(s.id) ?? [], { own })),
    });
  } catch (err) {
    if (err instanceof FinanceNotReadyError) return json(200, { schemaReady: false, own: false, statements: [] });
    log.error('statement list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the statements' });
  }
}
