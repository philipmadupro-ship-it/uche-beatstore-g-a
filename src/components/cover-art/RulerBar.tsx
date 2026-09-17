'use client';

/**
 * One ruler, horizontal or vertical.
 *
 * Draws ticks for the artboard's own coordinate space, positioned against the
 * canvas viewport rather than against the artboard element — so the ruler stays
 * pinned to the edge of the working area while the artboard scrolls under it,
 * which is what makes it useful when zoomed past the viewport.
 *
 * It deliberately owns no drag state. Pressing a ruler reports a document
 * position upward and `StudioCanvas` runs the gesture through the same window
 * listener machinery every other drag uses. A second, parallel pointer system
 * living in here is exactly how a fast drag ends up leaving a guide stuck to
 * the cursor.
 */

import { rulerTicks, type RulerTick } from '@/lib/cover/rulers';
import { cn } from '@/lib/utils';

export const RULER_SIZE = 20;

export function RulerBar({
  orientation,
  documentLength,
  zoom,
  offset,
  extent,
  cursor,
  onPressRuler,
}: {
  orientation: 'horizontal' | 'vertical';
  /** Artboard size along this axis, in document units. */
  documentLength: number;
  zoom: number;
  /** Pixels from the ruler's own origin to document position 0. */
  offset: number;
  /** Visible length of the ruler in pixels. */
  extent: number;
  /** Pointer position in document units, or null when it is off-canvas. */
  cursor: number | null;
  onPressRuler: (documentPosition: number) => void;
}) {
  const horizontal = orientation === 'horizontal';
  const ticks: RulerTick[] = rulerTicks(documentLength, zoom);

  /** Screen pixels for a document position, along this ruler. */
  const at = (position: number) => offset + position * zoom;

  return (
    <div
      role="presentation"
      onPointerDown={(event) => {
        // Only the primary button pulls a guide; middle-drag is panning.
        if (event.button !== 0) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        const local = horizontal ? event.clientX - box.left : event.clientY - box.top;
        onPressRuler((local - offset) / zoom);
      }}
      className={cn(
        'absolute z-20 select-none overflow-hidden bg-[#0D0D0A] text-white/40',
        horizontal
          ? 'left-0 top-0 border-b border-white/10'
          : 'left-0 top-0 border-r border-white/10',
        // The cursor advertises what pressing does before you press.
        horizontal ? 'cursor-ew-resize' : 'cursor-ns-resize',
      )}
      style={horizontal
        ? { height: RULER_SIZE, width: extent }
        : { width: RULER_SIZE, height: extent }}
    >
      {/* The stretch of ruler that actually spans the artboard, so the document
          is distinguishable from the dead space either side of it. */}
      <span
        aria-hidden
        className="absolute bg-white/[0.05]"
        style={horizontal
          ? { left: at(0), width: documentLength * zoom, top: 0, bottom: 0 }
          : { top: at(0), height: documentLength * zoom, left: 0, right: 0 }}
      />

      {ticks.map((tick) => {
        const position = at(tick.position);
        // Skip anything scrolled out of view rather than piling up thousands of
        // absolutely-positioned nodes at high zoom.
        if (position < -40 || position > extent + 40) return null;
        const length = tick.major ? RULER_SIZE : 4;
        return (
          <span key={`${tick.position}`}>
            <span
              aria-hidden
              className="absolute bg-white/25"
              style={horizontal
                ? { left: position, bottom: 0, width: 1, height: length }
                : { top: position, right: 0, height: 1, width: length }}
            />
            {tick.label ? (
              <span
                aria-hidden
                className="absolute font-mono text-[8px] leading-none tracking-[0.08em] text-white/40"
                style={horizontal
                  ? { left: position + 3, top: 3 }
                  : {
                    top: position + 3,
                    left: 2,
                    // Vertical labels read bottom-to-top, as every design tool
                    // sets them — horizontal text in a 20px column would clip
                    // after two digits.
                    writingMode: 'vertical-rl',
                  }}
              >
                {tick.label}
              </span>
            ) : null}
          </span>
        );
      })}

      {/* Where the pointer is, mirrored onto both rulers. */}
      {cursor !== null ? (
        <span
          aria-hidden
          className="absolute bg-white/70"
          style={horizontal
            ? { left: at(cursor), top: 0, bottom: 0, width: 1 }
            : { top: at(cursor), left: 0, right: 0, height: 1 }}
        />
      ) : null}
    </div>
  );
}

/** The small square where the two rulers meet. */
export function RulerCorner({ onClear, hasGuides }: { onClear: () => void; hasGuides: boolean }) {
  return (
    <button
      type="button"
      onClick={onClear}
      disabled={!hasGuides}
      title={hasGuides ? 'Clear all guides' : 'No guides to clear'}
      aria-label="Clear all guides"
      className="absolute left-0 top-0 z-30 grid place-items-center border-b border-r border-white/10 bg-[#0D0D0A] text-white/30 transition-colors enabled:hover:text-white/90 disabled:cursor-default"
      style={{ width: RULER_SIZE, height: RULER_SIZE }}
    >
      <span aria-hidden className="block size-1.5 border-b border-r border-current" />
    </button>
  );
}
