'use client';

import { useState } from 'react';
import { Plus, Tag as TagIcon, X } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/utils';
import { canAddCustomTag, categoryForTag, orderTags, type TagGroup } from '@/lib/ui/tag-groups';

export type { TagGroup };

interface Props {
  tags: string[];
  groups: TagGroup[];
  /** `category` is resolved from the taxonomy; `active` is the CURRENT state,
   *  matching the toggle-mutation signature both tag hooks already use. */
  onToggle: (args: { tag: string; category: string; active: boolean }) => void;
  /** Accessible name for the add control, e.g. "project". */
  subject: string;
  emptyLabel?: string;
  className?: string;
  /** Externally opened, so a menu item can jump straight to the picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Tags, in place.
 *
 * Applied tags render as pills you can remove with one click; adding opens a
 * lightweight popover over the same spot. Nothing here navigates — editing a
 * project's tags previously meant View details → the drawer, which is three
 * screens away from the tags themselves.
 *
 * Removal is direct manipulation (rung one of the hierarchy) and addition is a
 * popover (rung two), because removal targets a specific visible pill while
 * addition needs the whole vocabulary.
 */
export function InlineTagStrip({
  tags, groups, onToggle, subject, emptyLabel = 'Add tags', className,
  open, onOpenChange,
}: Props) {
  const [custom, setCustom] = useState('');
  const ordered = orderTags(groups, tags);

  const toggle = (tag: string, category?: string) =>
    onToggle({
      tag,
      category: category ?? categoryForTag(groups, tag),
      active: tags.some((t) => t.toLowerCase() === tag.toLowerCase()),
    });

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddCustomTag(tags, custom)) return;
    onToggle({ tag: custom.trim(), category: 'custom', active: false });
    setCustom('');
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <TagIcon size={11} className="shrink-0 text-white/30" />

      {ordered.map((tag) => (
        <span
          key={tag}
          className="group/tag inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2.5 pr-1 text-[10px] font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
        >
          {tag}
          <button
            type="button"
            onClick={() => toggle(tag)}
            aria-label={`Remove tag ${tag}`}
            className="grid size-4 place-items-center rounded-full text-white/30 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={9} />
          </button>
        </span>
      ))}

      <Popover
        width={300}
        open={open}
        onOpenChange={onOpenChange}
        // Opened from the ⋯ menu as well as its own button, so it has to take
        // focus itself — see Popover's `initialFocus`.
        initialFocus
        label={`${subject.charAt(0).toUpperCase()}${subject.slice(1)} tags`}
        trigger={({ open: isOpen, toggle: toggleOpen, ref }) => (
          <button
            type="button"
            ref={ref as (el: HTMLButtonElement | null) => void}
            onClick={toggleOpen}
            aria-label={`Edit ${subject} tags`}
            aria-expanded={isOpen}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors',
              isOpen
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-dashed border-white/15 text-white/40 hover:border-white/30 hover:text-white',
            )}
          >
            <Plus size={10} />
            {ordered.length === 0 ? emptyLabel : 'Tag'}
          </button>
        )}
      >
        <div className="max-h-[min(60vh,420px)] space-y-4 overflow-y-auto p-3">
          {groups.map((group) => (
            <div key={group.category} className="space-y-1.5">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">{group.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.options.map((opt) => {
                  const active = tags.some((t) => t.toLowerCase() === opt.toLowerCase());
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggle(opt, group.category)}
                      aria-pressed={active}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-colors',
                        active
                          ? 'border-white/40 bg-white/10 text-white'
                          : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/80',
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <form onSubmit={submitCustom} className="border-t border-white/10 pt-3">
            <div className="relative">
              <Plus size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Custom tag"
                aria-label="Add a custom tag"
                maxLength={40}
                className="w-full rounded-lg border border-white/10 bg-[#090907] py-2 pl-8 pr-3 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
              />
            </div>
          </form>
        </div>
      </Popover>
    </div>
  );
}
