import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { PortalPlayBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortal } from '@/lib/artist-portal/gate';
import { portalProjectsWithTrack } from '@/lib/artist-portal/membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.play');

/** One play per track per this window: replays and scrubbing are not new plays. */
const PLAY_WINDOW_MS = 30 * 60 * 1000;

/**
 * POST /api/portal/[token]/play  { track_id }
 *
 * The artist pressed play. Logged as a `track_played` row on the contact's
 * timeline, which is what the workspace's "played" engagement and
 * "last played" read — at most once per track per half hour.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalplay:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const parsed = PortalPlayBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const { track_id } = parsed.data;

  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;
    if ((await portalProjectsWithTrack(admin, portal, track_id)).length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const since = new Date(Date.now() - PLAY_WINDOW_MS).toISOString();
    const { data: recent } = await admin
      .from('contact_activity')
      .select('id')
      .eq('contact_id', portal.contact_id)
      .eq('user_id', portal.user_id)
      .eq('kind', 'track_played')
      .eq('metadata->>track_id', track_id)
      .gte('occurred_at', since)
      .limit(1);
    if (recent && recent.length > 0) return NextResponse.json({ logged: false });

    const { data: track } = await admin.from('tracks').select('title').eq('id', track_id).eq('user_id', portal.user_id).maybeSingle();
    const { error } = await admin.from('contact_activity').insert({
      contact_id: portal.contact_id,
      user_id: portal.user_id,
      kind: 'track_played',
      title: `Played ${(track as { title?: string } | null)?.title ?? 'a beat'}`,
      metadata: { track_id, source: 'portal' },
    });
    if (error) throw error;
    return NextResponse.json({ logged: true });
  } catch (err) {
    log.error('play log failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
