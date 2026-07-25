import { cdnAudioSrc } from '@/lib/audio/cdn';

export function publicPreviewUrl(trackId: string | null | undefined): string | null {
  if (!trackId) return null;
  return `/api/store/preview/${encodeURIComponent(trackId)}`;
}

export function publicPeaksUrl(trackId: string | null | undefined, peaksUrl: string | null | undefined): string | null {
  if (!trackId || !peaksUrl) return null;
  return `/api/store/peaks/${encodeURIComponent(trackId)}`;
}

export function redactPublicTrackMedia<T extends Record<string, unknown>>(track: T): T {
  const id = typeof track.id === 'string' ? track.id : null;
  const preview = typeof track.preview_url === 'string' ? track.preview_url : null;
  const peaks = typeof track.peaks_url === 'string' ? track.peaks_url : null;
  // Prefer streaming the PUBLIC preview derivative straight from R2 (or the CDN
  // when NEXT_PUBLIC_R2_CDN_URL is set) so the player's <audio> element pulls
  // bytes directly instead of routing every play through the origin proxy
  // (/api/store/preview). Direct + Range-capable = near-instant first byte on
  // mobile. The full master is never exposed — preview_url is the truncated,
  // public-by-design clip. Tracks without a generated preview fall back to the
  // proxy, which resolves preview_url||audio_url server-side.
  const directSrc = preview && /^https?:\/\//i.test(preview) ? cdnAudioSrc(preview) : null;
  return {
    ...track,
    audio_url: directSrc ?? publicPreviewUrl(id),
    peaks_url: publicPeaksUrl(id, peaks),
    // Don't surface the raw storage URL as a separate field — audio_url carries
    // the playable source and the private master stays hidden.
    preview_url: null,
    wav_url: null,
  };
}
