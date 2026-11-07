/**
 * Playing a beat from the buyer's account.
 *
 * The library payload (`BuyerLibraryTrackSummary`) carries metadata only, so
 * nothing on /store/account/me could reach the global player. This module
 * turns a summary into the `Track` the existing `usePlayer` store and
 * `PlayerBar` already take, and says where its audio comes from.
 *
 * The source is `/api/store/me/preview/[id]`, not the public
 * `/api/store/preview/[id]`: the public route only serves beats the store
 * lists or a featured bundle holds, and a buyer's exclusive purchase is
 * delisted on sale — so the one beat they paid most for would play nothing.
 * Both routes stream the same public preview clip, never the master.
 */
import type { Track, TrackType } from '@/lib/types';
import type { BuyerLibraryTrackSummary } from '@/lib/store/buyer-library';

/** Which of a buyer's tracks the account may play, from its identity query. */
export function buyerPreviewUrl(trackId: string, identityQuery: string): string {
  return `/api/store/me/preview/${encodeURIComponent(trackId)}?${identityQuery}`;
}

export function buyerPlayerTrack(summary: BuyerLibraryTrackSummary, identityQuery: string): Track {
  return {
    id: summary.id,
    user_id: '',
    title: summary.title?.trim() || 'Untitled beat',
    type: (summary.type ?? 'beat') as TrackType,
    audio_url: buyerPreviewUrl(summary.id, identityQuery),
    preview_url: null,
    wav_url: null,
    peaks_url: null,
    cover_url: summary.cover_url,
    duration_seconds: summary.duration_seconds,
    bpm: summary.bpm,
    key: summary.key,
    scale: summary.scale,
    stems_status: 'none',
  } as Track;
}

/**
 * The queue for a list of library rows: unavailable rows (`null` — deleted or
 * no longer visible to this buyer) are skipped and a beat appears once.
 */
export function buyerPlayerQueue(
  rows: Array<BuyerLibraryTrackSummary | null | undefined>,
  identityQuery: string,
): Track[] {
  const seen = new Set<string>();
  const queue: Track[] = [];
  for (const row of rows) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    queue.push(buyerPlayerTrack(row, identityQuery));
  }
  return queue;
}

/** A purchased line item (loadBuyerPurchases) as the summary the builders take. */
export function purchasedItemSummary(item: {
  track_id: string;
  title?: string | null;
  cover_url?: string | null;
  type?: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  duration_seconds?: number | null;
}): BuyerLibraryTrackSummary {
  return {
    id: item.track_id,
    title: item.title ?? null,
    cover_url: item.cover_url ?? null,
    type: item.type ?? null,
    bpm: item.bpm ?? null,
    key: item.key ?? null,
    scale: item.scale ?? null,
    duration_seconds: item.duration_seconds ?? null,
  };
}
