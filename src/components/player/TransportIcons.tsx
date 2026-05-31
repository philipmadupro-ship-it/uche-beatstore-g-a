/**
 * Luxury transport glyphs — refined, minimalist play/pause/skip icons that
 * replace the stock lucide set across every player surface (store + dashboard).
 *
 * Design: filled shapes with softly rounded corners (achieved via a matching
 * round-joined stroke), generous negative space, balanced optical weight. They
 * read as one elegant icon family rather than utilitarian UI glyphs.
 *
 * Drop-in compatible with the lucide API we were using: accept `size` +
 * `className` + any SVG prop (e.g. `fill="currentColor"` call sites still work).
 */

import type { SVGProps } from 'react';

interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, 'fill'> {
  size?: number;
  fill?: string;
}

function Svg({ size = 24, className, children, ...rest }: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function PlayGlyph(props: GlyphProps) {
  // Rounded right-pointing triangle. The matching round-joined stroke softens
  // the three corners for that premium, liquid feel.
  return (
    <Svg {...props}>
      <path
        d="M9 6.3 L17.6 12 L9 17.7 Z"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function PauseGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <rect x="7" y="5.2" width="3.4" height="13.6" rx="1.7" />
      <rect x="13.6" y="5.2" width="3.4" height="13.6" rx="1.7" />
    </Svg>
  );
}

export function PrevGlyph(props: GlyphProps) {
  // Bar on the left + a left-pointing rounded triangle ( |◀ ).
  return (
    <Svg {...props}>
      <rect x="6" y="5.6" width="2.4" height="12.8" rx="1.2" />
      <path
        d="M18.4 6.6 L11 12 L18.4 17.4 Z"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function NextGlyph(props: GlyphProps) {
  // A right-pointing rounded triangle + bar on the right ( ▶| ).
  return (
    <Svg {...props}>
      <path
        d="M5.6 6.6 L13 12 L5.6 17.4 Z"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <rect x="15.6" y="5.6" width="2.4" height="12.8" rx="1.2" />
    </Svg>
  );
}
