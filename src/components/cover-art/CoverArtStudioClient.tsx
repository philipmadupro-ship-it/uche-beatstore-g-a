'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  History,
  ImageIcon,
  Layers,
  Lock,
  Music2,
  Palette,
  PanelRight,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Type,
  Unlock,
  Upload,
  Wand2,
  Waves,
} from 'lucide-react';
import {
  coverArtExportPresets,
  getCoverArtRasterFilename,
  svgToRasterBlob,
  type CoverArtExportPresetId,
} from '@/design-system';
import { cn } from '@/lib/utils';
import { uploadGeneratedCoverArt } from '@/lib/upload/generated-cover-upload';
import { attachCoverUrl, type CoverAttachTarget } from '@/lib/upload/cover-attachment';
import { analyzeCoverWaveform } from '@/lib/upload/cover-waveform-analysis';
import {
  fetchCoverAttachOptions,
  type CoverAttachOption,
  type CoverAttachTargetKind,
} from '@/lib/upload/cover-attach-options';
import {
  coverArtDirections,
  createDawWaveformBars,
  createArtworkDocument,
  defaultArtworkPalette,
  moveLayer,
  renderArtworkDocumentSvg,
  sortArtworkLayers,
  updateWaveformLayerPeaks,
  type ArtworkDocument,
  type ArtworkLayer,
  type ArtworkSource,
  type CoverArtDirectionId,
  type CoverArtTool,
  type TextArtworkLayer,
  type WaveformArtworkLayer,
} from './cover-art-document';
import { CoverGeneratorPanel } from './CoverGeneratorPanel';
import { HudSlider } from './HudSlider';
import { usePlayer } from '@/hooks/usePlayer';
import type { Track } from '@/lib/types';
import { useAudioReactivity } from '@/hooks/useAudioReactivity';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useVisualPeaks } from '@/hooks/useVisualPeaks';

type Surface = 'dev-lab' | 'cover-art-studio';
type SaveState = 'saved' | 'editing' | 'saving';
type ExportState = 'idle' | 'exporting' | 'failed';
type UploadState = 'idle' | 'uploading' | 'uploaded' | 'failed';
type AttachState = 'idle' | 'attaching' | 'attached' | 'failed';
type WaveformAnalysisState = 'idle' | 'analyzing' | 'analyzed' | 'failed';

type CoverArtStudioClientProps = {
  surface?: Surface;
};

const toolItems: Array<{
  id: CoverArtTool;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}> = [
  { id: 'source', label: 'Project', shortcut: '1', icon: Music2 },
  { id: 'directions', label: 'Directions', shortcut: '2', icon: Wand2 },
  { id: 'media', label: 'Media', shortcut: '3', icon: ImageIcon },
  { id: 'typography', label: 'Typography', shortcut: '4', icon: Type },
  { id: 'elements', label: 'Elements', shortcut: '5', icon: Box },
  { id: 'textures', label: 'Textures', shortcut: '6', icon: Sparkles },
  { id: 'waveform', label: 'Waveform', shortcut: '7', icon: Waves },
  { id: 'brand', label: 'Brand', shortcut: '8', icon: Palette },
  { id: 'history', label: 'History', shortcut: '9', icon: History },
];

const attachTargetKinds: CoverAttachTargetKind[] = ['track', 'project', 'playlist', 'profile'];
const sourceKinds: ArtworkSource['kind'][] = ['track', 'project', 'playlist', 'empty'];
const fontLabels: Record<TextArtworkLayer['fontFamily'], string> = {
  display: 'Display Editorial',
  artwork: 'Artwork Display',
  ui: 'UI Sans',
  mono: 'Metadata Mono',
};

const fontStacks: Record<TextArtworkLayer['fontFamily'], string> = {
  display: 'Synkopy, Akira Expanded, sans-serif',
  artwork: 'Synkopy, Akira Expanded, sans-serif',
  ui: 'Inter, system-ui, sans-serif',
  mono: 'Panchang, ui-monospace, monospace',
};

const surfaceCopy: Record<Surface, { eyebrow: string; title: string }> = {
  'dev-lab': { eyebrow: 'Internal lab', title: 'Beatstor Design System Lab' },
  'cover-art-studio': { eyebrow: 'Producer workspace', title: 'Cover Art Studio' },
};

function createAttachTarget(kind: CoverAttachTargetKind, id: string): CoverAttachTarget {
  if (kind === 'profile') return { kind: 'profile' };
  return { kind, id };
}

function readableLayerType(layer: ArtworkLayer) {
  if (layer.type === 'waveform') return 'Audio waveform';
  if (layer.type === 'texture') return 'Texture';
  if (layer.type === 'shape') return 'Shape';
  if (layer.type === 'image') return 'Image';
  return 'Text';
}

function findWaveformLayer(document: ArtworkDocument): WaveformArtworkLayer {
  const layer = document.layers.find((item): item is WaveformArtworkLayer => item.type === 'waveform');
  if (layer) return layer;
  return createArtworkDocument('spectral-night', document.source).layers.find((item): item is WaveformArtworkLayer => item.type === 'waveform') as WaveformArtworkLayer;
}

function copyDocument(document: ArtworkDocument): ArtworkDocument {
  return JSON.parse(JSON.stringify(document)) as ArtworkDocument;
}

function patchLayer<T extends ArtworkLayer>(
  document: ArtworkDocument,
  layerId: string,
  patch: Partial<T>,
): ArtworkDocument {
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    layers: document.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } as ArtworkLayer : layer)),
  };
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium text-[#AAA294]">{children}</span>;
}

function SegmentedButton<T extends string>({
  value,
  selected,
  label,
  onSelect,
}: {
  value: T;
  selected: T;
  label: string;
  onSelect: (value: T) => void;
}) {
  const active = value === selected;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={cn(
        'min-h-9 border px-3 text-[12px] transition-colors',
        active
          ? 'border-[#C7B89D]/50 bg-[#C7B89D] text-[#080806]'
          : 'border-[#EBE1CC1A] bg-[#151510] text-[#AAA294] hover:border-[#EBE1CC52] hover:text-[#EEE8DD]',
      )}
    >
      {label}
    </button>
  );
}

/**
 * Every continuous value in the studio is a slider.
 *
 * This kept its name and signature so all twelve call sites convert at once
 * rather than being touched individually. A number spinner gave no sense of
 * where a value sat within its range and could not be explored by dragging;
 * `HudSlider` shows the range, and still accepts an exact typed value.
 *
 * Position and size have no natural ceiling, so they get defaults derived from
 * the 3000px document rather than an arbitrary 100.
 */
/**
 * Collapses a side panel. Icon points the way the panel will move, which is
 * the convention every editor uses and the only thing that makes a bare
 * chevron legible without a label.
 */
