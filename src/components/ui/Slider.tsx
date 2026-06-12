'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  /** Visible tooltip bubble while dragging. */
  showTooltip?: boolean;
  /** Format the tooltip number. Defaults to round-to-int. */
  formatTooltip?: (v: number) => string;
  /** Accent color override. Defaults to the app purple. */
  accent?: string;
  /** Tinted active range fill (e.g. for loop region overlays). Hidden by default. */
  tinted?: boolean;
  /**
   * Visual style.
   *   - `default` (UI controls — settings, library volumes): thumb hidden
   *     at rest, slim 3px rail. Visually quiet.
   *   - `studio` (audio controls — mixer, transport, FX): thumb always
   *     visible, 5px rail, double-click on the rail snaps to the
   *     bipolar center (when `bipolar` is set). Reads from across the
   *     room and feels physical.
   */
  variant?: 'default' | 'studio';
  /**
   * For symmetric ranges centered on 0 (pan, pitch, EQ gain). Adds a
   * subtle tick mark at the midpoint and, in `studio` variant, fills
   * the range FROM the center instead of the left edge — same idiom
   * Ableton / Logic use for bipolar controls so the visual matches
   * the audio meaning (zero = no effect).
   */
  bipolar?: boolean;
  'aria-label'?: string;
}

/**
 * Custom slider replacing native `<input type="range">`.
 *
 * Visual brief: dark-theme-native, thin track (h-1.5), subtle thumb that
 * scales up on hover, gradient fill on the active range, optional
 * tooltip bubble while dragging.
 *
 * Implementation: native input under the hood for free keyboard / a11y /
 * touch support. The thumb and track are absolutely positioned siblings
 * keyed off the input's value via percentage math — the input itself is
 * invisible but covers the full hit-target so drag / arrow keys work.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  className,
  showTooltip = false,
  formatTooltip,
  accent = '#E7D7BE',
  tinted = false,
  variant = 'default',
  bipolar = false,
  'aria-label': ariaLabel,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const rangeRef = useRef<HTMLInputElement>(null);

  // Percentage of the slider track that's "filled". Used for both the
  // gradient range fill and to position the custom thumb.
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  // Center % for bipolar ranges (where 0 lives on the rail). For pan
  // (-1..1) this is 50%; for asymmetric ranges (e.g. -6dB to +18dB)
  // it places the detent at the actual zero point, not always
  // visually center.
  const zeroPct = max > min && min < 0 && max > 0 ? (-min / (max - min)) * 100 : 50;

  const stop = useCallback(() => setDragging(false), []);
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging, stop]);

  // Variant-driven dimensions. Studio variant gets a thicker rail,
  // larger always-visible thumb, slightly taller hit-target.
  const isStudio = variant === 'studio';
  const railHeightClass = isStudio ? 'h-[5px]' : 'h-[3px]';
  const hitHeightClass = isStudio ? 'h-6' : 'h-5';
  const thumbDim = isStudio ? 14 : 10;

  // For bipolar studio sliders the active fill spans from the zero
  // detent to the thumb, not from the left edge. Outside studio mode
  // we keep the conventional left-to-thumb fill so legacy callers
  // don't break visually.
  const fillFromCenter = isStudio && bipolar;
  const fillLeft = fillFromCenter ? Math.min(pct, zeroPct) : 0;
  const fillRight = fillFromCenter ? Math.max(pct, zeroPct) : pct;
  const fillWidth = fillFromCenter ? Math.abs(pct - zeroPct) : pct;

  return (
    <div className={cn('relative w-full group flex items-center', hitHeightClass, disabled && 'opacity-40', className)}>
      {/* Track (background). */}
      <div className={cn('absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-white/[0.08]', railHeightClass)} />

      {/* Center detent — small notch at the zero point for bipolar
          ranges. Only shown in studio variant (the UI variant doesn't
          need this strong an affordance). */}
      {isStudio && bipolar && (
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none w-px h-2 bg-white/[0.15]"
          style={{ left: `${zeroPct}%` }}
        />
      )}

      {/* Range (filled portion). */}
      <div
        className={cn(
          'absolute top-1/2 -translate-y-1/2 pointer-events-none transition-opacity rounded-full',
          railHeightClass,
          tinted ? 'opacity-40' : 'opacity-100',
        )}
        style={{
          left: `${fillLeft}%`,
          width: `${fillWidth}%`,
          background: accent,
          boxShadow: dragging ? `0 0 10px ${accent}66` : 'none',
          // Hide the fill bar when the thumb is sitting exactly on the
          // detent — zero-width gradient is harmless but the boxShadow
          // would otherwise glow at the dead-center even when "off".
          opacity: fillFromCenter && fillWidth < 0.5 ? 0 : tinted ? 0.4 : 1,
        }}
      />

      {/* Thumb. UI variant: hidden until hover. Studio variant: always
          visible — these are the controls the user touches most, no
          need to play hide-and-seek. Pointer-events disabled because
          the underlying input owns the drag. */}
      <div
        className={cn(
          'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none',
          'rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]',
          'transition-all duration-150 ease-out',
          // Studio variant keeps the thumb visible; default hides it.
          isStudio
            ? 'opacity-100 scale-100 group-hover:scale-110'
            : 'opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100',
          dragging && '!opacity-100 !scale-125',
        )}
        style={{ left: `${pct}%`, width: thumbDim, height: thumbDim }}
      />

      {/* Tooltip — appears only while dragging when showTooltip is on.
          Positioned above the thumb. The arrow-down cap is a single rotated
          square so we don't ship an extra SVG. */}
      {showTooltip && dragging && (
        <div
          className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none"
          style={{ left: `${pct}%` }}
        >
          <div className="relative px-2 py-1 rounded-md bg-[#211F1A] border border-[#3B372F] text-[10px] font-mono text-[#F7EBDD] whitespace-nowrap shadow-lg">
            {formatTooltip ? formatTooltip(value) : Math.round(value).toString()}
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 h-2 w-2 rotate-45 bg-[#211F1A] border-r border-b border-[#3B372F]" />
          </div>
        </div>
      )}

      {/* Invisible but interactive native range. Owns focus, keyboard,
          touch, pointer events. Full hit target — h-5 so it's easy to
          tap on mobile without the visible track being tall. */}
      <input
        ref={rangeRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerDown={() => setDragging(true)}
        className="relative w-full h-5 appearance-none bg-transparent cursor-pointer disabled:cursor-not-allowed
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:opacity-0
                   [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:opacity-0 [&::-moz-range-thumb]:border-0"
      />
    </div>
  );
}
