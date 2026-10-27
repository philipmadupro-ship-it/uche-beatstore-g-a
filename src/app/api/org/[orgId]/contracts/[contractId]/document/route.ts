/**
 * /api/org/[orgId]/contracts/[contractId]/document (LABEL-58).
 *
 *   GET   the contract as a PDF, made now from the contract as it stands.
 *         `contracts.read`; the copy is NOT stored. `contract.document_downloaded`
 *         is an audit event written BEFORE the first byte (if it cannot be
 *         written nothing is sent). This is how a contract that has no project
 *         is downloaded; one with a project also has the stored copy below,
 *         whose downloads are audited by the Files route
 *         (`file.restricted_downloaded`).
 *   POST  make the PDF and file it as a restricted `contract` project file in
 *         the contract's project (its release's, else its song's). `contracts.write`
 *         and `contracts.read`. One file per version and status: asking again
 *         returns the same file. A contract with no project answers 409 and
 *         stores nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { contractDocumentFileName, renderContractDocumentPdf } from '@/lib/labelos/contracts/document';
import { storeContractPdf } from '@/lib/labelos/contracts-document';
import { documentInputOf, documentOf, loadContractFor } from '@/lib/labelos/contracts-route';
import { CONTRACTS_NOT_READY, ContractsNotReadyError } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.document');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Contract not found' });

type Params = { params: Promise<{ orgId: string; contractId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.read');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return NOT_FOUND();
  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded) return NOT_FOUND();
    const { row, links, identities } = loaded;
    const rendered = await documentOf(access.admin, access.orgId, row, links, identities);
    // Before a byte leaves: an unauditable download does not happen.
    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'contract.document_downloaded',
      { type: 'contract', id: row.id, artistId: row.artist_contact_id, songId: row.track_id, releaseId: row.release_id },
      { version: row.version, status: row.status },
    );
    const pdf = await renderContractDocumentPdf(documentInputOf(row, links, identities, rendered));
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${contractDocumentFileName(row.id, row.version, row.status)}"`,
        'Content-Length': String(pdf.length),
        'X-Content-Type-Options': 'nosniff',
        ...NO_STORE,
      },
    });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return NOT_FOUND();
    log.error('contract document failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not make the document' });
  }
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  if (!access.capabilities.has('contracts.read')) return json(403, { error: 'Forbidden' });
  if (!isUUID(contractId)) return NOT_FOUND();
  const { admin, orgId: org } = access;
  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return NOT_FOUND();
    const { row, links, identities } = loaded;
    if (row.status === 'void') return json(409, { error: 'A void contract has no document to make' });
    const rendered = await documentOf(admin, org, row, links, identities);
    const copy = await storeContractPdf(admin, org, access.userId, row, links, identities, rendered);
    if (!copy.stored) {
      return json(409, { error: 'This contract is not attached to a song or release in a project, so there is nowhere to file the PDF. Download it instead.', reason: copy.reason });
    }
    if (!copy.reused) {
      await recordEvent(
        admin,
        { orgId: org, userId: access.userId },
        'contract.document_generated',
        { type: 'contract', id: row.id, artistId: row.artist_contact_id, projectId: copy.project_id, songId: row.track_id, releaseId: row.release_id },
        { version: row.version, status: row.status },
      );
    }
    return json(200, { ok: true, reused: copy.reused, asset_id: copy.asset_id, project_id: copy.project_id });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    log.error('contract document store failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not file the document' });
  }
}
