import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, getById } from '@/lib/local-store';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 60;

const TRACK_FIELDS = [
  'id', 'user_id', 'title', 'type',
  'audio_url', 'peaks_url', 'cover_url',
  'duration_seconds', 'bpm', 'key', 'scale',
  'rating', 'description',
  'lease_price_usd', 'exclusive_price_usd',
  'store_listed', 'free_download_enabled', 'created_at',
].join(', ');

/**
 * Resolve the license tiers to show on a product page.
 *
 * Priority chain (highest → lowest):
 *   1. track_licenses rows for this track (per-track enabled/disabled + price override)
 *   2. All licenses rows for this seller with no track_licenses filtering
 *      (seller has tiers but hasn't explicitly linked them to this track)
 *   3. Legacy lease_price_usd / exclusive_price_usd columns on track + creator_profile
 *
 * Returns an array shaped for the storefront license card grid — up to 4 tiers.
 */
async function resolveLicenses(
  admin: ReturnType<typeof createServiceClient>,
  sellerId: string,
  trackId: string,
  track: any,
  creator: any,
): Promise<any[]> {
  // Fetch all of the seller's license tiers + any per-track overrides in one round-trip
  const [{ data: allLicenses }, { data: trackLinks }] = await Promise.all([
    admin.from('licenses').select('*').eq('user_id', sellerId).order('sort_order', { ascending: true }),
    admin.from('track_licenses').select('license_id, price_override_usd, enabled').eq('track_id', trackId),
  ]);

  const licenses = allLicenses ?? [];
  const links = (trackLinks ?? []) as Array<{ license_id: string; price_override_usd: number | null; enabled: boolean }>;

  // If there are no custom license tiers at all, fall back to the legacy 2-tier system
  if (licenses.length === 0) {
    return buildLegacyTiers(track, creator);
  }

  // If track_licenses rows exist for this track, use only enabled ones with overridden prices.
  // If no track_licenses rows exist for this track, show all of the seller's tiers (global defaults).
  const linkedIds = new Set(links.map((l) => l.license_id));
  const useLinked = linkedIds.size > 0;

  const activeTiers = licenses
    .filter((l: any) => {
      if (useLinked) return linkedIds.has(l.id) && links.find((x) => x.license_id === l.id)?.enabled !== false;
      return true; // global: show all tiers
    })
    .map((l: any) => {
      const link = links.find((x) => x.license_id === l.id);
      const price = link?.price_override_usd != null ? Number(link.price_override_usd) : Number(l.price_usd);
      return {
        id: l.id,
        name: l.name,
        price_usd: price,
        description: l.description,
        is_free: l.is_free || price === 0,
        file_types: l.file_types ?? ['MP3'],
        stems_included: l.stems_included ?? false,
        is_exclusive: l.is_exclusive ?? false,
        streaming_limit: l.streaming_limit,
        distribution_limit: l.distribution_limit,
        commercial_rights: l.commercial_rights ?? true,
        sync_rights: l.sync_rights ?? false,
        broadcast_rights: l.broadcast_rights ?? false,
        credit_required: l.credit_required ?? true,
      };
    })
    .slice(0, 4);

  return activeTiers.length > 0 ? activeTiers : buildLegacyTiers(track, creator);
}

function buildLegacyTiers(track: any, creator: any): any[] {
  const tiers: any[] = [];
  const leasePrice = resolveLegacyPrice(track.lease_price_usd, creator?.license_lease_price_usd);
  const exclPrice = resolveLegacyPrice(track.exclusive_price_usd, creator?.license_exclusive_price_usd);

  if (leasePrice != null) {
    tiers.push({
      id: 'legacy-lease',
      name: 'MP3 Lease',
      price_usd: leasePrice,
      description: 'Non-exclusive · Up to 100K streams',
      is_free: false,
      file_types: ['MP3'],
      stems_included: false,
      is_exclusive: false,
      streaming_limit: 100000,
      distribution_limit: null,
      commercial_rights: true,
      sync_rights: false,
      broadcast_rights: false,
      credit_required: true,
    });
  }
  if (exclPrice != null) {
    tiers.push({
      id: 'legacy-exclusive',
      name: 'Exclusive Rights',
      price_usd: exclPrice,
      description: 'Exclusive worldwide license · Unlimited',
      is_free: false,
      file_types: ['MP3', 'WAV', 'STEMS'],
      stems_included: true,
      is_exclusive: true,
      streaming_limit: null,
      distribution_limit: null,
      commercial_rights: true,
      sync_rights: true,
      broadcast_rights: true,
      credit_required: false,
    });
  }
  return tiers;
}

