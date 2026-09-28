'use client';

import NextImage from 'next/image';
import { useState } from 'react';
import { isOptimizableImageSrc } from '@/lib/images/remote-hosts';
import { cn } from '@/lib/utils';

/**
 * Cover-art image with next/image optimization (resize + AVIF/WebP) and a
 * safe fallback.
 *
 * next/image can't handle blob: / data: URLs (offline-cached covers) or
 * arbitrary unconfigured hosts — for those we fall back to a plain <img>.
 * We also fall back if the optimizer errors at runtime, so a covered host
 * that isn't allowlisted never shows a broken image.
 *
 * The host check has to happen BEFORE the render, not in `onError`: next/image
 * throws for an unconfigured hostname rather than firing an error event, so a
 * cover pasted from anywhere else on the internet took down every page that
 * rendered that track. The allowlist is shared with next.config.ts so the two
 * cannot drift — see lib/images/remote-hosts.
 *
 * Drop-in for the storefront `<img className="... object-cover" />` covers:
 * pass the same className; we fill the parent (which must be `relative` and
 * sized) via `fill`.
 */
interface CoverImageProps {
  src: string;
  alt?: string;
  className?: string;
  /** Responsive sizes hint for the optimizer. Defaults to a small card. */
  sizes?: string;
  /** eager for above-the-fold hero covers; lazy (default) for grids. */
  priority?: boolean;
}



export function CoverImage({ src, alt = '', className, sizes = '(max-width: 640px) 50vw, 200px', priority = false }: CoverImageProps) {
  const [errored, setErrored] = useState(false);

  if (!isOptimizableImageSrc(src) || errored) {
    // blob:/data: covers, a host we haven't allowlisted, or a runtime
    // optimizer failure → plain img.
    //
    // It must fill the box the way `fill` does, or callers' `object-cover`
    // has nothing to act on: an unsized <img> renders at its natural aspect,
    // so a portrait cover was cut off at the top-left and a landscape one
    // left the bottom of the tile empty. Sized in flow rather than absolute,
    // so a parent that forgot `relative` still contains it.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={cn('block h-full w-full', className)} loading={priority ? 'eager' : 'lazy'} />;
  }

  return (
    <NextImage
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={className}
      onError={() => setErrored(true)}
      unoptimized={false}
    />
  );
}
