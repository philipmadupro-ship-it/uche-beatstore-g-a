import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    let projectSales: any[] = [];
    if (projectIds.length > 0) {
      const { data: links } = await admin
        .from('project_access_links')
        .select('id, project_id, buyer_email, amount_usd, created_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false });
      projectSales = links ?? [];
    }

    // 3. Plays — share_plays counts every public listen via share links.
    //    Scope by share tokens issued by this user.
    let playsByTrack: Record<string, number> = {};
    let totalPlays = 0;
    try {
      // Pull share tokens the user owns, then plays whose link_token
      // matches. Two queries instead of a join keeps this resilient to
      // missing-FK setups.
      const { data: links } = await admin
        .from('share_links')
        .select('token')
        .eq('user_id', userId);
      const tokens = (links ?? []).map((l: any) => l.token).filter(Boolean);
      if (tokens.length > 0) {
        const { data: plays } = await admin
          .from('share_plays')
          .select('track_id, link_token')
          .in('link_token', tokens);
        for (const row of (plays ?? []) as any[]) {
          totalPlays++;
          if (row.track_id) {
            playsByTrack[row.track_id] = (playsByTrack[row.track_id] ?? 0) + 1;
          }
        }
      }
    } catch {
      // share_plays + share_links are optional enrichment; non-fatal.
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
      const items: Array<{ track_id: string }> = Array.isArray(p.line_items)
        ? p.line_items
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
        const items: Array<{ track_id: string }> = Array.isArray(p.line_items)
          ? p.line_items
          : [];
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

    return NextResponse.json({
      totals: {
        plays: totalPlays,
        sales_count: (purchases?.length ?? 0) + projectSales.length,
        gross_usd: Number((grossTrack + grossProject).toFixed(2)),
      },
      by_track: byTrack,
      by_day: byDay,
      recent_sales: recentSales,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
