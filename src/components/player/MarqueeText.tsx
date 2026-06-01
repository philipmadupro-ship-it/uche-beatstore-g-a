'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * MarqueeText — shows `text` normally, but when it's too wide for its
 * container it scrolls horizontally in a seamless loop (Spotify-style),
 * pausing on hover. When it fits, it renders a plain truncated label.
 *
 * The scroll is driven by the Web Animations API (not a CSS keyframe) so it
 * has no dependency on a global stylesheet. Respects prefers-reduced-motion:
 * under that setting it never animates and stays a static truncated title.
 */
export function MarqueeText({ text, className = '' }: { text: string; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const animRef = useRef<Animation | null>(null);
  const [animate, setAnimate] = useState(false);

  // Decide whether the text overflows its container (and motion is allowed).
  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const measure = () => {
      const wrap = wrapRef.current;
      const el = measureRef.current;
      if (!wrap || !el) return;
      const overflow = el.scrollWidth - wrap.clientWidth;
      setAnimate(overflow > 4 && !reduce);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [text]);

  // Drive the seamless scroll once the duplicated track is mounted.
  useEffect(() => {
    animRef.current?.cancel();
    animRef.current = null;
    if (!animate) return;
    const track = trackRef.current;
    if (!track) return;
    // Two identical copies → half the track width is exactly one copy plus its
    // trailing gap, so translating by that distance loops seamlessly.
    const half = track.scrollWidth / 2;
    if (half <= 0) return;
    const duration = Math.max(5000, (half / 35) * 1000); // ~35px/sec, ≥5s
    const anim = track.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(-${half}px)` }],
      { duration, iterations: Infinity, easing: 'linear' },
    );
    animRef.current = anim;
    return () => anim.cancel();
  }, [animate, text]);

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className}`}>
      {/* Hidden natural-width probe — always present so re-measuring works even
          when the title shrinks back to a fitting one. */}
      <span
        ref={measureRef}
        aria-hidden
        className="absolute left-0 top-0 invisible whitespace-nowrap pointer-events-none"
      >
        {text}
      </span>

      {animate ? (
        <div
          ref={trackRef}
          className="flex w-max"
          onMouseEnter={() => animRef.current?.pause()}
          onMouseLeave={() => animRef.current?.play()}
        >
          <span className="whitespace-nowrap pr-8">{text}</span>
          <span className="whitespace-nowrap pr-8" aria-hidden>{text}</span>
        </div>
      ) : (
        <div className="truncate">{text}</div>
      )}
    </div>
  );
}
