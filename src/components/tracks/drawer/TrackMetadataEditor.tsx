'use client';

import { useEffect, useState } from 'react';
import { Track, TrackStatus, TrackType } from '@/lib/types';
import { StarRating } from '@/components/tracks/StarRating';

const TYPE_OPTIONS: { value: TrackType; label: string }[] = [
  { value: 'beat',         label: 'Beat' },
  { value: 'instrumental', label: 'Instr.' },
  { value: 'song',         label: 'Song' },
  { value: 'remix',        label: 'Remix' },
];

const STATUS_OPTIONS: { value: TrackStatus; label: string; active: string; dot: string }[] = [
  { value: 'maq',        label: 'MAQ',        active: 'bg-[#1a1033] text-[#b39ddb] border-[#534AB7]/40', dot: 'bg-[#b39ddb]' },
  { value: 'needs_work', label: 'WIP',        active: 'bg-[#1f1a0a] text-[#D6BE7A] border-[#3a2f1f]',   dot: 'bg-[#D6BE7A]' },
  { value: 'finished',   label: 'Finished',   active: 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]',   dot: 'bg-[#8ecf9f]' },
  { value: 'archived',   label: 'Archived',   active: 'bg-[#1A1813] text-[#B4AA99] border-[#2B2821]',   dot: 'bg-[#837B6D]' },
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

export function TrackMetadataEditor({ track, onPatch, onRatingChange }: Props) {
  const [bpmDraft, setBpmDraft] = useState<string>(track.bpm != null ? String(track.bpm) : '');
  useEffect(() => {
    setBpmDraft(track.bpm != null ? String(track.bpm) : '');
  }, [track.id, track.bpm]);

  const commitBpm = () => {
    const trimmed = bpmDraft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 20 || next > 300)) {
      setBpmDraft(track.bpm != null ? String(track.bpm) : '');
      return;
    }
    if (next === (track.bpm ?? null)) return;
    onPatch({ bpm: next });
  };

  const currentStatus = (track.status as TrackStatus) || 'needs_work';
  const isMinor = track.scale === 'minor';

  return (
    <div className="px-6 py-5 border-b border-[#2B2821] space-y-5">
      <h3 className="text-[9px] font-black uppercase tracking-[0.25em] text-[#837B6D]">Metadata</h3>

      {/* Type — pill row */}
      <div>
        <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest block mb-2">Type</span>
        <div className="flex gap-1.5 flex-wrap">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onPatch({ type: opt.value })}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-all ${
                track.type === opt.value
                  ? 'bg-[#342F27] border-[#C9BCA8]/50 text-[#F3E6D1] shadow-sm'
                  : 'bg-transparent border-[#2B2821] text-[#837B6D] hover:border-[#3B372F] hover:text-[#B4AA99]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status — pill row with colored dots */}
      <div>
        <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest block mb-2">Status</span>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map((opt) => {
            const active = currentStatus === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onPatch({ status: opt.value })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-all ${
                  active ? opt.active : 'bg-transparent border-[#2B2821] text-[#837B6D] hover:border-[#3B372F] hover:text-[#B4AA99]'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? opt.dot : 'bg-[#3B372F]'}`} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rating */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest">Rating</span>
        <StarRating trackId={track.id} initialRating={track.rating || 0} onChange={onRatingChange} />
      </div>

      {/* BPM — inline number input with +/- nudge buttons */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest">BPM</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const v = Number(bpmDraft);
              if (v > 20) { const n = v - 1; setBpmDraft(String(n)); onPatch({ bpm: n }); }
            }}
            className="w-6 h-6 rounded border border-[#2B2821] text-[#837B6D] hover:text-white hover:border-[#3B372F] flex items-center justify-center text-[12px] leading-none transition-colors"
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
            className="bg-[#090907] border border-[#2B2821] rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-[#F3E6D1] focus:outline-none focus:border-[#E7D7BE] w-16 text-center tabular-nums"
          />
          <button
            onClick={() => {
              const v = Number(bpmDraft);
              if (v < 300) { const n = v + 1; setBpmDraft(String(n)); onPatch({ bpm: n }); }
            }}
            className="w-6 h-6 rounded border border-[#2B2821] text-[#837B6D] hover:text-white hover:border-[#3B372F] flex items-center justify-center text-[12px] leading-none transition-colors"
          >+</button>
        </div>
      </div>

      {/* Key — chromatic button grid in circle-of-fifths layout */}
      <div>
        <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest block mb-2">Key</span>
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
                          ? 'bg-[#1a1833] border-[#534AB7]/50 text-[#9d95e8]'
                          : 'bg-[#1f1a10] border-[#3d3020]/60 text-[#c8a47a]'
                        : 'bg-[#090907] border-[#2B2821] text-[#837B6D] hover:border-[#3B372F] hover:text-[#B4AA99]'
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
        <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest">Scale</span>
        <div className="flex rounded-lg border border-[#2B2821] overflow-hidden">
          {SCALE_OPTIONS.map((s) => {
            const active = (track.scale ?? 'major') === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onPatch({ scale: s.value })}
                className={`px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider transition-colors ${
                  active
                    ? s.value === 'minor'
                      ? 'bg-[#1a1833] text-[#9d95e8]'
                      : 'bg-[#1f1a10] text-[#c8a47a]'
                    : 'bg-transparent text-[#837B6D] hover:text-[#B4AA99]'
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
