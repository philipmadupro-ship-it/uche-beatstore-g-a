/**
 * GET /api/org/[orgId]/consents — the store-listing questions put to the
 * caller as an artist (LABEL-71): every release of this org on which an
 * account that stands for them (`answerableFor`) is credited, with where it
 * stands — asked, yes, no — and whether it is on the store right now.
 *
 * Releases that are on the store and credit the caller but have no consent row yet (listed before migration 186, or
 * credited after the listing) are listed as asked: the artist still has the last word on them, and answering
 * creates the row (`PUT …/consent`).
 *
 * Any member may ask; they are shown only rows that are theirs, so a member
 * who is nobody's artist gets an empty list, never a 403 that would tell them
 * which colleagues are. Built field by field: the release's title, type and
 * date, never another artist, the lister or an id of anyone else.
 * Migration 186 missing: `{ schemaReady: false, consents: [] }`.
 */
import { NextResponse } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { inChunks } from '@/lib/labelos/paged-read';
import { answerableFor, loadListedReleasesOfArtist } from '@/lib/labelos/store-consent-store';
import { isConsentState } from '@/lib/labelos/store-consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.consents');

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const LIMIT = 200;

export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Releases need Supabase.' });
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  const { admin, orgId: org, userId } = access;
  try {
    const mine = await answerableFor(admin, org, userId);
    if (mine.length === 0) return json(200, { consents: [] });
    const { data, error } = await admin
      .from('listing_consents')
      .select('release_id, state, proposed_at, decided_at')
      .eq('org_id', org)
      .in('artist_contact_id', mine.slice(0, 200))
      .order('proposed_at', { ascending: false })
      .order('release_id', { ascending: true })
      .limit(LIMIT);
    if (error) {
      if (isMissingSchema(error)) return json(200, { schemaReady: false, consents: [] });
      throw new Error(error.message);
    }
    const rows = ((data ?? []) as { release_id: string; state: string; proposed_at: string; decided_at: string | null }[]).filter((r) => isConsentState(r.state));
    // Listed and credited, never asked: shown as asked (the row is made when they answer).
    const have = new Set(rows.map((r) => r.release_id.toLowerCase()));
    for (const id of await loadListedReleasesOfArtist(admin, org, mine.slice(0, 200))) {
      if (!have.has(id)) rows.push({ release_id: id, state: 'proposed', proposed_at: '', decided_at: null });
    }
    const releases = await inChunks<{ id: string; title: string; type: string; release_date: string | null; store_listed: boolean; state: string }>(
      rows.map((r) => r.release_id),
      (part, from, to) => admin.from('releases').select('id, title, type, release_date, store_listed, state').eq('org_id', org).in('id', part).order('id', { ascending: true }).range(from, to),
      'releases',
    );
    const byId = new Map(releases.map((r) => [r.id, r]));
    const consents = rows.flatMap((r) => {
      const rel = byId.get(r.release_id);
      if (!rel) return [];
      return [{ releaseId: rel.id, title: rel.title, type: rel.type, releaseDate: rel.release_date, listed: rel.store_listed, releaseState: rel.state, state: r.state, proposedAt: r.proposed_at, decidedAt: r.decided_at }];
    });
    return json(200, { schemaReady: true, consents });
  } catch (err) {
    log.error('consents failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not read your store listing questions' });
  }
}
