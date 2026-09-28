'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Mute button + level slider for the share pages. The rules (what muting,
 * dragging and unmuting do) live in `useVolumeState` / `lib/audio/player-volume`;
 * this only renders them, so the two pages cannot drift apart again.
 *
 * While muted the slider sits at the bottom and the kept level returns on
 * unmute; dragging it up unmutes.
 */
export function VolumeControl({
  volume,
  muted,
  silent,
  onVolumeChange,
  onToggleMute,
  className,
}: {
  volume: number;
  muted: boolean;
  silent: boolean;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        onClick={onToggleMute}
        className="text-white/40 hover:text-white transition-colors"
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {silent ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={muted ? 0 : volume}
        onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
        aria-label="Volume"
        aria-valuetext={muted ? 'Muted' : `${Math.round(volume * 100)} percent`}
        className="hidden sm:block w-20 cursor-pointer"
      />
    </div>
  );
}
