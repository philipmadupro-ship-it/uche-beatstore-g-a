'use client';

/**
 * Which storefront breakpoint the viewer is actually on.
 *
 * MOST per-breakpoint behaviour must NOT come through here. Section visibility
 * is emitted as CSS classes (`visibilityClasses`) precisely because `/store` is
 * server-rendered and edge-cached: branching in JS would bake one device's
 * layout into HTML that is then served to every device.
 *
 * This exists for the narrow case where the difference is not something CSS can
 * express — where the two variants are different COMPONENTS rather than
 * different styling. The hero is the one instance today: its default draws the
 * producer's name with `ParticleText`, a canvas running an animation loop, and
 * the whole point of the plain variant is that a phone never instantiates it.
 * Rendering both and hiding one with CSS would run the canvas anyway, which is
 * the cost the variant exists to avoid.
 *
 * Returns `desktop` on the first render — server and client alike — so the
 * hydrated HTML always matches, then corrects after mount. This is the same
 * shape as the grid/list preference this page already hydrates post-mount.
 */

import { useEffect, useState } from 'react';
import { breakpointWidths, type StoreBreakpoint } from '@/lib/store-editor/layout';

/** Tailwind's md/lg boundaries, which `visibilityClasses` also targets. */
const TABLET_MIN = 768;
const DESKTOP_MIN = 1024;

export function breakpointForWidth(width: number): StoreBreakpoint {
  if (width >= DESKTOP_MIN) return 'desktop';
  if (width >= TABLET_MIN) return 'tablet';
  return 'mobile';
}

export function useStoreBreakpoint(): StoreBreakpoint {
  const [breakpoint, setBreakpoint] = useState<StoreBreakpoint>('desktop');

  useEffect(() => {
    const read = () => setBreakpoint(breakpointForWidth(window.innerWidth));
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  return breakpoint;
}

/** Exported so the editor and the storefront agree on the device widths. */
export { breakpointWidths };
