import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, query, createServiceClient } from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.share.token.analytics');

/**
 * GET /api/share/[token]/analytics
 *
 * Aggregates play data for a share link:
 *   - total_plays
 *   - unique_listeners (distinct ip_hash)
 *   - last_24h plays
 *   - timeline: last 14 days, daily buckets
 *   - by_track: per-track play counts + titles
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    let plays: any[] = [];
    let tracks: any[] = [];
    let share: any = null;

    if (isSupabaseConfigured()) {
      // Analytics is for the link OWNER, not recipients. Recipients only have
      // the public token; without an auth gate they could see play counts and
      // unique-listener data the owner never meant to expose.
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }

      const supabase = createServiceClient();

      const { data: shareRow, error: shareErr } = await supabase
        .from('share_links')
        .select('*')
        .eq('token', token)
        .maybeSingle();
      if (shareErr) throw shareErr;
      if (!shareRow) return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
      if (shareRow.user_id && shareRow.user_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      share = shareRow;

      const { data: playRows } = await supabase
        .from('share_plays')
        .select('*')
        .eq('link_token', token);
      plays = playRows ?? [];

      if (share.track_ids?.length) {
        const { data: tr } = await supabase
          .from('tracks')
          .select('id, title')
          .in('id', share.track_ids);
        tracks = tr ?? [];
      }
    } else {
      const allLinks = getAll('share_links');
      share = allLinks.find((s: any) => s.token === token);
      if (!share) return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
      plays = query('share_plays', (p: any) => p.link_token === token);
      const allTracks = getAll('tracks');
      const ids = new Set(share.track_ids || []);
      tracks = allTracks.filter((t: any) => ids.has(t.id)).map((t: any) => ({ id: t.id, title: t.title }));
    }

    const trackTitle = new Map<string, string>();
    tracks.forEach((t) => trackTitle.set(t.id, t.title));

    const total_plays = plays.length;
    const unique_listeners = new Set(plays.map((p) => p.ip_hash).filter(Boolean)).size;

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const last_24h = plays.filter((p) => now - new Date(p.played_at).getTime() < DAY).length;

    // 14-day timeline — bucket by YYYY-MM-DD, zero-filled
    const timeline: Array<{ date: string; plays: number }> = [];
    const buckets = new Map<string, number>();
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now - i * DAY);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, 0);
    }
    plays.forEach((p) => {
      const key = new Date(p.played_at).toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    });
    buckets.forEach((v, k) => timeline.push({ date: k, plays: v }));
    timeline.sort((a, b) => (a.date < b.date ? -1 : 1));

    // Per-track counts
    const byTrackMap = new Map<string, number>();
    plays.forEach((p) => {
      if (!p.track_id) return;
      byTrackMap.set(p.track_id, (byTrackMap.get(p.track_id) ?? 0) + 1);
    });
    const by_track = Array.from(byTrackMap.entries())
      .map(([track_id, count]) => ({
        track_id,
        title: trackTitle.get(track_id) ?? '—',
        plays: count,
      }))
      .sort((a, b) => b.plays - a.plays);

    return NextResponse.json({
      token,
      title: share.title ?? null,
      created_at: share.created_at ?? null,
      expires_at: share.expires_at ?? null,
      total_plays,
      unique_listeners,
      last_24h,
      timeline,
      by_track,
    });
  } catch (error: any) {
    log.error('Share analytics error:', { error: errorMessage(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
