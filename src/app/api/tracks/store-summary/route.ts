import { NextResponse } from 'next/server';
import { isSupabaseConfigured, query, requireUser } from '@/lib/db';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SummaryTrack = {
  id: string;
  title: string;
  type: string | null;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  store_listed: boolean | null;
  store_featured: boolean | null;
  store_sort_order: number | null;
  lease_price_usd: number | null;
  exclusive_price_usd: number | null;
  free_download_enabled: boolean | null;
  exclusive_sold: boolean | null;
  voice_tag_enabled: boolean | null;
};

type SummaryLicense = {
  id: string;
  price_usd: number | null;
  is_free: boolean | null;
};

type SummaryTrackLicense = {
  track_id: string;
  license_id: string;
  price_override_usd: number | null;
  enabled: boolean | null;
};

type SummaryPriceContext = {
  defaultLeasePriceUsd?: number | null;
  defaultExclusivePriceUsd?: number | null;
  licenses?: SummaryLicense[];
  trackLicenses?: SummaryTrackLicense[];
};

function hasSellablePrice(
  track: SummaryTrack,
  context: SummaryPriceContext,
  links: SummaryTrackLicense[],
) {
  const legacyReady = (
    (track.lease_price_usd != null && track.lease_price_usd > 0) ||
    (track.exclusive_price_usd != null && track.exclusive_price_usd > 0) ||
    (context.defaultLeasePriceUsd != null && context.defaultLeasePriceUsd > 0) ||
    (context.defaultExclusivePriceUsd != null && context.defaultExclusivePriceUsd > 0)
  );
  const licenses = context.licenses ?? [];
  if (licenses.length === 0) return legacyReady;

  const linksByLicense = new Map(links.map((link) => [link.license_id, link]));
  const activeLicenses = licenses.filter((license) => {
    if (linksByLicense.size === 0) return true;
    const link = linksByLicense.get(license.id);
    return !!link && link.enabled !== false;
  });
  if (activeLicenses.length === 0) return legacyReady;

  return activeLicenses.some((license) => {
    if (license.is_free) return true;
    const override = linksByLicense.get(license.id)?.price_override_usd;
    return Number(override ?? license.price_usd) > 0;
  }) || legacyReady;
}

function summarize(rows: SummaryTrack[], context: SummaryPriceContext = {}) {
  const linksByTrack = new Map<string, SummaryTrackLicense[]>();
  for (const link of context.trackLicenses ?? []) {
    const links = linksByTrack.get(link.track_id);
    if (links) links.push(link);
    else linksByTrack.set(link.track_id, [link]);
  }
  const listed = rows.filter((track) => track.store_listed);
  const producerPicks = listed
    .filter((track) => track.store_featured)
    .sort((a, b) => (a.store_sort_order ?? 9999) - (b.store_sort_order ?? 9999) || a.title.localeCompare(b.title))
    .slice(0, 12);
  const issues = {
    noCover: listed.filter((track) => !track.cover_url),
    noPrice: listed.filter((track) => !hasSellablePrice(track, context, linksByTrack.get(track.id) ?? [])),
    noBpmKey: listed.filter((track) => track.bpm == null && !track.key),
  };

  return {
    total: rows.length,
    listed: listed.length,
    producerPicks,
    issues: {
      noCover: { count: issues.noCover.length, firstId: issues.noCover[0]?.id ?? null },
      noPrice: { count: issues.noPrice.length, firstId: issues.noPrice[0]?.id ?? null },
      noBpmKey: { count: issues.noBpmKey.length, firstId: issues.noBpmKey[0]?.id ?? null },
    },
  };
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      const localQuery = query as unknown as (table: string, predicate: (row: any) => boolean) => any[];
      const rows = (query('tracks', () => true) as any[]).map((track) => ({
        id: track.id,
        title: track.title,
        type: track.type ?? null,
        cover_url: track.cover_url ?? null,
        bpm: track.bpm ?? null,
        key: track.key ?? null,
        scale: track.scale ?? null,
        store_listed: !!track.store_listed,
        store_featured: !!track.store_featured,
        store_sort_order: track.store_sort_order ?? null,
        lease_price_usd: track.lease_price_usd ?? null,
        exclusive_price_usd: track.exclusive_price_usd ?? null,
        free_download_enabled: !!track.free_download_enabled,
        exclusive_sold: !!track.exclusive_sold,
        voice_tag_enabled: !!track.voice_tag_enabled,
      }));
      const profile = localQuery('creator_profiles', () => true)[0] ?? {};
      const licenses = localQuery('licenses', () => true).map((license) => ({
        id: license.id,
        price_usd: license.price_usd ?? null,
        is_free: !!license.is_free,
      }));
      const trackLicenses = localQuery('track_licenses', () => true).map((link) => ({
        track_id: link.track_id,
        license_id: link.license_id,
        price_override_usd: link.price_override_usd ?? null,
        enabled: link.enabled !== false,
      }));
      return NextResponse.json(summarize(rows, {
        defaultLeasePriceUsd: profile.license_lease_price_usd ?? null,
        defaultExclusivePriceUsd: profile.license_exclusive_price_usd ?? null,
        licenses,
        trackLicenses,
      }));
    }

    const owner = await requireUser();
    if (!owner.ok) return owner.res;

    const { data, error } = await owner.admin
      .from('tracks')
      .select([
        'id', 'title', 'type', 'cover_url',
        'bpm', 'key', 'scale',
        'store_listed', 'store_featured', 'store_sort_order',
        'lease_price_usd', 'exclusive_price_usd',
        'free_download_enabled', 'exclusive_sold', 'voice_tag_enabled',
      ].join(', '))
      .eq('user_id', owner.userId);
    if (error) throw error;

    const rows = (data ?? []) as unknown as SummaryTrack[];
    const trackIds = rows.map((track) => track.id);
    const [{ data: profileData, error: profileError }, { data: licenseData, error: licenseError }, trackLicenseResult] = await Promise.all([
      owner.admin
        .from('creator_profiles')
        .select('license_lease_price_usd, license_exclusive_price_usd')
        .eq('user_id', owner.userId)
        .maybeSingle(),
      owner.admin
        .from('licenses')
        .select('id, price_usd, is_free')
        .eq('user_id', owner.userId),
      trackIds.length > 0
        ? owner.admin
          .from('track_licenses')
          .select('track_id, license_id, price_override_usd, enabled')
          .in('track_id', trackIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (profileError) throw profileError;
    if (licenseError) throw licenseError;
    if (trackLicenseResult.error) throw trackLicenseResult.error;

    return NextResponse.json(summarize(rows, {
      defaultLeasePriceUsd: profileData?.license_lease_price_usd ?? null,
      defaultExclusivePriceUsd: profileData?.license_exclusive_price_usd ?? null,
      licenses: (licenseData ?? []) as unknown as SummaryLicense[],
      trackLicenses: (trackLicenseResult.data ?? []) as unknown as SummaryTrackLicense[],
    }));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
