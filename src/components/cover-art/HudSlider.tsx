'use client';

/**
 * HUD slider — the studio's single control for any continuous value.
 *
 * Replaces a bare `<input type="number">`. A spinner tells you nothing about
 * range and cannot be explored; a slider shows where a value sits inside its
 * limits at a glance, which is the whole point of a work field you scan rather
 * than read.
 *
 * SCRUB *OR* TYPE. The numeric field is kept alongside the track, not replaced
 * by it. Dragging is fast but imprecise, and some values here genuinely need to
 * be exact — matching a tracking value across two text layers, setting rotation
 * to exactly 0. Photoshop, Figma and every DAW offer both for the same reason.
 *
 * Built on a native `input[type=range]`, so keyboard operation, focus and the
 * slider role come from the platform rather than being re-implemented — arrow
 * keys, Home/End and Page Up/Down all work for free, which a div-with-handlers
 * would have to earn back.
 */

import { useId, useState } from 'react';

interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Appended to the readout, e.g. "px" or "°". Purely visual. */
  unit?: string;
  onChange: (value: number) => void;
}

/** Decimals to show, inferred from the step so 0.05 doesn't render as "0.30000000004". */
function decimalsFor(step: number): number {
  if (Number.isInteger(step)) return 0;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

export function HudSlider({
  label, value, min = 0, max = 100, step = 1, unit, onChange,
}: Props) {
  const id = useId();
  const decimals = decimalsFor(step);

  // The typed field is free text while focused so intermediate states like ""
  // or "-" don't get coerced to 0 on every keystroke and fight the user.
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? value.toFixed(decimals);

  // No effect re-syncs `draft` from `value`. It is cleared on commit, blur and
  // Escape, which covers every way editing ends — and if the value changes
  // externally (canvas drag, undo) while the field is focused, keeping what the
  // user is typing is the right call rather than overwriting it mid-keystroke.

  const commit = (raw: string) => {
    const parsed = Number(raw);
    setDraft(null);
    if (!Number.isFinite(parsed)) return;
    onChange(Math.min(max, Math.max(min, parsed)));
  };

  // Filled portion of the track, so the control reads at a glance.
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className="group grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[9px] uppercase tracking-[0.18em] text-[#6A655C] transition-colors group-focus-within:text-[#C7B89D]"
        >
          {label}
        </label>
        <input
          aria-label={`${label} value`}
          value={display}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
          }}
          inputMode="decimal"
          className="w-14 bg-transparent text-right font-mono text-[11px] tabular-nums text-[#EEE8DD] outline-none focus-visible:text-[#C7B89D]"
        />
      </div>

      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        // Track is painted with a gradient rather than a wrapper div so the
        // filled portion stays perfectly aligned with the native thumb.
        style={{
          background:
            `linear-gradient(to right, #C7B89D 0%, #C7B89D ${pct}%, #26241F ${pct}%, #26241F 100%)`,
        }}
        className="
          h-[3px] w-full cursor-pointer appearance-none rounded-full outline-none
          [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[#0D0D0A]
          [&::-webkit-slider-thumb]:bg-[#EEE8DD]
          [&::-webkit-slider-thumb]:transition-transform
          hover:[&::-webkit-slider-thumb]:scale-125
          [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3
          [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-[#0D0D0A]
          [&::-moz-range-thumb]:bg-[#EEE8DD]
          focus-visible:ring-1 focus-visible:ring-[#C7B89D] focus-visible:ring-offset-2
          focus-visible:ring-offset-[#0D0D0A]
        "
      />
      {unit ? <span className="sr-only">{unit}</span> : null}
    </div>
  );
}
