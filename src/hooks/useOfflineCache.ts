'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cacheTrack,
  getCachedMeta,
  listCached,
  OfflineMeta,
  removeCached,
} from '@/lib/offline/audio-cache';
import { audioSrc } from '@/lib/audio/url';
import { errorMessage } from '@/lib/errors';

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

export function useOfflineTrack(trackId: string | null | undefined) {
  const [meta, setMeta] = useState<OfflineMeta | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!trackId) return;
    const m = await getCachedMeta(trackId);
    setMeta(m);
  }, [trackId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const download = useCallback(
    async (rawUrl: string, title: string) => {
      if (!trackId) return;
      setError(null);
      setDownloading(true);
      setProgress(0);
      try {
        const m = await cacheTrack(trackId, audioSrc(rawUrl), title, (loaded, total) => {
          if (total > 0) setProgress(loaded / total);
        });
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
    await removeCached(trackId);
    setMeta(null);
  }, [trackId]);

  return { meta, isCached: !!meta, downloading, progress, error, download, remove, refresh };
}
