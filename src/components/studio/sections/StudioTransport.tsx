'use client';

import { Repeat } from 'lucide-react';
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
  return (
    <div className="rounded-xl border border-[#1A1813] bg-[#0D0B09] p-3 sm:p-4">
      {/* Scrub bar — luxury Slider primitive. Loop region renders as a
          translucent band underneath via absolute overlay. */}
      <div className="mb-3 flex items-center gap-3 text-[10px] font-mono text-[#D0C3AF]">
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

      {/* Loop A / B sliders + "Set A" / "Set B" stamp buttons. */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3">
        <button
          onClick={() => setLoopOn((v) => !v)}
          className={`flex min-h-8 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors ${
            loopOn
              ? 'bg-[#342F27] border-[#C9BCA8]/40 text-[#F3E6D1]'
              : 'bg-[#1A1813] border-[#211F1A] text-[#B4AA99]'
          }`}
        >
          <Repeat size={10} /> Loop
        </button>

        <div className="grid grid-cols-[18px_minmax(0,1fr)_48px] items-center gap-2 sm:contents">
          <span className="text-[10px] font-mono text-[#9B9282]">A</span>
          <Slider
              value={loopA}
              onChange={(v) => setLoopA(Math.min(v, loopB))}
              min={0} max={duration || 0} step={0.01}
              accent="#F3E6D1" variant="studio"
              aria-label="Loop start"
            />
          <span className="text-right text-[10px] font-mono tabular-nums text-[#D0C3AF]">{fmtTime(loopA)}</span>
        </div>

        <div className="grid grid-cols-[18px_minmax(0,1fr)_48px] items-center gap-2 sm:contents">
          <span className="text-[10px] font-mono text-[#9B9282]">B</span>
          <Slider
              value={loopB}
              onChange={(v) => setLoopB(Math.max(v, loopA))}
              min={0} max={duration || 0} step={0.01}
              accent="#F3E6D1" variant="studio"
              aria-label="Loop end"
            />
          <span className="text-right text-[10px] font-mono tabular-nums text-[#D0C3AF]">{fmtTime(loopB)}</span>
        </div>

        <div className="flex items-center gap-1.5 sm:col-span-2 sm:justify-end">
          <button
            onClick={() => setLoopA(currentTime)}
            className="rounded-full border border-[#211F1A] px-2 py-1 text-[9px] font-mono uppercase text-[#9B9282] transition-colors hover:text-white"
          >Set A</button>
          <button
            onClick={() => setLoopB(currentTime)}
            className="rounded-full border border-[#211F1A] px-2 py-1 text-[9px] font-mono uppercase text-[#9B9282] transition-colors hover:text-white"
          >Set B</button>
        </div>
      </div>

      {/* Tempo + pitch + pitch-lock toggle. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_160px] md:gap-5">
        <div>
          <Knob label="Tempo" value={`${(tempo * 100).toFixed(0)}%`}>
            <Slider
              value={tempo} onChange={setTempo}
              min={0.5} max={1.5} step={0.01}
              showTooltip variant="studio" bipolar
              formatTooltip={(v) => `${(v * 100).toFixed(0)}%`}
              aria-label="Tempo"
            />
          </Knob>
        </div>
        <div>
          <Knob
            label={`Pitch ${!preservePitch ? '(vinyl)' : ''}`}
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
          </Knob>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">Pitch lock</label>
            <button
              onClick={() => setPreservePitch((v) => !v)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded ${
                preservePitch
                  ? 'bg-[#342F27] text-[#F3E6D1] border border-[#C9BCA8]/40'
                  : 'bg-[#1A1813] text-[#B4AA99] border border-[#211F1A]'
              }`}
            >{preservePitch ? 'On' : 'Off'}</button>
          </div>
          <p className="text-[10px] text-[#9B9282] leading-relaxed">
            {preservePitch
              ? 'Tempo without pitch shift.'
              : 'Tempo + pitch coupled (vinyl).'}
          </p>
        </div>
      </div>
    </div>
  );
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function Knob({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">{label}</label>
        <span className="text-[11px] text-[#F3E6D1] font-mono">{value}</span>
      </div>
      {children}
    </div>
  );
}
