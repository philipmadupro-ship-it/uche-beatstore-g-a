'use client';

import { useId, useState } from 'react';
import { TagOverflowToggle } from '@/components/ui/TagOverflowToggle';
import { splitTags } from '@/lib/ui/tag-overflow';
import type { TrackTag } from './types';

interface Props {
  tags: TrackTag[];
  max?: number;
  accentGenre?: boolean;
}

export function TagChips({ tags, max = 3, accentGenre = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const all = tags.filter((t) => t.category === 'genre' || t.category === 'mood');
  const split = splitTags(all, { limit: max, expanded });
  if (all.length === 0) return null;
  return (
    <div id={id} className="flex flex-wrap gap-1 mt-1.5">
      {split.visible.map((t) => {
        const isGenre = t.category === 'genre';
        return (
          <span
            key={t.tag}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 border ${
              isGenre && accentGenre
                ? 'bg-white/10 border-white/20'
                : 'bg-white/20 border-white/10'
            }`}
          >
            {t.tag}
          </span>
        );
      })}
      {split.canToggle && (
        <TagOverflowToggle
          size="sm"
          expanded={expanded}
          hiddenCount={split.hiddenCount}
          onToggle={() => setExpanded((v) => !v)}
          controls={id}
        />
      )}
    </div>
  );
}
