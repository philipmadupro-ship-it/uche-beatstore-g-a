'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, isValidHex } from '@/lib/artwork/color';
import { cn } from '@/lib/utils';

/**
 * Colour picker, in the shape DAW users already know.
 *
 * Logic Pro gives you a fixed grid — every colour the app supports, laid out
 * so muscle memory works and two people describing "the third orange" mean the
 * same swatch. FL Studio gives you a continuous field for when the grid is not
 * exactly right. Neither alone is enough: the grid cannot express an arbitrary
 * brand colour, and a bare field makes picking a consistent set across twenty
 * tags a matter of luck.
 *
 * So: the grid first, because it is what people reach for, with the continuous
 * field and a hex box underneath for when it matters.
 *
 * Hand-rolled, per the project's no-UI-library rule. The saturation/value
 * field is a pointer-driven canvas of CSS gradients rather than a real canvas
 * element — it needs no pixel readback, only coordinates.
 */

/** Hues across the wheel × shades within each. Mirrors Logic's palette shape:
 *  wide enough to always have something close, short of being a colour atlas. */
const GRID_HUES = [0, 20, 40, 60, 90, 140, 175, 195, 215, 240, 265, 290, 315, 335];
const GRID_SHADES: Array<{ s: number; l: number }> = [
  { s: 0.72, l: 0.78 },
  { s: 0.75, l: 0.64 },
  { s: 0.70, l: 0.52 },
  { s: 0.68, l: 0.40 },
  { s: 0.60, l: 0.28 },
];
/** Neutrals get their own row — a greyscale ramp is unreachable on a hue grid
 *  and is exactly what someone wants for a monochrome brand. */
const GRID_NEUTRALS = ['#ffffff', '#d8cebe', '#a89f92', '#6c6255', '#34322c', '#1e1e1a', '#0b0b0a'];

function swatch(h: number, s: number, l: number): string {
  return rgbToHex(hslToRgb({ h, s, l }));
}

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /** Extra swatches shown first — e.g. the producer's own brand palette. */
  recent?: string[];
  className?: string;
}

export function ColorPicker({ value, onChange, recent = [], className }: ColorPickerProps) {
  const current = isValidHex(value) ? value.toLowerCase() : '#7f5af0';
  const hsl = useMemo(() => rgbToHsl(hexToRgb(current)!), [current]);

  const [hex, setHex] = useState(current);
  useEffect(() => { setHex(current); }, [current]);

  const fieldRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const commit = (h: number, s: number, l: number) => onChange(swatch(h, s, l));

  /** Map a pointer position in the field to saturation/lightness. */
  const pickFromField = (clientX: number, clientY: number) => {
    const el = fieldRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    // x = saturation, y = lightness inverted — the arrangement every DAW and
    // design tool uses, so it needs no learning.
    commit(hsl.h, x, 1 - y);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) pickFromField(e.clientX, e.clientY); };
    const up = () => { dragging.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  return (
    <div className={cn('w-[248px] space-y-2.5 p-1', className)}>
      {recent.length > 0 && (
        <div>
          <Label>Brand</Label>
          <div className="flex flex-wrap gap-1">
            {recent.filter(isValidHex).map((c) => (
              <Swatch key={c} color={c} active={c.toLowerCase() === current} onPick={onChange} />
            ))}
          </div>
        </div>
      )}

      <div>
        <Label>Palette</Label>
        <div className="flex flex-wrap gap-[3px]">
          {GRID_SHADES.map((shade) =>
            GRID_HUES.map((h) => {
              const c = swatch(h, shade.s, shade.l);
              return <Swatch key={`${h}-${shade.l}`} color={c} active={c === current} onPick={onChange} />;
            }),
          )}
        </div>
        <div className="mt-[3px] flex flex-wrap gap-[3px]">
          {GRID_NEUTRALS.map((c) => (
            <Swatch key={c} color={c} active={c === current} onPick={onChange} />
          ))}
        </div>
      </div>

      <div>
        <Label>Custom</Label>
        {/* Saturation × lightness for the current hue. */}
        <div
          ref={fieldRef}
          role="application"
          aria-label="Saturation and lightness"
          onPointerDown={(e) => { dragging.current = true; pickFromField(e.clientX, e.clientY); }}
          className="relative h-20 w-full cursor-crosshair rounded-lg border border-white/10"
          style={{
            backgroundImage:
              'linear-gradient(to top, #000, transparent 50%, #fff), ' +
              `linear-gradient(to right, #808080, ${swatch(hsl.h, 1, 0.5)})`,
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ left: `${hsl.s * 100}%`, top: `${(1 - hsl.l) * 100}%`, backgroundColor: current }}
          />
        </div>

        {/* Hue. A range input rather than a second custom field: it is a single
            axis, and the native control is keyboard-accessible for free. */}
        <input
          type="range"
          min={0}
          max={359}
          value={Math.round(hsl.h)}
          aria-label="Hue"
          onChange={(e) => commit(Number(e.target.value), hsl.s, hsl.l)}
          className="mt-2 h-3 w-full cursor-pointer appearance-none rounded-full border border-white/10"
          style={{
            backgroundImage:
              'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-6 shrink-0 rounded-md border border-white/20"
          style={{ backgroundColor: current }}
        />
        <input
          value={hex}
          aria-label="Hex colour"
          spellCheck={false}
          onChange={(e) => {
            setHex(e.target.value);
            // Commit only once it parses, so typing "#7f" mid-entry does not
            // flash the swatch through nonsense.
            if (isValidHex(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] uppercase text-white focus:border-white/30 focus:outline-none"
        />
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">{children}</p>;
}

function Swatch({ color, active, onPick }: { color: string; active: boolean; onPick: (hex: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(color)}
      title={color}
      aria-label={color}
      aria-pressed={active}
      className={cn(
        // Fixed size rather than `w-full aspect-square`: that sizing only
        // works inside the grid, and stretched each swatch to the full row
        // width everywhere else.
        'grid size-[15px] shrink-0 place-items-center rounded-[3px] transition-transform',
        active ? 'ring-2 ring-white' : 'hover:scale-110',
      )}
      style={{ backgroundColor: color }}
    >
      {active && <Check size={9} className="text-white mix-blend-difference" />}
    </button>
  );
}
