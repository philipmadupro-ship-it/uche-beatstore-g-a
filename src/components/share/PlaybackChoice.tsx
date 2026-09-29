'use client';

import { Headphones } from 'lucide-react';

interface Props {
  /** true = the whole track (the default); false = the 75 s preview clip. */
  fullPlayback: boolean;
  onChange: (fullPlayback: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const OPTIONS: Array<{ value: boolean; label: string; help: string }> = [
  { value: true, label: 'Full track', help: 'The whole beat. Needed to write to it.' },
  { value: false, label: '1:15 preview', help: 'First 75 seconds only.' },
];

/**
 * The per-share playback choice (mig 121, lib/share/playback). Two named
 * options rather than an ON/OFF toggle: "Full track: OFF" does not say what
 * the recipient hears instead.
 */
export function PlaybackChoice({ fullPlayback, onChange, disabled, className = '' }: Props) {
  return (
    <div className={className}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
        <Headphones size={11} aria-hidden="true" />
        Playback
      </p>
      <div role="radiogroup" aria-label="Playback length" className="grid grid-cols-2 gap-1.5">
        {OPTIONS.map((o) => {
          const active = fullPlayback === o.value;
          return (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
                active
                  ? 'border-white/30 bg-white/[0.14] text-white'
                  : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]'
              }`}
            >
              <span className="text-[11px] font-medium">{o.label}</span>
              <span className="text-[9px] leading-tight text-white/40">{o.help}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
