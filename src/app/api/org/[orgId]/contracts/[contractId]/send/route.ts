/**
 * POST /api/org/[orgId]/contracts/[contractId]/send — "Send for signature"
 * (LABEL-58). `contracts.write`, inside the caller's artist scope. Body
 * `{ version }`: the version the sender reviewed; if the contract moved on, 409.
 *
 * This is the LAST edit: draft → sent in one conditional UPDATE (so two
 * requests cannot both send it), after which the database refuses any change
 * to the content (migration 176). A contract with a value still empty, or a
 * required party not chosen, is 422 with what is missing. `contract.sent` is
 * an audit event written right after the claim: there is no atomic function
 * for it (that needs a migration) and a sent contract cannot go back to draft,
 * so if the event cannot be written the answer is 500 and the failure is
 * logged loudly (accepted deviation, see the PR).
 *
 * A frozen PDF copy is filed in the contract's project when it has one
 * (best effort; `…/document` makes it later if this could not).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractSendBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { AuditEventError, recordEvent } from '@/lib/labelos/activity';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { markClauses } from '@/lib/labelos/contracts/clause-edit';
import { planSend } from '@/lib/labelos/contracts/send';
import { platformTemplate } from '@/lib/labelos/contracts/templates';
import { storeContractPdf } from '@/lib/labelos/contracts-document';
import { documentOf, loadContractFor } from '@/lib/labelos/contracts-route';
import { CONTRACTS_NOT_READY, ContractsNotReadyError, claimSend, templateBase } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.send');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; contractId: string }> }) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return json(404, { error: 'Contract not found' });
  const parsed = await readBody(req, OrgContractSendBodySchema);
  if (!parsed.ok) return parsed.res;
  const { admin, orgId: org } = access;

  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return json(404, { error: 'Contract not found' });
    const { row, links, identities } = loaded;
    if (parsed.data.version !== row.version) {
      return json(409, { error: 'This contract changed after you reviewed it. Reload it and read the new version before sending.' });
    }

    const rendered = await documentOf(admin, org, row, links, identities);
    const plan = planSend({
      status: row.status,
      missing: rendered.missing,
      slots: platformTemplate(row.type).slots,
      filledRoles: new Set(links.map((l) => l.role)),
    });
    if (!plan.ok) return json(plan.status, { error: plan.error, ...(plan.missing ? { missing: plan.missing } : {}) });

    if (!(await claimSend(admin, org, row.id, row.version))) return json(409, { error: 'This contract was changed or sent by someone else just now. Reload it.' });

    const base = await templateBase(admin, org, row, (t) => platformTemplate(t).clauses);
    try {
      await recordEvent(
        admin,
        { orgId: org, userId: access.userId },
        'contract.sent',
        { type: 'contract', id: row.id, artistId: row.artist_contact_id, songId: row.track_id, releaseId: row.release_id },
        { type: row.type, version: row.version, fields: Object.keys(row.fields), party_roles: links.map((l) => l.role), clauses_changed: markClauses(base, row.clauses).changed },
      );
    } catch (err) {
      if (err instanceof AuditEventError) {
        log.error('contract sent WITHOUT its audit event', { orgId: org, contractId: row.id, error: err.message });
        return json(500, { error: 'The contract was sent but the record of it could not be written. Tell an administrator.' });
      }
      throw err;
    }

    let copy: Awaited<ReturnType<typeof storeContractPdf>> = { stored: false, reason: 'no_project' };
    try {
      copy = await storeContractPdf(admin, org, access.userId, { ...row, status: 'sent' }, links, identities, rendered);
    } catch (err) {
      // Sent is done and recorded; the copy can be made from the contract page.
      log.error('contract PDF not filed after sending', { orgId: org, contractId: row.id, error: errorMessage(err) });
    }
    return json(200, { ok: true, status: 'sent', version: row.version, copy });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    log.error('contract send failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not send the contract' });
  }
}
