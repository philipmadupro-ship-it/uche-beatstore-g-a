import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';

const log = createLogger('store.mp3-alert');

type AlertClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { eq: (col: string, val: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> } };
    };
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/**
 * A buyer asked for the MP3 they paid for and it could not be made (ffmpeg
 * missing on this host, or the master unreadable). The buyer is told it is
 * being prepared; the producer has to hear about it or the sale just sits.
 * One notification per track, however many buyers hit it: same dedupe
 * convention as /api/cron/fulfillment-alerts. Best-effort — an alert that
 * fails to write must not change what the buyer is told.
 */
export async function alertMp3Unavailable(
  admin: AlertClient,
  params: { sellerUserId: string | null; trackId: string; title: string | null },
): Promise<void> {
  const { sellerUserId, trackId, title } = params;
  log.error('delivery MP3 unavailable', { trackId });
  if (!sellerUserId) return;
  try {
    const dedupeKey = `mp3_unavailable_${trackId}`;
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', sellerUserId)
      .eq('data->>dedupe_key', dedupeKey)
      .maybeSingle();
    if (existing) return;
    const { error } = await admin.from('notifications').insert({
      user_id: sellerUserId,
      kind: 'fulfillment_alert',
      title: `A buyer's MP3 could not be made — ${title || 'a track'}`,
      body: 'A lease buyer asked for the MP3 and it could not be generated from the master. Upload an MP3 version of the track, or check that ffmpeg is available.',
      data: { dedupe_key: dedupeKey, track_id: trackId, alert_kind: 'mp3_unavailable' },
    });
    if (error) log.warn('mp3 alert insert failed', { error: error.message });
  } catch (err) {
    log.warn('mp3 alert threw', { error: errorMessage(err) });
  }
}
