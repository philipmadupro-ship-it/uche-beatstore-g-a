'use client';

import { useEffect, useRef } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { usePlayerReactivity } from '@/hooks/usePlayerReactivity';
import { backdropFrame, RESTING_FRAME, smooth } from '@/lib/audio/reactive-backdrop';

/**
 * A soft glow behind a hero that breathes with whatever is playing.
 *
 * Two blurred radial washes in white-at-alpha — no new colours; the page's
 * own artwork and accent stay the only colour on screen. Bass swells the low
 * wash, overall level lifts the high one. Nothing plays → a still resting
 * glow. Reduced motion → the resting glow, always.
 *
 * Driven by writing CSS variables from a rAF loop into one element, not by
 * React state, so a hero never re-renders at 60fps. Pointer-events none and
 * aria-hidden: purely decorative, placed inside a `relative` hero.
 */
/** `className` positions and layers it; the default suits a plain hero. */
export function MusicReactiveBackdrop({ className = 'inset-0 -z-10' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (f: typeof RESTING_FRAME) => {
      el.style.setProperty('--rb-bass-scale', f.bassScale.toFixed(3));
      el.style.setProperty('--rb-bass-opacity', f.bassOpacity.toFixed(3));
      el.style.setProperty('--rb-level-opacity', f.levelOpacity.toFixed(3));
    };
    // Low-power devices get the still glow: a 60fps loop behind every page
    // title is not worth a phone's battery.
    const lowPower = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
    if (reduced || lowPower) { apply(RESTING_FRAME); return; }

    let raf = 0;
    const cur = { ...RESTING_FRAME };
    const tick = () => {
      const { level, bass, playing } = usePlayerReactivity.getState();
      const target = backdropFrame(level, bass, playing);
      cur.bassScale = smooth(cur.bassScale, target.bassScale);
      cur.bassOpacity = smooth(cur.bassOpacity, target.bassOpacity);
      cur.levelOpacity = smooth(cur.levelOpacity, target.levelOpacity);
      apply(cur);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <div ref={ref} aria-hidden className={`pointer-events-none absolute overflow-hidden ${className}`}>
      <div
        className="absolute -bottom-1/2 left-[-10%] h-[140%] w-[70%] rounded-full blur-3xl"
        style={{
          background: 'radial-gradient(closest-side, rgba(255,255,255,0.14), transparent)',
          opacity: 'var(--rb-bass-opacity, 0.22)',
          transform: 'scale(var(--rb-bass-scale, 1))',
          transformOrigin: '30% 80%',
        }}
      />
      <div
        className="absolute -top-1/3 right-[-5%] h-[110%] w-[55%] rounded-full blur-3xl"
        style={{
          background: 'radial-gradient(closest-side, rgba(255,255,255,0.10), transparent)',
          opacity: 'var(--rb-level-opacity, 0.12)',
        }}
      />
    </div>
  );
}
