import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { parsePurchaseLineItems } from '@/lib/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LicensePurchaseRow {
  id: string;
  buyer_email: string | null;
  track_ids: unknown;
  line_items: unknown;
  license_type: string | null;
  amount_usd: number | string | null;
  stripe_session_id: string | null;
  status: string | null;
  download_unlocked: boolean | null;
  needs_stems_upload: boolean | null;
  needs_refund_review: boolean | null;
  created_at: string;
}

interface ProjectAccessLinkRow {
  id: string;
  project_id: string;
  buyer_email: string | null;
  stripe_session_id: string | null;
  amount_usd: number | string | null;
  created_at: string;
  expires_at: string | null;
}

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
      .select('id, buyer_email, track_ids, line_items, license_type, amount_usd, stripe_session_id, status, download_unlocked, needs_stems_upload, needs_refund_review, created_at')
      .eq('seller_user_id', userId)
      .order('created_at', { ascending: false });

    if (lpErr) throw lpErr;

    // Hydrate track titles so the row shows "808 Crush — Lease" instead of a UUID.
    const trackIds = [
      ...new Set(
        ((purchases ?? []) as LicensePurchaseRow[]).flatMap((p) => (
          Array.isArray(p.track_ids) ? p.track_ids.filter((id): id is string => typeof id === 'string') : []
        )),
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
    // Single query now that migration 049 denormalised seller_user_id
    // onto project_access_links. We still pull the producer's owned
    // projects for the name lookup + the price fallback (legacy rows
    // pre-migration-044 lack amount_usd).
    const { data: links, error: alErr } = await admin
      .from('project_access_links')
      .select('id, project_id, buyer_email, stripe_session_id, amount_usd, created_at, expires_at')
      .eq('seller_user_id', userId)
      .order('created_at', { ascending: false });
    if (alErr) throw alErr;
    const accessLinks = (links ?? []) as ProjectAccessLinkRow[];

    const referencedProjectIds = [...new Set(accessLinks.map((a) => a.project_id))];
    const projectById: Record<string, string> = {};
    const projectIds: string[] = referencedProjectIds;
    if (referencedProjectIds.length > 0) {
      const { data: projRows } = await admin
        .from('projects')
        .select('id, name')
        .in('id', referencedProjectIds);
      for (const p of (projRows ?? []) as Array<{ id: string; name: string }>) {
        projectById[p.id] = p.name;
      }
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
    const trackSales = ((purchases ?? []) as LicensePurchaseRow[]).map((p) => {
      // line_items is the canonical per-line breakdown; fall back to track_ids
      // for older rows written before line_items was introduced.
      // Zod-parse line_items so we don't trust raw webhook JSON.
      // Falls back to building items from track_ids for pre-line_items rows.
      const parsed = parsePurchaseLineItems(p.line_items);
      const items: Array<{ track_id: string; license_type?: string }> = parsed.length > 0
        ? parsed
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
        needs_stems_upload: p.needs_stems_upload ?? false,
        needs_refund_review: p.needs_refund_review ?? false,
        created_at: p.created_at,
      };
    });

    const projectSales = accessLinks.map((a) => ({
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
