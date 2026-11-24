'use client';

import { cn } from '@/lib/utils';

interface Props {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
  /** id of the element that holds the pills, for aria-controls. */
  controls?: string;
  /** Pill size: `sm` matches the store's mono 9px chips, `md` the dashboard's 10px pills. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The single "+N more / Show less" control for every tag pill row. Translucent
 * control language, no animation of its own (colour only, which a reduced-motion
 * viewer does not mind).
 */
export function TagOverflowToggle({ expanded, hiddenCount, onToggle, controls, size = 'md', className }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controls}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white',
        size === 'sm'
          ? 'px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider'
          : 'px-2.5 py-1 text-[10px] font-medium',
        className,
      )}
    >
      {expanded ? 'Show less' : `+${hiddenCount} more`}
    </button>
  );
}

/** The non-interactive "+N" chip rows use, where a fixed row height rules out expanding. */
export function TagOverflowChip({ count, title, className }: { count: number; title: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn('shrink-0 text-[11px] text-white/40', className)}
    >
      +{count}
    </span>
  );
}
