'use client';

import { useId, useState } from 'react';
import { TagOverflowToggle } from '@/components/ui/TagOverflowToggle';
import { splitTags, TAG_LIMIT_DETAIL } from '@/lib/ui/tag-overflow';

interface Props {
  tags: Array<{ tag: string; category?: string | null }>;
  limit?: number;
}

/** The track page's tag pills: a couple of rows, "+N more" for the rest. */
export function ExpandableTagList({ tags, limit = TAG_LIMIT_DETAIL }: Props) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const split = splitTags(tags, { limit, expanded });
  if (tags.length === 0) return null;
  return (
    <div id={id} className="flex flex-wrap gap-1.5 mt-3" data-testid="store-tag-list">
      {split.visible.map(({ tag, category }) => (
        <span
          key={`${category}:${tag}`}
          className="px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider border border-white/10 bg-white/[0.03] text-white/60"
        >
          {tag}
        </span>
      ))}
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
