import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { createServiceClient } from '@/lib/auth/ownership';
import { EMPTY_ARTWORK_THEME, loadPublicArtworkTheme } from '@/lib/artwork/public-theme';
import { errorMessage } from '@/lib/errors';
import { resolveStoreOwner } from '@/lib/store/owner';
import { createLogger } from '@/lib/log';

const log = createLogger('api.store.theme');

/**
 * GET /api/store/theme → the producer's artwork identity, for public pages.
 *
 * Most public surfaces already load the producer alongside their own data and
 * get the theme in that payload. A few do not: checkout and the delivery pages
 * work from a cart or a purchase token and never fetch a catalogue, so the
 * beats in them had no way to draw branded artwork.
 *
 * Public by design — it exposes the same images the storefront already renders
 * and nothing else. No id, no email, no counts.
 */
export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ artworkTheme: EMPTY_ARTWORK_THEME });
    }

    const admin = createServiceClient();

    // Same owner rule as /api/store, so the theme here matches the catalogue's.
    const owner = await resolveStoreOwner(admin);
    const artworkTheme = await loadPublicArtworkTheme(admin, owner?.user_id);

    const res = NextResponse.json({ artworkTheme });
    // Changes only when the producer edits their branding, which is rare, so
    // this can sit in the CDN far longer than the catalogue does.
    res.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    return res;
  } catch (err) {
    log.error('theme read failed', { error: errorMessage(err) });
    // Degrade rather than fail: an unbranded page beats a broken one.
    return NextResponse.json({ artworkTheme: EMPTY_ARTWORK_THEME });
  }
}
