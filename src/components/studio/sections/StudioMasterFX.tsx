'use client';

import { Headphones } from 'lucide-react';
import { Slider } from '@/components/ui/Slider';

interface Props {
  masterVol: number;
  setMasterVol: (v: number) => void;
  reverbReturn: number;
  setReverbReturn: (v: number) => void;
  delayReturn: number;
  setDelayReturn: (v: number) => void;
  delayTime: number;
  setDelayTime: (v: number) => void;
  delayFeedback: number;
  setDelayFeedback: (v: number) => void;
}

/**
 * Master volume + send returns + delay tuning — extracted from
 * StudioWorkstation.
 *
 * Every knob is a stock <input type="range"> with shared styling.
 * The audio engine listens to the parent's setters via useEffect so
 * adjustments take effect immediately. No state of its own.
 */
export function StudioMasterFX({
  masterVol, setMasterVol,
  reverbReturn, setReverbReturn,
  delayReturn, setDelayReturn,
  delayTime, setDelayTime,
  delayFeedback, setDelayFeedback,
}: Props) {
  return (
    <aside className="rounded-2xl border border-[#1A1813] bg-[#0D0B09] p-3 sm:p-4 xl:sticky xl:top-6 xl:self-start">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Headphones size={12} className="text-[#F3E6D1]" />
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#F7EBDD]">Master + FX</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <Knob label="Master" value={`${Math.round(masterVol * 100)}`}>
          <Slider value={masterVol} onChange={setMasterVol} min={0} max={1} step={0.01}
            accent="#F7EBDD" showTooltip variant="studio"
            formatTooltip={(v) => `${Math.round(v * 100)}`} aria-label="Master" />
        </Knob>
        <Knob label="Reverb return" value={`${Math.round(reverbReturn * 100)}`}>
          <Slider value={reverbReturn} onChange={setReverbReturn} min={0} max={1.5} step={0.01}
            showTooltip variant="studio"
            formatTooltip={(v) => `${Math.round(v * 100)}`} aria-label="Reverb return" />
        </Knob>
        <Knob label="Delay return" value={`${Math.round(delayReturn * 100)}`}>
          <Slider value={delayReturn} onChange={setDelayReturn} min={0} max={1.5} step={0.01}
            showTooltip variant="studio"
            formatTooltip={(v) => `${Math.round(v * 100)}`} aria-label="Delay return" />
        </Knob>
        <Knob label="Delay time" value={`${Math.round(delayTime * 1000)}ms`}>
          <Slider value={delayTime} onChange={setDelayTime} min={0.05} max={1.5} step={0.005}
            showTooltip variant="studio"
            formatTooltip={(v) => `${Math.round(v * 1000)}ms`} aria-label="Delay time" />
        </Knob>
        <Knob label="Delay feedback" value={`${Math.round(delayFeedback * 100)}`}>
          <Slider value={delayFeedback} onChange={setDelayFeedback} min={0} max={0.95} step={0.01}
            showTooltip variant="studio"
            formatTooltip={(v) => `${Math.round(v * 100)}`} aria-label="Delay feedback" />
        </Knob>
      </div>
    </aside>
  );
}

function Knob({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#17130F] bg-[#090907] p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282]">{label}</label>
        <span className="text-[11px] text-[#F3E6D1] font-mono">{value}</span>
      </div>
      {children}
    </div>
  );
}
