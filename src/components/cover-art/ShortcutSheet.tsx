'use client';

/**
 * Keyboard reference, opened with "?".
 *
 * A keyboard model nobody can discover is the same as not having one. This is
 * the cheapest way to make the shortcuts learnable without putting hint text
 * next to every control.
 */

import { X } from 'lucide-react';

/**
 * Modifier names are spelled out rather than drawn with the Mac glyphs for
 * shift and option: the metadata face (Panchang) has no glyph for U+21E7 or
 * U+2325 and renders them as tofu. Command has a glyph and is kept.
 */
export const shortcutGroups: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Tools',
    items: [
      ['V', 'Deselect'],
      ['T', 'Add text'],
      ['R', 'Add rectangle'],
      ['O', 'Add circle'],
      ['G', 'Toggle guides'],
      ['Shift R', 'Toggle rulers'],
      ['?', 'This sheet'],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['⌘Z / Shift ⌘Z', 'Undo / redo'],
      ['⌘C / ⌘V', 'Copy / paste layers'],
      ['⌘V', 'Paste image from clipboard'],
      ['⌘D', 'Duplicate'],
      ['⌘A', 'Select all'],
      ['Delete', 'Remove selection'],
    ],
  },
  {
    title: 'Arrange',
    items: [
      ['Arrows', 'Nudge 8'],
      ['Shift Arrows', 'Nudge 40'],
      ['⌘G / Shift ⌘G', 'Group / ungroup'],
      ['] / [', 'Forward / backward'],
      ['Shift ] / Shift [', 'To front / to back'],
      ['Shift drag', 'Lock aspect ratio'],
      ['Alt drag', 'Resize from centre'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Space drag', 'Pan'],
      ['⌘ scroll', 'Zoom to pointer'],
      ['⌘0', 'Fit to window'],
      ['⌘1', 'Actual size'],
      ['⌘+ / ⌘-', 'Zoom in / out'],
      ['Double-click', 'Edit text in place'],
    ],
  },
];

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="absolute inset-0 z-[1000] grid place-items-center bg-[#090907]/80 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-3xl overflow-y-auto border border-white/20 bg-[#0D0D0A] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-heading text-lg text-white/90">Keyboard</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="grid h-7 w-7 place-items-center text-white/40 transition-colors hover:text-white/90"
          >
            <X size={14} />
          </button>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {shortcutGroups.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{group.title}</h3>
              <dl className="grid gap-1">
                {group.items.map(([keys, label]) => (
                  <div key={`${group.title}-${keys}-${label}`} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 font-mono text-[11px] text-white">{keys}</dt>
                    <dd className="min-w-0 flex-1 border-b border-dotted border-white/10 text-right text-[12px] text-white/60">
                      {label}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
