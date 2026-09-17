'use client';

/**
 * Properties for the current selection.
 *
 * Contextual by layer type: an image gets crop and treatment, text gets type
 * settings, a shape gets fill and corners. The old inspector showed the same
 * handful of transform fields for everything and pushed type controls into a
 * separate tool, so editing one layer meant moving between panels.
 */

import { useState } from 'react';
import {
  AlignEndHorizontal, AlignHorizontalJustifyCenter, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignVerticalJustifyCenter, EyeOff, MoveHorizontal, MoveVertical, Trash2,
} from 'lucide-react';
import { isBarMode } from '@/lib/cover/waveform';
import {
  artworkImageMasks, artworkImageTreatments, artworkTextureKinds,
  type ArtworkDocument, type ArtworkLayer, type ImageArtworkLayer, type LayerAlignment,
  type ShapeArtworkLayer, type TextArtworkLayer, type TextureArtworkLayer, type WaveformArtworkLayer,
  imageCropDefaults,
  waveformDefaults,
} from './cover-art-document';
import {
  ColorField, FieldLabel, NumberField, PanelSection, SegmentedField, SliderField, StudioButton,
} from './StudioControls';
import { AdjustSection, EffectsSection, MoodSection } from './FxInspector';
import { FontPicker } from './FontPicker';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { cn } from '@/lib/utils';
import { type ArtworkLayerFx } from '@/lib/cover/effects';
import { textPathDefaults, type TextPathShape } from '@/lib/cover/text-path';
import {
  ARTBOARD_MAX, ARTBOARD_MIN, artboardPresets, aspectLabel, matchArtboardPreset,
  type ArtboardResizeMode,
} from '@/lib/cover/artboard';

/**
 * The full CSS/SVG blend set rather than the five that used to be offered.
 * `difference`, `exclusion` and the component modes are the ones that make a
 * duotone or a knocked-out title work, and both renderers already pass the
 * value straight through — the short list was the only thing withholding them.
 *
 * Grouped the way every image editor groups them (darkening, lightening,
 * contrast, comparative, component) because that ordering is what makes a list
 * this long scannable. A segmented grid was tried first and is genuinely worse
 * here: sixteen labels in three columns truncate, and `color-dodge` and
 * `color-burn` both render as "COLOR…", so two different modes look identical.
 */
export const blendModeOptions: DropdownOption<ArtworkLayer['blendMode']>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'darken', label: 'Darken', separator: true },
  { value: 'multiply', label: 'Multiply' },
  { value: 'color-burn', label: 'Color burn' },
  { value: 'lighten', label: 'Lighten', separator: true },
  { value: 'screen', label: 'Screen' },
  { value: 'color-dodge', label: 'Color dodge' },
  { value: 'overlay', label: 'Overlay', separator: true },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'hard-light', label: 'Hard light' },
  { value: 'difference', label: 'Difference', separator: true },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue', separator: true },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

/**
 * The effect state to show for a multi-selection.
 *
 * Identical across the selection means the panel can show it. Anything else
 * shows neutral rather than picking one layer's settings to display, which
 * would misreport the other layers — and because a patch here writes to every
 * selected layer, showing one layer's values would invite flattening the rest
 * onto it by touching an unrelated slider.
 */
function sharedFx(layers: ArtworkLayer[]): ArtworkLayerFx | undefined {
  if (layers.length === 0) return undefined;
  const first = JSON.stringify(layers[0].fx ?? null);
  return layers.every((layer) => JSON.stringify(layer.fx ?? null) === first)
    ? layers[0].fx
    : undefined;
}

