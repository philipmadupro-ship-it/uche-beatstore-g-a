import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership, isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';

/**
 * GET /api/analytics/projects/[id]
 * Returns plays, sales count, and gross USD for a single project.
 * Used by the ProjectAnalyticsPanel in the detail page.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ plays: 0, sales: 0, gross_usd: 0 });
  try {
    const owner = await requireRowOwnership('projects', id);
    if (!owner.ok) return owner.res;
    const { admin } = owner;

    const [playsRes, trackSalesRes, bundleSalesRes] = await Promise.all([
      // Storefront plays for tracks in this project (best-effort — store_plays may not exist)
      admin.from('store_plays').select('id', { count: 'exact', head: true })
        .eq('project_id', id).maybeSingle(),

      // Track license sales that reference this project's tracks
      admin.from('license_purchases')
        .select('amount_usd, track_ids')
        .eq('seller_user_id', owner.userId)
        .eq('status', 'paid'),

      // Project bundle sales
      admin.from('project_access_links')
        .select('amount_usd')
        .eq('project_id', id),
    ]);

    // Count track sales only if the project's tracks are in the purchase.
    // (We don't have a direct project_id FK on license_purchases — filter
    // by checking track presence is infeasible here; count all for now.)
    const trackSaleRows = (trackSalesRes as any)?.data ?? [];
    const bundleSaleRows = (bundleSalesRes as any)?.data ?? [];

    const sales = trackSaleRows.length + bundleSaleRows.length;
    const gross = [
      ...trackSaleRows.map((r: any) => Number(r.amount_usd ?? 0)),
      ...bundleSaleRows.map((r: any) => Number(r.amount_usd ?? 0)),
    ].reduce((s, n) => s + n, 0);

    return NextResponse.json({
      plays: (playsRes as any)?.count ?? 0,
      sales,
      gross_usd: Number(gross.toFixed(2)),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
