'use client';

import { useState } from 'react';
import { ChevronDown, Repeat } from 'lucide-react';
import { Slider } from '@/components/ui/Slider';

interface Props {
  currentTime: number;
  duration: number;
  seek: (t: number) => void;
  loopOn: boolean;
  setLoopOn: (fn: (v: boolean) => boolean) => void;
  loopA: number;
  setLoopA: (v: number) => void;
  loopB: number;
  setLoopB: (v: number) => void;
  tempo: number;
  setTempo: (v: number) => void;
  pitchSemis: number;
  setPitchSemis: (v: number) => void;
  preservePitch: boolean;
  setPreservePitch: (fn: (v: boolean) => boolean) => void;
}

/**
 * Transport bar with scrub + loop region + tempo / pitch knobs.
 *
 * Extracted from StudioWorkstation. Self-contained presentation; every
 * state value + setter is threaded through props so the parent retains
 * ownership of audio engine wiring. About 100 LOC removed from the
 * workstation file by lifting this out.
 */
export function StudioTransport({
  currentTime, duration, seek,
  loopOn, setLoopOn, loopA, setLoopA, loopB, setLoopB,
  tempo, setTempo, pitchSemis, setPitchSemis,
  preservePitch, setPreservePitch,
}: Props) {
  const [showLoopEditor, setShowLoopEditor] = useState(false);

  const toggleLoop = () => {
    setLoopOn((v) => {
      const next = !v;
      if (next) {
        setShowLoopEditor(true);
        if (duration > 0 && loopB <= loopA) setLoopB(duration);
      }
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-[#1A1813] bg-[#0D0B09] p-3 sm:p-4">
      {/* Scrub bar — luxury Slider primitive. Loop region renders as a
          translucent band underneath via absolute overlay. */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-[#D0C3AF]">
        <span className="tabular-nums">{fmtTime(currentTime)}</span>
        <div className="flex-1 relative">
          {/* Loop region overlay — drawn beneath the slider but on top
              of the track. Slider's own thumb / range sit above this via
              z-index ordering. */}
          {loopOn && duration > 0 && loopB > loopA && (
            <div
              className="absolute top-1/2 -translate-y-1/2 h-2 bg-[#F3E6D1]/15 border border-[#E7D7BE]/40 rounded pointer-events-none z-0"
              style={{
                left: `${(loopA / duration) * 100}%`,
                width: `${((loopB - loopA) / duration) * 100}%`,
              }}
            />
          )}
          <Slider
            value={currentTime}
            onChange={seek}
            min={0}
            max={duration || 0}
            step={0.01}
            showTooltip
            variant="studio"
            formatTooltip={fmtTime}
            aria-label="Scrub position"
          />
        </div>
        <span className="tabular-nums">{fmtTime(duration)}</span>
      </div>

      {/* Tempo + pitch + pitch-lock toggle. */}
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <ControlCard label="Tempo" value={`${(tempo * 100).toFixed(0)}%`}>
          <Slider
            value={tempo} onChange={setTempo}
            min={0.5} max={1.5} step={0.01}
            showTooltip variant="studio" bipolar
            formatTooltip={(v) => `${(v * 100).toFixed(0)}%`}
            aria-label="Tempo"
          />
        </ControlCard>
        <ControlCard
          label={preservePitch ? 'Pitch' : 'Pitch vinyl'}
          value={preservePitch ? '0st' : `${pitchSemis > 0 ? '+' : ''}${pitchSemis}st`}
        >
          <Slider
            value={pitchSemis} onChange={(v) => setPitchSemis(Math.round(v))}
            min={-12} max={12} step={1}
            disabled={preservePitch}
            showTooltip variant="studio" bipolar
            formatTooltip={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}st`}
            aria-label="Pitch"
          />
        </ControlCard>
        <div className="grid grid-cols-2 gap-2 md:w-[190px]">
          <button
            onClick={() => setPreservePitch((v) => !v)}
            className={`min-h-[54px] rounded-lg border px-2 py-2 text-[9px] font-mono uppercase tracking-[0.16em] transition-colors ${
              preservePitch
                ? 'border-[#C9BCA8]/40 bg-[#342F27] text-[#F3E6D1]'
                : 'border-[#211F1A] bg-[#1A1813] text-[#B4AA99] hover:text-white'
            }`}
          >
            Lock<br />
            <span className="text-[11px]">{preservePitch ? 'On' : 'Off'}</span>
          </button>
          <button
            onClick={toggleLoop}
            className={`flex min-h-[54px] items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[9px] font-mono uppercase tracking-[0.16em] transition-colors ${
              loopOn
                ? 'border-[#C9BCA8]/40 bg-[#342F27] text-[#F3E6D1]'
                : 'border-[#211F1A] bg-[#1A1813] text-[#B4AA99] hover:text-white'
            }`}
          >
            <Repeat size={10} /> Loop
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowLoopEditor((v) => !v)}
        className="mt-3 flex w-full items-center justify-between rounded-lg border border-[#17130F] bg-[#090907] px-3 py-2 text-left text-[9px] font-mono uppercase tracking-[0.18em] text-[#837B6D] transition-colors hover:text-[#F3E6D1]"
      >
        <span>Loop points {loopOn ? `${fmtTime(loopA)} - ${fmtTime(loopB)}` : 'off'}</span>
        <ChevronDown size={12} className={`transition-transform ${showLoopEditor ? 'rotate-180' : ''}`} />
      </button>

      {showLoopEditor && (
        <div className="mt-2 rounded-lg border border-[#17130F] bg-[#090907] p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_52px_auto] sm:items-center">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">A</span>
            <Slider
              value={loopA}
              onChange={(v) => setLoopA(Math.min(v, loopB))}
              min={0} max={duration || 0} step={0.01}
              accent="#F3E6D1" variant="studio"
              aria-label="Loop start"
            />
            <span className="text-right text-[10px] font-mono tabular-nums text-[#D0C3AF]">{fmtTime(loopA)}</span>
            <button
              onClick={() => setLoopA(currentTime)}
              className="rounded-full border border-[#211F1A] px-2 py-1 text-[9px] font-mono uppercase text-[#9B9282] transition-colors hover:text-white"
            >Set A</button>

            <span className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">B</span>
            <Slider
              value={loopB}
              onChange={(v) => setLoopB(Math.max(v, loopA))}
              min={0} max={duration || 0} step={0.01}
              accent="#F3E6D1" variant="studio"
              aria-label="Loop end"
            />
            <span className="text-right text-[10px] font-mono tabular-nums text-[#D0C3AF]">{fmtTime(loopB)}</span>
            <button
              onClick={() => setLoopB(currentTime)}
              className="rounded-full border border-[#211F1A] px-2 py-1 text-[9px] font-mono uppercase text-[#9B9282] transition-colors hover:text-white"
            >Set B</button>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function ControlCard({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#17130F] bg-[#090907] p-3">
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">{label}</label>
        <span className="text-[11px] text-[#F3E6D1] font-mono">{value}</span>
      </div>
      {children}
    </div>
  );
}
