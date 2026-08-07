'use client';

import { useMemo } from 'react';
import { generateGradient, type ArtworkKind } from '@/lib/artwork/gradient';
import { useBrandArtwork } from '@/hooks/useBrandArtwork';
import { useTagColors } from '@/hooks/useTagColors';
import { paletteForTags } from '@/lib/artwork/tag-colors';
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
  /**
   * The item's tags, most significant first.
   *
   * When present the first tag's colour leads the gradient, so everything
   * sharing a tag shares a hue and a catalogue groups by genre on sight.
   * Absent, the artwork falls back to the brand palette exactly as before.
   */
  tags?: readonly string[];
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
  tags,
  gradientOnly = false,
}: ArtworkFallbackProps) {
  // Per-kind: a project falls back to the project image, not the track one.
  const { defaultArtworkUrl, palette } = useBrandArtwork(kind);
  const tagColors = useTagColors();

  const tagged = (tags?.length ?? 0) > 0;
  const gradient = useMemo(
    () => generateGradient(
      tagged ? paletteForTags(tags!, palette, tagColors) : palette,
      seed,
      // A tag palette holds its hue tight so the tag stays recognisable; a
      // brand palette is free to drift, since it has nothing to encode.
      { kind, tagAnchored: tagged },
    ),
    [tagged, tags, palette, tagColors, seed, kind],
  );

  // The item's own cover always wins — a real photograph beats anything
  // generated, and this only fills a gap.
  if (src) {
    return <CoverImage src={src} alt={alt} className={className} sizes={sizes} priority={priority} />;
  }

  const useBrandImage = !gradientOnly && !!defaultArtworkUrl;

  return (
    <div
      className={cn('relative grid h-full w-full place-items-center overflow-hidden', className)}
      // `isolation` matters: the blend layers below must composite against the
      // artwork only. Without it they blend with whatever card, row or page
      // background sits behind, and the same beat looks different depending on
      // where it is rendered.
      style={{
        isolation: 'isolate',
        backgroundImage: useBrandImage ? undefined : gradient.css,
      }}
      // Decorative: the surrounding card always carries the real title, and
      // announcing "generated artwork" on every tile is pure noise.
      role="presentation"
      aria-hidden={!alt}
      aria-label={alt || undefined}
    >
      {useBrandImage ? (
        /* The brand image IS the artwork; the gradient is fused into it
           rather than sitting over it.
           
           As a small centred emblem the two read as two things — a sticker on
           a background — and every tile carried the identical mark. Here the
           image is the base at full bleed and the gradient is blended through
           it, so each cover is one surface: the same brand image, recoloured
           per item. `soft-light` keeps the image's own structure and shadows
           while taking the gradient's hue, which is what makes it read as
           tinted rather than covered. */
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={defaultArtworkUrl!}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Structure and light. Back to `soft-light`: `hard-light` crushed
              the base image into flat colour, and the texture is what makes
              these read as artwork rather than as a shape. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: gradient.css, mixBlendMode: 'soft-light' }}
          />
          {/* Hue. This is the pass that decides what colour a cover IS, so it
              still carries the most weight — but well short of replacing the
              image's own colour entirely. */}
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{ backgroundImage: gradient.css, mixBlendMode: 'color' }}
          />
          {/* Deepens shadow without flattening the image the way a plain
              scrim would. */}
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{ backgroundImage: gradient.css, mixBlendMode: 'overlay' }}
          />
          {/* Anchors the result into the app's near-black. Without it a light
              brand image stays light and the grid glows. */}
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{ backgroundImage: gradient.css }}
          />
        </>
      ) : children ? (
        <span style={{ color: gradient.foreground }} className="opacity-90">
          {children}
        </span>
      ) : null}
    </div>
  );
}
