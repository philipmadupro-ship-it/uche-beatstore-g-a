'use client';

import { useMemo } from 'react';
import { generateGradient } from '@/lib/artwork/gradient';
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
   * Skip the producer's default image and go straight to a gradient.
   *
   * Set on the catalogue's track rows and cards. With 55 of 59 beats lacking
   * a cover, using the default image there rendered the same logo 46 times
   * down one screen — which reads as "nothing here" just as fast as the grey
   * glyphs it replaced. The image is still doing its job: it is where the
   * palette comes from. It just is not repeated as the artwork itself.
   *
   * Left off wherever artwork appears alone or a handful at a time, where a
   * real image beats a generated one.
   */
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
  gradientOnly = false,
}: ArtworkFallbackProps) {
  const { defaultArtworkUrl, palette } = useBrandArtwork();

  const gradient = useMemo(() => generateGradient(palette, seed), [palette, seed]);

  const resolved = src || (gradientOnly ? null : defaultArtworkUrl);
  if (resolved) {
    return <CoverImage src={resolved} alt={alt} className={className} sizes={sizes} priority={priority} />;
  }

  return (
    <div
      className={cn('grid h-full w-full place-items-center', className)}
      style={{ backgroundImage: gradient.css }}
      // Decorative: the surrounding card always carries the real title, and
      // announcing "generated artwork" on every tile is pure noise.
      role="presentation"
      aria-hidden={!alt}
      aria-label={alt || undefined}
    >
      {children && (
        <span style={{ color: gradient.foreground }} className="opacity-90">
          {children}
        </span>
      )}
    </div>
  );
}
