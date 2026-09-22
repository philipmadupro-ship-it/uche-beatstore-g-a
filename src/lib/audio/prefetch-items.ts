/**
 * Which tracks may be prefetched into the preview cache, and from where.
 *
 * Only a direct http(s) URL qualifies. A track without a generated preview
 * falls back to the authenticated proxy, whose `audio_url` is an opaque
 * `r2://` reference to the MASTER — prefetching that would pull full-size
 * WAVs into a cache meant for short preview clips, on every page view.
 *
 * This rule used to live inline in `usePreviewPrefetch`. Keyboard auditioning
 * prefetches too, and a second inline copy is exactly how one of them would
 * eventually stop excluding masters. Both now read it from here.
 */
export interface PrefetchCandidate {
  id?: string | null;
  audio_url?: string | null;
}

export function prefetchItemsFor(
  tracks: ReadonlyArray<PrefetchCandidate | null | undefined>,
): Array<{ id: string; url: string }> {
  const items: Array<{ id: string; url: string }> = [];
  for (const t of tracks) {
    if (!t?.id || !t.audio_url) continue;
    if (!/^https?:\/\//i.test(t.audio_url)) continue;
    items.push({ id: t.id, url: t.audio_url });
  }
  return items;
}