function PanelToggle({ side, open, onToggle }: { side: 'left' | 'right'; open: boolean; onToggle: () => void }) {
  const Icon = (side === 'left') === open ? PanelChevronLeft : PanelChevronRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${side} panel`}
      title={`${open ? 'Collapse' : 'Expand'} ${side} panel`}
      className="grid h-7 w-7 place-items-center text-[#6A655C] transition-colors hover:text-[#EEE8DD] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C7B89D]"
    >
      <Icon />
    </button>
  );
}

function PanelChevronLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PanelChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <HudSlider
      label={label}
      value={value}
      min={min ?? 0}
      max={max ?? 3000}
      step={step}
      onChange={onChange}
    />
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <span className="grid grid-cols-[2.25rem_minmax(0,1fr)] border border-[#EBE1CC1A] bg-[#0D0D0A]">
        <input
          aria-label={`${label} picker`}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-9 border-0 bg-transparent p-1"
        />
        <input
          aria-label={`${label} hex`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 min-w-0 bg-transparent px-2 font-mono text-xs text-[#EEE8DD] outline-none"
        />
      </span>
    </label>
  );
}

function LayerPreview({ layer }: { layer: ArtworkLayer }) {
  const color = layer.type === 'text'
    ? layer.color
    : layer.type === 'waveform'
      ? layer.color
      : layer.type === 'shape'
        ? layer.fill
        : '#C7B89D';
  return (
    <span className="grid h-8 w-8 place-items-center border border-[#EBE1CC1A] bg-[#080806]">
      <span className="h-3 w-5" style={{ background: color, opacity: layer.opacity }} />
    </span>
  );
}

function WaveformGraphic({ layer }: { layer: WaveformArtworkLayer }) {
  const bars = createDawWaveformBars({
    peaks: layer.peaks,
    bpm: layer.bpm,
    durationSeconds: layer.durationSeconds,
    count: 56,
    sensitivity: layer.amplitude,
  });
  return (
    <div className="relative flex h-full items-center justify-between gap-[3px] border-y border-[#EBE1CC14] bg-[linear-gradient(90deg,rgba(235,225,204,.08)_1px,transparent_1px)] bg-[length:12.5%_100%] px-1">
      <span className="pointer-events-none absolute left-0 right-0 top-1/2 border-t border-[#EBE1CC1A]" />
      {bars.map((bar) => {
        const color = bar.lane === 'low'
          ? defaultArtworkPalette.waveformLow
          : bar.lane === 'mid'
            ? layer.color
            : defaultArtworkPalette.waveformHigh;
        return (
          <span
            key={bar.index}
            className={cn('relative block w-full', bar.beat ? 'shadow-[0_0_0_1px_rgba(199,184,157,.28)]' : '')}
            style={{
              height: `${Math.max(8, bar.height * 100)}%`,
              background: color,
              opacity: bar.transient ? 1 : bar.beat ? 0.86 : 0.58,
            }}
          />
        );
      })}
    </div>
  );
}

export function CoverArtStudioClient({ surface = 'dev-lab' }: CoverArtStudioClientProps) {
  const initialSource: ArtworkSource = { kind: 'empty', label: 'Empty design', detail: '3000 x 3000' };
  const [activeTool, setActiveTool] = useState<CoverArtTool>('source');
  // Both panels start open — a first-time user needs to see the controls exist.
  // Collapsing is for once you know the tool and want the canvas.
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [sourceKind, setSourceKind] = useState<ArtworkSource['kind']>('track');
  const [sourceOptions, setSourceOptions] = useState<CoverAttachOption[]>([]);
  const [sourceState, setSourceState] = useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [directionId, setDirectionId] = useState<CoverArtDirectionId>('de-roche-mineral');
  const [document, setDocument] = useState<ArtworkDocument>(() => createArtworkDocument('de-roche-mineral', initialSource));
  const [history, setHistory] = useState<ArtworkDocument[]>([]);
  const [future, setFuture] = useState<ArtworkDocument[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.22);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const exportPresetId: CoverArtExportPresetId = 'square-cover';
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [waveformAnalysisState, setWaveformAnalysisState] = useState<WaveformAnalysisState>('idle');
  const [waveformAnalysisError, setWaveformAnalysisError] = useState<string | null>(null);
  const [generatedCoverUrl, setGeneratedCoverUrl] = useState<string | null>(null);
  const [attachTargetKind, setAttachTargetKind] = useState<CoverAttachTargetKind>('track');
  const [attachTargetId, setAttachTargetId] = useState('');
  const [attachOptions, setAttachOptions] = useState<CoverAttachOption[]>([]);
  const [attachState, setAttachState] = useState<AttachState>('idle');
  const [attachError, setAttachError] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; layerX: number; layerY: number } | null>(null);
  const artboardRef = useRef<HTMLDivElement>(null);

  const selectedLayer = selectedLayerIds.length === 1
    ? document.layers.find((layer) => layer.id === selectedLayerIds[0]) ?? null
    : null;
  const selectedTextLayer = selectedLayer?.type === 'text' ? selectedLayer : null;
  const selectedWaveformLayer = selectedLayer?.type === 'waveform' ? selectedLayer : null;
  const selectedSourceOption = sourceOptions.find((option) => option.id === selectedSourceId) ?? null;

  /**
   * Live audio reaction for the preview.
   *
   * Reads the SAME analysis the player and store drawer use, so the cover
   * reacts to exactly the moment you are hearing. Gated on the studio's
   * selected source actually being the track that is playing — otherwise the
   * artwork would pulse to an unrelated song, which is worse than static.
   *
   * PREVIEW ONLY. The exported SVG/PNG is a still image; this exists so the
   * cover can be judged against its track while being designed, not to bake
   * motion into the artwork.
   */
  const currentTrack = usePlayer((state) => state.currentTrack);
  const playerProgress = usePlayer((state) => state.progress);
  const playerIsPlaying = usePlayer((state) => state.isPlaying);
  const setPlayerTrack = usePlayer((state) => state.setTrack);
  const togglePlayerPlay = usePlayer((state) => state.togglePlay);
  const previewingCurrentTrack = Boolean(
    sourceKind === 'track' && selectedSourceId && currentTrack?.id === selectedSourceId,
  );
  const reactivity = useAudioReactivity(
    previewingCurrentTrack ? selectedSourceId : null,
    previewingCurrentTrack ? currentTrack?.audio_url : null,
    playerProgress,
    previewingCurrentTrack && playerIsPlaying,
  );
  const prefersReducedMotion = useReducedMotion();
  // Reduced motion means no pulsing at all — this is decorative movement, and
  // the project's constraint on it is explicit.
  const reactive = prefersReducedMotion
    ? { level: 0, bass: 0 }
    : { level: reactivity.level, bass: reactivity.bass };

  /**
   * Audition the selected source in place.
   *
   * Without this the reaction above is unreachable in practice: it only fires
   * when the playing track IS the studio's source, and there was no way to make
   * that true from this screen — you had to leave, find the beat in the
   * library, play it, and come back. Loads the source into the player if it
   * isn't already there, otherwise just toggles.
   */
  const auditionSource = () => {
    if (!selectedSourceOption || sourceKind !== 'track') return;
    if (currentTrack?.id === selectedSourceId) {
      togglePlayerPlay();
      return;
    }
    setPlayerTrack({
      id: selectedSourceOption.id,
      title: selectedSourceOption.label,
      audio_url: selectedSourceOption.audioUrl ?? null,
      cover_url: selectedSourceOption.coverUrl ?? null,
      bpm: selectedSourceOption.bpm ?? null,
      key: selectedSourceOption.musicalKey ?? null,
      duration_seconds: selectedSourceOption.durationSeconds ?? null,
      peaks_url: selectedSourceOption.peaksUrl ?? null,
    } as Track);
  };
  const sortedLayers = useMemo(() => sortArtworkLayers(document.layers), [document.layers]);
  const renderedSvg = useMemo(() => renderArtworkDocumentSvg(document), [document]);
  const safeName = document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover-art';
  const svgFilename = `beatstor-${safeName}.svg`;
  const exportPreset = coverArtExportPresets[exportPresetId];
  const rasterFilename = getCoverArtRasterFilename(svgFilename, exportPreset);
  const selectedTrackPeaks = useVisualPeaks(
    sourceKind === 'track' ? selectedSourceId || 'cover-art-preview' : 'cover-art-preview',
    sourceKind === 'track' ? selectedSourceOption?.peaksUrl : null,
    128,
  );

  useEffect(() => {
    if (sourceKind === 'empty' || sourceKind === 'upload') {
      queueMicrotask(() => {
        setSourceOptions([]);
        setSelectedSourceId('');
        setSourceState('loaded');
        setSourceError(null);
      });
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSourceState('loading');
      setSourceError(null);
    });
    fetchCoverAttachOptions(sourceKind, 12)
      .then((options) => {
        if (cancelled) return;
        setSourceOptions(options);
        setSelectedSourceId(options[0]?.id ?? '');
        setSourceState('loaded');
      })
      .catch((error) => {
        if (cancelled) return;
        setSourceError(error instanceof Error ? error.message : 'Could not load sources.');
        setSourceState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKind]);

  useEffect(() => {
    let cancelled = false;
    fetchCoverAttachOptions(attachTargetKind, 16)
      .then((options) => {
        if (cancelled) return;
        setAttachOptions(options);
        setAttachTargetId(options[0]?.id ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setAttachOptions([]);
        setAttachTargetId('');
      });
    return () => {
      cancelled = true;
    };
  }, [attachTargetKind]);

  useEffect(() => {
    if (saveState !== 'editing') return;
    const id = window.setTimeout(() => setSaveState('saved'), 700);
    return () => window.clearTimeout(id);
  }, [document, saveState]);

  useEffect(() => {
    if (sourceKind !== 'track' || !selectedSourceId) return;
    queueMicrotask(() => {
      setDocument((current) => ({
        ...current,
        layers: updateWaveformLayerPeaks(
          current.layers,
          selectedTrackPeaks.peaks,
          selectedTrackPeaks.source === 'real' ? 'real' : 'preview',
          selectedSourceOption?.bpm ?? null,
          selectedSourceOption?.durationSeconds ?? null,
        ),
      }));
    });
  }, [selectedSourceId, selectedSourceOption?.bpm, selectedSourceOption?.durationSeconds, selectedTrackPeaks.peaks, selectedTrackPeaks.source, sourceKind]);

  function updateDocument(mutator: (current: ArtworkDocument) => ArtworkDocument) {
    setDocument((current) => {
      setHistory((items) => [...items.slice(-24), copyDocument(current)]);
      setFuture([]);
      setSaveState('editing');
      return mutator(current);
    });
  }

  /**
   * Drop a generated image into the document's image layer.
   *
   * Reuses the existing layer rather than appending a new one — the templates
   * already position and mask an "Artwork Image" layer per art direction, so
   * filling it keeps the composition the direction intended. If a document has
   * no image layer (a template without one), a full-bleed layer is added behind
   * everything else so the artwork reads as a background plate.
   *
   * Stores the inlined data URI, not the R2 URL: the SVG export path renders
   * through an <img>, which cannot fetch cross-origin, so a bare URL would
   * export a cover with the artwork missing.
   */
  function handleGeneratedImage(image: { dataUrl: string; url: string }) {
    updateDocument((current) => {
      const existing = current.layers.find((layer) => layer.type === 'image');
      if (existing) {
        return {
          ...current,
          layers: current.layers.map((layer) => (
            layer.id === existing.id
              ? { ...layer, src: image.dataUrl, label: 'Generated artwork', visible: true }
              : layer
          )),
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...current,
        layers: [
          ...current.layers,
          {
            id: `generated-image-${Date.now()}`,
            name: 'Generated Artwork',
            type: 'image' as const,
            x: 0,
            y: 0,
            width: current.width,
            height: current.height,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            // Behind every other layer so text and waveform stay legible.
            zIndex: -1,
            blendMode: 'normal' as const,
            src: image.dataUrl,
            label: 'Generated artwork',
            treatment: 'normal' as const,
          },
        ],
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function undo() {
    setHistory((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setFuture((futureItems) => [copyDocument(document), ...futureItems.slice(0, 24)]);
      setDocument(previous);
      setSaveState('editing');
      return items.slice(0, -1);
    });
  }

  function redo() {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setHistory((historyItems) => [...historyItems.slice(-24), copyDocument(document)]);
      setDocument(next);
      setSaveState('editing');
      return items.slice(1);
    });
  }

  function sourceFromSelection(): ArtworkSource {
    if (sourceKind === 'empty') return initialSource;
    if (sourceKind === 'upload') return { kind: 'upload', label: 'Uploaded audio', detail: 'Awaiting local analysis' };
    const option = sourceOptions.find((item) => item.id === selectedSourceId);
    return {
      kind: sourceKind,
      id: option?.id,
      label: option?.label ?? `${sourceKind} source`,
      detail: option?.detail ?? [
        option?.bpm ? `${option.bpm} BPM` : null,
        option?.musicalKey,
      ].filter(Boolean).join(' / '),
    };
  }

  function applyDirection(id = directionId) {
    const source = sourceFromSelection();
    setDirectionId(id);
    setDocument(createArtworkDocument(id, source));
    setSelectedLayerIds([]);
    setHistory([]);
    setFuture([]);
    setSaveState('editing');
    setActiveTool('typography');
  }

  function selectLayer(event: React.MouseEvent, id: string) {
    event.stopPropagation();
    setSelectedLayerIds((current) => {
      if (event.shiftKey) return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return [id];
    });
  }

  function startDrag(event: PointerEvent<HTMLDivElement>, layer: ArtworkLayer) {
    if (layer.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: layer.id,
      startX: event.clientX,
      startY: event.clientY,
      layerX: layer.x,
      layerY: layer.y,
    };
  }

  function dragLayer(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    setDocument((current) => patchLayer(current, drag.id, {
      x: Math.max(0, Math.min(current.width, drag.layerX + dx)),
      y: Math.max(0, Math.min(current.height, drag.layerY + dy)),
    }));
    setSaveState('editing');
  }

  function endDrag() {
    if (!dragRef.current) return;
    setHistory((items) => [...items.slice(-24), copyDocument(document)]);
    dragRef.current = null;
  }

  function updateSelectedLayer<T extends ArtworkLayer>(patch: Partial<T>) {
    if (!selectedLayer) return;
    updateDocument((current) => patchLayer<T>(current, selectedLayer.id, patch));
  }

  function duplicateSelectedLayer() {
    if (!selectedLayer) return;
    const clone = {
      ...copyDocument({ ...document, layers: [selectedLayer] }).layers[0],
      id: `${selectedLayer.id}-copy-${Date.now().toString(36)}`,
      name: `${selectedLayer.name} Copy`,
      x: selectedLayer.x + 90,
      y: selectedLayer.y + 90,
      locked: false,
      zIndex: document.layers.length,
    };
    updateDocument((current) => ({ ...current, layers: [...current.layers, clone] }));
    setSelectedLayerIds([clone.id]);
  }

  function deleteSelectedLayer() {
    if (!selectedLayer || selectedLayer.locked) return;
    updateDocument((current) => ({ ...current, layers: current.layers.filter((layer) => layer.id !== selectedLayer.id) }));
    setSelectedLayerIds([]);
  }

  function moveSelectedLayer(delta: -1 | 1) {
    if (!selectedLayer) return;
    updateDocument((current) => ({ ...current, layers: moveLayer(current.layers, selectedLayer.id, delta) }));
  }

  function applyColor(color: string) {
    if (!selectedLayer) {
      updateDocument((current) => ({ ...current, background: color, palette: { ...current.palette, background: color } }));
      return;
    }
    if (selectedLayer.type === 'text') updateSelectedLayer<TextArtworkLayer>({ color });
    if (selectedLayer.type === 'waveform') updateSelectedLayer<WaveformArtworkLayer>({ color });
    if (selectedLayer.type === 'shape') updateSelectedLayer({ fill: color });
  }

  function downloadSvg() {
    downloadBlob(renderedSvg, svgFilename, 'image/svg+xml');
  }

  async function downloadRaster() {
    setExportState('exporting');
    try {
      const blob = await svgToRasterBlob(renderedSvg, exportPreset);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = rasterFilename;
      window.document.body.appendChild(anchor);
      anchor.click();
      window.document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setExportState('idle');
    } catch {
      setExportState('failed');
      window.setTimeout(() => setExportState('idle'), 2200);
    }
  }

  async function uploadGeneratedCover() {
    setUploadState('uploading');
    setGeneratedCoverUrl(null);
    try {
      const url = await uploadGeneratedCoverArt(renderedSvg, svgFilename, exportPreset);
      setGeneratedCoverUrl(url);
      setUploadState('uploaded');
    } catch {
      setUploadState('failed');
      window.setTimeout(() => setUploadState('idle'), 2200);
    }
  }

  async function attachGeneratedCover() {
    setAttachState('attaching');
    setAttachError(null);
    try {
      await attachCoverUrl(createAttachTarget(attachTargetKind, attachTargetId), generatedCoverUrl ?? '');
      setAttachState('attached');
      window.setTimeout(() => setAttachState('idle'), 2200);
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : 'Could not attach cover.');
      setAttachState('failed');
      window.setTimeout(() => setAttachState('idle'), 2200);
    }
  }

  async function analyzeSelectedTrackWaveform() {
    if (sourceKind !== 'track') {
      setWaveformAnalysisError('Choose a track source before analyzing waveform peaks.');
      setWaveformAnalysisState('failed');
      window.setTimeout(() => setWaveformAnalysisState('idle'), 2200);
      return;
    }

    setWaveformAnalysisState('analyzing');
    setWaveformAnalysisError(null);
    try {
      const result = await analyzeCoverWaveform(selectedSourceId);
      setSourceOptions((options) => options.map((option) => (
        option.id === selectedSourceId ? { ...option, peaksUrl: result.peaksUrl } : option
      )));
      setWaveformAnalysisState('analyzed');
      window.setTimeout(() => setWaveformAnalysisState('idle'), 2200);
    } catch (error) {
      setWaveformAnalysisError(error instanceof Error ? error.message : 'Could not analyze waveform.');
      setWaveformAnalysisState('failed');
      window.setTimeout(() => setWaveformAnalysisState('idle'), 2200);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tool = toolItems.find((item) => item.shortcut === event.key);
      if (tool && !event.metaKey && !event.ctrlKey && !event.altKey) {
        setActiveTool(tool.id);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (!selectedLayer || selectedLayer.locked || editingLayerId) return;
      const delta = event.shiftKey ? 24 : 6;
      const movement: Record<string, [number, number]> = {
        ArrowUp: [0, -delta],
        ArrowDown: [0, delta],
        ArrowLeft: [-delta, 0],
        ArrowRight: [delta, 0],
      };
      const next = movement[event.key];
      if (!next) return;
      event.preventDefault();
      updateDocument((current) => patchLayer(current, selectedLayer.id, {
        x: Math.max(0, selectedLayer.x + next[0]),
        y: Math.max(0, selectedLayer.y + next[1]),
      }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const appVars = {
    '--cover-bg': document.palette.background,
    '--cover-panel': document.palette.panel,
    '--cover-text': document.palette.text,
    '--cover-muted': document.palette.muted,
    '--cover-accent': document.palette.accent,
    '--cover-secondary': document.palette.secondary,
  } as CSSProperties;

  return (
    <div className="min-h-[calc(100vh-100px)] bg-[#080806] text-[#EEE8DD]" style={appVars}>
      <div className="grid min-h-[calc(100vh-100px)] grid-rows-[3.75rem_minmax(0,1fr)_5rem] overflow-hidden">
        <StudioTopbar
          surface={surface}
          document={document}
          saveState={saveState}
          historyLength={history.length}
          futureLength={future.length}
          previewMode={previewMode}
          exportState={exportState}
          uploadState={uploadState}
          onRename={(name) => updateDocument((current) => ({ ...current, name }))}
          onUndo={undo}
          onRedo={redo}
          onPreviewMode={setPreviewMode}
          onDownloadSvg={downloadSvg}
          onDownloadRaster={downloadRaster}
          onUpload={uploadGeneratedCover}
        />

        {/* Panels collapse so the artwork can take the whole field. Both were
            permanently pinned before, leaving the thing being designed with
            about a quarter of the screen — backwards for a canvas tool. Column
            widths also tightened (20rem/19rem to 18rem/16rem) now that controls
            are sliders rather than grids of chips. */}
        <div
          className={cn(
            'grid min-h-0 grid-cols-1 transition-[grid-template-columns] duration-200',
            leftPanelOpen && rightPanelOpen && 'lg:grid-cols-[3.5rem_18rem_minmax(0,1fr)_16rem]',
            leftPanelOpen && !rightPanelOpen && 'lg:grid-cols-[3.5rem_18rem_minmax(0,1fr)_0rem]',
            !leftPanelOpen && rightPanelOpen && 'lg:grid-cols-[3.5rem_0rem_minmax(0,1fr)_16rem]',
            !leftPanelOpen && !rightPanelOpen && 'lg:grid-cols-[3.5rem_0rem_minmax(0,1fr)_0rem]',
          )}
        >
          <ToolRail activeTool={activeTool} onTool={setActiveTool} />
          <ContextPanel
            activeTool={activeTool}
            sourceKind={sourceKind}
            sourceOptions={sourceOptions}
            sourceState={sourceState}
            sourceError={sourceError}
            selectedSourceId={selectedSourceId}
            directionId={directionId}
            selectedTextLayer={selectedTextLayer}
            selectedWaveformLayer={selectedWaveformLayer}
            selectedTrackPeaksSource={selectedTrackPeaks.source}
            document={document}
            sourceCanAnalyze={sourceKind === 'track' && Boolean(selectedSourceId)}
            waveformAnalysisState={waveformAnalysisState}
            waveformAnalysisError={waveformAnalysisError}
            generatedCoverUrl={generatedCoverUrl}
            attachTargetKind={attachTargetKind}
            attachTargetId={attachTargetId}
            attachOptions={attachOptions}
            attachState={attachState}
            attachError={attachError}
            onGeneratedImage={handleGeneratedImage}
            open={leftPanelOpen}
            onSourceKind={setSourceKind}
            onSourceId={setSelectedSourceId}
            onDirection={(id) => {
              setDirectionId(id);
              applyDirection(id);
            }}
            onUseDirection={() => applyDirection()}
            onUpdateText={(patch) => updateSelectedLayer<TextArtworkLayer>(patch)}
            onUpdateWaveform={(patch) => updateSelectedLayer<WaveformArtworkLayer>(patch)}
            onAnalyzeWaveform={analyzeSelectedTrackWaveform}
            onApplyColor={applyColor}
            onAttachTargetKind={setAttachTargetKind}
            onAttachTargetId={setAttachTargetId}
            onAttach={attachGeneratedCover}
          />

          <CanvasWorkspace
            artboardRef={artboardRef}
            document={document}
            sortedLayers={sortedLayers}
            selectedLayerIds={selectedLayerIds}
            editingLayerId={editingLayerId}
            zoom={zoom}
            previewMode={previewMode}
            onSelectLayer={selectLayer}
            onClearSelection={() => setSelectedLayerIds([])}
            onStartDrag={startDrag}
            onDrag={dragLayer}
            onEndDrag={endDrag}
            onEditLayer={setEditingLayerId}
            onUpdateText={(id, text) => updateDocument((current) => patchLayer<TextArtworkLayer>(current, id, { text }))}
            onZoom={setZoom}
            leftPanelOpen={leftPanelOpen}
            rightPanelOpen={rightPanelOpen}
            onToggleLeftPanel={() => setLeftPanelOpen((v) => !v)}
            onToggleRightPanel={() => setRightPanelOpen((v) => !v)}
            reactive={reactive}
            canAudition={sourceKind === 'track' && Boolean(selectedSourceId)}
            auditioning={previewingCurrentTrack && playerIsPlaying}
            onAudition={auditionSource}
          />

          <PropertiesInspector
            document={document}
            selectedLayer={selectedLayer}
            selectedLayerIds={selectedLayerIds}
            onPatchLayer={updateSelectedLayer}
            onDuplicate={duplicateSelectedLayer}
            onDelete={deleteSelectedLayer}
            onMoveLayer={moveSelectedLayer}
            onSelectLayer={(id) => setSelectedLayerIds([id])}
            open={rightPanelOpen}
          />
        </div>

        <AudioTimeline document={document} />
      </div>
    </div>
  );
}

function StudioTopbar({
  surface,
  document,
  saveState,
  historyLength,
  futureLength,
  previewMode,
  exportState,
  uploadState,
  onRename,
  onUndo,
  onRedo,
  onPreviewMode,
  onDownloadSvg,
  onDownloadRaster,
  onUpload,
}: {
  surface: Surface;
  document: ArtworkDocument;
  saveState: SaveState;
  historyLength: number;
  futureLength: number;
  previewMode: 'desktop' | 'mobile';
  exportState: ExportState;
  uploadState: UploadState;
  onRename: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPreviewMode: (mode: 'desktop' | 'mobile') => void;
  onDownloadSvg: () => void;
  onDownloadRaster: () => void;
  onUpload: () => void;
}) {
  const copy = surfaceCopy[surface];
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center border-b border-[#EBE1CC1A] bg-[#0D0D0A] px-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="hidden border-r border-[#EBE1CC1A] pr-4 md:block">
          <p className="text-[10px] text-[#706B61]">{copy.eyebrow}</p>
          <p className="text-sm font-semibold text-[#EEE8DD]">{copy.title}</p>
        </div>
        <div className="min-w-0">
          <label className="sr-only" htmlFor="cover-document-name">Document name</label>
          <input
            id="cover-document-name"
            value={document.name}
            onChange={(event) => onRename(event.target.value)}
            className="w-full min-w-0 bg-transparent text-lg font-semibold text-[#EEE8DD] outline-none"
          />
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[#706B61]">
            <span>{document.width} x {document.height}</span>
            <span>/</span>
            <span className="inline-flex items-center gap-1">
              <Save size={12} />
              {saveState === 'editing' ? 'Autosaving' : saveState === 'saving' ? 'Saving' : 'Saved'}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onUndo} disabled={historyLength === 0} aria-label="Undo" title="Undo (Command Z)" className="grid h-9 w-9 place-items-center border border-[#EBE1CC1A] text-[#AAA294] hover:text-[#EEE8DD] disabled:opacity-35">
          <RotateCcw size={15} />
        </button>
        <button type="button" onClick={onRedo} disabled={futureLength === 0} aria-label="Redo" title="Redo (Shift Command Z)" className="grid h-9 w-9 place-items-center border border-[#EBE1CC1A] text-[#AAA294] hover:text-[#EEE8DD] disabled:opacity-35">
          <RotateCw size={15} />
        </button>
        <div className="ml-2 hidden border border-[#EBE1CC1A] md:flex">
          <SegmentedButton value="desktop" selected={previewMode} label="Desktop" onSelect={onPreviewMode} />
          <SegmentedButton value="mobile" selected={previewMode} label="Mobile" onSelect={onPreviewMode} />
        </div>
        <button type="button" onClick={onDownloadSvg} className="ml-2 hidden h-9 border border-[#EBE1CC1A] px-3 text-xs text-[#AAA294] hover:text-[#EEE8DD] sm:inline-flex sm:items-center sm:gap-2">
          <Download size={14} />
          SVG
        </button>
        <button type="button" onClick={onDownloadRaster} disabled={exportState === 'exporting'} className="h-9 border border-[#C7B89D]/50 bg-[#C7B89D] px-3 text-xs font-semibold text-[#080806] disabled:opacity-60">
          {exportState === 'exporting' ? 'Rendering' : 'Export'}
        </button>
        <button type="button" onClick={onUpload} disabled={uploadState === 'uploading'} className="hidden h-9 border border-[#EBE1CC1A] px-3 text-xs text-[#AAA294] hover:text-[#EEE8DD] md:inline-flex md:items-center md:gap-2">
          <Upload size={14} />
          {uploadState === 'uploading' ? 'Uploading' : uploadState === 'uploaded' ? 'Uploaded' : 'Upload'}
        </button>
      </div>
    </header>
  );
}

function ToolRail({ activeTool, onTool }: { activeTool: CoverArtTool; onTool: (tool: CoverArtTool) => void }) {
  return (
    <aside className="hidden border-r border-[#EBE1CC1A] bg-[#080806] py-3 lg:block">
      <nav className="grid justify-items-center gap-1">
        {toolItems.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeTool;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={`${item.label}, shortcut ${item.shortcut}`}
              title={`${item.label} (${item.shortcut})`}
              onClick={() => onTool(item.id)}
              className={cn(
                'grid h-12 w-12 place-items-center border text-[#706B61] transition-colors',
                active ? 'border-[#C7B89D]/50 bg-[#151510] text-[#EEE8DD]' : 'border-transparent hover:border-[#EBE1CC1A] hover:text-[#AAA294]',
              )}
            >
              <Icon size={18} strokeWidth={1.7} />
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function ContextPanel({
  activeTool,
  sourceKind,
  sourceOptions,
  sourceState,
  sourceError,
  selectedSourceId,
  directionId,
  selectedTextLayer,
  selectedWaveformLayer,
  selectedTrackPeaksSource,
  document,
  sourceCanAnalyze,
  waveformAnalysisState,
  waveformAnalysisError,
  generatedCoverUrl,
  attachTargetKind,
  attachTargetId,
  attachOptions,
  attachState,
  attachError,
  onSourceKind,
  onSourceId,
  onDirection,
  onUseDirection,
  onUpdateText,
  onUpdateWaveform,
  onAnalyzeWaveform,
  onApplyColor,
  onAttachTargetKind,
  onAttachTargetId,
  onAttach,
  onGeneratedImage,
  open,
}: {
  activeTool: CoverArtTool;
  open: boolean;
  onGeneratedImage: (image: { dataUrl: string; url: string }) => void;
  sourceKind: ArtworkSource['kind'];
  sourceOptions: CoverAttachOption[];
  sourceState: 'idle' | 'loading' | 'loaded' | 'failed';
  sourceError: string | null;
  selectedSourceId: string;
  directionId: CoverArtDirectionId;
  selectedTextLayer: TextArtworkLayer | null;
  selectedWaveformLayer: WaveformArtworkLayer | null;
  selectedTrackPeaksSource: 'real' | 'synthetic';
  document: ArtworkDocument;
  sourceCanAnalyze: boolean;
  waveformAnalysisState: WaveformAnalysisState;
  waveformAnalysisError: string | null;
  generatedCoverUrl: string | null;
  attachTargetKind: CoverAttachTargetKind;
  attachTargetId: string;
  attachOptions: CoverAttachOption[];
  attachState: AttachState;
  attachError: string | null;
  onSourceKind: (kind: ArtworkSource['kind']) => void;
  onSourceId: (id: string) => void;
  onDirection: (id: CoverArtDirectionId) => void;
  onUseDirection: () => void;
  onUpdateText: (patch: Partial<TextArtworkLayer>) => void;
  onUpdateWaveform: (patch: Partial<WaveformArtworkLayer>) => void;
  onAnalyzeWaveform: () => void;
  onApplyColor: (color: string) => void;
  onAttachTargetKind: (kind: CoverAttachTargetKind) => void;
  onAttachTargetId: (id: string) => void;
  onAttach: () => void;
}) {
  return (
    <aside
      // NOT `display:none` when collapsed. A hidden grid item is removed from
      // placement entirely, so every later item slides one column left — the
      // canvas landed in the 0rem track and the artwork vanished. Collapsing to
      // zero width keeps the item in the grid. `inert` takes the hidden
      // controls out of the tab order without removing them from layout.
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={cn(
        'min-h-0 bg-[#10100D]',
        open
          ? 'overflow-y-auto border-r border-[#EBE1CC1A] p-4'
          : 'w-0 overflow-hidden border-0 p-0',
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] text-[#706B61]">Step {Math.max(1, toolItems.findIndex((item) => item.id === activeTool) + 1)}</p>
          <h2 className="text-lg font-semibold text-[#EEE8DD]">{toolItems.find((item) => item.id === activeTool)?.label}</h2>
        </div>
        <span className="border border-[#EBE1CC1A] px-2 py-1 text-[10px] text-[#706B61]">Basic</span>
      </div>

      {activeTool === 'source' ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-[#AAA294]">Choose what this cover belongs to. Existing metadata feeds the editable layers, but the design remains non-destructive.</p>
          <div className="grid grid-cols-2 gap-2">
            {sourceKinds.map((kind) => (
              <SegmentedButton key={kind} value={kind} selected={sourceKind} label={kind === 'empty' ? 'Empty' : kind} onSelect={onSourceKind} />
            ))}
          </div>
          {sourceState === 'loading' ? <p className="text-sm text-[#706B61]">Loading sources...</p> : null}
          {sourceError ? <p className="border border-[#A95235]/40 bg-[#A95235]/10 p-3 text-sm text-[#DED1B8]">{sourceError}</p> : null}
          <div className="grid gap-2">
            {sourceOptions.map((option) => {
              const active = option.id === selectedSourceId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSourceId(option.id)}
                  className={cn(
                    'grid min-h-14 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 border p-2 text-left',
                    active ? 'border-[#C7B89D]/50 bg-[#151510]' : 'border-[#EBE1CC1A] hover:border-[#EBE1CC52]',
                  )}
                >
                  <span className="block h-10 w-10 bg-cover bg-center" style={option.coverUrl ? { backgroundImage: `url(${option.coverUrl})` } : { background: '#1B1A15' }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[#EEE8DD]">{option.label}</span>
                    <span className="block truncate text-xs text-[#706B61]">{option.detail ?? option.id}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={onUseDirection} className="h-10 w-full bg-[#C7B89D] text-sm font-semibold text-[#080806]">Start from source</button>
        </div>
      ) : null}

      {activeTool === 'directions' ? (
        <div className="space-y-3">
          {coverArtDirections.map((direction) => {
            const active = direction.id === directionId;
            return (
              <button
                key={direction.id}
                type="button"
                onClick={() => onDirection(direction.id)}
                className={cn('w-full border p-3 text-left', active ? 'border-[#C7B89D]/50 bg-[#151510]' : 'border-[#EBE1CC1A] hover:border-[#EBE1CC52]')}
              >
                <span className="mb-3 grid h-24 grid-cols-4 gap-1">
                  {Object.values(direction.palette).slice(0, 4).map((color) => <span key={color} style={{ background: color }} />)}
                </span>
                <span className="block text-sm font-semibold text-[#EEE8DD]">{direction.name}</span>
                <span className="mt-1 block text-xs leading-relaxed text-[#AAA294]">{direction.rationale}</span>
                <span className="mt-2 block text-[11px] text-[#706B61]">{direction.material}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {activeTool === 'typography' ? (
        <div className="space-y-4">
          {selectedTextLayer ? (
            <>
              <label className="grid gap-1.5">
                <FieldLabel>Layer text</FieldLabel>
                <textarea value={selectedTextLayer.text} onChange={(event) => onUpdateText({ text: event.target.value })} className="min-h-24 border border-[#EBE1CC1A] bg-[#0D0D0A] p-2 text-sm text-[#EEE8DD] outline-none focus:border-[#EBE1CC52]" />
              </label>
              <label className="grid gap-1.5">
                <FieldLabel>Font role</FieldLabel>
                <select value={selectedTextLayer.fontFamily} onChange={(event) => onUpdateText({ fontFamily: event.target.value as TextArtworkLayer['fontFamily'] })} className="h-9 border border-[#EBE1CC1A] bg-[#0D0D0A] px-2 text-sm text-[#EEE8DD] outline-none">
                  {Object.entries(fontLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Size" value={selectedTextLayer.fontSize} min={24} max={420} onChange={(value) => onUpdateText({ fontSize: value })} />
                <NumberInput label="Tracking" value={selectedTextLayer.tracking} min={-20} max={60} onChange={(value) => onUpdateText({ tracking: value })} />
              </div>
              <ColorInput label="Text colour" value={selectedTextLayer.color} onChange={(value) => onUpdateText({ color: value })} />
              <button type="button" onClick={() => onUpdateText({ uppercase: !selectedTextLayer.uppercase })} className="h-10 w-full border border-[#EBE1CC1A] text-sm text-[#AAA294] hover:text-[#EEE8DD]">
                {selectedTextLayer.uppercase ? 'Use original case' : 'Make uppercase'}
              </button>
            </>
          ) : (
            <p className="border border-[#EBE1CC1A] p-3 text-sm leading-relaxed text-[#AAA294]">Select a text layer on the canvas or in Layers to edit type without regenerating the cover.</p>
          )}
        </div>
      ) : null}

      {activeTool === 'waveform' ? (
        <div className="space-y-4">
          {selectedWaveformLayer ? (
            <>
              <div className="border border-[#EBE1CC1A] bg-[#0D0D0A] p-3">
                <p className="text-sm font-semibold text-[#EEE8DD]">{selectedWaveformLayer.peakSource === 'real' ? 'Real peaks loaded' : 'Preview grid'}</p>
                <p className="mt-1 text-xs leading-relaxed text-[#AAA294]">
                  {selectedWaveformLayer.peakSource === 'real'
                    ? 'The artwork waveform is using the selected beat peak sidecar.'
                    : 'Select a track with analyzed peaks or run track analysis to replace this preview pattern.'}
                </p>
                <button
                  type="button"
                  onClick={onAnalyzeWaveform}
                  disabled={!sourceCanAnalyze || waveformAnalysisState === 'analyzing' || selectedTrackPeaksSource === 'real'}
                  className="mt-3 h-9 w-full border border-[#C7B89D]/50 bg-[#C7B89D] text-sm font-semibold text-[#080806] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {waveformAnalysisState === 'analyzing'
                    ? 'Analyzing beat'
                    : waveformAnalysisState === 'analyzed' || selectedTrackPeaksSource === 'real'
                      ? 'Waveform analyzed'
                      : 'Analyze waveform'}
                </button>
                {waveformAnalysisError ? (
                  <p className="mt-2 text-xs leading-relaxed text-[#DED1B8]">{waveformAnalysisError}</p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['linear', 'circular', 'spectral-bars', 'contour'] as WaveformArtworkLayer['mode'][]).map((mode) => (
                  <SegmentedButton key={mode} value={mode} selected={selectedWaveformLayer.mode} label={mode.replace('-', ' ')} onSelect={(value) => onUpdateWaveform({ mode: value })} />
                ))}
              </div>
              <NumberInput label="Amplitude" value={selectedWaveformLayer.amplitude} min={0.1} max={1.4} step={0.05} onChange={(value) => onUpdateWaveform({ amplitude: value })} />
              <NumberInput label="Stroke" value={selectedWaveformLayer.strokeWidth} min={2} max={64} onChange={(value) => onUpdateWaveform({ strokeWidth: value })} />
              <NumberInput label="Smoothing" value={selectedWaveformLayer.smoothing} min={0} max={1} step={0.05} onChange={(value) => onUpdateWaveform({ smoothing: value })} />
              <ColorInput label="Band colour" value={selectedWaveformLayer.color} onChange={(value) => onUpdateWaveform({ color: value })} />
            </>
          ) : (
            <p className="border border-[#EBE1CC1A] p-3 text-sm leading-relaxed text-[#AAA294]">Select the Spectral Waveform layer to tune audio-reactive artwork controls.</p>
          )}
        </div>
      ) : null}

      {activeTool === 'brand' ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-[#AAA294]">Drag support comes later; for now, click a swatch to apply it to the selected object or the canvas background.</p>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(document.palette).map(([name, color]) => (
              <button key={name} type="button" title={name} aria-label={`Apply ${name}`} onClick={() => onApplyColor(color)} className="h-14 border border-[#EBE1CC1A]" style={{ background: color }} />
            ))}
          </div>
          <button type="button" onClick={() => onApplyColor(defaultArtworkPalette.background)} className="h-10 w-full border border-[#EBE1CC1A] text-sm text-[#AAA294] hover:text-[#EEE8DD]">Restore canvas dark</button>
        </div>
      ) : null}

      {activeTool === 'history' ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-[#AAA294]">Undo and redo are live for layer edits, object movement, colour changes and document changes.</p>
          <div className="border border-[#EBE1CC1A] p-3 text-sm text-[#AAA294]">
            <p>{document.layers.length} editable layers</p>
            <p className="mt-1">{document.version} document version</p>
            <p className="mt-1">Updated {new Date(document.updatedAt).toLocaleTimeString()}</p>
          </div>
        </div>
      ) : null}

      {activeTool === 'media' ? (
        <CoverGeneratorPanel
          palette={document.palette}
          styleName={coverArtDirections.find((d) => d.id === directionId)?.name ?? ''}
          onGenerated={onGeneratedImage}
        />
      ) : null}

      {!['source', 'directions', 'media', 'typography', 'waveform', 'brand', 'history'].includes(activeTool) ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-[#AAA294]">This panel is staged for Phase 1. Select layers, use Typography, Brand and Waveform, then export or attach the artwork.</p>
          <div className="border border-[#EBE1CC1A] p-3 text-sm text-[#AAA294]">Advanced controls will open here without changing the editor structure.</div>
        </div>
      ) : null}

      <div className="mt-6 border-t border-[#EBE1CC1A] pt-4">
        <p className="mb-2 text-[11px] font-medium text-[#AAA294]">Attach final uploaded art</p>
        <div className="grid grid-cols-2 gap-2">
          {attachTargetKinds.map((kind) => (
            <SegmentedButton key={kind} value={kind} selected={attachTargetKind} label={kind} onSelect={onAttachTargetKind} />
          ))}
        </div>
        {attachOptions.length > 0 ? (
          <select value={attachTargetId} onChange={(event) => onAttachTargetId(event.target.value)} className="mt-2 h-9 w-full border border-[#EBE1CC1A] bg-[#0D0D0A] px-2 text-sm text-[#EEE8DD]">
            {attachOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        ) : null}
        <button type="button" disabled={!generatedCoverUrl || attachState === 'attaching'} onClick={onAttach} className="mt-2 h-10 w-full border border-[#C7B89D]/50 bg-[#C7B89D] text-sm font-semibold text-[#080806] disabled:opacity-45">
          {attachState === 'attaching' ? 'Attaching' : attachState === 'attached' ? 'Attached' : 'Attach uploaded cover'}
        </button>
        {attachError ? <p className="mt-2 text-sm text-[#DED1B8]">{attachError}</p> : null}
        {generatedCoverUrl ? <p className="mt-2 break-all text-xs text-[#706B61]">{generatedCoverUrl}</p> : null}
      </div>
    </aside>
  );
}

function CanvasWorkspace({
  artboardRef,
  document,
  sortedLayers,
  selectedLayerIds,
  editingLayerId,
  zoom,
  previewMode,
  onSelectLayer,
  onClearSelection,
  onStartDrag,
  onDrag,
  onEndDrag,
  onEditLayer,
  onUpdateText,
  onZoom,
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeftPanel,
  onToggleRightPanel,
  reactive,
  canAudition,
  auditioning,
  onAudition,
}: {
  artboardRef: React.RefObject<HTMLDivElement | null>;
  document: ArtworkDocument;
  sortedLayers: ArtworkLayer[];
  selectedLayerIds: string[];
  editingLayerId: string | null;
  zoom: number;
  previewMode: 'desktop' | 'mobile';
  onSelectLayer: (event: React.MouseEvent, id: string) => void;
  onClearSelection: () => void;
  onStartDrag: (event: PointerEvent<HTMLDivElement>, layer: ArtworkLayer) => void;
  onDrag: (event: PointerEvent<HTMLDivElement>) => void;
  onEndDrag: () => void;
  onEditLayer: (id: string | null) => void;
  onUpdateText: (id: string, text: string) => void;
  onZoom: (zoom: number) => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  /** 0..1 loudness and bass at the playhead of the track being previewed. */
  reactive: { level: number; bass: number };
  canAudition: boolean;
  auditioning: boolean;
  onAudition: () => void;
}) {
  return (
    <section className="relative min-h-0 overflow-hidden bg-[#0A0A08]">
      {/* Overlay HUD rather than bordered boxes: the canvas reads as one
          surface with instruments floating on it, not three panes competing. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3">
        <div className="pointer-events-auto flex items-center gap-1 bg-[#0D0D0A]/80 p-0.5 backdrop-blur-sm">
          <PanelToggle
            side="left"
            open={leftPanelOpen}
            onToggle={() => onToggleLeftPanel()}
          />
          <span aria-hidden className="mx-1 h-4 w-px bg-[#EBE1CC1A]" />
          {canAudition ? (
            <>
              <button
                type="button"
                onClick={onAudition}
                aria-pressed={auditioning}
                aria-label={auditioning ? 'Pause source track' : 'Play source track'}
                title={auditioning ? 'Pause source track' : 'Play source track to make the cover react'}
                className={cn(
                  'grid h-7 w-7 place-items-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C7B89D]',
                  auditioning ? 'text-[#C7B89D]' : 'text-[#6A655C] hover:text-[#EEE8DD]',
                )}
              >
                {auditioning ? <Pause size={12} /> : <Play size={12} />}
              </button>
              {/* Level meter: confirms at a glance that the reaction is live,
                  and gives the producer something to read when the artwork
                  itself is deliberately moving only a few percent. */}
              <span aria-hidden className="relative h-[3px] w-10 overflow-hidden bg-[#26241F]">
                <span
                  className="absolute inset-y-0 left-0 bg-[#C7B89D]"
                  style={{ width: `${Math.round(reactive.level * 100)}%` }}
                />
              </span>
              <span aria-hidden className="mx-1 h-4 w-px bg-[#EBE1CC1A]" />
            </>
          ) : null}
          {[0.16, 0.22, 0.3].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onZoom(value)}
              className={cn(
                'h-7 px-2 font-mono text-[10px] tabular-nums transition-colors',
                zoom === value ? 'text-[#C7B89D]' : 'text-[#6A655C] hover:text-[#EEE8DD]',
              )}
            >
              {Math.round(value * 100)}%
            </button>
          ))}
        </div>
        <div className="pointer-events-auto flex items-center gap-2 bg-[#0D0D0A]/80 px-2 py-1.5 backdrop-blur-sm">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A655C]">
            {previewMode === 'desktop' ? 'Desktop' : 'Mobile'} · guides on
          </span>
          <span aria-hidden className="h-4 w-px bg-[#EBE1CC1A]" />
          <PanelToggle
            side="right"
            open={rightPanelOpen}
            onToggle={() => onToggleRightPanel()}
          />
        </div>
      </div>
      <div className="grid h-full place-items-center overflow-auto p-12" onClick={onClearSelection}>
        <div
          ref={artboardRef}
          className="relative shrink-0 border border-[#EBE1CC52] bg-[#080806] shadow-[0_24px_80px_rgba(0,0,0,0.38)]"
          style={{
            width: document.width * zoom,
            height: document.height * zoom,
            background: document.background,
          }}
        >
          <div className="pointer-events-none absolute inset-[8%] border border-dashed border-[#EEE8DD33]" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-full border-l border-[#EEE8DD1F]" />
          <div className="pointer-events-none absolute left-0 top-1/2 w-full border-t border-[#EEE8DD1F]" />
          {sortedLayers.map((layer) => {
            if (!layer.visible) return null;
            const selected = selectedLayerIds.includes(layer.id);
            // Live audio reaction, PREVIEW ONLY — see `reactive` on this
            // component. The image breathes with overall loudness and the
            // waveform stretches with the bass, so you can judge the cover
            // against the track it belongs to rather than against silence.
            // Deliberately small multipliers: this is a design surface, and a
            // layer that jumps around cannot be positioned accurately.
            const reactScale = layer.type === 'image' ? 1 + reactive.level * 0.045 : 1;
            const reactStretch = layer.type === 'waveform' ? 1 + reactive.bass * 0.5 : 1;
            const reactOpacity = layer.type === 'waveform'
              ? Math.min(1, layer.opacity * (0.75 + reactive.level * 0.45))
              : layer.opacity;

            const style: CSSProperties = {
              left: layer.x * zoom,
              top: layer.y * zoom,
              width: layer.width * zoom,
              height: layer.height * zoom,
              opacity: reactOpacity,
              transform: `rotate(${layer.rotation}deg) scale(${reactScale}) scaleY(${reactStretch})`,
              // Not transitioned: the values already arrive smoothed from the
              // analysis, and a CSS transition on top would lag the audio.
              transformOrigin: 'center',
              mixBlendMode: layer.blendMode,
              zIndex: layer.zIndex,
              pointerEvents: layer.type === 'texture' ? 'none' : undefined,
            };
            return (
              <div
                key={layer.id}
                role="button"
                tabIndex={0}
                aria-label={`${layer.name} layer`}
                onClick={(event) => onSelectLayer(event, layer.id)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (layer.type === 'text') onEditLayer(layer.id);
                }}
                onPointerDown={(event) => onStartDrag(event, layer)}
                onPointerMove={onDrag}
                onPointerUp={onEndDrag}
                onPointerCancel={onEndDrag}
                className={cn(
                  'absolute select-none outline-none',
                  selected ? 'ring-1 ring-[#C7B89D]' : 'hover:ring-1 hover:ring-[#EEE8DD33]',
                  layer.locked ? 'cursor-not-allowed' : 'cursor-move',
                )}
                style={style}
              >
                <CanvasLayer layer={layer} zoom={zoom} editing={editingLayerId === layer.id} onEditDone={() => onEditLayer(null)} onUpdateText={(text) => onUpdateText(layer.id, text)} />
                {selected && !layer.locked ? (
                  <>
                    <span className="absolute -right-1 -top-1 h-2 w-2 bg-[#C7B89D]" />
                    <span className="absolute -bottom-1 -right-1 h-2 w-2 bg-[#C7B89D]" />
                    <span className="absolute -top-8 right-0 border border-[#EBE1CC1A] bg-[#080806] px-2 py-1 text-[10px] text-[#C7B89D]">drag / arrows</span>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CanvasLayer({
  layer,
  zoom,
  editing,
  onEditDone,
  onUpdateText,
}: {
  layer: ArtworkLayer;
  zoom: number;
  editing: boolean;
  onEditDone: () => void;
  onUpdateText: (text: string) => void;
}) {
  if (layer.type === 'shape') {
    return <div className="h-full w-full" style={{ background: layer.fill, border: layer.stroke ? `${layer.strokeWidth ?? 1}px solid ${layer.stroke}` : undefined, borderRadius: layer.shape === 'circle' ? '999px' : 0 }} />;
  }
  if (layer.type === 'image') {
    return (
      <div className="grid h-full w-full place-items-center border border-[#C7B89D33] bg-[#1B1A15] text-center text-[#706B61]">
        <ImageIcon size={Math.max(18, 80 * zoom)} />
      </div>
    );
  }
  if (layer.type === 'waveform') {
    return <WaveformGraphic layer={layer} />;
  }
  if (layer.type === 'texture') {
    return (
      <div
        className="h-full w-full"
        style={{
          opacity: layer.intensity,
          backgroundImage: 'linear-gradient(0deg, rgba(238,232,221,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(238,232,221,.06) 1px, transparent 1px)',
          backgroundSize: `${42 * zoom}px ${42 * zoom}px`,
        }}
      />
    );
  }
  const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  if (editing) {
    return (
      <textarea
        autoFocus
        defaultValue={layer.text}
        onBlur={(event) => {
          onUpdateText(event.target.value);
          onEditDone();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onEditDone();
        }}
        className="h-full w-full resize-none bg-[#0D0D0A]/90 p-2 outline outline-1 outline-[#C7B89D]"
        style={{
          color: layer.color,
          fontFamily: fontStacks[layer.fontFamily],
          fontSize: layer.fontSize * zoom,
          letterSpacing: layer.tracking * zoom,
          lineHeight: layer.lineHeight,
          textAlign: layer.align,
        }}
      />
    );
  }
  return (
    <div
      className="h-full w-full overflow-hidden whitespace-pre-wrap"
      style={{
        color: layer.color,
        fontFamily: fontStacks[layer.fontFamily],
        fontSize: layer.fontSize * zoom,
        letterSpacing: layer.tracking * zoom,
        lineHeight: layer.lineHeight,
        textAlign: layer.align,
        textTransform: layer.uppercase ? 'uppercase' : 'none',
      }}
    >
      {text}
    </div>
  );
}

function PropertiesInspector({
  document,
  selectedLayer,
  selectedLayerIds,
  onPatchLayer,
  onDuplicate,
  onDelete,
  onMoveLayer,
  onSelectLayer,
  open,
}: {
  document: ArtworkDocument;
  selectedLayer: ArtworkLayer | null;
  selectedLayerIds: string[];
  onPatchLayer: <T extends ArtworkLayer>(patch: Partial<T>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveLayer: (delta: -1 | 1) => void;
  onSelectLayer: (id: string) => void;
  open: boolean;
}) {
  return (
    <aside
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={cn(
        'hidden min-h-0 bg-[#10100D] xl:block',
        open
          ? 'overflow-y-auto border-l border-[#EBE1CC1A] p-4'
          : 'w-0 overflow-hidden border-0 p-0',
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        <PanelRight size={16} />
        <h2 className="text-lg font-semibold text-[#EEE8DD]">Inspector</h2>
      </div>
      {selectedLayer ? (
        <div className="space-y-4">
          <div className="border border-[#EBE1CC1A] p-3">
            <p className="text-sm font-semibold text-[#EEE8DD]">{selectedLayer.name}</p>
            <p className="mt-1 text-xs text-[#706B61]">{readableLayerType(selectedLayer)} / {selectedLayer.width} x {selectedLayer.height}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberInput label="X" value={Math.round(selectedLayer.x)} onChange={(value) => onPatchLayer({ x: value })} />
            <NumberInput label="Y" value={Math.round(selectedLayer.y)} onChange={(value) => onPatchLayer({ y: value })} />
            <NumberInput label="Width" value={Math.round(selectedLayer.width)} min={40} onChange={(value) => onPatchLayer({ width: value })} />
            <NumberInput label="Height" value={Math.round(selectedLayer.height)} min={40} onChange={(value) => onPatchLayer({ height: value })} />
            <NumberInput label="Rotate" value={selectedLayer.rotation} min={-180} max={180} onChange={(value) => onPatchLayer({ rotation: value })} />
            <NumberInput label="Opacity" value={selectedLayer.opacity} min={0} max={1} step={0.05} onChange={(value) => onPatchLayer({ opacity: value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onDuplicate} className="h-9 border border-[#EBE1CC1A] text-sm text-[#AAA294] hover:text-[#EEE8DD]">Duplicate</button>
            <button type="button" onClick={onDelete} disabled={selectedLayer.locked} className="h-9 border border-[#A95235]/40 text-sm text-[#DED1B8] disabled:opacity-35">Delete</button>
            <button type="button" onClick={() => onMoveLayer(-1)} className="inline-flex h-9 items-center justify-center gap-1 border border-[#EBE1CC1A] text-sm text-[#AAA294] hover:text-[#EEE8DD]"><ChevronDown size={14} /> Back</button>
            <button type="button" onClick={() => onMoveLayer(1)} className="inline-flex h-9 items-center justify-center gap-1 border border-[#EBE1CC1A] text-sm text-[#AAA294] hover:text-[#EEE8DD]"><ChevronUp size={14} /> Front</button>
            <button type="button" onClick={() => onPatchLayer({ visible: !selectedLayer.visible })} className="inline-flex h-9 items-center justify-center gap-1 border border-[#EBE1CC1A] text-sm text-[#AAA294] hover:text-[#EEE8DD]">
              {selectedLayer.visible ? <Eye size={14} /> : <EyeOff size={14} />} Visible
            </button>
            <button type="button" onClick={() => onPatchLayer({ locked: !selectedLayer.locked })} className="inline-flex h-9 items-center justify-center gap-1 border border-[#EBE1CC1A] text-sm text-[#AAA294] hover:text-[#EEE8DD]">
              {selectedLayer.locked ? <Lock size={14} /> : <Unlock size={14} />} Lock
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-[#EBE1CC1A] p-3 text-sm leading-relaxed text-[#AAA294]">
          Select a layer to edit properties. Document: {document.width} x {document.height}. {selectedLayerIds.length > 1 ? `${selectedLayerIds.length} layers selected.` : 'No layer selected.'}
        </div>
      )}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <Layers size={15} />
          <p className="text-sm font-semibold text-[#EEE8DD]">Layers</p>
        </div>
        <div className="grid gap-1">
          {sortArtworkLayers(document.layers).slice().reverse().map((layer) => (
            <button
              key={layer.id}
              type="button"
              onClick={() => onSelectLayer(layer.id)}
              className={cn('grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border p-2 text-left', selectedLayer?.id === layer.id ? 'border-[#C7B89D]/50 bg-[#151510]' : 'border-[#EBE1CC1A] hover:border-[#EBE1CC52]')}
            >
              <LayerPreview layer={layer} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-[#EEE8DD]">{layer.name}</span>
                <span className="block text-xs text-[#706B61]">{readableLayerType(layer)}</span>
              </span>
              <span className="text-[#706B61]">{layer.locked ? <Lock size={13} /> : layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function AudioTimeline({ document }: { document: ArtworkDocument }) {
  const waveformLayer = findWaveformLayer(document);

  return (
    <footer className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-[#EBE1CC1A] bg-[#0D0D0A] px-4">
      <div className="grid h-11 w-11 place-items-center border border-[#EBE1CC1A]" style={{ background: document.palette.panel }}>
        <Music2 size={17} className="text-[#C7B89D]" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <p className="truncate text-sm font-semibold text-[#EEE8DD]">{document.source.label}</p>
          <span className="hidden text-xs text-[#706B61] sm:inline">
            {document.source.detail ?? 'Audio drives waveform layer'} / {waveformLayer.peakSource === 'real' ? 'real peaks' : 'preview grid'}
          </span>
        </div>
        <div className="mt-2 h-5 overflow-hidden">
          <WaveformGraphic layer={waveformLayer} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Play preview" className="grid h-10 w-10 place-items-center border border-[#C7B89D]/50 bg-[#C7B89D] text-[#080806]">
          <Play size={16} fill="currentColor" />
        </button>
        <button type="button" aria-label="Pause preview" className="grid h-10 w-10 place-items-center border border-[#EBE1CC1A] text-[#AAA294]">
          <Pause size={15} />
        </button>
        <span className="hidden text-xs text-[#706B61] md:inline">00:00 / 02:48 / sync on</span>
      </div>
    </footer>
  );
}
