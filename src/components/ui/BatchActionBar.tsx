'use client';

import { Trash2, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Action {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  /** Visual intent — `danger` styles destructive (Delete) red. */
  intent?: 'default' | 'danger' | 'primary';
  loading?: boolean;
  disabled?: boolean;
}

interface Props {
  count: number;
  /** Singular and plural noun, e.g. ['track', 'tracks']. */
  noun: [string, string];
  onClear: () => void;
  actions: Action[];
  /** When true a spinner replaces the action row. Used during batch ops. */
  busy?: boolean;
}

/**
 * Floating bottom-anchored action bar that appears when items are selected
 * in a list view. Replaces ad-hoc per-page "N selected" toolbars so the
 * batch UX is identical in library / playlists / contacts.
 *
 * Glass treatment matches the PlayerBar. Positioned just above it (PlayerBar
 * is bottom-0 h-20; this sits bottom-24).
 */
export function BatchActionBar({ count, noun, onClear, actions, busy }: Props) {
  if (count === 0) return null;
  const label = count === 1 ? noun[0] : noun[1];
  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-2 fade-in duration-200 max-w-[calc(100vw-1rem)]">
      {/* Inner pill scrolls horizontally so a long action row is never clipped
          off a phone's edge (the whole bar is content-width + centered). */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-2xl bg-[#090907]/90 border border-white/[0.08] shadow-[0_10px_40px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)_inset] overflow-x-auto scrollbar-hide">
        <button
          onClick={onClear}
          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-full text-[#B4AA99] hover:text-white hover:bg-white/[0.06] transition-colors"
          aria-label="Clear selection"
        >
          <X size={13} />
        </button>
        <span className="text-[11px] font-mono uppercase tracking-wider text-[#D0C3AF] px-2 shrink-0 tabular-nums">
          {count} {label}
        </span>
        <div className="w-px h-5 bg-white/[0.08] mx-1 shrink-0" />
        {busy ? (
          <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[#D0C3AF] shrink-0">
            <Loader2 size={11} className="animate-spin" />
            Working…
          </div>
        ) : (
          actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              disabled={a.disabled || a.loading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0',
                a.intent === 'danger'   && 'bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/15 hover:border-red-500/40',
                a.intent === 'primary'  && 'bg-[#E7D7BE] text-white hover:bg-[#C9BCA8]',
                (!a.intent || a.intent === 'default') && 'bg-white/[0.04] text-[#F7EBDD] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12]',
              )}
            >
              {a.loading ? <Loader2 size={11} className="animate-spin" /> : a.icon}
              {a.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Convenience export of the trash icon for callers wiring a Delete action. */
export const DeleteIcon = Trash2;
