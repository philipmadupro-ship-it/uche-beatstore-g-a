import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { selectIn } from '@/lib/db/chunked-in';
import { isProducerUserId } from '@/lib/auth/producer';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { sendPortalDigest } from '@/lib/artists/portal-send';
import { autoDigestDue } from '@/lib/artist-portal/auto-digest';

const log = createLogger('cron.artist-digest');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Upper bound per run, so one run stays well inside the function timeout. */
const MAX_PER_RUN = 50;

/**
 * Daily artist digest (mig 129). Schedule: vercel.json.
 *
 * For every live portal with `auto_digest` on: if something is new since the
 * last notify and no digest went out in the last 20 hours
 * (lib/artist-portal/auto-digest), send the same single digest the Notify
 * button sends, through `sendPortalDigest` — so it is recorded identically
 * (beat_sends + timeline + last_notified_at). Idempotent: a second run the
 * same day finds nothing due. Owners who are no longer producers are skipped.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, sent: 0 });

  const admin = createServiceClient();
  const now = new Date();
  try {
    const { data: portalData, error } = await admin
      .from('artist_portals')
      .select('user_id, contact_id')
      .eq('auto_digest', true)
      .is('revoked_at', null)
      .limit(500);
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json({ ok: true, sent: 0, skipped: 'migration 129 not applied' });
      throw error;
    }
    const portals = (portalData ?? []) as Array<{ user_id: string; contact_id: string }>;
    if (portals.length === 0) return NextResponse.json({ ok: true, candidates: 0, sent: 0 });

    const contactIds = portals.map((p) => p.contact_id);
    const [contacts, links] = await Promise.all([
      selectIn<{ id: string; user_id: string; name: string | null; email: string | null }>((ids) => admin.from('contacts').select('id, user_id, name, email').in('id', ids), contactIds),
      selectIn<{ contact_id: string; user_id: string; last_notified_at: string | null }>((ids) => admin.from('project_contacts').select('contact_id, user_id, last_notified_at').in('contact_id', ids).eq('in_portal', true), contactIds),
    ]);
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const producers = new Map<string, boolean>();

    let sent = 0;
    let nothingNew = 0;
    let waiting = 0;
    const failures: string[] = [];
    for (const p of portals) {
      if (sent >= MAX_PER_RUN) break;
      const contact = contactById.get(p.contact_id);
      if (!contact || contact.user_id !== p.user_id || !contact.email) continue;
      if (!producers.has(p.user_id)) producers.set(p.user_id, await isProducerUserId(admin, p.user_id));
      if (!producers.get(p.user_id)) continue;

      const stamps = links.filter((l) => l.contact_id === p.contact_id && l.user_id === p.user_id).map((l) => l.last_notified_at);
      // The count itself is decided inside sendPortalDigest (409 = nothing
      // new); here only the once-a-day rule is checked, with "1" standing in
      // for "maybe something".
      if (!autoDigestDue({ unnotified: 1, lastNotifiedAt: stamps, now })) { waiting += 1; continue; }

      try {
        const result = await sendPortalDigest(admin, { userId: p.user_id, contact, now });
        if (result.ok) sent += 1;
        else if (result.status === 409) nothingNew += 1;
        else failures.push(`${p.contact_id}: ${result.error}`);
      } catch (err) {
        failures.push(`${p.contact_id}: ${errorMessage(err)}`);
      }
    }

    if (failures.length) log.warn('some digests failed', { failures });
    log.info('artist digest run', { candidates: portals.length, sent, nothingNew, waiting, failed: failures.length });
    return NextResponse.json({ ok: true, candidates: portals.length, sent, nothingNew, waiting, failed: failures.length });
  } catch (err) {
    log.error('artist digest cron failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