const alignActions: Array<{ id: LayerAlignment; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'left', label: 'Align left', icon: AlignLeft },
  { id: 'center-x', label: 'Align horizontal centres', icon: AlignHorizontalJustifyCenter },
  { id: 'right', label: 'Align right', icon: AlignRight },
  { id: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { id: 'center-y', label: 'Align vertical centres', icon: AlignVerticalJustifyCenter },
  { id: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
];

export function InspectorPanel({
  document: doc,
  selectedIds,
  onPatch,
  onPatchDocument,
  onAlign,
  onDistribute,
  onRemoveSelected,
  onResizeArtboard,
  onRestyle,
}: {
  document: ArtworkDocument;
  selectedIds: string[];
  onPatch: (patch: Partial<ArtworkLayer>) => void;
  onPatchDocument: (patch: Partial<ArtworkDocument>) => void;
  onAlign: (alignment: LayerAlignment) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  onRemoveSelected: () => void;
  onResizeArtboard: (width: number, height: number, mode: ArtboardResizeMode) => void;
  onRestyle: (moodId: string) => void;
}) {
  const selected = doc.layers.filter((layer) => selectedIds.includes(layer.id));
  const layer = selected.length === 1 ? selected[0] : null;

  return (
    <div className="min-h-0 overflow-y-auto">
      {selected.length > 0 ? (
        <PanelSection title={selected.length > 1 ? `${selected.length} layers` : 'Arrange'}>
          <div className="grid grid-cols-6 gap-1">
            {alignActions.map((action) => (
              <button
                key={action.id}
                type="button"
                title={action.label}
                aria-label={action.label}
                onClick={() => onAlign(action.id)}
                className="grid h-8 place-items-center border border-white/10 text-white/60 transition-colors hover:border-white/20 hover:text-white/90"
              >
                <action.icon size={13} />
              </button>
            ))}
          </div>
          {selected.length > 2 ? (
            <div className="grid grid-cols-2 gap-1">
              <StudioButton onClick={() => onDistribute('x')} title="Even horizontal gaps">
                <MoveHorizontal size={12} /> Distribute
              </StudioButton>
              <StudioButton onClick={() => onDistribute('y')} title="Even vertical gaps">
                <MoveVertical size={12} /> Distribute
              </StudioButton>
            </div>
          ) : null}
        </PanelSection>
      ) : null}

      {layer ? (
        <>
          <PanelSection title="Transform">
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="X" value={layer.x} onChange={(x) => onPatch({ x })} />
              <NumberField label="Y" value={layer.y} onChange={(y) => onPatch({ y })} />
              <NumberField label="Width" value={layer.width} min={24} onChange={(width) => onPatch({ width })} />
              <NumberField label="Height" value={layer.height} min={24} onChange={(height) => onPatch({ height })} />
            </div>
            <SliderField
              label="Rotation" value={layer.rotation} min={-180} max={180} step={1}
              format={(value) => `${Math.round(value)}°`}
              onChange={(rotation) => onPatch({ rotation })}
            />
            <SliderField
              label="Opacity" value={layer.opacity} min={0} max={1}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(opacity) => onPatch({ opacity })}
            />
            <div className="grid gap-1.5">
              <FieldLabel>Blend</FieldLabel>
              <Dropdown
                aria-label="Blend mode"
                value={layer.blendMode}
                options={blendModeOptions}
                onChange={(blendMode) => onPatch({ blendMode })}
              />
            </div>
          </PanelSection>

          {layer.type === 'text' ? <TextInspector layer={layer} onPatch={onPatch} /> : null}
          {layer.type === 'image' ? <ImageInspector layer={layer} onPatch={onPatch} /> : null}
          {layer.type === 'shape' ? <ShapeInspector layer={layer} onPatch={onPatch} /> : null}
          {layer.type === 'texture' ? <TextureInspector layer={layer} onPatch={onPatch} /> : null}
          {layer.type === 'waveform' ? (
            <WaveformInspector
              layer={layer}
              onPatch={onPatch}
              onHide={() => onPatch({ visible: false })}
              onRemove={() => onRemoveSelected()}
            />
          ) : null}

          {/* Effects live on the layer base, so every type gets them — a drop
              shadow on a title and a blur on a photograph go through the same
              code path rather than each being a special case. */}
          <MoodSection scope="selection" onRestyle={onRestyle} />
          <AdjustSection fx={layer.fx} onPatchFx={(fx) => onPatch({ fx } as Partial<ArtworkLayer>)} />
          <EffectsSection fx={layer.fx} onPatchFx={(fx) => onPatch({ fx } as Partial<ArtworkLayer>)} />
        </>
      ) : null}

      {/* Effects on a multi-selection: applied to every selected layer at once,
          which is how you give six collage tiles one consistent treatment. */}
      {!layer && selected.length > 1 ? (
        <>
          <AdjustSection fx={sharedFx(selected)} onPatchFx={(fx) => onPatch({ fx } as Partial<ArtworkLayer>)} />
          <EffectsSection fx={sharedFx(selected)} onPatchFx={(fx) => onPatch({ fx } as Partial<ArtworkLayer>)} />
        </>
      ) : null}

      {selected.length === 0 ? (
        <>
          <ArtboardSection doc={doc} onResizeArtboard={onResizeArtboard} />
          <MoodSection scope="document" onRestyle={onRestyle} />
          <PanelSection title="Canvas">
            <ColorField
              label="Background"
              value={doc.background}
              onChange={(background) => onPatchDocument({ background })}
            />
            <p className="text-[11px] leading-relaxed text-white/40">
              Nothing selected. Click a layer on the canvas, or drag a box across the canvas to select several.
            </p>
          </PanelSection>
          <PanelSection title="Palette">
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(doc.palette).map(([name, color]) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  aria-label={`Set background to ${name}`}
                  onClick={() => onPatchDocument({ background: color })}
                  className="h-10 border border-white/10"
                  style={{ background: color }}
                />
              ))}
            </div>
          </PanelSection>
        </>
      ) : null}
    </div>
  );
}

