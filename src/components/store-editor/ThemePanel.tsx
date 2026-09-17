'use client';

/**
 * Global storefront styling.
 *
 * Every control here changes the whole page at once — that is the point of a
 * design system rather than a pile of per-section colour pickers. The presets
 * are complete themes a producer can then take apart, not modes: applying one
 * writes plain values, so the next thing you touch is just an edit.
 *
 * The default preset is the app's own documented palette, so a storefront that
 * has never been themed is byte-for-byte the page that exists today.
 */

import { RotateCcw } from 'lucide-react';
import { defaultStoreTheme, type StoreTheme } from '@/lib/store-editor/layout';
import { cn } from '@/lib/utils';

type Preset = { id: string; name: string; hint: string; theme: Partial<StoreTheme> };

/**
 * Curated themes.
 *
 * Deliberately few and deliberately different from each other. A long list of
 * near-identical dark themes is the "AI dashboard" failure mode — these are
 * four positions a beat producer might actually take.
 */
const presets: Preset[] = [
  {
    id: 'default',
    name: 'House',
    hint: 'The stock storefront',
    theme: defaultStoreTheme,
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    hint: 'Hard edges, heavy rules',
    theme: {
      accent: '#F2F2F0',
      background: '#0A0A0A',
      surface: '#121212',
      border: 'rgba(255,255,255,0.28)',
      radius: 0,
      borderWidth: 2,
      spacingScale: 0.75,
      buttonStyle: 'outline',
      shadow: 'none',
      headingFont: 'heading',
    },
  },
  {
    id: 'mineral',
    name: 'Mineral',
    hint: 'Warm accent, softer rhythm',
    theme: {
      accent: '#c8a47a',
      background: '#090907',
      surface: '#14110d',
      border: 'rgba(255,255,255,0.12)',
      radius: 2,
      borderWidth: 1,
      spacingScale: 1.25,
      buttonStyle: 'solid',
      shadow: 'soft',
    },
  },
  {
    id: 'signal',
    name: 'Signal',
    hint: 'Mint accent, tight grid',
    theme: {
      accent: '#6DC6A4',
      background: '#070908',
      surface: '#0D110F',
      border: 'rgba(255,255,255,0.1)',
      radius: 0,
      borderWidth: 1,
      spacingScale: 0.9,
      buttonStyle: 'ghost',
      shadow: 'none',
    },
  },
];

function Label({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{children}</span>;
}

function Swatch({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // Only a plain hex can drive a native colour input; the theme also holds
  // rgba() values for borders, which stay editable as text.
  const isHex = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <label className="grid gap-1.5">
      <Label>{label}</Label>
      {/* Focus lands on the WRAPPER: the swatch and the hex field are one
          compound control, and the text input clears its own outline. */}
      <span className="flex items-center gap-2 border border-white/10 bg-[#090907] p-1 focus-within:border-white/40">
        {isHex ? (
          <input
            type="color"
            value={value}
            aria-label={label}
            onChange={(event) => onChange(event.target.value)}
            className="size-7 cursor-pointer border-0 bg-transparent p-0"
          />
        ) : (
          <span aria-hidden className="size-7 border border-white/10" style={{ background: value }} />
        )}
        <input
          type="text"
          value={value}
          aria-label={`${label} value`}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-transparent font-mono text-[11px] text-white/90 outline-none"
        />
      </span>
    </label>
  );
}

function Stepper({ label, value, min, max, step = 1, suffix, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-[10px] tabular-nums text-white/60">
          {Math.round(value * 100) / 100}{suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none bg-white/10 accent-white"
      />
    </label>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 truncate border px-1 text-[11px] capitalize transition-colors',
              value === option.value
                ? 'border-white/40 bg-white/[0.12] text-white/90'
                : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/90',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThemePanel({ theme, onChange }: {
  theme: StoreTheme;
  onChange: (patch: Partial<StoreTheme>) => void;
}) {
  return (
    <div className="min-h-0 space-y-5 overflow-y-auto px-3 py-4">
      <div className="grid gap-1.5">
        <span className="flex items-center justify-between">
          <Label>Presets</Label>
          <button
            type="button"
            onClick={() => onChange(defaultStoreTheme)}
            title="Back to the stock storefront"
            className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/40 transition-colors hover:text-white/90"
          >
            <RotateCcw size={9} /> Reset
          </button>
        </span>
        <div className="grid grid-cols-2 gap-1">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.hint}
              onClick={() => onChange(preset.theme)}
              className="border border-white/10 px-2 py-1.5 text-left transition-colors hover:border-white/25"
            >
              <span className="mb-1 flex gap-1">
                {[preset.theme.background, preset.theme.surface, preset.theme.accent].map((color, index) => (
                  <span
                    key={index}
                    aria-hidden
                    className="size-3 border border-white/10"
                    style={{ background: color ?? theme.background }}
                  />
                ))}
              </span>
              <span className="block truncate text-[11px] text-white/70">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t border-white/10 pt-4">
        <Label>Colour</Label>
        <Swatch label="Accent" value={theme.accent} onChange={(accent) => onChange({ accent })} />
        <Swatch label="Background" value={theme.background} onChange={(background) => onChange({ background })} />
        <Swatch label="Surface" value={theme.surface} onChange={(surface) => onChange({ surface })} />
        <Swatch label="Border" value={theme.border} onChange={(border) => onChange({ border })} />
      </div>

      <div className="space-y-3 border-t border-white/10 pt-4">
        <Label>Type</Label>
        <Choice
          label="Headings"
          value={theme.headingFont}
          options={[
            { value: 'heading', label: 'Synkopy' },
            { value: 'body', label: 'Akira' },
            { value: 'mono', label: 'Panchang' },
          ]}
          onChange={(headingFont) => onChange({ headingFont })}
        />
        <Stepper
          label="Base size" value={theme.typeScale} min={11} max={20} suffix="px"
          onChange={(typeScale) => onChange({ typeScale })}
        />
      </div>

      <div className="space-y-3 border-t border-white/10 pt-4">
        <Label>Form</Label>
        <Stepper label="Radius" value={theme.radius} min={0} max={24} suffix="px" onChange={(radius) => onChange({ radius })} />
        <Stepper label="Border width" value={theme.borderWidth} min={0} max={4} suffix="px" onChange={(borderWidth) => onChange({ borderWidth })} />
        <Stepper
          label="Spacing" value={theme.spacingScale} min={0.5} max={2} step={0.05} suffix="×"
          onChange={(spacingScale) => onChange({ spacingScale })}
        />
        <Choice
          label="Buttons"
          value={theme.buttonStyle}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'outline', label: 'Outline' },
            { value: 'ghost', label: 'Ghost' },
          ]}
          onChange={(buttonStyle) => onChange({ buttonStyle })}
        />
        <Choice
          label="Shadow"
          value={theme.shadow}
          options={[
            { value: 'none', label: 'None' },
            { value: 'soft', label: 'Soft' },
            { value: 'hard', label: 'Hard' },
          ]}
          onChange={(shadow) => onChange({ shadow })}
        />
      </div>
    </div>
  );
}
