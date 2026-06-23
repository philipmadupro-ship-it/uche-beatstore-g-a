export function publicPreviewUrl(trackId: string | null | undefined): string | null {
  if (!trackId) return null;
  return `/api/store/preview/${encodeURIComponent(trackId)}`;
}

export function redactPublicTrackMedia<T extends Record<string, unknown>>(track: T): T {
  const id = typeof track.id === 'string' ? track.id : null;
  return {
    ...track,
    audio_url: publicPreviewUrl(id),
    wav_url: null,
  };
}
