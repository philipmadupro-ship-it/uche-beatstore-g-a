import { NextResponse } from 'next/server';
import { requireProducer } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { runPreviewBackfill, type PreviewBackfillRow } from '@/lib/audio/preview-backfill';
import { isPreviewableMaster } from '@/lib/audio/preview-candidates';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.tracks.previews.backfill');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One master in memory at a time, ~5–20 s each with ffmpeg.
export const maxDuration = 300;

/** Per click. A single-producer catalogue rarely has more listed beats than this missing a clip. */
const BATCH = 12;

/**
 * POST /api/tracks/previews/backfill
 *
 * Producer-only: generate the public preview clip for the caller's LISTED
 * beats that have none — the beats that are on /store but 404 when a buyer
 * presses play. Same code as the nightly cron (lib/audio/preview-backfill),
 * but it answers the producer with what happened, per track, including why
 * a clip could not be made.
 */
export async function POST() {
  const auth = await requireProducer();
  if (!auth.ok) return auth.res;
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { data, error } = await auth.admin
      .from('tracks')
      .select('id, title, audio_url, duration_seconds, preview_status, preview_url, peaks_url, store_listed, created_at')
      .eq('user_id', auth.userId)
      .eq('store_listed', true)
      .or('preview_status.is.null,preview_status.neq.ready,preview_url.is.null');
    if (error) throw error;
    const rows = (data ?? []) as Array<PreviewBackfillRow & { title?: string | null }>;
    // Only the preview is this button's job; peaks-only rows have their own.
    const needing = rows.filter((r) => !r.preview_url || r.preview_status !== 'ready');
    const result = await runPreviewBackfill(auth.admin, needing, BATCH);
    const titles = new Map(rows.map((r) => [r.id, r.title ?? r.id]));
    // The batch picker skips these silently; the producer needs to hear it.
    const unsupported = needing
      .filter((r) => !isPreviewableMaster(r.audio_url))
      .map((r) => ({ id: r.id, stage: 'source', error: 'Master is not a supported audio file — re-upload it' }));
    return NextResponse.json({
      ...result,
      needed: needing.length,
      failed: result.failed + unsupported.length,
      reasons: [...unsupported, ...result.reasons]
        .filter((r) => r.stage !== 'peaks')
        .map((r) => ({ ...r, title: titles.get(r.id) ?? r.id })),
    });
  } catch (err) {
    log.error('preview backfill failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
