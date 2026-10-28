import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { isUUID } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { publicReleaseView } from '@/lib/labelos/store-listing';
import { loadPublicRelease, toPublicItems } from '@/lib/labelos/store-listing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.releases.detail');

/**
 * GET /api/store/releases/[id] (LABEL-42) — one listed release and its
 * playable tracklist. `audio_url` of each track is a same-origin stream
 * (`/api/store/releases/[id]/audio/[item]`); no storage reference, org id or
 * org track id is in the body. Not listed, not released (any more), not the
 * store owner's: all the same 404.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  // Lower-cased once: every key below (cache, limiter) is a lowercase UUID, so letter case multiplies nothing.
  const id = rawId.toLowerCase();
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
