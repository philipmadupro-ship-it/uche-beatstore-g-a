'use client';

import type { DitherColorMode, DitherMode, DitherTexture } from '@/components/ui/dither-shader';

interface DitherModeSelectorProps {
  mode: DitherMode;
  colorMode: DitherColorMode;
  texture: DitherTexture;
  onChange: (
    mode: DitherModeSelectorProps['mode'],
    colorMode: DitherModeSelectorProps['colorMode'],
    texture: DitherModeSelectorProps['texture'],
  ) => void;
}

const modes: Array<{ value: DitherMode; label: string }> = [
  { value: 'bayer', label: 'Bayer' },
  { value: 'halftone', label: 'Halftone' },
  { value: 'noise', label: 'Noise' },
  { value: 'crosshatch', label: 'Cross' },
];

const colorModes: Array<{ value: DitherColorMode; label: string }> = [
  { value: 'original', label: 'Color' },
  { value: 'grayscale', label: 'Gray' },
  { value: 'duotone', label: 'Duotone' },
];

const textures: Array<{ value: DitherTexture; label: string }> = [
  { value: 'paper', label: 'Paper' },
  { value: 'film-grain', label: 'Grain' },
  { value: 'concrete', label: 'Stone' },
  { value: 'scanlines', label: 'Scan' },
  { value: 'none', label: 'None' },
];

export function DitherModeSelector({ mode, colorMode, texture, onChange }: DitherModeSelectorProps) {
  const buttonClass = (active: boolean) =>
    `pb-1 text-[10px] font-mono uppercase tracking-[0.2em] transition-colors ${
      active
        ? 'text-[#D4BFA0] border-b border-[#D4BFA0]'
        : 'text-[#6a5d4a] border-b border-transparent hover:text-[#a08a6a]'
    }`;

  return (
    <div className="space-y-2 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2" data-card-action>
      <div role="radiogroup" aria-label="Dither mode" className="flex flex-wrap gap-3">
        {modes.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={mode === item.value}
            className={buttonClass(mode === item.value)}
            onClick={(event) => {
              event.stopPropagation();
              onChange(item.value, colorMode, texture);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Dither color mode" className="flex flex-wrap gap-3">
        {colorModes.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={colorMode === item.value}
            className={buttonClass(colorMode === item.value)}
            onClick={(event) => {
              event.stopPropagation();
              onChange(mode, item.value, texture);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Dither texture" className="flex flex-wrap gap-3">
        {textures.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={texture === item.value}
            className={buttonClass(texture === item.value)}
            onClick={(event) => {
              event.stopPropagation();
              onChange(mode, colorMode, item.value);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
