'use client';

/**
 * The toolbar that changes with the selection.
 *
 * The studio's header is global — undo, zoom, guides, export — and the right
 * panel is exhaustive. Neither is the thing you want while actually working,
 * which is the four or five controls that matter for whatever is selected right
 * now, one click away and in the same place every time.
 *
 * So this strip is deliberately NOT a second inspector. It carries only the
 * controls a producer reaches for repeatedly mid-composition: type size and
 * alignment while setting a title, fit and mask while placing a photograph,
 * align and distribute while tidying a collage. Everything else stays in the
 * panel. Adding more here would recreate the overloaded toolbar this exists to
 * avoid.
 *
 * Nothing is duplicated for its own sake either — every control writes through
 * the same handlers the inspector uses, so the two can never disagree.
 */

import {
  AlignCenter, AlignEndHorizontal, AlignHorizontalJustifyCenter, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignVerticalJustifyCenter, Eye, EyeOff, Lock, MoveHorizontal,
  MoveVertical, Trash2, Type as TypeIcon, Unlock,
} from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { resolveFont, nearestFace } from '@/lib/cover/fonts';
import { fxPresets } from '@/lib/cover/effects';
import { cn } from '@/lib/utils';
import {
  artworkImageMasks, artworkImageTreatments, imageCropDefaults,
  type ArtworkLayer, type LayerAlignment,
} from './cover-art-document';

/* ── Shared atoms ───────────────────────────────────────────────────────── */

function Divider() {
  return <span aria-hidden className="h-5 w-px shrink-0 bg-white/10" />;
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {label ? (
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{label}</span>
      ) : null}
      {children}
    </div>
  );
}

function IconButton({ label, active, onClick, children }: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid size-7 shrink-0 place-items-center border transition-colors',
        active
          ? 'border-white/40 bg-white/[0.12] text-white/90'
          : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/90',
      )}
    >
      {children}
    </button>
  );
}

/** Compact inline number field. Committed on blur/Enter so typing is not fought. */
function MiniNumber({ label, value, min, max, width = 52, onChange }: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  width?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1" title={label}>
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{label}</span>
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        min={min}
        max={max}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isNaN(next)) return;
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
        }}
        style={{ width }}
        className="h-7 border border-white/10 bg-[#090907] px-1.5 text-[11px] tabular-nums text-white/90 outline-none focus:border-white/40"
      />
    </label>
  );
}

function SwatchButton({ label, color, onChange }: {
  label: string;
  color: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative shrink-0" title={label}>
      <span
        aria-hidden
        className="block size-7 border border-white/20"
        style={{ background: color }}
      />
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

/* ── The toolbar ────────────────────────────────────────────────────────── */

export function ContextualToolbar({
  selected,
  onPatch,
  onAlign,
  onDistribute,
  onRemoveSelected,
}: {
  selected: ArtworkLayer[];
  onPatch: (patch: Partial<ArtworkLayer>) => void;
  onAlign: (alignment: LayerAlignment) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  onRemoveSelected: () => void;
}) {
  const layer = selected.length === 1 ? selected[0] : null;
  const many = selected.length > 1;

  return (
    <div className="flex h-10 items-center gap-2 overflow-x-auto border-b border-white/10 bg-[#0D0D0A] px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {selected.length === 0 ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
          Nothing selected — click a layer, or drag a box across the canvas
        </span>
      ) : null}

      {/* Alignment is the one thing that means something for ANY selection:
          one layer aligns to the artboard, several align to each other. */}
      {selected.length > 0 ? (
        <>
          <Group label={many ? `${selected.length} layers` : 'Align'}>
            <IconButton label="Align left" onClick={() => onAlign('left')}><AlignLeft size={12} /></IconButton>
            <IconButton label="Align horizontal centres" onClick={() => onAlign('center-x')}><AlignHorizontalJustifyCenter size={12} /></IconButton>
            <IconButton label="Align right" onClick={() => onAlign('right')}><AlignRight size={12} /></IconButton>
            <IconButton label="Align top" onClick={() => onAlign('top')}><AlignStartHorizontal size={12} /></IconButton>
            <IconButton label="Align vertical centres" onClick={() => onAlign('center-y')}><AlignVerticalJustifyCenter size={12} /></IconButton>
            <IconButton label="Align bottom" onClick={() => onAlign('bottom')}><AlignEndHorizontal size={12} /></IconButton>
          </Group>
          <Divider />
        </>
      ) : null}

      {selected.length > 2 ? (
        <>
          <Group label="Distribute">
            <IconButton label="Even horizontal gaps" onClick={() => onDistribute('x')}><MoveHorizontal size={12} /></IconButton>
            <IconButton label="Even vertical gaps" onClick={() => onDistribute('y')}><MoveVertical size={12} /></IconButton>
          </Group>
          <Divider />
        </>
      ) : null}

      {layer?.type === 'text' ? <TextTools layer={layer} onPatch={onPatch} /> : null}
      {layer?.type === 'image' ? <ImageTools layer={layer} onPatch={onPatch} /> : null}
      {layer?.type === 'shape' ? <ShapeTools layer={layer} onPatch={onPatch} /> : null}
      {layer?.type === 'waveform' ? <WaveformTools layer={layer} onPatch={onPatch} /> : null}
      {layer?.type === 'texture' ? <TextureTools layer={layer} onPatch={onPatch} /> : null}

      {/* A look applies to everything selected at once, which is the fast way
          to give a whole collage one treatment. */}
      {selected.length > 0 ? (
        <>
          <Divider />
          <Group label="Look">
            <Dropdown
              aria-label="Apply a look"
              value=""
              placeholder="Apply…"
              options={fxPresets.map((preset) => ({
                value: preset.id, label: preset.name, hint: preset.hint,
              }))}
              onChange={(id) => {
                const preset = fxPresets.find((item) => item.id === id);
                if (preset) onPatch({ fx: preset.fx } as Partial<ArtworkLayer>);
              }}
              menuWidth={220}
            />
          </Group>
        </>
      ) : null}

      {selected.length > 0 ? (
        <>
          <Divider />
          <Group>
            <IconButton
              label={selected.every((item) => item.locked) ? 'Unlock' : 'Lock'}
              active={selected.every((item) => item.locked)}
              onClick={() => onPatch({ locked: !selected.every((item) => item.locked) })}
            >
              {selected.every((item) => item.locked) ? <Unlock size={12} /> : <Lock size={12} />}
            </IconButton>
            <IconButton
              label={selected.every((item) => item.visible) ? 'Hide' : 'Show'}
              onClick={() => onPatch({ visible: !selected.every((item) => item.visible) })}
            >
              {selected.every((item) => item.visible) ? <Eye size={12} /> : <EyeOff size={12} />}
            </IconButton>
            <IconButton label="Delete" onClick={onRemoveSelected}><Trash2 size={12} /></IconButton>
          </Group>
        </>
      ) : null}
    </div>
  );
}

