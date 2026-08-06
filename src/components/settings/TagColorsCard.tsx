'use client';

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { TAG_TAXONOMY, type TagCategory } from '@/lib/types/tags';
import { colorForTag, paletteForTags, normaliseTagKey } from '@/lib/artwork/tag-colors';
import { generateGradient } from '@/lib/artwork/gradient';
import { useTagColors, useTagColorStore, saveTagColor } from '@/hooks/useTagColors';
import { useBrandArtwork } from '@/hooks/useBrandArtwork';
import { Popover } from '@/components/ui/Popover';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/**
 * Assign colours to tags.
 *
 * The payoff is on the artwork, not here: every beat tagged Trap leads on the
 * Trap colour, so a catalogue scanned by eye groups by genre and a mistagged
 * beat stands out. This screen is where that mapping is decided.
 *
 * Only genre and mood are offered. Instrument and status tags do not drive
 * artwork — colouring them would imply they do, and a control that appears to
 * do something it does not is worse than no control.
 */
const EDITABLE: TagCategory[] = ['genre', 'mood'];

export function TagColorsCard() {
  const colors = useTagColors();
  const { palette: brandPalette } = useBrandArtwork();
  const [category, setCategory] = useState<TagCategory>('genre');

  const tags = TAG_TAXONOMY[category] as readonly string[];

  const apply = async (tag: string, color: string | null) => {
    try {
      await saveTagColor(tag, color, category);
    } catch {
      // Roll the optimistic write back rather than leaving the UI claiming a
      // colour the database never took.
      useTagColorStore.getState().load();
      toast.error('Could not save that colour');
    }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-white">Tag colours</h2>
      <p className="mt-1 text-[11px] leading-snug text-white/50">
        Generated covers lead on the colour of a beat&apos;s first tag, so everything
        tagged the same shares a hue. Tags you haven&apos;t set use a sensible default.
      </p>

      <div className="mt-3 flex gap-1.5">
        {EDITABLE.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={cn(
              'tap min-h-8 rounded-full border px-3 text-[11px] font-medium capitalize transition-colors',
              category === c
                ? 'border-white/25 bg-white/[0.13] text-white'
                : 'border-white/10 bg-white/[0.04] text-white/60 hover:text-white',
            )}
          >{c}</button>
        ))}
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {tags.map((tag) => {
          const key = normaliseTagKey(tag);
          const color = colorForTag(tag, colors);
          const overridden = Boolean(colors[key]);
          // Preview the actual artwork this colour produces, not just a chip:
          // the chip is not what the producer will be looking at all day.
          const preview = generateGradient(
            paletteForTags([tag], brandPalette),
            `preview-${key}`,
            { tagAnchored: true },
          );

          return (
            <li
              key={tag}
              className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-1.5"
            >
              <span
                aria-hidden
                className="size-8 shrink-0 rounded-md border border-white/10"
                style={{ backgroundImage: preview.css }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{tag}</span>

              {overridden && (
                <button
                  onClick={() => void apply(tag, null)}
                  aria-label={`Reset ${tag} to the default colour`}
                  title="Reset to default"
                  className="tap grid size-6 shrink-0 place-items-center rounded text-white/35 transition-colors hover:text-white"
                >
                  <RotateCcw size={11} />
                </button>
              )}

              <Popover
                width={264}
                align="right"
                trigger={({ open, toggle, ref }) => (
                  <button
                    ref={ref as (el: HTMLButtonElement | null) => void}
                    onClick={toggle}
                    aria-expanded={open}
                    aria-label={`Choose a colour for ${tag}`}
                    className={cn(
                      'size-6 shrink-0 rounded-full border transition-transform hover:scale-110',
                      open ? 'border-white' : 'border-white/25',
                    )}
                    style={{ backgroundColor: color }}
                  />
                )}
              >
                {() => (
                  <ColorPicker
                    value={color}
                    recent={brandPalette}
                    onChange={(hex) => void apply(tag, hex)}
                  />
                )}
              </Popover>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
