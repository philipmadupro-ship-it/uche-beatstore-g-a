'use client';

import { Tag } from 'lucide-react';

interface TagPillsProps {
  tags: string[];
  maxVisible?: number;
  onClick?: () => void;
}

export function TagPills({ tags, maxVisible = 2, onClick }: TagPillsProps) {
  if (!tags || tags.length === 0) return null;

  const visibleTags = tags.slice(0, maxVisible);
  const remaining = tags.length - maxVisible;

  return (
    <div 
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
      className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
    >
      {visibleTags.map((tag) => (
        <span 
          key={tag}
          className="px-2 py-0.5 rounded-md bg-white/10 text-white text-[9px] font-bold uppercase tracking-wider border border-white/"
        >
          {tag}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">
          +{remaining} MORE
        </span>
      )}
    </div>
  );
}
