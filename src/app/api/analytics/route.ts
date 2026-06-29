import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { parsePurchaseLineItems } from '@/lib/contracts';
import { computeFunnel } from '@/lib/store/funnel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bucket a raw Referer URL into a friendly traffic-source label. */
function platformFromReferrer(referrer: string | null | undefined): string {
  if (!referrer) return 'Direct';
  let host = '';
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'Other';
  }
  if (!host) return 'Direct';
  if (host.includes('instagram')) return 'Instagram';
  if (host.includes('tiktok')) return 'TikTok';
  if (host === 't.co' || host.includes('twitter') || host === 'x.com') return 'Twitter/X';
  if (host.includes('youtube') || host === 'youtu.be') return 'YouTube';
  if (host.includes('facebook') || host === 'fb.com' || host.includes('fb.me')) return 'Facebook';
  if (host.includes('whatsapp')) return 'WhatsApp';
  if (host.includes('t.me') || host.includes('telegram')) return 'Telegram';
  if (host.includes('discord')) return 'Discord';
  if (host.includes('reddit')) return 'Reddit';
  if (host.includes('google') || host.includes('bing') || host.includes('duckduckgo')) return 'Search';
  // Same-origin opens (the store domain itself) read as direct navigation.
  const appHost = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (appHost && host.includes(appHost.replace(/^www\./, ''))) return 'Direct';
  return host;
}

