import { NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll } from '@/lib/local-store';
import { createServiceClient, safeSellerId } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FacetTrack = {
  id: string;
  user_id?: string | null;
  key?: string | null;
  bpm?: number | null;
  lease_price_usd?: number | null;
};

function buildFacetPayload(
  tracks: FacetTrack[],
  tags: Array<{ track_id: string; tag: string; category: string | null }>,
) {
  const trackIds = new Set(tracks.map((track) => track.id));
  const genres = new Set<string>();
  const moods = new Set<string>();
  const keys = new Set<string>();
  const bpms: number[] = [];
  const prices: number[] = [];

  for (const track of tracks) {
    if (track.key) keys.add(track.key);
    if (track.bpm != null && Number.isFinite(Number(track.bpm))) bpms.push(Number(track.bpm));
    if (track.lease_price_usd != null && Number(track.lease_price_usd) > 0) prices.push(Number(track.lease_price_usd));
  }

  for (const tag of tags) {
    if (!trackIds.has(tag.track_id)) continue;
    if (tag.category === 'genre') genres.add(tag.tag);
    if (tag.category === 'mood') moods.add(tag.tag);
  }

  return {
    total: tracks.length,
    genres: Array.from(genres).sort(),
    moods: Array.from(moods).sort(),
    keys: Array.from(keys).sort(),
    bpmRange: bpms.length ? { min: Math.min(...bpms), max: Math.max(...bpms) } : { min: 60, max: 200 },
    priceRange: prices.length ? { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) } : { min: 0, max: 200 },
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      const tracks = ((getAll('tracks') as any[]) || [])
        .filter((track) => track.store_listed === true)
        .map((track) => ({
          id: track.id,
          key: track.key ?? null,
          bpm: track.bpm ?? null,
          lease_price_usd: track.lease_price_usd ?? null,
        }));
      const tags = ((getAll('track_tags' as any) as any[]) || []).map((tag) => ({
        track_id: tag.track_id,
        tag: tag.tag,
        category: tag.category ?? null,
      }));
      const response = NextResponse.json(buildFacetPayload(tracks, tags));
      response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      return response;
    }

    const admin = createServiceClient();
    const profileOwner = await admin
      .from('creator_profiles')
      .select('user_id, display_name')
      .order('display_name', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const sellerId = profileOwner.data?.user_id as string | undefined;
    const safeSeller = safeSellerId(sellerId);

    let tracksQuery = admin
      .from('tracks')
      .select('id,user_id,key,bpm,lease_price_usd')
      .eq('store_listed', true);
    if (sellerId) {
      tracksQuery = tracksQuery.or(`user_id.eq.${safeSeller},user_id.is.null`);
    }
    const { data: trackRows, error: trackError } = await tracksQuery;
    if (trackError) throw trackError;

    const tracks = ((trackRows ?? []) as FacetTrack[]);
    const trackIds = tracks.map((track) => track.id).filter(Boolean);
    const tagChunks = await Promise.all(chunk(trackIds, 100).map(async (ids) => {
      const { data: tagRows, error: tagError } = await admin
        .from('track_tags')
        .select('track_id,tag,category')
        .in('track_id', ids);
      if (tagError) throw tagError;
      return (tagRows ?? []) as Array<{ track_id: string; tag: string; category: string | null }>;
    }));
    const tags = tagChunks.flat();

    const response = NextResponse.json(buildFacetPayload(tracks, tags));
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return response;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
