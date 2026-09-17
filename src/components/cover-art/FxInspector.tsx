'use client';

/**
 * Adjustments and effects for the selected layer.
 *
 * Two sections with deliberately different shapes, because they answer
 * different questions:
 *
 *   Adjust  — always present, always the same nine controls. These are the
 *             tonal dials you sweep while looking at the artwork, so they are
 *             laid out as a fixed grid you build muscle memory for.
 *   Effects — a list you add to. An effect that is off shows one row, not a
 *             block of dead sliders. The brief was "curated, not a gimmicky
 *             effects menu", and the difference between those two things is
 *             mostly whether the panel is full of controls doing nothing.
 *
 * Every value written here lands in `layer.fx` and is rendered by the shared
 * filter builder in `lib/cover/effects.ts`, so anything adjusted on the canvas
 * is in the export by construction rather than by a second implementation.
 */

import { Plus, RotateCcw, X } from 'lucide-react';
import {
  fxDefaults, fxPresets, hasAnyFx,
  type ArtworkGlow, type ArtworkGradientMap, type ArtworkLayerFx, type ArtworkShadow,
} from '@/lib/cover/effects';
import { HudSlider } from './HudSlider';
import { moods } from '@/lib/cover/restyle';
import { ColorField, FieldLabel, PanelSection } from './StudioControls';
import { cn } from '@/lib/utils';

type FxPatch = (fx: ArtworkLayerFx) => void;

/** Percent-facing control over a 0..2 multiplier stored with 1 as neutral. */
function MultiplierSlider({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <HudSlider
      label={label}
      value={Math.round(value * 100)}
      min={0}
      max={200}
      step={1}
      unit="%"
      onChange={(percent) => onChange(percent / 100)}
    />
  );
}

/** Percent-facing control over a 0..1 amount. */
function AmountSlider({ label, value, max = 100, onChange }: {
  label: string;
  value: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <HudSlider
      label={label}
      value={Math.round(value * 100)}
      min={0}
      max={max}
      step={1}
      unit="%"
      onChange={(percent) => onChange(percent / 100)}
    />
  );
}

export function AdjustSection({ fx, onPatchFx }: { fx: ArtworkLayerFx | undefined; onPatchFx: FxPatch }) {
  const r = fxDefaults(fx);
  const set = (patch: Partial<ArtworkLayerFx>) => onPatchFx({ ...(fx ?? {}), ...patch });

  const tonalIsNeutral = r.exposure === 0 && r.brightness === 1 && r.contrast === 1
    && r.saturation === 1 && r.hue === 0 && r.blur === 0 && r.sharpen === 0
    && r.grain === 0 && r.vignette === 0;

  return (
    <PanelSection
      title="Adjust"
      action={tonalIsNeutral ? null : (
        <button
          type="button"
          onClick={() => onPatchFx({
            ...(fx ?? {}),
            exposure: undefined,
            brightness: undefined,
            contrast: undefined,
            saturation: undefined,
            hue: undefined,
            blur: undefined,
            sharpen: undefined,
            grain: undefined,
            vignette: undefined,
          })}
          title="Reset every adjustment on this layer"
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 transition-colors hover:text-white/90"
        >
          <RotateCcw size={11} /> Reset
        </button>
      )}
    >
      <HudSlider
        label="Exposure" value={r.exposure} min={-2} max={2} step={0.05} unit="stops"
        onChange={(exposure) => set({ exposure })}
      />
      <MultiplierSlider label="Brightness" value={r.brightness} onChange={(brightness) => set({ brightness })} />
      <MultiplierSlider label="Contrast" value={r.contrast} onChange={(contrast) => set({ contrast })} />
      <MultiplierSlider label="Saturation" value={r.saturation} onChange={(saturation) => set({ saturation })} />
      <HudSlider
        label="Hue" value={r.hue} min={-180} max={180} step={1} unit="°"
        onChange={(hue) => set({ hue })}
      />

      <div className="border-t border-white/10 pt-3" />

      <HudSlider
        label="Blur" value={r.blur} min={0} max={200} step={1} unit="units"
        onChange={(blur) => set({ blur })}
      />
      <AmountSlider label="Sharpen" value={r.sharpen} onChange={(sharpen) => set({ sharpen })} />
      <AmountSlider label="Grain" value={r.grain} onChange={(grain) => set({ grain })} />
      <AmountSlider label="Vignette" value={r.vignette} onChange={(vignette) => set({ vignette })} />
    </PanelSection>
  );
}

