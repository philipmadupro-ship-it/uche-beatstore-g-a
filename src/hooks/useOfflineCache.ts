'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cacheTrack,
  getCachedMeta,
  listCached,
  OfflineMeta,
  removeCached,
} from '@/lib/offline/audio-cache';
import { audioSrc } from '@/lib/audio/url';
import { errorMessage } from '@/lib/errors';
import {
  deriveOfflineStatus,
  formatOfflineSize,
  offlineRemovedAnnouncement,
  offlineStatusAnnouncement,
  type OfflineStatus,
} from '@/lib/offline/status';
import { toast } from '@/hooks/useToast';

export function useOfflineCache() {
  const [cached, setCached] = useState<OfflineMeta[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await listCached();
      setCached(list);
    } catch {
      setCached([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cached, refresh, refreshing };
}

/**
 * The single implementation behind both offline-download surfaces —
 * `OfflineToggle` (button/compact) and `TrackCard`'s ⋯ menu item. Both used
 * to keep parallel copies of this state; collapsing it here means a status
 * word or an announcement can't drift between the two. See `lib/offline/status.ts`
 * for the status derivation and label/announcement text.
 */
export function useOfflineTrack(trackId: string | null | undefined) {
  const [meta, setMeta] = useState<OfflineMeta | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Screen-reader text for the shared `role="status"` region each surface
  // renders. Set only on a STATUS transition (see the effect below), never
  // per progress tick — announcing every percentage point would fire the
  // live region dozens of times over one download.
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const titleRef = useRef<string>('');
  const prevStatusRef = useRef<OfflineStatus>('idle');

  const isCached = !!meta;
  const status = deriveOfflineStatus({ isCached, downloading, error });

  const refresh = useCallback(async () => {
    if (!trackId) return;
    try {
      const m = await getCachedMeta(trackId);
      setMeta(m);
      if (m) titleRef.current = m.title;
    } catch {
      // IndexedDB unavailable (private browsing, SSR/test environment) — the
      // row just renders as "not cached" rather than throwing.
      setMeta(null);
    }
  }, [trackId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (status === prevStatusRef.current) return;
    prevStatusRef.current = status;
    const text = offlineStatusAnnouncement(status, {
      title: titleRef.current,
      sizeLabel: meta ? formatOfflineSize(meta.size) : null,
      error,
    });
    if (text) setAnnouncement(text);
  }, [status, meta, error]);

  const download = useCallback(
    async (rawUrl: string, title: string) => {
      if (!trackId) return;
      titleRef.current = title;
      setError(null);
      setDownloading(true);
      setProgress(0);
      try {
        const m = await cacheTrack(
          trackId,
          audioSrc(rawUrl),
          title,
          (loaded, total) => {
            if (total > 0) setProgress(loaded / total);
          },
          (evicted) => {
            // Explicit saves are never dropped silently — see
            // lib/offline/eviction.ts for why this is oldest-saved-first and
            // capped generously rather than an LRU-by-use policy.
            const names = evicted.map((e) => e.title).filter(Boolean).join(', ');
            toast.info(
              'Made room offline',
              `Removed ${evicted.length} older offline save${evicted.length === 1 ? '' : 's'}${names ? ` (${names})` : ''} to fit "${title}".`,
            );
          }
        );
        setMeta(m);
      } catch (e: unknown) {
        setError(errorMessage(e));
      } finally {
        setDownloading(false);
      }
    },
    [trackId]
  );

  const remove = useCallback(async () => {
    if (!trackId) return;
    const removedTitle = meta?.title || titleRef.current;
    await removeCached(trackId);
    setMeta(null);
    if (removedTitle) setAnnouncement(offlineRemovedAnnouncement(removedTitle));
  }, [trackId, meta]);

  return {
    meta,
    isCached,
    downloading,
    progress,
    error,
    status,
    announcement,
    download,
    remove,
    refresh,
  };
}
