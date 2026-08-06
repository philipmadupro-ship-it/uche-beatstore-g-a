'use client';

import { useMemo } from 'react';
import { generateGradient, type ArtworkKind } from '@/lib/artwork/gradient';
import { useBrandArtwork } from '@/hooks/useBrandArtwork';
import { CoverImage } from './CoverImage';
import { cn } from '@/lib/utils';

/**
 * What to show where a cover should be.
 *
 * Resolution order, most specific first:
 *   1. the item's own cover
 *   2. the producer's default artwork, if they have set one
 *   3. a gradient generated from their brand palette, seeded by the item id
 *
 * Step 3 is what keeps step 2 from becoming wallpaper. Forty cards showing the
 * same logo is barely better than forty grey squares — it reads as "nothing
 * here" just as fast. The gradient is derived from the same palette, so the
 * grid still looks like one brand, but no two tiles are the same.
 *
 * The seed must be stable per item, which is why it is required rather than
 * defaulted: seeding on an index or a title would change a cover when the
 * list re-sorted or the track was renamed.
 */
interface ArtworkFallbackProps {
  /** The item's own cover, if it has one. */
  src?: string | null;
  /** Stable identity for the gradient — use the row id, never an index. */
  seed: string;
  alt?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Rendered centred over the gradient (an initial, a glyph). */
  children?: React.ReactNode;
  /**
   * What this artwork belongs to. Projects, playlists and tracks each take a
   * different slice of the palette, so a mixed grid stays legible by category
   * rather than looking like one undifferentiated set.
   */
  kind?: ArtworkKind;
  /** Render only the gradient, with no brand emblem over it. */
  gradientOnly?: boolean;
}

export function ArtworkFallback({
  src,
  seed,
  alt = '',
  className,
  sizes,
  priority,
  children,
  kind = 'track',
  gradientOnly = false,
}: ArtworkFallbackProps) {
  const { defaultArtworkUrl, palette } = useBrandArtwork();

  const gradient = useMemo(() => generateGradient(palette, seed, kind), [palette, seed, kind]);

  // The item's own cover always wins — a real photograph beats anything
  // generated, and this only fills a gap.
  if (src) {
    return <CoverImage src={src} alt={alt} className={className} sizes={sizes} priority={priority} />;
  }

  const showEmblem = !gradientOnly && !!defaultArtworkUrl;

  return (
    <div
      className={cn('relative grid h-full w-full place-items-center overflow-hidden', className)}
      style={{ backgroundImage: gradient.css }}
      // Decorative: the surrounding card always carries the real title, and
      // announcing "generated artwork" on every tile is pure noise.
      role="presentation"
      aria-hidden={!alt}
      aria-label={alt || undefined}
    >
      {showEmblem ? (
        /* The brand image sits ON the gradient rather than replacing it.
           Used full-bleed it was the same logo repeated down a whole screen,
           which reads as "nothing here"; dropped entirely, the artwork lost
           the brand. As a contained emblem over a per-item gradient it does
           both — one recognisable mark, a different background every time.
           `object-contain` because a logo cropped to fill is a logo ruined. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={defaultArtworkUrl!}
          alt=""
          loading="lazy"
          className="pointer-events-none absolute inset-[18%] h-[64%] w-[64%] object-contain opacity-95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
        />
      ) : children ? (
        <span style={{ color: gradient.foreground }} className="opacity-90">
          {children}
        </span>
      ) : null}
    </div>
  );
}
