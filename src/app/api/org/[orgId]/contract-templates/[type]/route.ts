/**
 * PUT /api/org/[orgId]/contract-templates/[type] (LABEL-57): save the next
 * version of the org's OWN template for a contract type. `contracts.write`.
 * Versions are rows that are never rewritten, so a contract made from an
 * earlier version keeps its words. Saving words identical to the current ones
 * saves nothing (`unchanged`). The event names the type, the new version and
 * the ids of the clauses that changed — never the text.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractTemplateSaveBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { cleanTemplateEdit, changedClauseIds, sameClauses } from '@/lib/labelos/contracts/template-edit';
import { platformSource, platformTemplate } from '@/lib/labelos/contracts/templates';
import { isTemplateType } from '@/lib/labelos/contracts/types';
import { CONTRACTS_NOT_READY, ContractsNotReadyError, insertTemplateVersion, latestOrgTemplate } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contract-templates.type');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type Params = { params: Promise<{ orgId: string; type: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, type } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  if (!isTemplateType(type)) return json(404, { error: 'Unknown contract type' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgContractTemplateSaveBodySchema);
  if (!parsed.ok) return parsed.res;
  const edit = cleanTemplateEdit(parsed.data);
  if (!edit.ok) return json(400, { error: edit.error });

  const { admin, orgId: org } = access;
  try {
    const latest = await latestOrgTemplate(admin, org, type);
    const current = latest ? { name: latest.name, clauses: latest.clauses } : { name: platformTemplate(type).name, clauses: [...platformTemplate(type).clauses] };
    if (current.name === edit.name && sameClauses(current.clauses, edit.clauses)) return json(200, { unchanged: true, version: latest?.version ?? null });

    const saved = await insertTemplateVersion(admin, org, access.userId, {
      type,
      name: edit.name,
      clauses: edit.clauses,
      basedOn: latest ? `org:${latest.version}` : platformSource(type),
    });
    if ('conflict' in saved) return json(409, { error: 'Someone saved this template first. Reload to see their version.' });

    await recordEvent(
      admin,
      { orgId: org, userId: access.userId },
      'contract_template.saved',
      { type: 'contract_template', id: saved.row.id },
      { type, version: saved.row.version, based_on: saved.row.based_on, renamed: current.name !== edit.name, changed_clauses: changedClauseIds(current.clauses, edit.clauses) },
    );
    return json(201, { template: { id: saved.row.id, type, version: saved.row.version, name: saved.row.name, clauses: saved.row.clauses, based_on: saved.row.based_on, created_at: saved.row.created_at } });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    log.error('template save failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not save the template' });
  }
}
