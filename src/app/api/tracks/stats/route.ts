import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { aggregateTrackStats } from '@/lib/library/track-stats';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.tracks.stats');

export const dynamic = 'force-dynamic';

/**
 * Plays, downloads and revenue per track, for the owner's catalogue.
 *
 * A separate endpoint rather than columns on /api/tracks: these come from
 * three other tables, they are only needed when the producer has actually
 * turned those columns on, and joining them into the main catalogue query
 * would slow the common case to serve the uncommon one.
 *
 * Each source degrades independently. A library that renders no rows because
 * the downloads table hiccupped is far worse than one showing a dash in one
 * column.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  try {
    const [plays, downloads, purchases] = await Promise.all([
      auth.admin
        .from('store_play_counts')
        .select('track_id, play_count')
        .eq('seller_user_id', auth.userId)
        .then((r) => r.data ?? [], () => []),
      auth.admin
        .from('store_free_downloads')
        .select('track_id')
        .eq('seller_user_id', auth.userId)
        .then((r) => r.data ?? [], () => []),
      auth.admin
        .from('license_purchases')
        .select('amount_usd, track_ids, line_items, status')
        .eq('seller_user_id', auth.userId)
        .then((r) => r.data ?? [], () => []),
    ]);

    return NextResponse.json({ stats: aggregateTrackStats({ plays, downloads, purchases }) });
  } catch (err) {
    log.error('stats failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
