'use client';

import React from 'react';
import { Play, Pause, Loader2 } from 'lucide-react';

/**
 * The one play/pause control.
 *
 * Every play affordance in the app used to be a solid white disc with a black
 * glyph — the single loudest element on any dark screen, and the one thing that
 * refused to sit inside the Liquid Glass language everything else speaks. This
 * is the translucent replacement: frosted fill, a rim that catches light along
 * the top, and a soft accent bloom that only appears while audio is playing, so
 * "which track is playing" is still readable at a glance without a white disc
 * shouting it.
 *
 * Rendered as a plain <button> with a required `label`, because the icon alone
 * says nothing to a screen reader.
 */

export type GlassPlayButtonSize = 'sm' | 'md' | 'lg';

const SIZES: Record<GlassPlayButtonSize, { box: string; icon: number }> = {
  sm: { box: 'size-7',  icon: 12 },
  md: { box: 'size-10', icon: 15 },
  lg: { box: 'size-12', icon: 18 },
};

export interface GlassPlayButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** Drives the glyph, the pressed styling and the default accessible name. */
  playing?: boolean;
  /** Shows a spinner instead of the glyph — e.g. while a stream buffers. */
  loading?: boolean;
  size?: GlassPlayButtonSize;
  /** Accessible name. Defaults to Play/Pause, but say what is being played
   *  when several of these share a screen ("Play Midnight Drive"). */
  label?: string;
}

export function GlassPlayButton({
  playing = false,
  loading = false,
  size = 'md',
  label,
  className = '',
  disabled,
  ...props
}: GlassPlayButtonProps) {
  const { box, icon } = SIZES[size];
  const accessibleName = label ?? (playing ? 'Pause' : 'Play');

  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-label={accessibleName}
      aria-pressed={playing}
      data-playing={playing ? 'true' : 'false'}
      className={`
        glass-play glass-play-surface grid ${box} shrink-0 place-items-center
        overflow-hidden rounded-full
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent
        disabled:cursor-not-allowed disabled:opacity-40
        ${className}
      `}
    >
      {/* Specular sweep across the top half — the "wet glass" read. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/[0.22] to-transparent"
      />
      {/* Crisp rim highlight. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
      />
      <span className="relative z-10 grid place-items-center">
        {loading ? (
          <Loader2 size={icon} className="glass-play-spin" aria-hidden />
        ) : playing ? (
          <Pause size={icon} fill="currentColor" aria-hidden />
        ) : (
          // Nudged right by a hair — a triangle centred on its bounding box
          // always reads as sitting left of centre inside a circle.
          <Play size={icon} fill="currentColor" className="translate-x-[1px]" aria-hidden />
        )}
      </span>
    </button>
  );
}

export default GlassPlayButton;