/* ── Per-type tool sets ─────────────────────────────────────────────────── */

function TextTools({ layer, onPatch }: {
  layer: Extract<ArtworkLayer, { type: 'text' }>;
  onPatch: (patch: Partial<ArtworkLayer>) => void;
}) {
  const font = resolveFont(layer.fontFamily);
  const face = nearestFace(font, layer.fontWeight ?? 400);
  return (
    <>
      <Group>
        {/* The face itself, set IN the face — the picker proper lives in the
            panel, but knowing what you are looking at should not require it. */}
        <span
          className="flex h-7 shrink-0 items-center gap-1.5 border border-white/10 px-2 text-[12px] text-white/90"
          title={`${font.name} ${face.label}`}
        >
          <TypeIcon size={11} className="shrink-0 text-white/40" />
          <span style={{ fontFamily: font.stack, fontWeight: face.weight }}>{font.name}</span>
        </span>
        {font.faces.length > 1 ? (
          <Dropdown
            aria-label="Font weight"
            value={String(face.weight)}
            options={font.faces.map((item) => ({ value: String(item.weight), label: item.label }))}
            onChange={(weight) => onPatch({ fontWeight: Number(weight) } as Partial<ArtworkLayer>)}
            menuWidth={150}
          />
        ) : null}
      </Group>
      <Divider />
      <Group>
        <MiniNumber label="Size" value={layer.fontSize} min={8} max={900} onChange={(fontSize) => onPatch({ fontSize } as Partial<ArtworkLayer>)} />
        <MiniNumber label="Track" value={layer.tracking} min={-60} max={200} onChange={(tracking) => onPatch({ tracking } as Partial<ArtworkLayer>)} />
        <MiniNumber label="Lead" value={layer.lineHeight} min={0.6} max={2} width={46} onChange={(lineHeight) => onPatch({ lineHeight } as Partial<ArtworkLayer>)} />
      </Group>
      <Divider />
      <Group>
        <IconButton label="Align left" active={layer.align === 'left'} onClick={() => onPatch({ align: 'left' } as Partial<ArtworkLayer>)}><AlignLeft size={12} /></IconButton>
        <IconButton label="Align centre" active={layer.align === 'center'} onClick={() => onPatch({ align: 'center' } as Partial<ArtworkLayer>)}><AlignCenter size={12} /></IconButton>
        <IconButton label="Align right" active={layer.align === 'right'} onClick={() => onPatch({ align: 'right' } as Partial<ArtworkLayer>)}><AlignRight size={12} /></IconButton>
        <IconButton
          label={layer.uppercase ? 'Use original case' : 'Make uppercase'}
          active={layer.uppercase}
          onClick={() => onPatch({ uppercase: !layer.uppercase } as Partial<ArtworkLayer>)}
        >
          <span className="text-[10px] font-semibold leading-none">AA</span>
        </IconButton>
        <SwatchButton label="Text colour" color={layer.color} onChange={(color) => onPatch({ color } as Partial<ArtworkLayer>)} />
      </Group>
    </>
  );
}

