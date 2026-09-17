'use client';

/**
 * The type browser.
 *
 * A font picker has to show the fonts. The control this replaces was four
 * buttons reading "Display / Brand / Mono / Sans" set in the interface face —
 * so choosing type meant guessing, and six of the seven Panchang cuts plus two
 * whole faces shipped in `/public/fonts` were unreachable because no *role*
 * pointed at them.
 *
 * Every row here renders its own name in its own face at its own weight, which
 * is the only reason a list like this is worth having. Weights come from
 * `lib/cover/fonts.ts` and are the real files, labelled honestly — Synkopy's
 * 700 is the Flipside cut, not a bold, and calling it "Bold" would be a lie the
 * canvas immediately exposes.
 */

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  fontsByCategory, nearestFace, resolveFont,
  type CoverFontId,
} from '@/lib/cover/fonts';
import { FieldLabel } from './StudioControls';
import { cn } from '@/lib/utils';

export function FontPicker({ value, weight, onChange }: {
  value: string;
  weight: number | undefined;
  onChange: (patch: { fontFamily?: CoverFontId; fontWeight?: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const font = resolveFont(value);
  const activeFace = nearestFace(font, weight ?? 400);
  const groups = fontsByCategory();

  return (
    <div className="grid gap-1.5">
      <FieldLabel>Typeface</FieldLabel>

      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex items-center justify-between gap-2 border border-white/10 bg-[#090907] px-2.5 py-2 text-left transition-colors hover:border-white/25"
      >
        <span className="min-w-0">
          <span
            className="block truncate text-[15px] leading-tight text-white/90"
            style={{ fontFamily: font.stack, fontWeight: activeFace.weight }}
          >
            {font.name}
          </span>
          <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
            {activeFace.label}
          </span>
        </span>
        <ChevronDown size={13} className={cn('shrink-0 text-white/40 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="max-h-72 overflow-y-auto border border-white/10 bg-[#090907]">
          {groups.map((group) => (
            <div key={group.category}>
              <p className="sticky top-0 z-10 bg-[#090907] px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">
                {group.label}
              </p>
              {group.fonts.map((option) => {
                const selected = option.id === font.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      // Snap the current weight into the new family's range, so
                      // switching from Panchang Extrabold to a single-weight
                      // face does not leave an 800 stored that nothing ships.
                      onChange({
                        fontFamily: option.id,
                        fontWeight: nearestFace(option, weight ?? 400).weight,
                      });
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left transition-colors',
                      selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
                    )}
                  >
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[15px] leading-tight text-white/90"
                        style={{ fontFamily: option.stack }}
                      >
                        {option.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] leading-tight text-white/40">
                        {option.hint}
                      </span>
                    </span>
                    {selected ? <Check size={13} className="shrink-0 text-white/90" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/* Weights are the family's real cuts. A family with one cut shows one
          button rather than a disabled range implying weights it does not have. */}
      <div className="grid gap-1.5">
        <FieldLabel>Weight</FieldLabel>
        <div className="flex flex-wrap gap-1">
          {font.faces.map((face) => (
            <button
              key={face.weight}
              type="button"
              aria-pressed={face.weight === activeFace.weight}
              onClick={() => onChange({ fontWeight: face.weight })}
              title={`${font.name} ${face.label} (${face.weight})`}
              className={cn(
                'border px-2 py-1 text-[11px] transition-colors',
                face.weight === activeFace.weight
                  ? 'border-white/40 bg-white/[0.12] text-white/90'
                  : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white/90',
              )}
              style={{ fontFamily: font.stack, fontWeight: face.weight }}
            >
              {face.label}
            </button>
          ))}
        </div>
        {!font.embeddable ? (
          <p className="text-[10px] leading-relaxed text-white/40">
            System face — exports fall back to whatever the viewer has installed.
          </p>
        ) : null}
      </div>
    </div>
  );
}
