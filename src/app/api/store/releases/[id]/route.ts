import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { isUUID } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { publicReleaseView } from '@/lib/labelos/store-listing';
import { clientIp, rateLimit } from '@/lib/security/rate-limit';
import { loadPublicRelease, toPublicItems } from '@/lib/labelos/store-listing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per caller and release, per minute (LABEL-75). */
const REQUESTS_PER_MINUTE = 120;

const log = createLogger('api.store.releases.detail');

/**
 * GET /api/store/releases/[id] (LABEL-42) — one listed release and its
 * playable tracklist. `audio_url` of each track is a same-origin stream
 * (`/api/store/releases/[id]/audio/[item]`); no storage reference, org id or
 * org track id is in the body. Not listed, not released (any more), not the
 * store owner's: all the same 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  // Lower-cased once: every key below (cache, limiter) is a lowercase UUID, so letter case multiplies nothing.
  const id = rawId.toLowerCase();
  // Only a well-formed release id can mint a limiter bucket: anything else is a 404 before it.
  if (isUUID(id) && !rateLimit(`store-release-detail:${clientIp(req)}:${id}`, REQUESTS_PER_MINUTE)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  }
  try {
    if (!isSupabaseConfigured() || !isUUID(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const admin = createServiceClient();
    const loaded = await loadPublicRelease(admin, id, new Date());
    if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const res = NextResponse.json(publicReleaseView(loaded.row, toPublicItems(loaded.items)));
    res.headers.set('Cache-Control', loaded.consentGoverned ? 'no-store' : 'public, s-maxage=30, stale-while-revalidate=60');
    return res;
  } catch (err) {
    log.error('detail failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Release unavailable' }, { status: 500 });
  }
}
