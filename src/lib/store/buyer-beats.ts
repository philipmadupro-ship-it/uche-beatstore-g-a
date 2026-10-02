/**
 * Server side of the buyer's "My beats" workspace: the queries behind
 * `GET /api/store/me?view=beats`, and the ownership check that lets
 * `/api/store/me` put a beat the buyer paid for into a project even after the
 * storefront stopped listing it (an exclusive delists the beat it sells).
 *
 * Every read is keyed on the canonical email the caller already proved — a
 * Supabase session or a signed token. Nothing here accepts an email from a
 * request body.
 */
import type { createServiceClient } from '@/lib/auth/ownership';
import { loadBuyerPurchases } from '@/lib/store/buyer-purchases';
import {
  buildBuyerBeats,
  type BuyerBeat,
  type BuyerBeatOfferInput,
  type BuyerBeatTrackRow,
} from '@/lib/store/buyer-workspace';

type Admin = ReturnType<typeof createServiceClient>;

type Purchases = Awaited<ReturnType<typeof loadBuyerPurchases>>;

async function loadBundleTracks(admin: Admin, purchases: Purchases) {
  const projectIds = [...new Set(
    purchases.project_bundles.filter((b) => !b.access_revoked).map((b) => b.project_id),
  )];
  if (projectIds.length === 0) return [];
  const { data, error } = await admin
    .from('project_tracks')
    .select('project_id, track_id')
    .in('project_id', projectIds);
  if (error) throw error;
  return (data ?? []) as Array<{ project_id: string; track_id: string }>;
}

/** Track ids this buyer currently has access to (revoked purchases excluded). */
export async function loadBuyerOwnedTrackIds(admin: Admin, email: string): Promise<Set<string>> {
  const purchases = await loadBuyerPurchases(admin, email);
  const bundleTracks = await loadBundleTracks(admin, purchases);
  return new Set(
    buildBuyerBeats({
      licenses: purchases.track_licenses,
      bundles: purchases.project_bundles,
      bundleTracks,
      offers: [],
      tracks: [],
    }).filter((b) => b.status === 'owned').map((b) => b.id),
  );
}

/** The workspace rows for one buyer. A failed read throws; it is never "empty". */
export async function loadBuyerBeats(admin: Admin, email: string): Promise<BuyerBeat[]> {
  const [purchases, offerRes] = await Promise.all([
    loadBuyerPurchases(admin, email),
    admin
      .from('buyer_offers')
      .select('id, track_id, track_title, offered_price_usd, status, created_at')
      .eq('buyer_email', email)
      .order('created_at', { ascending: false }),
  ]);
  if (offerRes.error) throw offerRes.error;
  const offers = (offerRes.data ?? []) as BuyerBeatOfferInput[];
  const bundleTracks = await loadBundleTracks(admin, purchases);

  const trackIds = [...new Set([
    ...purchases.track_licenses
      .filter((l) => !l.access_revoked)
      .flatMap((l) => l.items.map((i) => i.track_id)),
    ...bundleTracks.map((r) => r.track_id),
    ...offers.map((o) => o.track_id).filter((id): id is string => typeof id === 'string'),
  ].filter(Boolean))];

  let tracks: BuyerBeatTrackRow[] = [];
  if (trackIds.length > 0) {
    const { data, error } = await admin
      .from('tracks')
      .select('id,title,cover_url,type,bpm,key,scale,duration_seconds,store_listed')
      .in('id', trackIds);
    if (error) throw error;
    tracks = (data ?? []) as BuyerBeatTrackRow[];
  }

  return buildBuyerBeats({
    licenses: purchases.track_licenses,
    bundles: purchases.project_bundles,
    bundleTracks,
    offers,
    tracks,
  });
}
