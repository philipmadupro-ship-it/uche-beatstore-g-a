'use client';

import { useState } from 'react';
import { Track, TrackStatus, TrackType } from '@/lib/types';
import { StarRating } from '@/components/tracks/StarRating';

const TYPE_OPTIONS: { value: TrackType; label: string }[] = [
  { value: 'beat',         label: 'Beat' },
  { value: 'instrumental', label: 'Instr.' },
  { value: 'song',         label: 'Song' },
  { value: 'remix',        label: 'Remix' },
];

const STATUS_OPTIONS: { value: TrackStatus; label: string; active: string; dot: string }[] = [
  { value: 'maq',        label: 'MAQ',        active: 'bg-[#1f1a10] text-[#c8a47a] border-[#3d3020]/40', dot: 'bg-[#c8a47a]' },
  { value: 'needs_work', label: 'WIP',        active: 'bg-[#1f1a0a] text-white border-[#3a2f1f]',   dot: 'bg-white' },
  { value: 'finished',   label: 'Finished',   active: 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]',   dot: 'bg-[#8ecf9f]' },
  { value: 'archived',   label: 'Archived',   active: 'bg-[#0D0D0A] text-white/60 border-white/10',   dot: 'bg-white/40' },
];

// All 12 chromatic pitch classes in circle-of-fifths order so adjacent
// keys are harmonically related — easier to navigate when correcting
// Essentia's half/double-time errors.
const KEY_ROW_1 = ['C', 'G', 'D', 'A', 'E', 'B'] as const;
const KEY_ROW_2 = ['F#', 'C#', 'G#', 'D#', 'A#', 'F'] as const;

const SCALE_OPTIONS: { value: string; label: string }[] = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
];

interface Props {
  track: Track;
  onPatch: (patch: Record<string, unknown>) => void;
  onRatingChange: (newRating: number) => void;
}

type BpmDraft = {
  trackId: string;
  initial: string;
  value: string;
};

export function TrackMetadataEditor({ track, onPatch, onRatingChange }: Props) {
  const [bpmDraftOverride, setBpmDraftOverride] = useState<BpmDraft | null>(null);
  const canonicalBpmDraft = track.bpm != null ? String(track.bpm) : '';
  const bpmDraft = bpmDraftOverride?.trackId === track.id && bpmDraftOverride.initial === canonicalBpmDraft
    ? bpmDraftOverride.value
    : canonicalBpmDraft;

  const setBpmDraft = (value: string) => {
    setBpmDraftOverride({ trackId: track.id, initial: canonicalBpmDraft, value });
  };

  const commitBpm = () => {
    const trimmed = bpmDraft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 20 || next > 300)) {
      setBpmDraftOverride(null);
      return;
    }
    if (next === (track.bpm ?? null)) {
      setBpmDraftOverride(null);
      return;
    }
    onPatch({ bpm: next });
  };

  const currentStatus = (track.status as TrackStatus) || 'needs_work';
  const isMinor = track.scale === 'minor';

  return (
    <div className="px-6 py-5 border-b border-white/10 space-y-5">
      <h3 className="text-[9px] font-black uppercase tracking-[0.25em] text-white/40">Metadata</h3>

      {/* Type — pill row */}
      <div>
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-2">Type</span>
        <div className="flex gap-1.5 flex-wrap">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onPatch({ type: opt.value })}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-all ${
                track.type === opt.value
                  ? 'bg-white/10 border-white/ text-white shadow-sm'
                  : 'bg-transparent border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status — pill row with colored dots */}
      <div>
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-2">Status</span>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map((opt) => {
            const active = currentStatus === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onPatch({ status: opt.value })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-all ${
                  active ? opt.active : 'bg-transparent border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? opt.dot : 'bg-white/20'}`} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rating */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Rating</span>
        <StarRating trackId={track.id} initialRating={track.rating || 0} onChange={onRatingChange} />
      </div>

      {/* BPM — inline number input with +/- nudge buttons */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">BPM</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const v = Number(bpmDraft);
              if (v > 20) { const n = v - 1; setBpmDraft(String(n)); onPatch({ bpm: n }); }
            }}
            className="w-6 h-6 rounded border border-white/10 text-white/40 hover:text-white hover:border-white/20 flex items-center justify-center text-[12px] leading-none transition-colors"
          >−</button>
          <input
            type="number"
            inputMode="numeric"
            min={20} max={300}
            value={bpmDraft}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="—"
            className="bg-[#090907] border border-white/10 rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-white focus:outline-none focus:border-white/30 w-16 text-center tabular-nums"
          />
          <button
            onClick={() => {
              const v = Number(bpmDraft);
              if (v < 300) { const n = v + 1; setBpmDraft(String(n)); onPatch({ bpm: n }); }
            }}
            className="w-6 h-6 rounded border border-white/10 text-white/40 hover:text-white hover:border-white/20 flex items-center justify-center text-[12px] leading-none transition-colors"
          >+</button>
        </div>
      </div>

      {/* Key — chromatic button grid in circle-of-fifths layout */}
      <div>
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-2">Key</span>
        <div className="space-y-1">
          {[KEY_ROW_1, KEY_ROW_2].map((row, ri) => (
            <div key={ri} className="flex gap-1">
              {row.map((k) => {
                const active = track.key === k;
                return (
                  <button
                    key={k}
                    onClick={() => onPatch({ key: active ? null : k })}
                    className={`flex-1 py-1.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wide border transition-all ${
                      active
                        ? isMinor
                          ? 'bg-[#1f1a10] border-[#3d3020]/50 text-[#c8a47a]'
                          : 'bg-[#1f1a10] border-[#3d3020]/60 text-[#c8a47a]'
                        : 'bg-[#090907] border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                    }`}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Scale — two-state toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Scale</span>
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {SCALE_OPTIONS.map((s) => {
            const active = (track.scale ?? 'major') === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onPatch({ scale: s.value })}
                className={`px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider transition-colors ${
                  active
                    ? s.value === 'minor'
                      ? 'bg-[#1f1a10] text-[#c8a47a]'
                      : 'bg-[#1f1a10] text-[#c8a47a]'
                    : 'bg-transparent text-white/40 hover:text-white/60'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
