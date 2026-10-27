/**
 * GET /api/org/[orgId]/contract-templates (LABEL-57): every contract type's
 * template — the platform default (in code, with its version) and the org's
 * own saved versions. `contracts.read` in an org licensed for contracts
 * (404 otherwise). A roster artist never reaches it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { fieldKeysOf } from '@/lib/labelos/contracts/render';
import { platformTemplates, platformSource } from '@/lib/labelos/contracts/templates';
import { ContractsNotReadyError, listOrgTemplates } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contract-templates');
const NO_STORE = { 'Cache-Control': 'no-store' };

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Contracts need Supabase.' }, { status: 501, headers: NO_STORE });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.read');
  if (!access.ok) return access.res;

  const platform = platformTemplates().map((t) => ({
    type: t.type,
    name: t.name,
    version: t.version,
    source: platformSource(t.type),
    summary: t.summary,
    slots: t.slots,
    clauses: t.clauses,
    suggested_fields: t.suggestedFields,
    field_keys: fieldKeysOf(t.clauses),
  }));
  const canWrite = access.capabilities.has('contracts.write');
  try {
    const rows = await listOrgTemplates(access.admin, access.orgId);
    return NextResponse.json(
      {
        schemaReady: true,
        canWrite,
        platform,
        org: rows.map((r) => ({ id: r.id, type: r.type, version: r.version, name: r.name, clauses: r.clauses, based_on: r.based_on, created_at: r.created_at, field_keys: fieldKeysOf(r.clauses) })),
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return NextResponse.json({ schemaReady: false, canWrite: false, platform, org: [] }, { headers: NO_STORE });
    log.error('template list failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the templates' }, { status: 500, headers: NO_STORE });
  }
}
