import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { isUUID } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { publicStreamPlan } from '@/lib/labelos/store-listing';
import { clientIp, rateLimit, rateLimitDurable } from '@/lib/security/rate-limit';
import { loadPublicRelease } from '@/lib/labelos/store-listing-store';
import { promotedPreviewRef } from '@/lib/storage/store-release-media';
import { openFullDerivative } from '@/lib/storage/org-derivative';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.releases.audio');

/** Per IP and release. Generous for a listener (a seek is a request), small for a scraper. */
const AUDIO_REQUESTS_PER_MINUTE = 90;

/**
 * Full-length playback (LABEL-72) is the one thing here worth scraping, so it has a second, DURABLE bound per
 * caller across every release (Postgres-backed, shared by all instances): each response is at most one capped
 * chunk of the lossy derivative, and a player seeking through a song makes a handful of requests a minute.
 */
const FULL_REQUESTS_PER_MINUTE = 120;

/**
 * GET /api/store/releases/[id]/audio/[itemId] (LABEL-42, D8, LABEL-72) — play one item
 * of a listed release. The handle is the release ITEM (never an org track id),
 * and the release must be listed, still deliverable and the store owner's.
 *
 *  - `preview` plays only the promoted copy in the PUBLIC bucket
 *    (`store-releases/<release>/<master>`); an item that was never promoted
 *    is 404, never the private clip or the master. A release listed as a
 *    teaser before its date is always `preview`.
 *  - `full` plays only from the release date (the playback is derived on
 *    every read: `effectivePlayback`) and streams the lossy full-length
 *    DERIVATIVE of the master from the PRIVATE bucket, through the server.
 *    The master is not reachable from here at all: no plan names it, and a
 *    missing derivative is a 404, not a fallback. Every response is a bounded
 *    partial (206) — a request with no Range, or an open-ended one, gets the
 *    first chunk — and each caller has a durable per-IP limit.
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

    const plan = publicStreamPlan(loaded.playback, loaded.release.id, item, loaded.release.org_id);
    if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (plan.kind === 'private-derivative') {
      if (!(await rateLimitDurable(`store-release-full:${clientIp(req)}`, FULL_REQUESTS_PER_MINUTE))) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
      }
      const res = await openFullDerivative(plan.orgId, plan.masterTrackId, req.headers.get('range'));
      if (!res) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const headers = new Headers(res.headers);
      headers.set('cache-control', loaded.consentGoverned ? 'no-store' : 'private, max-age=60');
      return new Response(res.body, { status: res.status, headers });
    }

    const source = promotedPreviewRef(loaded.release.id, item.master_track_id);
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const upstream = await streamAudioPreviewSource(req, source);
    const headers = new Headers(upstream.headers);
    // Short, so an unlisted release stops playing within the store's ~90 s window.
    headers.set('cache-control', loaded.consentGoverned ? 'no-store' : 'public, max-age=60, s-maxage=60');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    log.error('audio failed', { id, itemId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Audio unavailable' }, { status: 500 });
  }
}

export const GET = handle;
export const HEAD = handle;
