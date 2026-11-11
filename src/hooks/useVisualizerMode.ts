'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_VISUAL_MODE, VISUAL_MODE_STORAGE_KEY, parseVisualMode, type VisualMode,
} from '@/lib/visuals/modes';

/** The viewer's chosen visual mode, remembered per browser (localStorage, guarded). */
export function useVisualizerMode(): [VisualMode, (m: VisualMode) => void] {
  const [mode, setMode] = useState<VisualMode>(DEFAULT_VISUAL_MODE);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VISUAL_MODE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read after hydration so SSR markup matches
      if (saved) setMode(parseVisualMode(saved));
    } catch { /* private mode / blocked storage: keep the default */ }
  }, []);

  const choose = useCallback((m: VisualMode) => {
    setMode(m);
    try { window.localStorage.setItem(VISUAL_MODE_STORAGE_KEY, m); } catch { /* ignore */ }
  }, []);

  return [mode, choose];
}