function TextInspector({ layer, onPatch }: { layer: TextArtworkLayer; onPatch: (patch: Partial<TextArtworkLayer>) => void }) {
  return (
    <PanelSection title="Type">
      <label className="grid gap-1.5">
        <FieldLabel>Text</FieldLabel>
        <textarea
          value={layer.text}
          onChange={(event) => onPatch({ text: event.target.value })}
          className="min-h-20 border border-white/10 bg-[#090907] p-2 text-sm text-white/90 outline-none focus:border-white/40"
        />
      </label>
      <FontPicker
        value={layer.fontFamily}
        weight={layer.fontWeight}
        onChange={(patch) => onPatch(patch)}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Size" value={layer.fontSize} min={8} max={900} onChange={(fontSize) => onPatch({ fontSize })} />
        <NumberField label="Tracking" value={layer.tracking} min={-60} max={200} onChange={(tracking) => onPatch({ tracking })} />
      </div>
      <SliderField
        label="Line height" value={layer.lineHeight} min={0.6} max={2} step={0.01}
        onChange={(lineHeight) => onPatch({ lineHeight })}
      />
      <SegmentedField
        label="Align"
        value={layer.align}
        columns={3}
        options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]}
        onChange={(align) => onPatch({ align })}
      />
      {/* Type on a curve. `<textPath>` has no concept of lines, so the note
          below is the honest warning that multi-line text becomes one run. */}
      <SegmentedField
        label="Curve"
        value={textPathDefaults(layer.path).shape}
        columns={4}
        options={[
          { value: 'none' as TextPathShape, label: 'Flat' },
          { value: 'arc' as TextPathShape, label: 'Arc' },
          { value: 'circle' as TextPathShape, label: 'Circle' },
          { value: 'wave' as TextPathShape, label: 'Wave' },
        ]}
        onChange={(shape) => onPatch({ path: { ...textPathDefaults(layer.path), shape } })}
      />
      {textPathDefaults(layer.path).shape === 'arc' || textPathDefaults(layer.path).shape === 'wave' ? (
        <SliderField
          label="Curvature" value={textPathDefaults(layer.path).curvature} min={-1} max={1} step={0.01}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(curvature) => onPatch({ path: { ...textPathDefaults(layer.path), curvature } })}
        />
      ) : null}
      {textPathDefaults(layer.path).shape !== 'none' && layer.text.includes('\n') ? (
        <p className="text-[11px] leading-relaxed text-white/40">
          A curve is a single run — your line breaks become spaces.
        </p>
      ) : null}

      <ColorField label="Colour" value={layer.color} onChange={(color) => onPatch({ color })} />
      <ColorField label="Outline" value={layer.stroke ?? '#000000'} onChange={(stroke) => onPatch({ stroke })} />
      <SliderField
        label="Outline width" value={layer.strokeWidth ?? 0} min={0} max={40} step={1}
        onChange={(strokeWidth) => onPatch({ strokeWidth })}
      />
      <StudioButton onClick={() => onPatch({ uppercase: !layer.uppercase })}>
        {layer.uppercase ? 'Use original case' : 'Make uppercase'}
      </StudioButton>
    </PanelSection>
  );
}

