'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { SECTION_PRESETS, type SectionPreset } from '@/lib/store-editor/presets';
import { cn } from '@/lib/utils';

/**
 * The "+" between two sections on the canvas.
 *
 * Adding a section used to mean: scroll the layers panel to its foot, open a
 * menu of bare kind names, get a blank block at the END of the page, then drag
 * it up to where it was wanted. Here it is inserted exactly where you are
 * looking, from a preset that already looks finished. A hairline at rest (so
 * the page still reads as the page), the button on hover.
 */
export function CanvasInsert({ onInsert, zoom = 1 }: {
  onInsert: (preset: SectionPreset) => void;
  /** Canvas zoom — the picker counter-scales so it stays readable at 25%. */
  zoom?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="group/insert relative z-20 h-0"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={cn(
        'absolute inset-x-0 -top-3 flex h-6 items-center justify-center transition-opacity',
        open ? 'opacity-100' : 'opacity-0 group-hover/insert:opacity-100 focus-within:opacity-100',
      )}
      >
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-white/40" />
        <button
          type="button"
          style={{ transform: `scale(${1 / Math.max(0.25, zoom)})` }}
          aria-expanded={open}
          aria-label="Add a section here"
          onClick={() => setOpen((v) => !v)}
          className="relative grid size-6 place-items-center rounded-full border border-white/40 bg-[#090907] text-white shadow-[0_4px_16px_rgba(0,0,0,0.6)] transition-colors hover:bg-white/90 hover:text-black"
        >
          <Plus size={13} />
        </button>
      </div>
      {open ? (
        <div
          style={{ transform: `translateX(-50%) scale(${1 / Math.max(0.25, zoom)})`, transformOrigin: 'top center' }}
          className="absolute left-1/2 top-4 w-[440px] rounded-xl border border-white/15 bg-[#0D0D0A] p-2 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)]">
          <p className="px-2 pb-2 pt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">Insert here</p>
          <div className="grid grid-cols-2 gap-1">
            {SECTION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => { onInsert(preset); setOpen(false); }}
                className="rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-white/15 hover:bg-white/[0.06]"
              >
                <span className="block text-[11px] text-white/90">{preset.label}</span>
                <span className="block text-[10px] text-white/40">{preset.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
