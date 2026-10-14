import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { isUUID } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { orgAudioSourceAllowed } from '@/lib/labelos/org-audio';
import { publicStreamPlan } from '@/lib/labelos/store-listing';
import { clientIp, rateLimit } from '@/lib/security/rate-limit';
import { loadPublicRelease } from '@/lib/labelos/store-listing-store';
import { promotedPreviewRef } from '@/lib/storage/store-release-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.releases.audio');

/** Per IP and release. Generous for a listener (a seek is a request), small for a scraper. */
const AUDIO_REQUESTS_PER_MINUTE = 90;

/**
 * GET /api/store/releases/[id]/audio/[itemId] (LABEL-42, D8) — play one item
 * of a listed release. The handle is the release ITEM (never an org track id),
 * and the release must be listed, still released and the store owner's.
 *
 *  - `preview` mode streams only the promoted copy in the PUBLIC bucket
 *    (`store-releases/<release>/<master>`); an item that was never promoted
 *    is 404, never the private clip or the master.
 *  - `full` mode streams the item's master through the server, Range
 *    forwarded, from the PRIVATE bucket only (`orgAudioSourceAllowed`):
 *    nothing is presigned and no storage URL leaves, as for share pages.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const raw = await ctx.params;
  // Lower-cased once, before the limiter key and the item cache key are built from them.
  const id = raw.id.toLowerCase();
  const itemId = raw.itemId.toLowerCase();
  // Anonymous callers can pull a whole master through this route in `full` mode, one Range at a time:
  // bound it per caller and release (a player seeking makes a handful of requests a minute).
  // Only a well-formed release id can mint a bucket: anything else is a 404 before the limiter.
  if (!isUUID(id) || !isUUID(itemId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`store-release-audio:${clientIp(req)}:${id}`, AUDIO_REQUESTS_PER_MINUTE)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  try {
    if (!isSupabaseConfigured() || !isUUID(id) || !isUUID(itemId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const admin = createServiceClient();
    const loaded = await loadPublicRelease(admin, id, new Date(), { itemId });
    const item = loaded?.items.find((i) => i.id.toLowerCase() === itemId.toLowerCase());
    if (!loaded || !item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const plan = publicStreamPlan(loaded.playback, loaded.release.id, item);
    let source: string | null = null;
    if (plan?.kind === 'public-preview') source = promotedPreviewRef(loaded.release.id, item.master_track_id);
    else if (plan?.kind === 'private-master' && orgAudioSourceAllowed(plan.ref, process.env.R2_PRIVATE_BUCKET_NAME)) source = plan.ref;
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const upstream = await streamAudioPreviewSource(req, source);
    const headers = new Headers(upstream.headers);
    // Short, so an unlisted release stops playing within the store's ~90 s window.
    headers.set('cache-control', plan?.kind === 'public-preview' ? 'public, max-age=60, s-maxage=60' : 'private, max-age=60');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    log.error('audio failed', { id, itemId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Audio unavailable' }, { status: 500 });
  }
}

export const GET = handle;
export const HEAD = handle;