function resolveLegacyPrice(trackOverride: any, profileDefault: any): number | null {
  if (trackOverride != null && Number(trackOverride) > 0) return Number(trackOverride);
  if (profileDefault != null && Number(profileDefault) > 0) return Number(profileDefault);
  return null;
}

/**
 * GET /api/store/[id]
 *
 * Public endpoint for the /store/[id] product page. Returns:
 *   { track, creator, related: Track[] }
 *
 * - track must have store_listed = true or returns 404.
 * - related = up to 6 other store-listed tracks from same producer,
 *   same type first, sorted by created_at desc.
 * - creator fields are the same subset /api/store exposes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (!isSupabaseConfigured()) {
      const track = getById('tracks', id) as any;
      if (!track || !track.store_listed) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const all = (getAll('tracks') as any[]).filter(
        (t) => t.store_listed === true && t.id !== id,
      );
      const profiles = (getAll('creator_profiles' as any) as any[]) || [];
      const creator = profiles[0] ?? null;
      return NextResponse.json({ track, creator, related: all.slice(0, 6) });
    }

    const admin = createServiceClient();

    const { data: track, error: tErr } = await admin
      .from('tracks')
      .select(TRACK_FIELDS)
      .eq('id', id)
      .eq('store_listed', true)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const sellerId = (track as any).user_id as string | undefined;

    // Creator profile + related tracks + licenses in parallel where possible
    const [creatorRes, relatedRes] = await Promise.all([
      sellerId
        ? admin
            .from('creator_profiles')
            .select([
              'display_name', 'bio', 'hero_image_url', 'credits',
              'license_lease_price_usd', 'license_exclusive_price_usd', 'license_notes',
              'instagram_handle', 'twitter_handle', 'spotify_url',
              'soundcloud_url', 'website_url', 'contact_email',
              'accent_color', 'share_card_style', 'share_video_style',
            ].join(', '))
            .eq('user_id', sellerId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // Same type first — two queries unioned client-side is simpler than
      // a single ORDER BY that would require a generated column.
      admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .eq('store_listed', true)
        .eq('type', (track as any).type)
        .neq('id', id)
        .order('created_at', { ascending: false })
        .limit(6),
    ]);

    let related = (relatedRes.data as any[]) ?? [];

    // Top up with different-type tracks if same-type didn't fill the 6 slots
    if (related.length < 6) {
      const { data: more } = await admin
        .from('tracks')
        .select(TRACK_FIELDS)
        .eq('store_listed', true)
        .neq('type', (track as any).type)
        .neq('id', id)
        .order('created_at', { ascending: false })
        .limit(6 - related.length);
      related = [...related, ...(more ?? [])];
    }

    // Resolve license tiers (custom tiers → legacy fallback)
    const [licenses, tagsRes] = await Promise.all([
      sellerId
        ? resolveLicenses(admin, sellerId, id, track, creatorRes.data)
        : Promise.resolve(buildLegacyTiers(track, creatorRes.data)),
      admin.from('track_tags').select('tag, category').eq('track_id', id),
    ]);

    // Strip user_id off every track before responding
    const stripUserId = ({ user_id: _u, ...rest }: any) => rest;
    const safeTrack = stripUserId(track);
    const safeRelated = related.map(stripUserId);

    return NextResponse.json({
      track: safeTrack,
      creator: creatorRes.data ?? null,
      licenses,
      tags: tagsRes.data ?? [],
      related: safeRelated,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
