'use client';

import { useEffect } from 'react';
import { enqueuePrefetch } from '@/lib/audio/preview-cache';

type Prefetchable = { id?: string | null; audio_url?: string | null };

/**
 * Background-prefetch the preview clips for a list of tracks the moment a page
 * shows them, so tapping any of them plays instantly from the on-device cache.
 *
 * Only tracks whose `audio_url` is a direct http(s) preview are queued — the
 * proxy-fallback path (a track without a generated preview) is skipped so we
 * never prefetch a full master. Bandwidth/queue limits live in the cache layer.
 */
export function usePreviewPrefetch(tracks: Prefetchable[] | null | undefined): void {
  useEffect(() => {
    if (!tracks?.length) return;
    // Defer to idle so prefetch never competes with first paint / interaction.
    const run = () => {
      const items = tracks
        .filter((t): t is { id: string; audio_url: string } =>
          !!t?.id && !!t?.audio_url && /^https?:\/\//i.test(t.audio_url),
        )
        .map((t) => ({ id: t.id, url: t.audio_url }));
      if (items.length) enqueuePrefetch(items);
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (ric) {
      const handle = ric(run);
      return () => {
        const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
        cic?.(handle);
      };
    }
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [tracks]);
}
