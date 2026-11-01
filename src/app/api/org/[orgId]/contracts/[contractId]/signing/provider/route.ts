/**
 * PUT /api/org/[orgId]/contracts/[contractId]/signing/provider (LABEL-60).
 *
 * The address of an EXTERNAL e-signature (a hosted document at the label's
 * provider), kept on the contract so the parties can find it from the
 * certificate page. `{ url }` — https only, no credentials; `null` clears it.
 * `contracts.write` inside the caller's artist scope. This is a note, not an
 * integration: the app never calls the address and sends nothing to it.
 *
 * It is the one fact of a sent or signed contract that may still change (the
 * database freezes the content, not this column), so the change is recorded
 * as `contract.esign_url_set` — saying that it was set or cleared, never the
 * address itself. A void contract is not edited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractProviderBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { cleanProviderUrl } from '@/lib/labelos/contract-signing';
import { SIGNING_NOT_READY, SigningNotReadyError, writeProviderUrl } from '@/lib/labelos/contract-signing-store';
import { loadContractFor } from '@/lib/labelos/contracts-route';
import { CONTRACTS_NOT_READY, ContractsNotReadyError } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.signing.provider');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ orgId: string; contractId: string }> }) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return json(404, { error: 'Contract not found' });
  const parsed = await readBody(req, OrgContractProviderBodySchema);
  if (!parsed.ok) return parsed.res;
  const url = cleanProviderUrl(parsed.data.url);
  if (url === 'invalid') return json(400, { error: 'Use the full https:// address of the document at your e-signature provider.' });

  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return json(404, { error: 'Contract not found' });
    const { row } = loaded;
    if (row.status === 'void') return json(409, { error: 'A void contract is not edited.' });
    if (!(await writeProviderUrl(access.admin, access.orgId, row.id, url))) return json(404, { error: 'Contract not found' });
    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'contract.esign_url_set',
      { type: 'contract', id: row.id, artistId: row.artist_contact_id, songId: row.track_id, releaseId: row.release_id },
      { set: url !== null },
    );
    return json(200, { ok: true, url });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    if (err instanceof SigningNotReadyError) return json(503, { error: SIGNING_NOT_READY });
    log.error('provider url failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the address' });
  }
}
