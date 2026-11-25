'use client';

import { forwardRef, type AudioHTMLAttributes } from 'react';
import { useOfflineFirstSrc } from '@/hooks/useResolvedAudioSrc';

interface Props extends Omit<AudioHTMLAttributes<HTMLAudioElement>, 'src'> {
  /** IndexedDB key (track id for a master, asset id for a stem). */
  cacheId: string;
  /** The stored/proxied reference to play when nothing current is saved. */
  rawUrl: string;
  /** Fingerprint of the file now (`assetContentKey`), to ignore a stale copy. */
  contentKey?: string | null;
}

/**
 * The Studio's <audio>: the saved offline copy when there is a current one,
 * the normal online src otherwise, and the online src again if the saved copy
 * fails to load. Same element, same ref, same events as before — only the src
 * resolver changed (AUDIO-01).
 */
export const OfflineFirstAudio = forwardRef<HTMLAudioElement, Props>(function OfflineFirstAudio(
  { cacheId, rawUrl, contentKey, onError, ...rest },
  ref,
) {
  const { src, usingOffline, onError: fallback } = useOfflineFirstSrc(cacheId, rawUrl, contentKey);
  return (
    <audio
      {...rest}
      ref={ref}
      src={src}
      data-offline={usingOffline ? 'true' : undefined}
      onError={(e) => {
        fallback();
        onError?.(e);
      }}
    />
  );
});