/** One entry in the effects list — a header row that expands when enabled. */
function EffectRow({ name, enabled, onAdd, onRemove, children }: {
  name: string;
  enabled: boolean;
  onAdd: () => void;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('border', enabled ? 'border-white/20' : 'border-white/10')}>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className={cn(
          'font-mono text-[10px] uppercase tracking-[0.16em]',
          enabled ? 'text-white/90' : 'text-white/40',
        )}
        >
          {name}
        </span>
        <button
          type="button"
          onClick={enabled ? onRemove : onAdd}
          title={enabled ? `Remove ${name.toLowerCase()}` : `Add ${name.toLowerCase()}`}
          aria-label={enabled ? `Remove ${name.toLowerCase()}` : `Add ${name.toLowerCase()}`}
          aria-pressed={enabled}
          className="grid size-5 place-items-center text-white/40 transition-colors hover:text-white/90"
        >
          {enabled ? <X size={12} /> : <Plus size={12} />}
        </button>
      </div>
      {enabled ? <div className="space-y-2.5 border-t border-white/10 px-2.5 py-3">{children}</div> : null}
    </div>
  );
}

const DEFAULT_SHADOW: ArtworkShadow = { x: 12, y: 16, blur: 24, color: '#000000', opacity: 0.55 };
const DEFAULT_GLOW: ArtworkGlow = { blur: 28, color: '#F2F2F0', opacity: 0.45 };
const DEFAULT_GRADIENT_MAP: ArtworkGradientMap = { from: '#0C0C0A', to: '#C8A47A', amount: 0.85 };

/**
 * Whole-cover moods.
 *
 * Distinct from the effect PRESETS below, which touch one layer: a mood
 * restyles typography, effects and palette together across the artwork while
 * leaving positions and content alone. It is one undo step.
 */
export function MoodSection({ onRestyle, scope }: {
  onRestyle: (moodId: string) => void;
  scope: 'selection' | 'document';
}) {
  return (
    <PanelSection title="Mood">
      <p className="text-[11px] leading-relaxed text-white/40">
        {scope === 'selection'
          ? 'Restyles the selected layers. Your positions and words stay put.'
          : 'Restyles the whole cover. Your layout, images and words stay put.'}
      </p>
      <div className="flex flex-wrap gap-1">
        {moods.map((mood) => (
          <button
            key={mood.id}
            type="button"
            title={mood.hint}
            onClick={() => onRestyle(mood.id)}
            className="border border-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
          >
            {mood.name}
          </button>
        ))}
      </div>
    </PanelSection>
  );
}

