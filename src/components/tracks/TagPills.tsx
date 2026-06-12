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
          className="px-2 py-0.5 rounded-md bg-[#342F27] text-[#F3E6D1] text-[9px] font-bold uppercase tracking-wider border border-[#C9BCA8]/30"
        >
          {tag}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest">
          +{remaining} MORE
        </span>
      )}
    </div>
  );
}
