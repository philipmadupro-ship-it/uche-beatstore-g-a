'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCachedMeta, getOfflineSrc, revokeOfflineSrc } from '@/lib/offline/audio-cache';
import { audioSrc } from '@/lib/audio/url';

export function useResolvedAudioSrc(trackId: string | null | undefined, rawUrl: string | null | undefined) {
  const [resolved, setResolved] = useState<string>(audioSrc(rawUrl));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!trackId) {
        setResolved(audioSrc(rawUrl));
        return;
      }
      try {
        const off = await getOfflineSrc(trackId);
        if (cancelled) return;
        setResolved(off || audioSrc(rawUrl));
      } catch {
        if (!cancelled) setResolved(audioSrc(rawUrl));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId, rawUrl]);

  return resolved;
}

/**
 * Offline-first src for a media element (AUDIO-01) — the Studio's resolver.
 *
 *  - Starts on the ONLINE src, so playback never waits on IndexedDB.
 *  - Swaps to the saved copy only when one exists AND is current (a stale copy
 *    — `contentKey` differs from the file now — is ignored; rows with no
 *    fingerprint read as current).
 *  - `onError` drops back to the online src for good: a blob that fails to
 *    load must never mean silence.
 */
export function useOfflineFirstSrc(
  cacheId: string | null | undefined,
  rawUrl: string | null | undefined,
  contentKey?: string | null,
) {
  const online = audioSrc(rawUrl);
  const [offline, setOffline] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOffline(null);
    setFailed(false);
    if (!cacheId) return;
    (async () => {
      try {
        const meta = await getCachedMeta(cacheId);
        if (!meta || cancelled) return;
        if (contentKey && meta.contentKey && meta.contentKey !== contentKey) return;
        const src = await getOfflineSrc(cacheId);
        if (!cancelled && src) setOffline(src);
      } catch {
        /* IndexedDB unavailable: stay online */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheId, contentKey, rawUrl]);

  const onError = useCallback(() => {
    if (!offline) return;
    setFailed(true);
    // The blob URL is bad; drop it so the next lookup rebuilds it from the blob.
    if (cacheId) revokeOfflineSrc(cacheId);
  }, [offline, cacheId]);

  const usingOffline = !!offline && !failed;
  return { src: usingOffline ? (offline as string) : online, usingOffline, onError };
}
