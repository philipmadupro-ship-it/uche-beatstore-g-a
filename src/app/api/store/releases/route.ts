import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { publicReleaseTile } from '@/lib/labelos/store-listing';
import { clientIp, rateLimit } from '@/lib/security/rate-limit';
import { loadPublicReleaseList } from '@/lib/labelos/store-listing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.releases');

/** Per caller, per minute (LABEL-75). The response is edge-cached for a minute, so a browsing visitor makes a handful. */
const LIST_REQUESTS_PER_MINUTE = 60;

/**
 * GET /api/store/releases (LABEL-42)
 *
 * Public-by-design: the released music on the store — releases that were put
 * on it (`releases.store_listed`), are still released and still belong to the
 * store owner's studio or a connected artist. Tiles only, built field by
 * field (`publicReleaseTile`): no org id, no track id, no storage reference.
 * Additive to /api/store: the catalogue, checkout and license_purchases are
 * not touched. Same cache window as the catalogue, so an unlisted release
 * is gone from the store within ~90 s.
 */
export async function GET(req: NextRequest) {
  if (!rateLimit(`store-releases-list:${clientIp(req)}`, LIST_REQUESTS_PER_MINUTE)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  }
  try {
    if (!isSupabaseConfigured()) return NextResponse.json({ releases: [] });
    const admin = createServiceClient();
    const list = await loadPublicReleaseList(admin, new Date());
    const res = NextResponse.json({ releases: list.map((l) => publicReleaseTile(l.row, l.trackCount)) });
    // A release an artist has a say on is taken off the store the moment they say no: nothing of it may sit in a cache.
    res.headers.set('Cache-Control', list.consentGoverned ? 'no-store' : 'public, s-maxage=30, stale-while-revalidate=60');
    return res;
  } catch (err) {
    log.error('list failed', { error: errorMessage(err) });
    // A failed read is a 5xx that nothing may cache — not an empty list that looks like "no releases".
    return NextResponse.json({ error: 'Releases unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
