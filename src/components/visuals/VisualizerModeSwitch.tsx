'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { VISUAL_MODES, VISUAL_MODE_LABELS, stepMode, type VisualMode } from '@/lib/visuals/modes';

interface Props {
  mode: VisualMode;
  onChange: (mode: VisualMode) => void;
  className?: string;
}

/** Chip row, `role="radiogroup"`: arrows move + select, Tab leaves the group. */
export function VisualizerModeSwitch({ mode, onChange, className }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: VisualMode | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = stepMode(mode, 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = stepMode(mode, -1);
    else if (e.key === 'Home') next = VISUAL_MODES[0];
    else if (e.key === 'End') next = VISUAL_MODES[VISUAL_MODES.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Visual style"
      onKeyDown={onKeyDown}
      className={cn('grid grid-cols-4 gap-1.5', className)}
    >
      {VISUAL_MODES.map((m) => {
        const selected = m === mode;
        return (
          <button
            key={m}
            ref={(el) => { refs.current[m] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(m)}
            className={cn(
              'rounded-lg border px-1 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors',
              selected
                ? 'border-white/30 bg-white/[0.14] text-white'
                : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]',
            )}
          >
            {VISUAL_MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}
