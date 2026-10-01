import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { PortalReactionBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { canArtistSetDecision, describeDecisionChange, isDecision } from '@/lib/contacts/decisions';
import { gatePortal } from '@/lib/artist-portal/gate';
import { portalProjectsWithTrack } from '@/lib/artist-portal/membership';
import { artistReactionDedupeKey, buildArtistReactionNotification } from '@/lib/notifications/artist-reaction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.reaction');

/**
 * POST /api/portal/[token]/reaction  { track_id, decision: 'interested' | 'passed' | null }
 *
 * The artist's ♥ Interested / ✕ Pass, or taking it back. Writes only this
 * portal's contact, only a track that is in one of its projects (404
 * otherwise — never reveal what exists outside the portal), and never undoes
 * a decision the producer moved past interested (409, with the current word).
 * A new reaction notifies the producer and lands on the contact's timeline.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalreact:${clientIp(req)}`, 30, 60_000))
    || !(await rateLimitDurable(`portalreact:t:${token}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const parsed = PortalReactionBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
  const { track_id, decision } = parsed.data;

  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;

    const projects = await portalProjectsWithTrack(admin, portal, track_id);
    if (projects.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [{ data: track }, { data: state }, { data: contact }] = await Promise.all([
      admin.from('tracks').select('id, title').eq('id', track_id).eq('user_id', portal.user_id).maybeSingle(),
      admin.from('contact_track_states').select('decision, set_by').eq('contact_id', portal.contact_id).eq('track_id', track_id).eq('user_id', portal.user_id).maybeSingle(),
      admin.from('contacts').select('name').eq('id', portal.contact_id).eq('user_id', portal.user_id).maybeSingle(),
    ]);
    if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const current = state && isDecision(state.decision) ? state.decision : null;
    if (!canArtistSetDecision(current, decision)) {
      return NextResponse.json(
        { error: 'This beat has moved on with your producer — ask them to change it.', decision: current, decisionSetBy: state?.set_by ?? null },
        { status: 409 },
      );
    }
    if (current === decision) {
      return NextResponse.json({ decision: current, decisionSetBy: current ? state?.set_by ?? null : null, changed: false });
    }

    const now = new Date().toISOString();
    const { error: upErr } = await admin.from('contact_track_states').upsert({
      user_id: portal.user_id,
      contact_id: portal.contact_id,
      track_id,
      project_id: projects[0].project_id,
      decision,
      set_by: 'artist',
      updated_at: now,
    }, { onConflict: 'contact_id,track_id' });
    if (upErr) throw upErr;

    const contactName = (contact as { name?: string } | null)?.name ?? 'Artist';
    const { error: actErr } = await admin.from('contact_activity').insert({
      contact_id: portal.contact_id,
      user_id: portal.user_id,
      kind: 'decision_changed',
      title: describeDecisionChange({ contactName, trackTitle: track.title ?? 'a beat', decision, setBy: 'artist' }),
      metadata: { track_id, decision, previous: current, set_by: 'artist' },
      occurred_at: now,
    });
    if (actErr) log.warn('reaction timeline row failed', { error: errorMessage(actErr) });

    if (decision) {
      const dedupe = artistReactionDedupeKey(portal.contact_id, track_id, decision);
      const { data: already } = await admin
        .from('notifications')
        .select('id')
        .eq('user_id', portal.user_id)
        .eq('data->>dedupe_key', dedupe)
        .eq('read', false)
        .limit(1);
      if (!already || already.length === 0) {
        const { error: nErr } = await admin.from('notifications').insert(buildArtistReactionNotification({
          ownerId: portal.user_id,
          contactId: portal.contact_id,
          contactName,
          trackId: track_id,
          trackTitle: track.title ?? '',
          decision,
        }));
        if (nErr) log.warn('reaction notification failed', { error: errorMessage(nErr) });
      }
    }

    return NextResponse.json({ decision, decisionSetBy: decision ? 'artist' : null, changed: true });
  } catch (err) {
    log.error('reaction failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