export function EffectsSection({ fx, onPatchFx }: { fx: ArtworkLayerFx | undefined; onPatchFx: FxPatch }) {
  const r = fxDefaults(fx);
  const set = (patch: Partial<ArtworkLayerFx>) => onPatchFx({ ...(fx ?? {}), ...patch });

  return (
    <PanelSection
      title="Effects"
      action={hasAnyFx(fx) ? (
        <button
          type="button"
          onClick={() => onPatchFx({})}
          title="Clear every adjustment and effect on this layer"
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 transition-colors hover:text-white/90"
        >
          <RotateCcw size={11} /> Clear all
        </button>
      ) : null}
    >
      {/* Presets are plain fx values, so anything one applies can then be taken
          apart control by control — they are starting points, not modes. */}
      <div className="grid gap-1.5">
        <FieldLabel>Looks</FieldLabel>
        <div className="flex flex-wrap gap-1">
          {fxPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.hint}
              onClick={() => onPatchFx(preset.fx)}
              className="border border-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 pt-1">
        <EffectRow
          name="Drop shadow"
          enabled={r.shadow !== null}
          onAdd={() => set({ shadow: DEFAULT_SHADOW })}
          onRemove={() => set({ shadow: undefined })}
        >
          {r.shadow ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <HudSlider
                  label="X" value={r.shadow.x} min={-200} max={200} step={1}
                  onChange={(x) => set({ shadow: { ...r.shadow!, x } })}
                />
                <HudSlider
                  label="Y" value={r.shadow.y} min={-200} max={200} step={1}
                  onChange={(y) => set({ shadow: { ...r.shadow!, y } })}
                />
              </div>
              <HudSlider
                label="Blur" value={r.shadow.blur} min={0} max={200} step={1}
                onChange={(blur) => set({ shadow: { ...r.shadow!, blur } })}
              />
              <HudSlider
                label="Opacity" value={Math.round(r.shadow.opacity * 100)} min={0} max={100} step={1} unit="%"
                onChange={(percent) => set({ shadow: { ...r.shadow!, opacity: percent / 100 } })}
              />
              <ColorField
                label="Colour" value={r.shadow.color}
                onChange={(color) => set({ shadow: { ...r.shadow!, color } })}
              />
            </>
          ) : null}
        </EffectRow>

        <EffectRow
          name="Glow"
          enabled={r.glow !== null}
          onAdd={() => set({ glow: DEFAULT_GLOW })}
          onRemove={() => set({ glow: undefined })}
        >
          {r.glow ? (
            <>
              <HudSlider
                label="Radius" value={r.glow.blur} min={0} max={200} step={1}
                onChange={(blur) => set({ glow: { ...r.glow!, blur } })}
              />
              <HudSlider
                label="Opacity" value={Math.round(r.glow.opacity * 100)} min={0} max={100} step={1} unit="%"
                onChange={(percent) => set({ glow: { ...r.glow!, opacity: percent / 100 } })}
              />
              <ColorField
                label="Colour" value={r.glow.color}
                onChange={(color) => set({ glow: { ...r.glow!, color } })}
              />
            </>
          ) : null}
        </EffectRow>

        <EffectRow
          name="Gradient map"
          enabled={r.gradientMap !== null}
          onAdd={() => set({ gradientMap: DEFAULT_GRADIENT_MAP })}
          onRemove={() => set({ gradientMap: undefined })}
        >
          {r.gradientMap ? (
            <>
              {/* A live ramp beats two swatches: the whole control is about the
                  transition between them, not the endpoints on their own. */}
              <div
                aria-hidden
                className="h-6 border border-white/10"
                style={{ background: `linear-gradient(90deg, ${r.gradientMap.from}, ${r.gradientMap.to})` }}
              />
              <ColorField
                label="Shadows" value={r.gradientMap.from}
                onChange={(from) => set({ gradientMap: { ...r.gradientMap!, from } })}
              />
              <ColorField
                label="Highlights" value={r.gradientMap.to}
                onChange={(to) => set({ gradientMap: { ...r.gradientMap!, to } })}
              />
              <HudSlider
                label="Amount" value={Math.round(r.gradientMap.amount * 100)} min={0} max={100} step={1} unit="%"
                onChange={(percent) => set({ gradientMap: { ...r.gradientMap!, amount: percent / 100 } })}
              />
            </>
          ) : null}
        </EffectRow>

        <EffectRow
          name="Chromatic"
          enabled={r.chromatic > 0}
          onAdd={() => set({ chromatic: 6 })}
          onRemove={() => set({ chromatic: undefined })}
        >
          <HudSlider
            label="Separation" value={r.chromatic} min={0} max={40} step={0.5} unit="units"
            onChange={(chromatic) => set({ chromatic })}
          />
        </EffectRow>

        <EffectRow
          name="Posterize"
          enabled={r.posterize >= 2}
          onAdd={() => set({ posterize: 6 })}
          onRemove={() => set({ posterize: undefined })}
        >
          <HudSlider
            label="Levels" value={r.posterize} min={2} max={16} step={1}
            onChange={(posterize) => set({ posterize })}
          />
        </EffectRow>
      </div>
    </PanelSection>
  );
}
