import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger, maskEmail } from '@/lib/log';
import { isValidEmail } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.orders');

/**
 * GET /api/store/orders?email=xxx
 *
 * Returns all completed purchases (track licenses + project bundles) for a
 * buyer email. No auth — email is the identity for guest checkout (same model
 * as Shopify guest orders). Returns download URLs so the buyer can access
 * files directly from the orders page.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.toLowerCase().trim() ?? '';
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const admin = createServiceClient();

    // ── Track license purchases ───────────────────────────────────────────
    const { data: purchases, error: pErr } = await admin
      .from('license_purchases')
      .select('id, track_ids, line_items, amount_usd, created_at, stripe_session_id, license_type, status')
      .eq('buyer_email', email)
      .eq('status', 'paid')
      .order('created_at', { ascending: false });

    if (pErr) throw pErr;

    // Batch-load track titles + covers
    const allTrackIds = [...new Set((purchases ?? []).flatMap((p) => (p.track_ids as string[]) ?? []))];
    let trackMap: Record<string, { title: string; cover_url?: string | null }> = {};
    if (allTrackIds.length > 0) {
      const { data: tracks } = await admin
        .from('tracks')
        .select('id, title, cover_url')
        .in('id', allTrackIds);
      trackMap = Object.fromEntries((tracks ?? []).map((t) => [t.id, t]));
    }

    // ── Project bundle purchases ──────────────────────────────────────────
    const { data: projectLinks, error: plErr } = await admin
      .from('project_access_links')
      .select('id, project_id, token, amount_usd, created_at, expires_at, stripe_session_id')
      .eq('buyer_email', email)
      .order('created_at', { ascending: false });

    if (plErr) throw plErr;

    // Batch-load project names + covers
    const projectIds = [...new Set((projectLinks ?? []).map((p) => p.project_id as string))];
    let projectMap: Record<string, { name: string; cover_url?: string | null }> = {};
    if (projectIds.length > 0) {
      const { data: projects } = await admin
        .from('projects')
        .select('id, name, cover_url')
        .in('id', projectIds);
      projectMap = Object.fromEntries((projects ?? []).map((p) => [p.id, p]));
    }

    // ── Merge + sort ──────────────────────────────────────────────────────
    type TrackOrder = {
      id: string;
      kind: 'track_license';
      tracks: Array<{ id: string; title: string; cover_url?: string | null }>;
      license_type: string | null;
      amount_usd: number | null;
      created_at: string;
      stripe_session_id: string;
    };
    type ProjectOrder = {
      id: string;
      kind: 'project_bundle';
      project: { id: string; name: string; cover_url?: string | null };
      amount_usd: number | null;
      created_at: string;
      token: string;
      expires_at: string | null;
    };

    const trackOrders: TrackOrder[] = (purchases ?? []).map((p) => ({
      id: p.id as string,
      kind: 'track_license',
      tracks: ((p.track_ids as string[]) ?? []).map((id) => ({
        id,
        title: trackMap[id]?.title ?? 'Unknown track',
        cover_url: trackMap[id]?.cover_url ?? null,
      })),
      license_type: (p.license_type as string) ?? null,
      amount_usd: p.amount_usd as number | null,
      created_at: p.created_at as string,
      stripe_session_id: p.stripe_session_id as string,
    }));

    const projectOrders: ProjectOrder[] = (projectLinks ?? []).map((p) => ({
      id: p.id as string,
      kind: 'project_bundle',
      project: {
        id: p.project_id as string,
        name: projectMap[p.project_id as string]?.name ?? 'Unknown project',
        cover_url: projectMap[p.project_id as string]?.cover_url ?? null,
      },
      amount_usd: p.amount_usd as number | null,
      created_at: p.created_at as string,
      token: p.token as string,
      expires_at: (p.expires_at as string) ?? null,
    }));

    const orders = [...trackOrders, ...projectOrders].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    log.info('orders lookup', { email: maskEmail(email), count: orders.length });
    return NextResponse.json({ orders });
  } catch (err) {
    log.error('orders lookup failed', { error: errorMessage(err) });
    return publicError(err);
  }
}
