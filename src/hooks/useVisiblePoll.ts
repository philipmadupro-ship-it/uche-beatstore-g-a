'use client';

import { useEffect, useRef } from 'react';

/**
 * Call `fn` every `intervalMs` while the tab is visible, and once right away
 * when a hidden tab becomes visible again (the thing most likely to have
 * changed is whatever happened while the user was away). A hidden tab makes
 * no requests. `fn` may change between renders without restarting the timer.
 * `enabled: false` stops it.
 */
export function useVisiblePoll(fn: () => void | Promise<void>, intervalMs: number, enabled = true): void {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; }, [fn]);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => { void ref.current(); };
    const start = () => { if (!timer) timer = setInterval(tick, intervalMs); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { tick(); start(); } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [intervalMs, enabled]);
}
