'use client';

import type { TrackTag } from './types';

interface Props {
  tags: TrackTag[];
  max?: number;
  accentGenre?: boolean;
}

export function TagChips({ tags, max = 3, accentGenre = false }: Props) {
  const display = tags
    .filter((t) => t.category === 'genre' || t.category === 'mood')
    .slice(0, max + 1);
  if (display.length === 0) return null;
  const visible = display.slice(0, max);
  const overflow = display.length - max;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {visible.map((t) => {
        const isGenre = t.category === 'genre';
        return (
          <span
            key={t.tag}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 border ${
              isGenre && accentGenre
                ? 'bg-white/10 border-white/'
                : 'bg-white/20 border-white/10'
            }`}
          >
            {t.tag}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 bg-white/[0.05]">
          +{overflow}
        </span>
      )}
    </div>
  );
}