function ImageInspector({ layer, onPatch }: { layer: ImageArtworkLayer; onPatch: (patch: Partial<ImageArtworkLayer>) => void }) {
  const crop = imageCropDefaults(layer);
  return (
    <PanelSection title="Image">
      <SegmentedField
        label="Fit"
        value={crop.fit}
        columns={3}
        options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'fill', label: 'Stretch' }]}
        onChange={(fit) => onPatch({ fit })}
      />
      <SliderField
        label="Zoom" value={crop.scale} min={1} max={3} step={0.01}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(scale) => onPatch({ scale })}
      />
      {/* Pan does nothing at 100% because there is no overflow to move within —
          saying so beats a slider that silently has no effect. */}
      {crop.scale > 1 ? (
        <>
          <SliderField label="Pan X" value={crop.offsetX} min={-1} max={1} step={0.01} onChange={(offsetX) => onPatch({ offsetX })} />
          <SliderField label="Pan Y" value={crop.offsetY} min={-1} max={1} step={0.01} onChange={(offsetY) => onPatch({ offsetY })} />
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-white/40">Zoom past 100% to pan the crop.</p>
      )}
      <SegmentedField
        label="Treatment"
        value={layer.treatment}
        columns={3}
        options={artworkImageTreatments.map((value) => ({ value, label: value.replace('-', ' ') }))}
        onChange={(treatment) => onPatch({ treatment })}
      />
      <SegmentedField
        label="Mask"
        value={crop.mask}
        columns={4}
        options={artworkImageMasks.map((value) => ({ value, label: value }))}
        onChange={(mask) => onPatch({ mask })}
      />
      <SliderField
        label="Corner radius" value={crop.radius} min={0} max={600} step={4}
        format={(value) => `${Math.round(value)}`}
        onChange={(radius) => onPatch({ radius })}
      />
    </PanelSection>
  );
}

function ShapeInspector({ layer, onPatch }: { layer: ShapeArtworkLayer; onPatch: (patch: Partial<ShapeArtworkLayer>) => void }) {
  return (
    <PanelSection title="Shape">
      <SegmentedField
        label="Kind"
        value={layer.shape}
        columns={4}
        options={[
          { value: 'rect', label: 'Rect' }, { value: 'circle', label: 'Circle' },
          { value: 'triangle', label: 'Tri' }, { value: 'rule', label: 'Rule' },
        ]}
        onChange={(shape) => onPatch({ shape })}
      />
      <ColorField label="Fill" value={layer.fill} onChange={(fill) => onPatch({ fill })} />
      <ColorField label="Stroke" value={layer.stroke ?? '#000000'} onChange={(stroke) => onPatch({ stroke })} />
      <SliderField label="Stroke width" value={layer.strokeWidth ?? 0} min={0} max={80} step={1} onChange={(strokeWidth) => onPatch({ strokeWidth })} />
      {layer.shape === 'rect' ? (
        <SliderField
          label="Corner radius" value={layer.cornerRadius ?? 0} min={0} max={600} step={4}
          format={(value) => `${Math.round(value)}`}
          onChange={(cornerRadius) => onPatch({ cornerRadius })}
        />
      ) : null}
    </PanelSection>
  );
}

function TextureInspector({ layer, onPatch }: { layer: TextureArtworkLayer; onPatch: (patch: Partial<TextureArtworkLayer>) => void }) {
  return (
    <PanelSection title="Texture">
      <SegmentedField
        label="Kind"
        value={layer.texture}
        columns={2}
        options={artworkTextureKinds.map((value) => ({ value, label: value.replace('-', ' ') }))}
        onChange={(texture) => onPatch({ texture })}
      />
      <SliderField
        label="Intensity" value={layer.intensity} min={0} max={1}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(intensity) => onPatch({ intensity })}
      />
    </PanelSection>
  );
}

