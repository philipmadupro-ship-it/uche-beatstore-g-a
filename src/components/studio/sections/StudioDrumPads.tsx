'use client';

import { useEffect, useRef, useState } from 'react';
import { type ChannelKey } from '@/lib/audio/engine';
import { cn } from '@/lib/utils';

export type PadKind = 'kick' | 'snare' | 'hat' | 'openhat' | 'clap';

interface Props {
  /** Fires a one-shot through the studio engine. The parent threads its
   *  bound trigger handler (which mixes the pad sound through the
   *  current pad channel + master FX). */
  onTrigger: (pad: PadKind) => void;
}

/**
 * 4×4 MPC-style pad grid.
 *
 * The audio engine currently ships 5 one-shots (kick / snare / hat /
 * open-hat / clap). Those occupy specific slots in the grid; the
 * remaining pads render as empty placeholders that hint at future
 * per-pad sample loading without pretending sounds exist where they
 * don't. Hotkeys 1–5 are preserved from the old 5-pad row and bound
 * by the parent (StudioWorkstation owns the document keydown listener).
 *
 * On trigger, each pad gets a visual "press" — a fast scale + glow
 * pulse driven by transient state with a short timeout, not CSS-only
 * `:active` (so keyboard hotkeys flash the right pad even when the
 * cursor is somewhere else entirely).
 */
const PAD_LAYOUT: Array<{ kind: PadKind | null; label: string; hotkey?: string; color: string; glow: string }> = [
  // Row 1 (top) — empty slots reserved for future sample loading.
  { kind: null, label: '',         color: '',                glow: '' },
  { kind: null, label: '',         color: '',                glow: '' },
  { kind: null, label: '',         color: '',                glow: '' },
  { kind: null, label: '',         color: '',                glow: '' },
  // Row 2 — empty.
  { kind: null, label: '',         color: '',                glow: '' },
  { kind: null, label: '',         color: '',                glow: '' },
  { kind: null, label: '',         color: '',                glow: '' },
  { kind: null, label: '',         color: '',                glow: '' },
  // Row 3 — hats / cymbals (cool palette: teal / mint / blue).
  { kind: 'hat',     label: 'HAT',     hotkey: '3', color: 'from-[#1a3a3a] to-[#0a1a1a]', glow: '#6DC6A4' },
  { kind: 'openhat', label: 'OPEN HAT', hotkey: '4', color: 'from-[#1a3a2a] to-[#0a1a14]', glow: '#8edfa8' },
  { kind: null, label: '',         color: '',                glow: '' },
  { kind: null, label: '',         color: '',                glow: '' },
  // Row 4 (bottom) — kick / snare / clap (warm palette: amber / coral / yellow).
  { kind: 'kick',  label: 'KICK',  hotkey: '1', color: 'from-[#3a2a1a] to-[#1a120a]', glow: '#e8a86a' },
  { kind: 'snare', label: 'SNARE', hotkey: '2', color: 'from-[#3a1a1a] to-[#1a0a0a]', glow: '#e88a8a' },
  { kind: 'clap',  label: 'CLAP',  hotkey: '5', color: 'from-[#3a2a1a] to-[#1a140a]', glow: '#e8c86a' },
  { kind: null, label: '',         color: '',                glow: '' },
];

export function StudioDrumPads({ onTrigger }: Props) {
  // Per-pad press state. Keyed by grid index; value is a timestamp that
  // we use to drive the glow + scale flash. Cleared 180ms after press
  // — long enough to read, short enough to keep up with rapid hits.
  const [pressed, setPressed] = useState<Record<number, number>>({});
  const timeouts = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const flashPad = (index: number) => {
    setPressed((p) => ({ ...p, [index]: Date.now() }));
    clearTimeout(timeouts.current[index]);
    timeouts.current[index] = setTimeout(() => {
      setPressed((p) => {
        const next = { ...p };
        delete next[index];
        return next;
      });
    }, 180);
  };

  // Keyboard hotkeys (1–5) come through the parent's document listener,
  // which invokes `onTrigger(kind)`. We sync the visual flash by
  // mounting a parallel listener here — cheap, scoped to capture
  // numeric keys only. Avoids passing flashing state up through props.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const map: Record<string, PadKind> = { '1': 'kick', '2': 'snare', '3': 'hat', '4': 'openhat', '5': 'clap' };
      const kind = map[e.key];
      if (!kind) return;
      const idx = PAD_LAYOUT.findIndex((p) => p.kind === kind);
      if (idx >= 0) flashPad(idx);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="border border-[#1A1813] rounded-lg p-5 bg-[#090907]">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#F7EBDD]">Drum Pads</p>
        <p className="text-[9px] font-mono text-[#9B9282]">Keys 1–5 · click to trigger</p>
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {PAD_LAYOUT.map((pad, i) => {
          const isPressed = pressed[i] != null;
          const isEmpty = pad.kind == null;
          return (
            <button
              key={i}
              onMouseDown={() => {
                if (!pad.kind) return;
                flashPad(i);
                onTrigger(pad.kind);
              }}
              disabled={isEmpty}
              className={cn(
                'aspect-square rounded-xl relative overflow-hidden transition-all duration-100',
                'border',
                isEmpty
                  ? 'border-[#1A1813] bg-[#080808] cursor-default'
                  : cn(
                      'border-white/[0.06] bg-gradient-to-br shadow-[0_2px_6px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]',
                      pad.color,
                      'cursor-pointer hover:border-white/[0.12] active:scale-95',
                    ),
                isPressed && 'scale-[0.96]',
              )}
              style={
                isPressed && pad.glow
                  ? {
                      boxShadow: `0 0 24px ${pad.glow}88, inset 0 0 12px ${pad.glow}33, 0 2px 6px rgba(0,0,0,0.4)`,
                      borderColor: pad.glow,
                    }
                  : undefined
              }
              aria-label={pad.label || `Empty pad ${i + 1}`}
            >
              {!isEmpty && (
                <>
                  {/* Bright accent flash overlay — fades in/out with the press
                      flash. Sits on top of the gradient so it brightens the
                      pad face without losing its base color. */}
                  <div
                    className="absolute inset-0 transition-opacity duration-100 pointer-events-none"
                    style={{
                      background: pad.glow,
                      opacity: isPressed ? 0.18 : 0,
                    }}
                  />
                  <div className="relative z-10 h-full w-full flex flex-col items-center justify-center gap-1.5 p-2">
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: isPressed ? pad.glow : '#F7EBDD' }}
                    >
                      {pad.label}
                    </span>
                    {pad.hotkey && (
                      <span
                        className="text-[8px] font-mono"
                        style={{ color: isPressed ? pad.glow : '#9B9282' }}
                      >
                        [{pad.hotkey}]
                      </span>
                    )}
                  </div>
                </>
              )}
              {isEmpty && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[#211F1A] text-[18px] font-light">+</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Re-export ChannelKey-using types so any future signature stays aligned.
export type { ChannelKey };
