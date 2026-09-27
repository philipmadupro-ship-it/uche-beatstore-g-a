import { NextResponse } from 'next/server';
import { requireProducer } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { runPreviewBackfill, type PreviewBackfillRow } from '@/lib/audio/preview-backfill';
import { isPreviewableMaster } from '@/lib/audio/preview-candidates';
import { bundlePreviewCandidates, mergeCandidates } from '@/lib/store/public-preview-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.tracks.previews.backfill');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One master in memory at a time, ~5–20 s each with ffmpeg.
export const maxDuration = 300;

/** Per click. A single-producer catalogue rarely has more listed beats than this missing a clip. */
const BATCH = 12;

const isWavPreview = (url: string | null | undefined) => typeof url === 'string' && /\.wav(?:\?|$)/i.test(url);

/**
 * POST /api/tracks/previews/backfill
 *
 * Producer-only: generate the public preview clip for the caller's LISTED
 * beats, and beats in their featured bundles, that have none — the beats
 * that are on /store but 404 when a buyer presses play. Same code as the nightly cron (lib/audio/preview-backfill),
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
    const select = 'id, user_id, title, audio_url, duration_seconds, preview_status, preview_url, peaks_url, store_listed, created_at';
    const { data, error } = await auth.admin
      .from('tracks')
      .select(select)
      .eq('user_id', auth.userId)
      .eq('store_listed', true);
    if (error) throw error;
    type Row = PreviewBackfillRow & { title?: string | null; user_id?: string | null };
    // Beats public only through one of this producer's featured bundles play
    // on the bundle page too, so they need a clip as much as listed ones.
    const rows = mergeCandidates(
      (data ?? []) as Row[],
      // No status filter, as for listed rows: ready WAV clips may be re-made below.
      await bundlePreviewCandidates<Row>(auth.admin, select, undefined, auth.userId),
    );
    // Only the preview is this button's job; peaks-only rows have their own.
    const { ffmpegStatus } = await import('@/lib/audio/convert');
    const ffmpeg = await ffmpegStatus();
    // A byte-truncated WAV clip plays, but it is tens of MB. Once ffmpeg runs,
    // re-make those as ~1 MB MP3s; without it, redoing them changes nothing.
    const needing = rows
      .filter((r) => !r.preview_url || r.preview_status !== 'ready' || (ffmpeg.available && isWavPreview(r.preview_url)))
      .map((r) => (r.preview_url && isWavPreview(r.preview_url) ? { ...r, preview_status: 'none' } : r));
    const result = await runPreviewBackfill(auth.admin, needing, BATCH);
    const titles = new Map(rows.map((r) => [r.id, r.title ?? r.id]));
    // The batch picker skips these silently; the producer needs to hear it.
    const unsupported = needing
      .filter((r) => !isPreviewableMaster(r.audio_url))
      .map((r) => ({ id: r.id, stage: 'source', error: 'Master is not a supported audio file — re-upload it' }));
    return NextResponse.json({
      ...result,
      needed: needing.length,
      // Without ffmpeg a clip is a byte-truncated WAV (tens of MB), not a ~1 MB MP3.
      ffmpeg: {
        available: ffmpeg.available,
        reason: ffmpeg.available ? null : ffmpeg.attempts.map((a) => `${a.bin}: ${a.error}`).join(' · '),
      },
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