function WaveformInspector({ layer, onPatch, onRemove, onHide }: {
  layer: WaveformArtworkLayer;
  onPatch: (patch: Partial<WaveformArtworkLayer>) => void;
  onRemove: () => void;
  onHide: () => void;
}) {
  const defaults = waveformDefaults(layer);
  const drawsBars = isBarMode(layer.mode);

  return (
    <PanelSection title="Waveform">
      <p className="text-[11px] leading-relaxed text-white/40">
        {layer.peakSource === 'real'
          ? 'Drawing this track\u2019s analysed peaks.'
          : 'Drawing a stand-in pattern. Pick a track in Source to use its real waveform.'}
      </p>

      <SegmentedField
        label="Shape"
        value={layer.mode}
        columns={2}
        options={[
          { value: 'linear', label: 'Bars' },
          { value: 'blocks', label: 'Blocks' },
          { value: 'line', label: 'Line' },
          { value: 'contour', label: 'Contour' },
          { value: 'circular', label: 'Circular' },
          { value: 'spectral-bars', label: 'Spectral' },
        ]}
        onChange={(mode) => onPatch({ mode })}
      />

      <SliderField
        label="Height" value={layer.amplitude} min={0.1} max={1.4}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(amplitude) => onPatch({ amplitude })}
      />

      {drawsBars ? (
        <>
          <SliderField
            label="Detail" value={defaults.barCount} min={24} max={400} step={1}
            format={(value) => `${Math.round(value)} bars`}
            onChange={(barCount) => onPatch({ barCount: Math.round(barCount) })}
          />
          <SliderField
            label="Spacing" value={defaults.barGap} min={0} max={0.85} step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(barGap) => onPatch({ barGap })}
          />
          <SegmentedField
            label="Ends"
            value={defaults.cap}
            columns={2}
            options={[{ value: 'round', label: 'Rounded' }, { value: 'flat', label: 'Flat' }]}
            onChange={(cap) => onPatch({ cap })}
          />
          <SegmentedField
            label="Anchor"
            value={defaults.mirror ? 'centre' : 'baseline'}
            columns={2}
            options={[{ value: 'centre', label: 'Centred' }, { value: 'baseline', label: 'Baseline' }]}
            onChange={(value) => onPatch({ mirror: value === 'centre' })}
          />
        </>
      ) : (
        <SliderField
          label="Stroke" value={layer.strokeWidth} min={2} max={64} step={1}
          format={(value) => `${Math.round(value)}`}
          onChange={(strokeWidth) => onPatch({ strokeWidth })}
        />
      )}

      <SliderField
        label="Smoothing" value={layer.smoothing} min={0} max={1}
        format={(value) => (value === 0 ? 'off' : `${Math.round(value * 100)}%`)}
        onChange={(smoothing) => onPatch({ smoothing })}
      />

      {/* Normalising lifts a quiet track to full height. Off shows true
          relative loudness, which matters when a cover carries two waveforms. */}
      <SegmentedField
        label="Levels"
        value={defaults.normalize ? 'normalized' : 'true'}
        columns={2}
        options={[{ value: 'normalized', label: 'Normalised' }, { value: 'true', label: 'True level' }]}
        onChange={(value) => onPatch({ normalize: value === 'normalized' })}
      />

      <ColorField label="Colour" value={layer.color} onChange={(color) => onPatch({ color })} />

      {/* The waveform ships in every template, so removing it has to be as
          reachable as changing it — not buried in the layers list. */}
      <div className="grid grid-cols-2 gap-1 border-t border-white/10 pt-3">
        <StudioButton onClick={onHide} title="Keep the layer but hide it">
          <EyeOff size={12} /> Hide
        </StudioButton>
        <StudioButton onClick={onRemove} title="Delete the waveform layer">
          <Trash2 size={12} /> Remove
        </StudioButton>
      </div>
    </PanelSection>
  );
}

/**
 * Artboard size.
 *
 * Sits at the top of the no-selection inspector because it is a property of the
 * whole piece, not of anything in it. The resize MODE is exposed rather than
 * chosen for you: reformatting a square cover into a story and extending a
 * canvas to make room are different intentions, and guessing wrong silently
 * rearranges someone's finished artwork.
 */
function ArtboardSection({ doc, onResizeArtboard }: {
  doc: ArtworkDocument;
  onResizeArtboard: (width: number, height: number, mode: ArtboardResizeMode) => void;
}) {
  const active = matchArtboardPreset(doc.width, doc.height);
  const [mode, setMode] = useState<ArtboardResizeMode>('scale');

  return (
    <PanelSection title="Artboard">
      <div className="grid grid-cols-2 gap-1">
        {artboardPresets.map((preset) => {
          const selected = active?.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={`${preset.width} × ${preset.height} — ${preset.hint}`}
              aria-pressed={selected}
              onClick={() => onResizeArtboard(preset.width, preset.height, mode)}
              className={cn(
                'border px-2 py-1.5 text-left transition-colors',
                selected
                  ? 'border-white/40 bg-white/[0.12]'
                  : 'border-white/10 hover:border-white/25',
              )}
            >
              <span className={cn('block truncate text-[11px]', selected ? 'text-white/90' : 'text-white/60')}>
                {preset.name}
              </span>
              <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                {aspectLabel(preset.width, preset.height)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Width" value={doc.width} min={ARTBOARD_MIN} max={ARTBOARD_MAX}
          onChange={(width) => onResizeArtboard(width, doc.height, mode)}
        />
        <NumberField
          label="Height" value={doc.height} min={ARTBOARD_MIN} max={ARTBOARD_MAX}
          onChange={(height) => onResizeArtboard(doc.width, height, mode)}
        />
      </div>

      <SegmentedField
        label="On resize"
        value={mode}
        columns={2}
        options={[
          { value: 'scale', label: 'Scale art' },
          { value: 'keep', label: 'Keep sizes' },
        ]}
        onChange={setMode}
      />
      <p className="text-[10px] leading-relaxed text-white/40">
        {mode === 'scale'
          ? 'Layers are rescaled to fit the new board, keeping the composition.'
          : 'Layers stay exactly where they are. The board changes around them.'}
      </p>
    </PanelSection>
  );
}
