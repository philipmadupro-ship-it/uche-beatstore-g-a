import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { createServiceClient } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import {
  aggregateFreeDownloadLeads,
  leadsNotYetContacts,
  contactFromLead,
  normaliseEmail,
  type FreeDownloadRow,
} from '@/lib/crm/free-download-leads';
import { selectIn } from '@/lib/db/chunked-in';

const log = createLogger('api.store.free-downloads');

export const runtime = 'nodejs';

/**
 * The producer's free-download list.
 *
 * `store_free_downloads` has been collecting addresses since migration 037 and
 * was read by nothing — this is the first surface that makes it usable.
 *
 * Owner-scoped by joining through `tracks.user_id`: the table itself only
 * stores `track_id`, so ownership has to be resolved via the track. Without
 * that join this endpoint would leak every producer's list on a multi-tenant
 * deployment.
 */
export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    const admin = createServiceClient();

    const { data: ownTracks, error: trackError } = await admin
      .from('tracks')
      .select('id, title')
      .eq('user_id', auth.userId);
    if (trackError) throw trackError;

    const titles = new Map((ownTracks ?? []).map((t) => [t.id as string, t.title as string]));
    const trackIds = [...titles.keys()];
    if (trackIds.length === 0) {
      return NextResponse.json({ leads: [], newLeads: [], totalDownloads: 0 });
    }

    // Chunked: trackIds is the producer's whole catalogue, and one `.in()`
    // over it is rejected as "Bad Request".
    const rows = await selectIn<{ email: string; track_id: string; downloaded_at: string }>(
      (ids) => admin
        .from('store_free_downloads')
        .select('email, track_id, downloaded_at')
        .in('track_id', ids)
        .order('downloaded_at', { ascending: false }),
      trackIds,
    );

    const withTitles: FreeDownloadRow[] = (rows ?? []).map((r) => ({
      email: r.email as string,
      track_id: r.track_id as string,
      downloaded_at: r.downloaded_at as string,
      track_title: titles.get(r.track_id as string) ?? null,
    }));

    const leads = aggregateFreeDownloadLeads(withTitles);

    // Which of these are not already in the CRM, so the UI can offer
    // "promote 12 new leads" rather than making the producer diff by eye.
    const { data: contacts } = await admin
      .from('contacts')
      .select('email')
      .eq('user_id', auth.userId);
    const newLeads = leadsNotYetContacts(leads, (contacts ?? []).map((c) => c.email as string | null));

    return NextResponse.json({
      leads,
      newLeads,
      totalDownloads: withTitles.length,
    });
  } catch (err) {
    log.error('free-downloads list failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) || 'Failed to load leads' }, { status: 500 });
  }
}

/**
 * Promote selected leads into contacts.
 *
 * Explicit rather than automatic. Someone who grabbed a free beat has not opted
 * into outreach, and auto-filling the CRM with them would corrupt both its
 * meaning and its pipeline statistics. The producer chooses.
 *
 * Idempotent: addresses already present as contacts are skipped, not
 * duplicated, so re-running after a partial failure is safe.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    const body = await req.json().catch(() => null);
    const requested: unknown = (body as { emails?: unknown } | null)?.emails;
    if (!Array.isArray(requested) || requested.length === 0) {
      return NextResponse.json({ error: 'No emails provided.' }, { status: 400 });
    }

    const emails = [...new Set(
      requested
        .filter((e): e is string => typeof e === 'string' && e.includes('@'))
        .map(normaliseEmail),
    )];
    if (emails.length === 0) {
      return NextResponse.json({ error: 'No valid emails provided.' }, { status: 400 });
    }

    const admin = createServiceClient();

    // Only promote addresses that actually appear in THIS producer's download
    // list — otherwise the endpoint would be an arbitrary contact-injection API.
    const { data: ownTracks } = await admin.from('tracks').select('id').eq('user_id', auth.userId);
    const trackIds = (ownTracks ?? []).map((t) => t.id as string);
    if (trackIds.length === 0) {
      return NextResponse.json({ error: 'No downloads to promote.' }, { status: 400 });
    }

    const rows = await selectIn<{ email: string; track_id: string; downloaded_at: string }>(
      (ids) => admin
        .from('store_free_downloads')
        .select('email, track_id, downloaded_at')
        .in('track_id', ids),
      trackIds,
    );

    const leads = aggregateFreeDownloadLeads((rows ?? []).map((r) => ({
      email: r.email as string,
      track_id: r.track_id as string,
      downloaded_at: r.downloaded_at as string,
    })));
    const requestedSet = new Set(emails);
    const matched = leads.filter((l) => requestedSet.has(l.email));

    const { data: contacts } = await admin
      .from('contacts')
      .select('email')
      .eq('user_id', auth.userId);
    const toCreate = leadsNotYetContacts(matched, (contacts ?? []).map((c) => c.email as string | null));

    if (toCreate.length === 0) {
      return NextResponse.json({ created: 0, skipped: matched.length });
    }

    const { error } = await admin.from('contacts').insert(
      toCreate.map((lead) => ({ ...contactFromLead(lead), user_id: auth.userId })),
    );
    if (error) throw error;

    log.info('promoted free-download leads', { created: toCreate.length });
    return NextResponse.json({
      created: toCreate.length,
      skipped: matched.length - toCreate.length,
    });
  } catch (err) {
    log.error('free-downloads promote failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) || 'Failed to promote leads' }, { status: 500 });
  }
}
