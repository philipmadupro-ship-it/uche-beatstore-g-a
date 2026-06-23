'use client';

import { Loader2, Sliders, Volume2, VolumeX } from 'lucide-react';
import { Slider } from '@/components/ui/Slider';
import { EqCurve } from '@/components/studio/sections/EqCurve';

export type StemKey = 'vocals' | 'drums' | 'bass' | 'other';

export interface ChannelState {
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  reverb: number;
  delay: number;
}

export type ChannelKey = StemKey | 'master' | 'pads';

export const STEM_COLORS: Record<ChannelKey, string> = {
  vocals: 'bg-[#E7D7BE]',
  drums:  'bg-[#E26D5C]',
  bass:   'bg-[#E2C16D]',
  other:  'bg-[#6DC6A4]',
  pads:   'bg-[#F09EE3]',
  master: 'bg-white',
};

interface MixerProps {
  /** Whether the user is in stem-mode (4-channel stems mixer) vs master-only. */
  useStems: boolean;
  /** "Loading stems…" spinner gate. */
  stemsLoading: boolean;
  /** All channel states keyed by ChannelKey. Pads are engine-only for keyboard hits. */
  channels: Record<ChannelKey, ChannelState>;
  /** Patch a single channel. The parent dispatches engine updates from this. */
  setChannel: (key: ChannelKey, patch: Partial<ChannelState>) => void;
}

/**
 * Stem/master mixer + ChannelStrip primitive — extracted from
 * StudioWorkstation. Contains everything that renders the mixer surface
 * including the channel strips themselves; the parent just hands in
 * state + a setter.
 *
 * Why keep ChannelStrip co-located with the Mixer: it's only used here.
 * Pulling it into its own file is one more file for no win at this
 * coupling. If it ever gets reused elsewhere (drum machine? sampler?),
 * promote then.
 */