function ImageTools({ layer, onPatch }: {
  layer: Extract<ArtworkLayer, { type: 'image' }>;
  onPatch: (patch: Partial<ArtworkLayer>) => void;
}) {
  const crop = imageCropDefaults(layer);
  return (
    <>
      <Group label="Fit">
        {(['cover', 'contain', 'fill'] as const).map((fit) => (
          <button
            key={fit}
            type="button"
            aria-pressed={crop.fit === fit}
            onClick={() => onPatch({ fit } as Partial<ArtworkLayer>)}
            className={cn(
              'h-7 shrink-0 border px-2 text-[11px] capitalize transition-colors',
              crop.fit === fit
                ? 'border-white/40 bg-white/[0.12] text-white/90'
                : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/90',
            )}
          >
            {fit === 'fill' ? 'stretch' : fit}
          </button>
        ))}
      </Group>
      <Divider />
      <Group label="Mask">
        <Dropdown
          aria-label="Mask shape"
          value={crop.mask}
          options={artworkImageMasks.map((mask) => ({ value: mask, label: mask }))}
          onChange={(mask) => onPatch({ mask } as Partial<ArtworkLayer>)}
          menuWidth={140}
        />
      </Group>
      <Divider />
      <Group label="Treat">
        <Dropdown
          aria-label="Image treatment"
          value={layer.treatment}
          options={artworkImageTreatments.map((treatment) => ({
            value: treatment, label: treatment.replace('-', ' '),
          }))}
          onChange={(treatment) => onPatch({ treatment } as Partial<ArtworkLayer>)}
          menuWidth={170}
        />
      </Group>
      <Divider />
      <Group>
        <MiniNumber
          label="Zoom" value={Math.round(crop.scale * 100)} min={100} max={300}
          onChange={(percent) => onPatch({ scale: percent / 100 } as Partial<ArtworkLayer>)}
        />
        <MiniNumber
          label="Radius" value={crop.radius} min={0} max={600}
          onChange={(radius) => onPatch({ radius } as Partial<ArtworkLayer>)}
        />
      </Group>
    </>
  );
}

function ShapeTools({ layer, onPatch }: {
  layer: Extract<ArtworkLayer, { type: 'shape' }>;
  onPatch: (patch: Partial<ArtworkLayer>) => void;
}) {
  return (
    <>
      <Group label="Shape">
        <Dropdown
          aria-label="Shape kind"
          value={layer.shape}
          options={[
            { value: 'rect', label: 'Rectangle' },
            { value: 'circle', label: 'Circle' },
            { value: 'triangle', label: 'Triangle' },
            { value: 'rule', label: 'Rule' },
          ]}
          onChange={(shape) => onPatch({ shape } as Partial<ArtworkLayer>)}
          menuWidth={150}
        />
      </Group>
      <Divider />
      <Group label="Fill">
        <SwatchButton label="Fill colour" color={layer.fill} onChange={(fill) => onPatch({ fill } as Partial<ArtworkLayer>)} />
      </Group>
      <Group label="Stroke">
        <SwatchButton label="Stroke colour" color={layer.stroke ?? '#000000'} onChange={(stroke) => onPatch({ stroke } as Partial<ArtworkLayer>)} />
        <MiniNumber label="W" value={layer.strokeWidth ?? 0} min={0} max={80} width={44} onChange={(strokeWidth) => onPatch({ strokeWidth } as Partial<ArtworkLayer>)} />
      </Group>
      {layer.shape === 'rect' ? (
        <Group>
          <MiniNumber label="Radius" value={layer.cornerRadius ?? 0} min={0} max={600} onChange={(cornerRadius) => onPatch({ cornerRadius } as Partial<ArtworkLayer>)} />
        </Group>
      ) : null}
    </>
  );
}

function WaveformTools({ layer, onPatch }: {
  layer: Extract<ArtworkLayer, { type: 'waveform' }>;
  onPatch: (patch: Partial<ArtworkLayer>) => void;
}) {
  return (
    <>
      <Group label="Shape">
        <Dropdown
          aria-label="Waveform shape"
          value={layer.mode}
          options={[
            { value: 'linear', label: 'Bars' },
            { value: 'blocks', label: 'Blocks' },
            { value: 'line', label: 'Line' },
            { value: 'contour', label: 'Contour' },
            { value: 'circular', label: 'Circular' },
          ]}
          onChange={(mode) => onPatch({ mode } as Partial<ArtworkLayer>)}
          menuWidth={150}
        />
      </Group>
      <Divider />
      <Group>
        <MiniNumber
          label="Height" value={Math.round(layer.amplitude * 100)} min={10} max={140}
          onChange={(percent) => onPatch({ amplitude: percent / 100 } as Partial<ArtworkLayer>)}
        />
        <SwatchButton label="Waveform colour" color={layer.color} onChange={(color) => onPatch({ color } as Partial<ArtworkLayer>)} />
      </Group>
    </>
  );
}

function TextureTools({ layer, onPatch }: {
  layer: Extract<ArtworkLayer, { type: 'texture' }>;
  onPatch: (patch: Partial<ArtworkLayer>) => void;
}) {
  return (
    <Group label="Intensity">
      <MiniNumber
        label="%" value={Math.round(layer.intensity * 100)} min={0} max={100}
        onChange={(percent) => onPatch({ intensity: percent / 100 } as Partial<ArtworkLayer>)}
      />
    </Group>
  );
}
