/**
 * GET /api/org/[orgId]/contracts/[contractId]/suggestions — values the form
 * can offer (LABEL-58). `contracts.write`, a draft in the caller's artist scope.
 *
 *  · `fields`: the contract parties' shares on the song's split sheets in force
 *    (LABEL-28) as `master_share` / `publishing_share`. Shares are read as
 *    integers and written back exactly. Only with `rights.read` (D2): without
 *    it the list is empty, never "N hidden".
 *  · `artist_parties`: the parties (LABEL-54) that stand for the contract's
 *    artist contact, for the artist slot.
 *
 * Nothing is applied by this call; the person clicks. No payee data is read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { suggestArtistParties, suggestFromSplits, type SplitFacts } from '@/lib/labelos/contracts/suggest';
import { partyName } from '@/lib/labelos/contracts/context';
import { loadContractFor } from '@/lib/labelos/contracts-route';
import { ContractsNotReadyError } from '@/lib/labelos/contracts-store';
import { unitsOf } from '@/lib/labelos/splits';
import { linesOfSheets, listSheets, SplitsNotReadyError } from '@/lib/labelos/splits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.suggestions');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string; contractId: string }> }) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return json(404, { error: 'Contract not found' });
  const { admin, orgId: org } = access;
  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return json(404, { error: 'Contract not found' });
    const { row, links, identities } = loaded;

    let fields: ReturnType<typeof suggestFromSplits> = [];
    if (row.track_id && access.capabilities.has('rights.read')) {
      try {
        const sheets = await listSheets(admin, org, row.track_id);
        const lines = await linesOfSheets(admin, org, sheets.map((s) => s.id));
        const facts: SplitFacts[] = sheets.map((s) => ({
          kind: s.kind,
          status: s.status,
          version: s.version,
          lines: (lines.get(s.id) ?? []).map((l) => ({ party_id: l.party_id, units: unitsOf(l.share) })),
        }));
        fields = suggestFromSplits(
          facts,
          links.map((l) => ({ party_id: l.party_id, role: l.role, name: identities.get(l.party_id) ? partyName(identities.get(l.party_id)!) : 'Unknown party' })),
        );
      } catch (err) {
        if (!(err instanceof SplitsNotReadyError)) throw err;
      }
    }

    let artistParties: { id: string; name: string }[] = [];
    if (row.artist_contact_id) {
      const res = await admin.from('parties').select('id, display_name, legal_name, contact_id').eq('org_id', org).eq('contact_id', row.artist_contact_id).limit(20);
      if (!res.error) {
        const found = suggestArtistParties((res.data ?? []) as { id: string; display_name: string; legal_name: string | null; contact_id: string | null }[], row.artist_contact_id);
        artistParties = found.map((p) => ({ id: p.id, name: (p.legal_name?.trim() || p.display_name).trim() }));
      }
    }
    return json(200, { fields, artist_parties: artistParties });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(200, { schemaReady: false, fields: [], artist_parties: [] });
    log.error('contract suggestions failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not load suggestions' });
  }
}
