'use client';

/**
 * Dominant colour of a track's cover art, for tinting the Now Playing overlay.
 *
 * Returns null while extracting, and null when there is no cover at all — the
 * caller renders its untinted default in both cases rather than flashing a
 * stale colour from the previous track.
 */

import { useEffect, useState } from 'react';
import { extractCoverColor } from '@/lib/audio/cover-color';

export function useAmbientCoverColor(coverUrl: string | null | undefined): string | null {
  const [ambient, setAmbient] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!coverUrl) return;
    extractCoverColor(coverUrl).then((c) => { if (!cancelled) setAmbient(c); });
    return () => { cancelled = true; };
  }, [coverUrl]);

  // Gate on the current cover so a track without one never inherits the
  // previous track's colour while its own extraction is pending.
  return coverUrl ? ambient : null;
}
