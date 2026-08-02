'use client';

/**
 * Whether the viewer has asked for reduced motion.
 *
 * Live, not a one-shot read at mount: someone who turns the setting on while a
 * page is open should have animation stop immediately, which a captured boolean
 * cannot do. (The same bug was fixed in `AsciiCoverArt`.)
 *
 * Built on `useSyncExternalStore` rather than `useState` + `useEffect`. A media
 * query IS an external store, and this is the primitive React provides for one:
 * it subscribes without a state write inside an effect, and takes an explicit
 * server snapshot so SSR and hydration agree instead of flashing.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Server renders as "motion allowed" so the markup matches the common case and
 * the client corrects it on the first commit. The alternative — assuming
 * reduced — would make every animation flicker on for users who did not ask
 * for it.
 */
function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
