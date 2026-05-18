'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js on mount. Kept as a tiny client component so the
 * root layout stays a server component (the metadata/viewport
 * exports require it).
 *
 * The SW itself caches the app shell and falls back to /offline for
 * navigation requests when the network is gone. Track audio uses a
 * separate IndexedDB store (src/lib/offline/audio-cache.ts) and is
 * intentionally NOT cached here — each system has one job.
 *
 * Skipped in dev because Next's HMR + a live SW intercepting fetches
 * is a recipe for confusing "why didn't my edit show up" moments.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (err) {
        // Best-effort — SW failure shouldn't break the app.
        console.warn('SW registration failed:', err);
      }
    };

    // Defer until after first paint so the registration doesn't
    // compete with hydration.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