/**
 * GET /api/analytics
 *
 * Producer-only aggregates for the /analytics dashboard. Three numbers
 * + two leaderboards in a single round-trip. Auth-gated; sellers only
 * ever see their own data.
 *
 * Returns:
 *   { totals: { plays, sales_count, gross_usd },
 *     by_track: [{ track_id, title, plays, sales, gross }],
 *     by_day:   [{ date, sales, gross }],
 *     recent_sales: [{ kind, item, buyer_email, amount, created_at }] }
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;

  try {
    // 1. License purchases (track sales)
    const { data: purchases, error: lpErr } = await admin
      .from('license_purchases')
      .select('id, buyer_email, track_ids, line_items, amount_usd, created_at')
      .eq('seller_user_id', userId)
      .order('created_at', { ascending: false });
    if (lpErr) throw lpErr;

    // 2. Project bundles (need projects.user_id to scope)
    const { data: ownedProjects } = await admin
      .from('projects')
      .select('id, name')
      .eq('user_id', userId);
    const projectIds = (ownedProjects ?? []).map((p: any) => p.id);
    const projectNameById = new Map(
      (ownedProjects ?? []).map((p: any) => [p.id, p.name as string]),
    );

    // Project sales scoped by the denormalised seller_user_id (mig 049).
    const { data: projLinks } = await admin
      .from('project_access_links')
      .select('id, project_id, buyer_email, amount_usd, created_at')
      .eq('seller_user_id', userId)
      .order('created_at', { ascending: false });
    const projectSales = projLinks ?? [];

    // 3. Plays. Two sources merged:
    //    a) share_plays — DM'd share-link plays, scoped by share_links the user owns.
    //    b) store_plays — public storefront plays (mig 049), scoped by seller_user_id.
    //    The combined number is what /analytics actually reports.
    let playsByTrack: Record<string, number> = {};
    let totalPlays = 0;
    // Per-share-link rollup (Task 6): plays, unique opens, tracks, platform mix.
    const shareLinkAgg = new Map<string, {
      token: string;
      created_at: string | null;
      recipient_kind: string | null;
      plays: number;
      ips: Set<string>;
      tracks: Set<string>;
      platforms: Record<string, number>;
      last_play: string | null;
    }>();
    try {
      const { data: links } = await admin
        .from('share_links')
        .select('token, created_at, recipient_kind')
        .eq('user_id', userId);
      const tokens = (links ?? []).map((l: any) => l.token).filter(Boolean);
      for (const l of (links ?? []) as any[]) {
        shareLinkAgg.set(l.token, {
          token: l.token,
          created_at: l.created_at ?? null,
          recipient_kind: l.recipient_kind ?? null,
          plays: 0,
          ips: new Set(),
          tracks: new Set(),
          platforms: {},
          last_play: null,
        });
      }
      if (tokens.length > 0) {
        // referrer is mig 076 — select it, retry without if not yet applied.
        let plays: any[] | null = null;
        {
          const r = await admin
            .from('share_plays')
            .select('track_id, link_token, ip_hash, referrer, played_at')
            .in('link_token', tokens);
          if (r.error && /referrer/i.test(r.error.message)) {
            const r2 = await admin
              .from('share_plays')
              .select('track_id, link_token, ip_hash, played_at')
              .in('link_token', tokens);
            plays = (r2.data ?? []) as any[];
          } else {
            plays = (r.data ?? []) as any[];
          }
        }
        for (const row of plays as any[]) {
          totalPlays++;
          if (row.track_id) {
            playsByTrack[row.track_id] = (playsByTrack[row.track_id] ?? 0) + 1;
          }
          const agg = shareLinkAgg.get(row.link_token);
          if (agg) {
            agg.plays++;
            if (row.ip_hash) agg.ips.add(row.ip_hash);
            if (row.track_id) agg.tracks.add(row.track_id);
            const platform = platformFromReferrer(row.referrer);
            agg.platforms[platform] = (agg.platforms[platform] ?? 0) + 1;
            if (row.played_at && (!agg.last_play || row.played_at > agg.last_play)) {
              agg.last_play = row.played_at;
            }
          }
        }
      }
    } catch {
      // share_plays optional; non-fatal.
    }
    try {
      const { data: storePlays } = await admin
        .from('store_plays')
        .select('track_id')
        .eq('seller_user_id', userId);
      for (const row of (storePlays ?? []) as any[]) {
        totalPlays++;
        if (row.track_id) {
          playsByTrack[row.track_id] = (playsByTrack[row.track_id] ?? 0) + 1;
        }
      }
    } catch {
      // store_plays table may not exist yet (mig 049 unapplied); non-fatal.
    }

    // 4. Build by-track leaderboard. Pull titles for all tracks that show
    //    up in either plays or sales.
    const involvedTrackIds = new Set<string>([
      ...Object.keys(playsByTrack),
      ...((purchases ?? []) as any[]).flatMap((p) =>
        Array.isArray(p.track_ids) ? p.track_ids : [],
      ),
    ]);
    const titleByTrack: Record<string, string> = {};
    if (involvedTrackIds.size > 0) {
      const { data: trackRows } = await admin
        .from('tracks')
        .select('id, title')
        .in('id', Array.from(involvedTrackIds));
      for (const t of (trackRows ?? []) as any[]) titleByTrack[t.id] = t.title;
    }

    const salesByTrack: Record<string, { count: number; gross: number }> = {};
    let grossTrack = 0;
    for (const p of (purchases ?? []) as any[]) {
      const amount = Number(p.amount_usd ?? 0);
      grossTrack += amount;
      const parsed = parsePurchaseLineItems(p.line_items);
      const items: Array<{ track_id: string }> = parsed.length > 0
        ? parsed
        : Array.isArray(p.track_ids)
          ? p.track_ids.map((id: string) => ({ track_id: id }))
          : [];
      // Distribute revenue evenly across line items (we don't store
      // per-item unit_amount on license_purchases).
      const perItem = items.length > 0 ? amount / items.length : 0;
      for (const it of items) {
        const cur = salesByTrack[it.track_id] ?? { count: 0, gross: 0 };
        salesByTrack[it.track_id] = { count: cur.count + 1, gross: cur.gross + perItem };
      }
    }

    const byTrack = Array.from(involvedTrackIds)
      .map((id) => ({
        track_id: id,
        title: titleByTrack[id] ?? `Track ${id.slice(0, 6)}`,
        plays: playsByTrack[id] ?? 0,
        sales: salesByTrack[id]?.count ?? 0,
        gross: Number((salesByTrack[id]?.gross ?? 0).toFixed(2)),
      }))
      .sort((a, b) => b.gross - a.gross || b.sales - a.sales || b.plays - a.plays)
      .slice(0, 25);

    // 5. By-day series for the last 30 days. Cheap aggregation in JS — at
    //    catalogue scale a producer is unlikely to have 10k purchases.
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const dayKey = (iso: string | null | undefined) =>
      iso ? iso.slice(0, 10) : '';
    const byDayMap = new Map<string, { sales: number; gross: number }>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      byDayMap.set(d, { sales: 0, gross: 0 });
    }
    const bumpDay = (iso: string | null | undefined, amount: number) => {
      const d = dayKey(iso);
      if (!d) return;
      if (new Date(d).getTime() < since) return;
      const cur = byDayMap.get(d) ?? { sales: 0, gross: 0 };
      byDayMap.set(d, { sales: cur.sales + 1, gross: cur.gross + amount });
    };
    for (const p of (purchases ?? []) as any[]) {
      bumpDay(p.created_at, Number(p.amount_usd ?? 0));
    }
    for (const a of projectSales) {
      bumpDay(a.created_at, Number(a.amount_usd ?? 0));
    }
    const byDay = Array.from(byDayMap.entries())
      .map(([date, v]) => ({ date, sales: v.sales, gross: Number(v.gross.toFixed(2)) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 6. Recent activity (across both kinds).
    const recentSales = [
      ...((purchases ?? []) as any[]).slice(0, 10).map((p) => {
        const items = parsePurchaseLineItems(p.line_items);
        const titles = items.map((i) => titleByTrack[i.track_id]).filter(Boolean) as string[];
        return {
          kind: 'track' as const,
          item: titles[0] ?? 'Track',
          buyer_email: p.buyer_email,
          amount: Number(p.amount_usd ?? 0),
          created_at: p.created_at,
        };
      }),
      ...projectSales.slice(0, 10).map((a) => ({
        kind: 'project' as const,
        item: projectNameById.get(a.project_id) ?? 'Project',
        buyer_email: a.buyer_email,
        amount: Number(a.amount_usd ?? 0),
        created_at: a.created_at,
      })),
    ]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 10);

    const grossProject = projectSales.reduce(
      (acc, a) => acc + Number(a.amount_usd ?? 0),
      0,
    );

    // 7. Storefront funnel (mig 097). Last 30 days of store_events collapsed
    //    into view → cart → checkout → paid. Guarded: the table may not exist
    //    yet on a stale DB, in which case the funnel is simply omitted.
    let funnel: ReturnType<typeof computeFunnel> = [];
    try {
      const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: events } = await admin
        .from('store_events')
        .select('session_id, event_type')
        .eq('seller_user_id', userId)
        .gte('created_at', since30);
      funnel = computeFunnel((events ?? []) as { session_id: string | null; event_type: string | null }[]);
    } catch {
      // store_events table may not exist yet (mig 097 unapplied); non-fatal.
    }

    // Share-link table (Task 6) — only links that actually got opened, busiest
    // first, with the dominant traffic source surfaced.
    const byShareLink = Array.from(shareLinkAgg.values())
      .filter((s) => s.plays > 0)
      .map((s) => {
        const topPlatform =
          Object.entries(s.platforms).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Direct';
        return {
          token: s.token,
          recipient_kind: s.recipient_kind,
          plays: s.plays,
          unique_opens: s.ips.size,
          track_count: s.tracks.size,
          top_source: topPlatform,
          platforms: s.platforms,
          last_play: s.last_play,
          created_at: s.created_at,
        };
      })
      .sort((a, b) => b.plays - a.plays);

    return NextResponse.json({
      totals: {
        plays: totalPlays,
        sales_count: (purchases?.length ?? 0) + projectSales.length,
        gross_usd: Number((grossTrack + grossProject).toFixed(2)),
      },
      by_track: byTrack,
      by_day: byDay,
      recent_sales: recentSales,
      by_share_link: byShareLink,
      funnel,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
