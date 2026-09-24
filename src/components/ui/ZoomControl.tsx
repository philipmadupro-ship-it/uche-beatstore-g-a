'use client';

import { Minus, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatZoom, sliderToZoom, stepZoom, zoomToSlider, type ZoomRange } from '@/lib/ui/zoom';

/**
 * The zoom cluster both canvas editors share: − / percentage / + / slider / Fit.
 *
 * Same pill language as the Library toolbar's view switch, so the editors read
 * as part of the app rather than as a separate tool bolted into it. Clicking
 * the percentage jumps to 100% — actual size is the one zoom people ask for by
 * name. The slider is logarithmic (see `lib/ui/zoom.ts`).
 */
export function ZoomControl({
  zoom,
  range,
  fitted,
  onZoom,
  onFit,
  floating = false,
  className,
}: {
  zoom: number;
  range: ZoomRange;
  /** True while the canvas is following the window. */
  fitted: boolean;
  onZoom: (zoom: number) => void;
  onFit: () => void;
  /**
   * Hovering over the canvas rather than sitting in a toolbar: needs a solid,
   * blurred ground or artwork shows through the labels.
   */
  floating?: boolean;
  className?: string;
}) {
  const iconButton = 'grid size-7 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white disabled:text-white/20 disabled:hover:bg-transparent';
  return (
    <div className={cn(
      'flex shrink-0 items-center gap-0.5 rounded-full border p-0.5',
      floating
        ? 'border-white/10 bg-[#0D0D0A]/90 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] backdrop-blur-md'
        : 'border-white/[0.06] bg-white/[0.04]',
      className,
    )}>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={zoom <= range.min + 0.0005}
        onClick={() => onZoom(stepZoom(zoom, -1, range))}
        className={iconButton}
      >
        <Minus size={12} />
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={zoomToSlider(zoom, range)}
        aria-label="Zoom"
        aria-valuetext={formatZoom(zoom)}
        onChange={(event) => onZoom(sliderToZoom(Number(event.target.value), range))}
        className="hidden h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/10 accent-white sm:block"
      />
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={zoom >= range.max - 0.0005}
        onClick={() => onZoom(stepZoom(zoom, 1, range))}
        className={iconButton}
      >
        <Plus size={12} />
      </button>
      <button
        type="button"
        onClick={() => onZoom(Math.min(range.max, Math.max(range.min, 1)))}
        title="Actual size"
        className="h-7 min-w-12 rounded-full px-2 font-mono text-[10px] tabular-nums text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        {formatZoom(zoom)}
      </button>
      <button
        type="button"
        aria-pressed={fitted}
        onClick={onFit}
        title="Fit to window"
        className={cn(
          'h-7 rounded-full px-3 text-[11px] transition-colors',
          fitted ? 'bg-white/[0.14] text-white' : 'text-white/60 hover:bg-white/[0.08] hover:text-white',
        )}
      >
        Fit
      </button>
    </div>
  );
}
