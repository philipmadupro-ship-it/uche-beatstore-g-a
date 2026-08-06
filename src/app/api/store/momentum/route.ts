import { NextResponse } from 'next/server';
import { createServiceClient, safeSellerId } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { computeRecentSalesByTrack, MOMENTUM_WINDOW_MS, type MomentumPurchaseRow } from '@/lib/store/momentum';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.momentum');

/**
 * GET /api/store/momentum
 *
 * Public, no-auth. Returns { counts: { [trackId]: number } } — paid sales
 * per track in the last 7 days (see lib/store/momentum.ts). Deliberately a
 * separate, lightweight endpoint rather than baked into the already-large,
 * heavily-cached /api/store catalogue route: this can be cached and fail
 * independently without risking the main catalogue response.
 *
 * Callers apply their own "is this worth showing" threshold (see
 * MOMENTUM_THRESHOLD in BeatCard.tsx / BandcampRemixCard.tsx) — this route
 * just returns raw counts.
 */
export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ counts: {} }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } });
    }
    const admin = createServiceClient();

    // Same canonical-producer resolution as /api/store — NULLS LAST so a
    // populated profile always wins the .limit(1) lottery over an empty
    // dev-seeded row. See that route for the full rationale.
    const profileOwner = await admin
      .from('creator_profiles')
      .select('user_id')
      .order('display_name', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const safeSeller = safeSellerId(profileOwner.data?.user_id as string | undefined);
    if (!safeSeller) {
      return NextResponse.json({ counts: {} }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } });
    }

    const since = new Date(Date.now() - MOMENTUM_WINDOW_MS).toISOString();
    const { data, error } = await admin
      .from('license_purchases')
      .select('track_ids, created_at')
      .eq('seller_user_id', safeSeller)
      .eq('status', 'paid')
      .gte('created_at', since)
      .limit(2000);
    if (error) throw error;

    const counts = computeRecentSalesByTrack((data ?? []) as MomentumPurchaseRow[], MOMENTUM_WINDOW_MS);

    return NextResponse.json(
      { counts },
      // Short public cache — momentum data changes with sales, not on every
      // request, and staleness of a few minutes is fine for a social-proof
      // nicety (same tradeoff as the main catalogue's s-maxage).
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } },
    );
  } catch (err) {
    log.error('momentum fetch failed', { error: errorMessage(err) });
    // Social proof must never break the storefront — empty counts, not an error.
    return NextResponse.json({ counts: {} }, { status: 200 });
  }
}
