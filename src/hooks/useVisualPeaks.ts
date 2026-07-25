'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadVisualPeaks, resampleVisualPeaks, syntheticVisualPeaks } from '@/lib/audio/visual-peaks';

export function useVisualPeaks(trackId: string, peaksUrl: string | null | undefined, count: number) {
  const fallbackPeaks = useMemo(() => syntheticVisualPeaks(trackId, count), [count, trackId]);
  const loadKey = `${trackId}:${peaksUrl ?? ''}:${count}`;
  const [loaded, setLoaded] = useState<{ key: string; peaks: number[] } | null>(null);

  useEffect(() => {
    if (!peaksUrl) return;
    const controller = new AbortController();
    loadVisualPeaks(peaksUrl, controller.signal).then((rawPeaks) => {
      if (!rawPeaks || controller.signal.aborted) return;
      setLoaded({ key: loadKey, peaks: resampleVisualPeaks(rawPeaks, count) });
    });
    return () => controller.abort();
  }, [count, loadKey, peaksUrl]);

  return loaded?.key === loadKey
    ? { peaks: loaded.peaks, source: 'real' as const }
    : { peaks: fallbackPeaks, source: 'synthetic' as const };
}
