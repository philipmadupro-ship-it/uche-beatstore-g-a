import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sales
 *
 * Returns the producer's sales feed — license_purchases (per-track) and
 * project_access_links (project bundles) merged into one chronological
 * list. Each row is normalised so the dashboard renders a single table.
 *
 * Authenticated; sellers only see their own sales.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;

  try {
    // ── License purchases (track licenses) ─────────────────────────────────
    const { data: purchases, error: lpErr } = await admin
      .from('license_purchases')
      .select('id, buyer_email, track_ids, line_items, license_type, amount_usd, stripe_session_id, status, download_unlocked, created_at')
      .eq('seller_user_id', userId)
      .order('created_at', { ascending: false });

    if (lpErr) throw lpErr;

    // Hydrate track titles so the row shows "808 Crush — Lease" instead of a UUID.
    const trackIds = [
      ...new Set(
        (purchases ?? []).flatMap((p: any) => (Array.isArray(p.track_ids) ? p.track_ids : [])),
      ),
    ];
    const titleByTrack: Record<string, string> = {};
    if (trackIds.length > 0) {
      const { data: tracks } = await admin
        .from('tracks')
        .select('id, title')
        .in('id', trackIds);
      for (const t of (tracks ?? []) as Array<{ id: string; title: string }>) {
        titleByTrack[t.id] = t.title;
      }
    }

    // ── Project bundle purchases (project_access_links) ───────────────────
    // Two-step fetch instead of a join: lets us scope by user_id on projects
    // (the access_links row itself doesn't store seller_user_id).
    const { data: ownedProjects } = await admin
      .from('projects')
      .select('id, name')
      .eq('user_id', userId);

    const projectById: Record<string, string> = {};
    const projectIds: string[] = [];
    for (const p of (ownedProjects ?? []) as Array<{ id: string; name: string }>) {
      projectById[p.id] = p.name;
      projectIds.push(p.id);
    }

    // Frozen amount_usd was added in migration 044; older access_links
    // rows have it null and we fall back to projects.price_usd below.
    let accessLinks: any[] = [];
    if (projectIds.length > 0) {
      const { data: links, error: alErr } = await admin
        .from('project_access_links')
        .select('id, project_id, buyer_email, stripe_session_id, amount_usd, created_at, expires_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false });
      if (alErr) throw alErr;
      accessLinks = links ?? [];
    }

    // Fallback for legacy access_links that pre-date migration 044.
    const priceById: Record<string, number | null> = {};
    if (projectIds.length > 0) {
      const { data: priced } = await admin
        .from('projects')
        .select('id, price_usd')
        .in('id', projectIds);
      for (const p of (priced ?? []) as Array<{ id: string; price_usd: number | null }>) {
        priceById[p.id] = p.price_usd;
      }
    }

    // ── Normalise into a single sales feed ────────────────────────────────
    const trackSales = (purchases ?? []).map((p: any) => {
      // line_items is the canonical per-line breakdown; fall back to track_ids
      // for older rows written before line_items was introduced.
      const items: Array<{ track_id: string; license_type?: string }> = Array.isArray(p.line_items)
        ? p.line_items
        : (Array.isArray(p.track_ids) ? p.track_ids.map((id: string) => ({ track_id: id })) : []);
      const titles = items
        .map((i) => titleByTrack[i.track_id])
        .filter(Boolean) as string[];
      const itemLabel =
        titles.length === 0
          ? `${items.length} track${items.length === 1 ? '' : 's'}`
          : titles.length === 1
            ? titles[0]
            : `${titles[0]} +${titles.length - 1} more`;

      return {
        id: p.id,
        kind: 'track' as const,
        buyer_email: p.buyer_email,
        item_label: itemLabel,
        item_count: items.length,
        license_type: p.license_type ?? null,
        amount_usd: p.amount_usd != null ? Number(p.amount_usd) : null,
        stripe_session_id: p.stripe_session_id,
        status: p.status ?? 'paid',
        download_unlocked: p.download_unlocked ?? null,
        created_at: p.created_at,
      };
    });

    const projectSales = accessLinks.map((a: any) => ({
      id: a.id,
      kind: 'project' as const,
      buyer_email: a.buyer_email,
      item_label: projectById[a.project_id] ?? 'Project',
      item_count: 1,
      license_type: null,
      // Prefer frozen amount (migration 044); fall back to current
      // projects.price_usd only for legacy rows.
      amount_usd: a.amount_usd != null ? Number(a.amount_usd) : (priceById[a.project_id] ?? null),
      stripe_session_id: a.stripe_session_id ?? null,
      status: a.expires_at && new Date(a.expires_at).getTime() < Date.now() ? 'expired' : 'paid',
      download_unlocked: null,
      created_at: a.created_at,
    }));

    const sales = [...trackSales, ...projectSales].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const totals = {
      count: sales.length,
      revenue_usd: sales.reduce((acc, s) => acc + (s.amount_usd ?? 0), 0),
      track_count: trackSales.length,
      project_count: projectSales.length,
    };

    return NextResponse.json({ sales, totals });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