export function StudioMixer({ useStems, stemsLoading, channels, setChannel }: MixerProps) {
  return (
    <div className="rounded-2xl border border-[#1A1813] bg-[#090907] p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders size={12} className="text-[#F3E6D1]" />
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#F7EBDD]">
            {useStems ? 'Stem rack' : 'EQ rack'}
          </p>
        </div>
        {stemsLoading && (
          <p className="text-[10px] text-[#9B9282] flex items-center gap-2">
            <Loader2 size={10} className="animate-spin" /> Loading stems…
          </p>
        )}
      </div>

      <div className={`grid gap-2.5 ${useStems ? 'grid-cols-1 md:grid-cols-2 2xl:grid-cols-4' : 'grid-cols-1'}`}>
        {useStems
          ? (['vocals', 'drums', 'bass', 'other'] as StemKey[]).map((k) => (
              <ChannelStrip
                key={k}
                name={k}
                color={STEM_COLORS[k]}
                state={channels[k]}
                onChange={(p) => setChannel(k, p)}
              />
            ))
          : (
              <ChannelStrip
                name="master"
                color={STEM_COLORS.master}
                state={channels.master}
                onChange={(p) => setChannel('master', p)}
              />
            )}
      </div>
    </div>
  );
}

interface ChannelStripProps {
  name: string;
  color: string;
  state: ChannelState;
  onChange: (p: Partial<ChannelState>) => void;
}

function ChannelStrip({ name, color, state, onChange }: ChannelStripProps) {
  return (
    <div className="rounded-xl border border-[#1A1813] bg-[#0D0B09] p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${color}`} />
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#F7EBDD]">{name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onChange({ muted: !state.muted })}
            className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${
              state.muted
                ? 'bg-red-950/40 border-red-900/50 text-red-300'
                : 'bg-[#1A1813] border-[#211F1A] text-[#B4AA99] hover:text-[#F7EBDD]'
            }`}
          >M</button>
          <button
            onClick={() => onChange({ solo: !state.solo })}
            className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${
              state.solo
                ? 'bg-[#342F27] border-[#C9BCA8]/40 text-[#F3E6D1]'
                : 'bg-[#1A1813] border-[#211F1A] text-[#B4AA99] hover:text-[#F7EBDD]'
            }`}
          >S</button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_74px] gap-3">
        {/* Volume */}
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[8px] font-mono uppercase text-[#9B9282]">
              {state.muted ? <VolumeX size={10} className="text-red-400" /> : <Volume2 size={10} className="text-[#837B6D]" />}
              Level
            </span>
            <span className="text-[8px] font-mono text-[#D0C3AF]">{Math.round(state.volume * 100)}</span>
          </div>
          <Slider
            value={state.volume}
            onChange={(v) => onChange({ volume: v })}
            min={0}
            max={1.2}
            step={0.01}
            showTooltip
            variant="studio"
            formatTooltip={(v) => `${Math.round(v * 100)}`}
            aria-label="Volume"
          />
        </div>

        {/* Pan */}
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[8px] font-mono uppercase text-[#9B9282]">Pan</span>
            <span className="text-[8px] font-mono text-[#D0C3AF]">
              {state.pan === 0 ? 'C' : state.pan < 0 ? `L${Math.round(-state.pan * 100)}` : `R${Math.round(state.pan * 100)}`}
            </span>
          </div>
          <Slider
            value={state.pan}
            onChange={(v) => onChange({ pan: v })}
            min={-1}
            max={1}
            step={0.01}
            accent="#F3E6D1"
            showTooltip
            variant="studio" bipolar
            formatTooltip={(v) => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`}
            aria-label="Pan"
          />
        </div>
      </div>

      {/* EQ — live frequency-response curve above the 3 band sliders.
          The curve reads the same state.eqLow/Mid/High values the
          sliders below mutate, so adjustments are reflected in real
          time. Adds a strong visual cue ("I'm scooping the mids")
          on top of the numeric value the slider already shows. */}
      <div className="mb-3 rounded-lg border border-[#17130F] bg-[#090907] p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[8px] font-mono uppercase tracking-[0.18em] text-[#9B9282]">EQ</span>
          <span className="text-[8px] font-mono uppercase tracking-[0.14em] text-[#4F473B]">Lo · Mid · Hi</span>
        </div>
        <EqCurve low={state.eqLow} mid={state.eqMid} high={state.eqHigh} height={36} />
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {(['eqLow', 'eqMid', 'eqHigh'] as const).map((k, i) => (
            <div key={k}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] font-mono text-[#9B9282] uppercase">
                  {['Lo', 'Mid', 'Hi'][i]}
                </span>
                <span className="text-[8px] font-mono text-[#D0C3AF]">
                  {state[k] > 0 ? '+' : ''}{state[k].toFixed(1)}
                </span>
              </div>
              <Slider value={state[k]}
                onChange={(v) => onChange({ [k]: v } as Partial<ChannelState>)}
                min={-12} max={12} step={0.1} accent="#6DC6A4"
                variant="studio" bipolar
                aria-label={`EQ ${['Lo', 'Mid', 'Hi'][i]}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Sends */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-mono text-[#9B9282] uppercase">Reverb</span>
            <span className="text-[8px] font-mono text-[#F3E6D1]">{Math.round(state.reverb * 100)}</span>
          </div>
          <Slider value={state.reverb} onChange={(v) => onChange({ reverb: v })}
            min={0} max={1} step={0.01} variant="studio" aria-label="Reverb send" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-mono text-[#9B9282] uppercase">Delay</span>
            <span className="text-[8px] font-mono text-[#F3E6D1]">{Math.round(state.delay * 100)}</span>
          </div>
          <Slider value={state.delay} onChange={(v) => onChange({ delay: v })}
            min={0} max={1} step={0.01} variant="studio" aria-label="Delay send" />
        </div>
      </div>
    </div>
  );
}
