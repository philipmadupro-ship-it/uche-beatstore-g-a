'use client';

/**
 * Cover Art Studio.
 *
 * A layer-based editor for beat artwork: bring in your own images, generate one
 * with AI, set type, build a collage, then export it or attach it straight to a
 * track, project, playlist or the producer profile.
 *
 * State lives here and flows down; the canvas and panels are presentational.
 * Undo history is a stack of whole documents rather than a diff — a cover has
 * tens of layers, not thousands, so snapshots are cheap and cannot desync.
 *
 * Interaction maths is in `lib/cover/geometry`, layout maths in
 * `lib/cover/collage`, and document mutation in `cover-art-document` — all pure
 * and unit-tested, per the convention in CLAUDE.md, because logic that lives
 * only inside a component here has been silently reverted before.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download, Grid3x3, Image as ImageIcon, Layers as LayersIcon, Maximize2,
  Music2, Pause, Play, Redo2, Ruler, Sparkles, SquareStack, Undo2, FolderOpen, Check, Loader2, PanelLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { svgToRasterBlob } from '@/design-system';
import { readCoverArtFile, coverArtImportErrorMessage, type CoverArtImportError } from '@/design-system/presets/cover-art-import';
import { uploadGeneratedCoverArt } from '@/lib/upload/generated-cover-upload';
import { attachCoverUrl, type CoverAttachTarget } from '@/lib/upload/cover-attachment';
import { fetchCoverAttachOptions, type CoverAttachOption, type CoverAttachTargetKind } from '@/lib/upload/cover-attach-options';
import { buildCollage, collageFrame, type CollageLayoutId } from '@/lib/cover/collage';
import { fitRectInside } from '@/lib/cover/geometry';
import { resizeArtboard } from '@/lib/cover/artboard';
import { restyleDocument } from '@/lib/cover/restyle';
import { resolveExport, type ExportSettings } from '@/lib/cover/export-settings';
import { embedFontsInSvg } from '@/lib/cover/font-embed';
import {
  deleteCoverDocument, getLastOpenedId, listCoverDocuments, loadCoverDocument,
  saveCoverDocument, setLastOpenedId, toStored, uniqueDocumentName, withFreshId,
  type CoverDocumentSummary,
} from '@/lib/cover/document-store';
import { usePlayer } from '@/hooks/usePlayer';
import { useAudioReactivity } from '@/hooks/useAudioReactivity';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useVisualPeaks } from '@/hooks/useVisualPeaks';
import { confirmToast, toast } from '@/hooks/useToast';
import type { Track } from '@/lib/types';
import {
  addLayer, alignLayers, coverArtDirections, createArtworkDocument, createImageLayer,
  createShapeLayer, createTextLayer, createTextureLayer, createWaveformLayer,
  distributeLayers, duplicateLayers, groupLayers, removeLayers, renderArtworkDocumentSvg, reorderLayer,
  ungroupLayers,
  updateWaveformLayerPeaks,
  type ArtworkDocument, type ArtworkLayer, type ArtworkSource, type ArtworkTextureKind,
  type CoverArtDirectionId, type ImageArtworkLayer, type LayerAlignment, type LayerReorder,
  type ShapeArtworkLayer,
} from './cover-art-document';
import { StudioCanvas, type LayerPatch } from './StudioCanvas';
import { LayersPanel } from './LayersPanel';
import { InspectorPanel } from './InspectorPanel';
import { AddPanel, CollagePanel, ExportPanel, SourcePanel } from './StudioToolPanels';
import { DocumentsPanel } from './DocumentsPanel';
import { CoverGeneratorPanel } from './CoverGeneratorPanel';
import { StudioButton } from './StudioControls';
import { ShortcutSheet } from './ShortcutSheet';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { ContextualToolbar } from './ContextualToolbar';

type Surface = 'dev-lab' | 'cover-art-studio';
type ToolTab = 'documents' | 'source' | 'add' | 'collage' | 'ai' | 'export';

const toolTabs: Array<{ id: ToolTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'documents', label: 'Files', icon: FolderOpen },
  { id: 'source', label: 'Source', icon: Music2 },
  { id: 'add', label: 'Add', icon: ImageIcon },
  { id: 'collage', label: 'Collage', icon: SquareStack },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'export', label: 'Export', icon: Download },
];

type EditorState = {
  doc: ArtworkDocument;
  /** Most recent state last. */
  past: ArtworkDocument[];
  /** Next state first. */
  future: ArtworkDocument[];
};

/** Snapshots kept in each direction. Covers are small; 40 steps is generous. */
const HISTORY_LIMIT = 40;

const initialSource: ArtworkSource = { kind: 'empty', label: 'Untitled cover', detail: 'No source selected' };

/** Images added together are auto-arranged; a single image just lands centred. */
const COLLAGE_MIN = 2;

export function CoverArtStudio({ surface = 'cover-art-studio' }: { surface?: Surface }) {
  /**
   * Document plus undo history as ONE piece of state.
   *
   * These were three separate useStates, and undo/redo had to nest setState
   * calls inside each other's updaters to move a document between them. React
   * may invoke an updater more than once, so the nested calls fired more than
   * once too and the stacks desynced — redo did nothing at all. Keeping the
   * three together makes every history move a single atomic transition.
   */
  const [editor, setEditor] = useState<EditorState>(() => ({
    doc: createArtworkDocument('de-roche-mineral', initialSource),
    past: [],
    future: [],
  }));
  const document = editor.doc;
  const history = editor.past;
  const future = editor.future;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [tab, setTab] = useState<ToolTab>('add');
  const [zoom, setZoom] = useState(0.22);
  const [showGuides, setShowGuides] = useState(true);
  const [showRulers, setShowRulers] = useState(false);
  const [showLayers, setShowLayers] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  /**
   * Narrow layout. The rail plus both panels are 600px of fixed chrome, so
   * below roughly 1180px they leave the canvas — the thing being designed —
   * with almost nothing, and the grid overflows its own container. Measured off
   * the studio element rather than the window so it stays right inside the
   * dashboard shell whatever else is on screen.
   */
  const [compact, setCompact] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [collageLayout, setCollageLayout] = useState<CollageLayoutId>('grid');

  const [sourceKind, setSourceKind] = useState<ArtworkSource['kind']>('track');
  const [sourceOptions, setSourceOptions] = useState<CoverAttachOption[]>([]);
  const [sourceState, setSourceState] = useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [directionId, setDirectionId] = useState<CoverArtDirectionId>('de-roche-mineral');

  /**
   * Export settings, not just a preset id.
   *
   * A preset now WRITES these values rather than being a mode, so picking
   * "Streaming cover" and then nudging the quality down is one continuous
   * action instead of leaving a preset behind.
   */
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    width: 3000,
    height: 3000,
    format: 'png',
    quality: 0.92,
    transparent: false,
    filename: 'cover-art',
  });
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'failed'>('idle');
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'uploaded' | 'failed'>('idle');
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [attachTargetKind, setAttachTargetKind] = useState<CoverAttachTargetKind>('track');
  const [attachTargetId, setAttachTargetId] = useState('');
  const [attachOptions, setAttachOptions] = useState<CoverAttachOption[]>([]);
  const [attachState, setAttachState] = useState<'idle' | 'attaching' | 'attached' | 'failed'>('idle');
  const [attachError, setAttachError] = useState<string | null>(null);

  const [savedDocuments, setSavedDocuments] = useState<CoverDocumentSummary[]>([]);
  const [persistState, setPersistState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const viewportRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * Set once the producer takes control of the zoom, which stops the canvas
   * from re-fitting under them every time a panel opens or the window changes.
   */
  const userZoomed = useRef(false);
  /** createdAt of the open document, so autosaves do not keep resetting it. */
  const createdAtRef = useRef<string | undefined>(undefined);
  /** Blocks autosave until the producer has actually changed something. */
  const dirtyRef = useRef(false);

  const selectedSourceOption = sourceOptions.find((option) => option.id === selectedSourceId) ?? null;
  const imageLayers = document.layers.filter((layer): layer is ImageArtworkLayer => layer.type === 'image' && Boolean(layer.src));
  const selectedImageLayers = imageLayers.filter((layer) => selectedIds.includes(layer.id));

  const safeName = document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover-art';
  const svgFilename = `beatstor-${safeName}.svg`;
  const resolvedExport = resolveExport({ ...exportSettings, filename: exportSettings.filename || safeName });

  /* ── Audio-reactive preview (unchanged behaviour, preserved) ─────────── */

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
  // Reduced motion means no pulsing at all — decorative movement, and the
  // project's constraint on it is explicit.
  const reactive = prefersReducedMotion ? { level: 0, bass: 0 } : { level: reactivity.level, bass: reactivity.bass };

  const selectedTrackPeaks = useVisualPeaks(
    sourceKind === 'track' ? selectedSourceId || 'cover-art-preview' : 'cover-art-preview',
    sourceKind === 'track' ? selectedSourceOption?.peaksUrl : null,
    128,
  );

  /* ── History ─────────────────────────────────────────────────────────── */

  /** True while a pointer gesture is open, so only its first patch adds history. */
  const commitRef = useRef(false);

  const updateDocument = useCallback((mutator: (current: ArtworkDocument) => ArtworkDocument) => {
    setEditor((state) => {
      const next = mutator(state.doc);
      if (next === state.doc) return state;
      dirtyRef.current = true;
      return { doc: next, past: [...state.past.slice(-HISTORY_LIMIT), state.doc], future: [] };
    });
  }, []);

  /** Change the document without touching history — used for incoming metadata. */
  const setDocumentQuietly = useCallback((mutator: (current: ArtworkDocument) => ArtworkDocument) => {
    setEditor((state) => {
      const next = mutator(state.doc);
      if (next === state.doc) return state;
      dirtyRef.current = true;
      return { ...state, doc: next };
    });
  }, []);

  /**
   * Layer patches from the canvas.
   *
   * A drag fires dozens of these; only the first snapshots history, and the
   * final `commit` call closes the gesture. Without that the undo stack fills
   * with one entry per pointermove and undo becomes useless.
   */
  const patchLayers = useCallback((patches: LayerPatch[], commit: boolean) => {
    if (patches.length === 0) {
      if (commit) commitRef.current = false;
      return;
    }
    const opensGesture = !commitRef.current;
    if (opensGesture) commitRef.current = true;
    dirtyRef.current = true;

    setEditor((state) => {
      const byId = new Map(patches.map((item) => [item.id, item.patch]));
      const doc = {
        ...state.doc,
        layers: state.doc.layers.map((layer) => (
          byId.has(layer.id) ? { ...layer, ...byId.get(layer.id) } as ArtworkLayer : layer
        )),
        updatedAt: new Date().toISOString(),
      };
      // Only the patch that opens a gesture pushes history, so a drag of fifty
      // pointermoves collapses to a single undo step.
      return opensGesture
        ? { doc, past: [...state.past.slice(-HISTORY_LIMIT), state.doc], future: [] }
        : { ...state, doc };
    });
    if (commit) commitRef.current = false;
  }, []);

  const patchSelected = useCallback((patch: Partial<ArtworkLayer>) => {
    updateDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => (
        selectedIds.includes(layer.id) ? { ...layer, ...patch } as ArtworkLayer : layer
      )),
      updatedAt: new Date().toISOString(),
    }));
  }, [selectedIds, updateDocument]);

  const undo = useCallback(() => {
    setEditor((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      dirtyRef.current = true;
      return {
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future.slice(0, HISTORY_LIMIT)],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setEditor((state) => {
      const next = state.future[0];
      if (!next) return state;
      dirtyRef.current = true;
      return {
        doc: next,
        past: [...state.past.slice(-HISTORY_LIMIT), state.doc],
        future: state.future.slice(1),
      };
    });
  }, []);

  /* ── Adding layers ───────────────────────────────────────────────────── */

  /**
   * Bring images in from a file picker or a drop.
   *
   * Each image keeps its own aspect ratio — a landscape photo dropped on a
   * square canvas should not arrive pre-cropped. Two or more at once get run
   * through the collage layout, because placing a pile of images by hand is
   * the slowest part of making one.
   */
  const addImageFiles = useCallback(async (files: File[], at?: { x: number; y: number }) => {
    const loaded: Array<{ dataUrl: string; name: string; aspect: number }> = [];

    for (const file of files) {
      try {
        const imported = await readCoverArtFile(file);
        // `dataUrl` is optional on the shared import type; a source without one
        // cannot become a layer, so it is reported rather than added blank.
        const dataUrl = imported.dataUrl;
        if (!dataUrl) {
          toast.error(`${file.name} could not be read.`);
          continue;
        }
        const aspect = await new Promise<number>((resolve) => {
          const probe = new window.Image();
          probe.onload = () => resolve(probe.naturalWidth / probe.naturalHeight || 1);
          probe.onerror = () => resolve(1);
          probe.src = dataUrl;
        });
        loaded.push({ dataUrl, name: file.name.replace(/\.[^.]+$/, ''), aspect });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'read-failed';
        toast.error(coverArtImportErrorMessage(code as CoverArtImportError));
      }
    }

    if (loaded.length === 0) return;

    updateDocument((current) => {
      let next = current;

      if (loaded.length >= COLLAGE_MIN) {
        const slots = buildCollage({
          frame: collageFrame(current),
          count: loaded.length,
          layout: collageLayout,
          seed: `${current.id}-${loaded.length}`,
        });
        loaded.forEach((image, index) => {
          const slot = slots[index];
          const fitted = fitRectInside(slot, image.aspect);
          next = addLayer(next, createImageLayer(next, image.dataUrl, image.name, {
            x: Math.round(fitted.x), y: Math.round(fitted.y),
            width: Math.round(fitted.width), height: Math.round(fitted.height),
            rotation: slot.rotation,
          }));
        });
        return next;
      }

      const image = loaded[0];
      const size = current.width * 0.56;
      const fitted = fitRectInside(
        { x: 0, y: 0, width: size, height: size },
        image.aspect,
      );
      // The drop point is clamped to the artboard before it becomes a
      // position. A drop near an edge — or one whose coordinates are stale
      // because the canvas was still settling — would otherwise place an image
      // almost entirely outside the cover, where it is clipped and looks like
      // the import silently failed.
      const centreX = at ? Math.min(current.width, Math.max(0, at.x)) : current.width / 2;
      const centreY = at ? Math.min(current.height, Math.max(0, at.y)) : current.height / 2;
      return addLayer(next, createImageLayer(next, image.dataUrl, image.name, {
        x: Math.round(centreX - fitted.width / 2),
        y: Math.round(centreY - fitted.height / 2),
        width: Math.round(fitted.width), height: Math.round(fitted.height),
      }));
    });

    toast.success(loaded.length === 1 ? 'Image added' : `${loaded.length} images added`);
  }, [collageLayout, updateDocument]);

  const addText = useCallback(() => {
    updateDocument((current) => {
      const layer = createTextLayer(current);
      setSelectedIds([layer.id]);
      return addLayer(current, layer);
    });
  }, [updateDocument]);

  const addShape = useCallback((shape: ShapeArtworkLayer['shape']) => {
    updateDocument((current) => {
      const layer = createShapeLayer(current, shape);
      setSelectedIds([layer.id]);
      return addLayer(current, layer);
    });
  }, [updateDocument]);

  const addTexture = useCallback((texture: ArtworkTextureKind) => {
    updateDocument((current) => {
      const layer = createTextureLayer(current, texture);
      setSelectedIds([layer.id]);
      return addLayer(current, layer);
    });
  }, [updateDocument]);

  const addWaveform = useCallback(() => {
    updateDocument((current) => {
      const layer = createWaveformLayer(current);
      setSelectedIds([layer.id]);
      return addLayer(current, layer);
    });
  }, [updateDocument]);

  /** Drop a generated image onto the canvas as a new layer behind the type. */
  const handleGeneratedImage = useCallback((image: { dataUrl: string; url: string }) => {
    updateDocument((current) => {
      const layer = createImageLayer(current, image.dataUrl, 'Generated artwork', {
        x: 0, y: 0, width: current.width, height: current.height, zIndex: -1,
      });
      setSelectedIds([layer.id]);
      return addLayer(current, layer);
    });
    toast.success('Generated artwork added as a layer');
  }, [updateDocument]);

  /** Re-run the current collage layout over existing image layers. */
  const arrangeCollage = useCallback((only: ImageArtworkLayer[]) => {
    if (only.length < COLLAGE_MIN) return;
    updateDocument((current) => {
      const slots = buildCollage({
        frame: collageFrame(current),
        count: only.length,
        layout: collageLayout,
        seed: `${current.id}-${collageLayout}-${only.length}`,
      });
      const placed = new Map(only.map((layer, index) => {
        const slot = slots[index];
        const fitted = fitRectInside(slot, layer.width / layer.height);
        return [layer.id, {
          x: Math.round(fitted.x), y: Math.round(fitted.y),
          width: Math.round(fitted.width), height: Math.round(fitted.height),
          rotation: slot.rotation,
        }];
      }));
      return {
        ...current,
        layers: current.layers.map((layer) => (
          placed.has(layer.id) ? { ...layer, ...placed.get(layer.id) } as ArtworkLayer : layer
        )),
        updatedAt: new Date().toISOString(),
      };
    });
  }, [collageLayout, updateDocument]);

  /* ── Persistence ─────────────────────────────────────────────────────── */

  const refreshDocumentList = useCallback(async () => {
    try {
      setSavedDocuments(await listCoverDocuments());
    } catch {
      // IndexedDB unavailable (private mode, blocked storage). The editor still
      // works in-memory; it just cannot remember anything, and saying so once
      // in the panel beats a toast on every autosave tick.
      setSavedDocuments([]);
    }
  }, []);

  /**
   * Reopen whatever was last being worked on.
   *
   * Runs once. A cover that fails validation is skipped rather than thrown, so
   * one corrupt record cannot make the studio unopenable.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshDocumentList();
      try {
        const lastId = await getLastOpenedId();
        if (!lastId || cancelled) return;
        const stored = await loadCoverDocument(lastId);
        if (!stored || cancelled) return;
        createdAtRef.current = stored.createdAt;
        setEditor({ doc: stored.document, past: [], future: [] });
        setSelectedIds([]);
      } catch {
        // Nothing to restore; the blank document already on screen is correct.
      }
    })();
    return () => { cancelled = true; };
  }, [refreshDocumentList]);

  /**
   * Autosave, debounced.
   *
   * Debounced rather than saved per keystroke because a document carries its
   * images inline and can be several megabytes — writing that on every
   * pointermove of a drag would stall the canvas. `dirtyRef` keeps the initial
   * blank document from being written before the producer has touched anything,
   * which would otherwise fill the file list with empty covers.
   */
  useEffect(() => {
    if (!dirtyRef.current) return undefined;
    setPersistState('saving');
    const timer = window.setTimeout(async () => {
      try {
        const stored = toStored(document, createdAtRef.current);
        createdAtRef.current = stored.createdAt;
        await saveCoverDocument(stored);
        await setLastOpenedId(stored.id);
        setPersistState('saved');
        void refreshDocumentList();
      } catch {
        setPersistState('idle');
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [document, refreshDocumentList]);

  const openDocument = useCallback(async (id: string) => {
    try {
      const stored = await loadCoverDocument(id);
      if (!stored) {
        toast.error('That cover could not be opened.');
        return;
      }
      createdAtRef.current = stored.createdAt;
      dirtyRef.current = false;
      setEditor({ doc: stored.document, past: [], future: [] });
      setSelectedIds([]);
      setEditingId(null);
      await setLastOpenedId(id);
      toast.success(`Opened ${stored.name}`);
    } catch {
      toast.error('That cover could not be opened.');
    }
  }, []);

  const newDocument = useCallback(() => {
    const fresh = withFreshId(createArtworkDocument(directionId, sourceFromSelection()));
    const named = {
      ...fresh,
      name: uniqueDocumentName(fresh.name, savedDocuments.map((item) => item.name)),
    };
    createdAtRef.current = undefined;
    dirtyRef.current = true;
    setEditor({ doc: named, past: [], future: [] });
    setSelectedIds([]);
    setEditingId(null);
    setTab('add');
  // `sourceFromSelection` reads current state each call and is intentionally
  // not a dependency; listing it would rebuild this on every source keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directionId, savedDocuments]);

  const duplicateDocument = useCallback(async (id: string) => {
    try {
      const stored = await loadCoverDocument(id);
      if (!stored) return;
      const copy = withFreshId({
        ...stored.document,
        name: uniqueDocumentName(stored.name, savedDocuments.map((item) => item.name)),
      });
      createdAtRef.current = undefined;
      dirtyRef.current = true;
      setEditor({ doc: copy, past: [], future: [] });
      setSelectedIds([]);
      toast.success(`Duplicated as ${copy.name}`);
    } catch {
      toast.error('Could not duplicate that cover.');
    }
  }, [savedDocuments]);

  const removeDocument = useCallback(async (id: string) => {
    const target = savedDocuments.find((item) => item.name && item.id === id);
    const confirmed = await confirmToast(
      target ? `Delete "${target.name}"?` : 'Delete this cover?',
      'This cannot be undone.',
      { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
    );
    if (!confirmed) return;
    try {
      await deleteCoverDocument(id);
      await refreshDocumentList();
      toast.success('Cover deleted');
    } catch {
      toast.error('Could not delete that cover.');
    }
  }, [refreshDocumentList, savedDocuments]);

  /* ── Clipboard ───────────────────────────────────────────────────────── */

  /**
   * Layers copied with Cmd+C.
   *
   * Deliberately in-app rather than on the system clipboard: an artwork layer
   * carries a waveform, a blend mode and a treatment, none of which survive a
   * round trip through text or an image. Copying a layer and pasting it should
   * give back the same layer, not a flattened picture of it.
   */
  const layerClipboard = useRef<ArtworkLayer[]>([]);

  const copySelection = useCallback(() => {
    const picked = document.layers.filter((layer) => selectedIds.includes(layer.id));
    if (picked.length === 0) return;
    layerClipboard.current = picked.map((layer) => structuredClone(layer));
    toast.success(picked.length === 1 ? 'Layer copied' : `${picked.length} layers copied`);
  }, [document.layers, selectedIds]);

  const pasteLayers = useCallback(() => {
    const copied = layerClipboard.current;
    if (copied.length === 0) return false;
    updateDocument((current) => {
      let next = current;
      const pasted: string[] = [];
      copied.forEach((layer, index) => {
        const clone = {
          ...structuredClone(layer),
          id: `${layer.type}-paste-${Date.now().toString(36)}-${index}`,
          name: `${layer.name} copy`,
          x: layer.x + 80,
          y: layer.y + 80,
          locked: false,
          zIndex: next.layers.reduce((max, item) => Math.max(max, item.zIndex), -1) + 1,
        } as ArtworkLayer;
        pasted.push(clone.id);
        next = addLayer(next, clone);
      });
      setSelectedIds(pasted);
      return next;
    });
    return true;
  }, [updateDocument]);

  /**
   * System paste.
   *
   * Screenshot to clipboard, Cmd+V, done — the fastest way anything gets into a
   * cover, and the one every other design tool supports. An image on the
   * clipboard always wins over copied layers, because if the producer just took
   * a screenshot that is unambiguously what they meant to paste.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const files = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (files.length > 0) {
        event.preventDefault();
        void addImageFiles(files);
        return;
      }
      if (pasteLayers()) event.preventDefault();
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImageFiles, pasteLayers]);

  /* ── Source loading ──────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    // Deferred rather than set synchronously: React flags a synchronous
    // setState inside an effect as a cascading render, and the whole codebase
    // uses queueMicrotask for these load-state transitions.
    if (sourceKind === 'empty' || sourceKind === 'upload') {
      queueMicrotask(() => {
        if (cancelled) return;
        setSourceOptions([]);
        setSelectedSourceId('');
        setSourceState('loaded');
        setSourceError(null);
      });
      return () => { cancelled = true; };
    }

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
    return () => { cancelled = true; };
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
    return () => { cancelled = true; };
  }, [attachTargetKind]);

  // Feed real analysed peaks into every waveform layer as the source changes.
  useEffect(() => {
    if (sourceKind !== 'track' || !selectedSourceId) return;
    // Not part of the undo stack: this is metadata arriving for the current
    // source, not an edit the producer made, so it must not become a step they
    // have to undo past.
    queueMicrotask(() => {
      setDocumentQuietly((current) => ({
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
  }, [selectedSourceId, selectedSourceOption?.bpm, selectedSourceOption?.durationSeconds, selectedTrackPeaks.peaks, selectedTrackPeaks.source, setDocumentQuietly, sourceKind]);

  function sourceFromSelection(): ArtworkSource {
    if (sourceKind === 'empty' || sourceKind === 'upload') return initialSource;
    const option = sourceOptions.find((item) => item.id === selectedSourceId);
    return {
      kind: sourceKind,
      id: option?.id,
      label: option?.label ?? `${sourceKind} source`,
      detail: option?.detail ?? [option?.bpm ? `${option.bpm} BPM` : null, option?.musicalKey].filter(Boolean).join(' / '),
    };
  }

  function applyDirection(id: CoverArtDirectionId) {
    setDirectionId(id);
    updateDocument(() => createArtworkDocument(id, sourceFromSelection()));
    setSelectedIds([]);
    toast.success(`Applied ${coverArtDirections.find((d) => d.id === id)?.name ?? 'direction'}`);
  }

  /* ── Export / upload / attach ────────────────────────────────────────── */

  function downloadBlob(content: BlobPart, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  /**
   * The SVG as it must leave the app: with the fonts it uses inlined.
   *
   * Rasterising loads the SVG through an <img>, which renders in an isolated
   * context with no access to the page's @font-face rules — so an export built
   * from the raw markup alone came out in a fallback system font while the
   * canvas showed Synkopy. Every path that hands the artwork to the outside
   * world goes through here.
   *
   * The markup is built HERE, on demand, rather than in a `useMemo` keyed on
   * the document. That memo recomputed the whole SVG string on every render —
   * and `patchLayers` writes a new document on every pointermove, so dragging a
   * layer serialised the entire artwork sixty times a second to produce a
   * string only this function ever read. Effects made that worse, since the
   * markup now carries a filter chain per layer too.
   */
  async function exportReadySvg(transparent = false) {
    return embedFontsInSvg(renderArtworkDocumentSvg(document, { transparent }), document);
  }

  /**
   * One download path for every format.
   *
   * SVG skips rasterisation entirely — it is already the thing being produced —
   * while the raster formats go through the canvas. Transparency is taken from
   * the RESOLVED settings rather than the raw ones, so a transparent JPEG never
   * reaches the renderer and cannot come back with a black plate.
   */
  async function downloadArtwork() {
    setExportState('exporting');
    try {
      const svg = await exportReadySvg(resolvedExport.transparent);
      if (resolvedExport.format === 'svg') {
        downloadBlob(svg, resolvedExport.filename, 'image/svg+xml');
      } else {
        const blob = await svgToRasterBlob(svg, {
          width: resolvedExport.width,
          height: resolvedExport.height,
          mimeType: resolvedExport.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
          quality: resolvedExport.quality,
        });
        downloadBlob(blob, resolvedExport.filename, resolvedExport.mimeType);
      }
      setExportState('idle');
      toast.success(`Exported ${resolvedExport.filename}`);
    } catch (error) {
      setExportState('failed');
      toast.error(error instanceof Error ? error.message : 'Export failed.');
      window.setTimeout(() => setExportState('idle'), 2200);
    }
  }

  async function uploadArtwork() {
    setUploadState('uploading');
    setUploadedUrl(null);
    try {
      const url = await uploadGeneratedCoverArt(await exportReadySvg(), svgFilename, {
        width: resolvedExport.width,
        height: resolvedExport.height,
        // A cover attached to a track is displayed on an opaque surface, so
        // it always uploads as a solid JPEG regardless of the download
        // settings — a transparent PNG cover would show the page through it.
        mimeType: 'image/jpeg',
        quality: 0.92,
      });
      setUploadedUrl(url);
      setUploadState('uploaded');
      toast.success('Artwork uploaded');
    } catch (error) {
      setUploadState('failed');
      toast.error(error instanceof Error ? error.message : 'Upload failed.');
      window.setTimeout(() => setUploadState('idle'), 2200);
    }
  }

  function attachTarget(): CoverAttachTarget {
    if (attachTargetKind === 'profile') return { kind: 'profile' };
    return { kind: attachTargetKind, id: attachTargetId };
  }

  async function attachArtwork() {
    setAttachState('attaching');
    setAttachError(null);
    try {
      await attachCoverUrl(attachTarget(), uploadedUrl ?? '');
      setAttachState('attached');
      toast.success('Cover attached');
      window.setTimeout(() => setAttachState('idle'), 2200);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not attach cover.';
      setAttachError(message);
      setAttachState('failed');
      toast.error(message);
      window.setTimeout(() => setAttachState('idle'), 2200);
    }
  }

  /* ── Zoom ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 1180);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Entering compact folds the panels away so the canvas gets the room; leaving
  // it brings them back. Only the panels' default changes — an explicit toggle
  // afterwards still wins until the layout mode changes again.
  useEffect(() => {
    setShowTools(!compact);
    setShowLayers(!compact);
  }, [compact]);

  const fitToWindow = useCallback(() => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    const padding = 80;
    setZoom(Math.max(0.04, Math.min(
      (box.width - padding) / document.width,
      (box.height - padding) / document.height,
    )));
  }, [document.height, document.width]);

  /**
   * Keep the artwork fitted to whatever room the canvas actually has.
   *
   * A plain effect measured the element before the grid had laid out and got a
   * near-zero box, which is how the artboard first rendered at 5% in a window
   * with room for 16%. A ResizeObserver waits for a real measurement — and it
   * keeps watching, because fitting only once left the artboard at a zoom for a
   * column that no longer exists as soon as a panel opened or the window
   * changed, so the cover overflowed and hid under the side panel. Once the
   * producer sets their own zoom, `userZoomed` stops this taking it back.
   */
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 40 || box.height < 40 || userZoomed.current) return;
      fitToWindow();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitToWindow]);

  /** Zoom set deliberately, which pins it against auto-fit. */
  const setZoomManually = useCallback((value: number) => {
    userZoomed.current = true;
    setZoom(value);
  }, []);

  /* ── Keyboard ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal keys from a field the producer is typing in.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) {
          // Ungroup every selected group. Selecting a group and a loose layer
          // and pressing ⇧⌘G should dissolve the group and leave the layer be,
          // rather than refusing because the selection is mixed.
          const groupIds = document.layers
            .filter((layer) => selectedIds.includes(layer.id) && layer.type === 'group')
            .map((layer) => layer.id);
          if (groupIds.length === 0) return;
          updateDocument((current) => groupIds.reduce(ungroupLayers, current));
          return;
        }
        if (selectedIds.length === 0) return;
        updateDocument((current) => {
          const result = groupLayers(current, selectedIds);
          // Select the new group, not its contents: the next drag should move
          // the group as a unit, which is the whole point of having made it.
          if (result.id) setSelectedIds([result.id]);
          return result.document;
        });
        return;
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (selectedIds.length === 0) return;
        updateDocument((current) => {
          const result = duplicateLayers(current, selectedIds);
          setSelectedIds(result.ids);
          return result.document;
        });
        return;
      }
      if (meta && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      // Cmd+V is intentionally NOT handled here: the browser's own paste event
      // fires right after and carries the clipboard contents, which keydown
      // cannot see. Handling it in both places would paste twice.
      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedIds(document.layers.filter((layer) => !layer.locked).map((layer) => layer.id));
        return;
      }

      // Zoom. Cmd+0 fits, Cmd+1 goes to actual pixels, Cmd +/- steps.
      if (meta && event.key === '0') {
        event.preventDefault();
        // Fit is a request to go back to automatic, so it clears the pin.
        userZoomed.current = false;
        fitToWindow();
        return;
      }
      if (meta && event.key === '1') {
        event.preventDefault();
        setZoomManually(1);
        return;
      }
      if (meta && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        userZoomed.current = true;
        setZoom((value) => Math.min(2, value * 1.25));
        return;
      }
      if (meta && event.key === '-') {
        event.preventDefault();
        userZoomed.current = true;
        setZoom((value) => Math.max(0.02, value / 1.25));
        return;
      }

      // Layer order, using the bracket keys every design tool uses.
      if (!meta && (event.key === '[' || event.key === ']') && selectedIds.length === 1) {
        event.preventDefault();
        const move: LayerReorder = event.shiftKey
          ? (event.key === ']' ? 'front' : 'back')
          : (event.key === ']' ? 'forward' : 'backward');
        updateDocument((current) => ({ ...current, layers: reorderLayer(current.layers, selectedIds[0], move) }));
        return;
      }

      // Single-key tools. Guarded on no modifier so they cannot collide with
      // browser shortcuts, and they are ignored while a text layer is open.
      if (!meta && !event.altKey && !editingId) {
        const key = event.key.toLowerCase();
        if (key === 'v') { setSelectedIds([]); return; }
        if (key === 't') { addText(); return; }
        // Must precede the plain-r rectangle shortcut, which returns early and
        // would otherwise swallow the shifted variant. Shift+R rather than R
        // (taken) or Cmd+R (reloads the page).
        if (key === 'r' && event.shiftKey) { setShowRulers((value) => !value); return; }
        if (key === 'r') { addShape('rect'); return; }
        if (key === 'o') { addShape('circle'); return; }
        if (key === 'g') { setShowGuides((value) => !value); return; }
        if (key === '?' || (key === '/' && event.shiftKey)) {
          event.preventDefault();
          setShowShortcuts((value) => !value);
          return;
        }
      }
      if (event.key === 'Escape') {
        setShowShortcuts(false);
        setEditingId(null);
        setSelectedIds([]);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length > 0) {
        event.preventDefault();
        updateDocument((current) => removeLayers(current, selectedIds));
        setSelectedIds([]);
        return;
      }

      const nudges: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      };
      const nudge = nudges[event.key];
      if (!nudge || selectedIds.length === 0) return;
      event.preventDefault();
      const step = event.shiftKey ? 40 : 8;
      updateDocument((current) => ({
        ...current,
        layers: current.layers.map((layer) => (
          selectedIds.includes(layer.id) && !layer.locked
            ? { ...layer, x: layer.x + nudge[0] * step, y: layer.y + nudge[1] * step }
            : layer
        )),
      }));
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addShape, addText, copySelection, document.layers, editingId, fitToWindow, redo, selectedIds, setZoomManually, undo, updateDocument]);

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

  /** Right-click actions, built from the current selection. */
  /** Selected layers that are groups — what Ungroup acts on. */
  function selectedGroupIds(): string[] {
    return document.layers
      .filter((layer) => selectedIds.includes(layer.id) && layer.type === 'group')
      .map((layer) => layer.id);
  }

  function contextMenuItems(): ContextMenuItem[] {
    const has = selectedIds.length > 0;
    const one = selectedIds.length === 1;
    const target = one ? document.layers.find((layer) => layer.id === selectedIds[0]) : null;
    const reorder = (move: LayerReorder) => updateDocument((current) => ({
      ...current, layers: reorderLayer(current.layers, selectedIds[0], move),
    }));

    return [
      { kind: 'action', label: 'Paste', shortcut: '⌘V', disabled: layerClipboard.current.length === 0, onSelect: () => { pasteLayers(); } },
      { kind: 'action', label: 'Copy', shortcut: '⌘C', disabled: !has, onSelect: copySelection },
      {
        kind: 'action',
        label: 'Duplicate',
        shortcut: '⌘D',
        disabled: !has,
        onSelect: () => updateDocument((current) => {
          const result = duplicateLayers(current, selectedIds);
          setSelectedIds(result.ids);
          return result.document;
        }),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        label: 'Group',
        shortcut: '⌘G',
        disabled: !has,
        onSelect: () => updateDocument((current) => {
          const result = groupLayers(current, selectedIds);
          if (result.id) setSelectedIds([result.id]);
          return result.document;
        }),
      },
      {
        kind: 'action',
        label: 'Ungroup',
        shortcut: 'Shift ⌘G',
        disabled: !selectedGroupIds().length,
        onSelect: () => updateDocument((current) => selectedGroupIds().reduce(ungroupLayers, current)),
      },
      { kind: 'separator' },
      { kind: 'action', label: 'Bring to front', shortcut: 'Shift ]', disabled: !one, onSelect: () => reorder('front') },
      { kind: 'action', label: 'Send to back', shortcut: 'Shift [', disabled: !one, onSelect: () => reorder('back') },
      { kind: 'separator' },
      {
        kind: 'action',
        label: target?.locked ? 'Unlock' : 'Lock',
        disabled: !one,
        onSelect: () => patchSelected({ locked: !target?.locked }),
      },
      {
        kind: 'action',
        label: target?.visible === false ? 'Show' : 'Hide',
        disabled: !one,
        onSelect: () => patchSelected({ visible: target?.visible === false }),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        label: 'Delete',
        shortcut: 'Del',
        danger: true,
        disabled: !has,
        onSelect: () => {
          updateDocument((current) => removeLayers(current, selectedIds));
          setSelectedIds([]);
        },
      },
    ];
  }

  const canAudition = sourceKind === 'track' && Boolean(selectedSourceId);
  const auditioning = previewingCurrentTrack && playerIsPlaying;

  return (
    // Height is the viewport minus the dashboard shell's own chrome: the group
    // layout wraps every page in `main.pt-14.pb-28`, i.e. 3.5rem of TopBar and
    // 7rem of PlayerBar. This used to subtract a guessed 100px, which was 68px
    // short — so the studio overflowed the viewport, the PAGE scrolled instead
    // of the panels, and the bottom of the inspector was unreachable. If either
    // padding in `(dashboard)/layout.tsx` changes, this has to change with it.
    // The contextual toolbar is a THIRD fixed row (2.5rem) rather than extra
    // height on the studio: the outer height is pinned to the dashboard shell,
    // so a new row has to come out of the canvas's share, not out of the
    // viewport. Growing the container instead is what made the page scroll
    // rather than the panels the last time this layout was touched.
    <div ref={rootRef} className="relative grid h-[calc(100vh-10.5rem)] grid-rows-[3.25rem_2.5rem_minmax(0,1fr)] overflow-hidden bg-[#090907] text-white/90">
      {showShortcuts ? <ShortcutSheet onClose={() => setShowShortcuts(false)} /> : null}
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={contextMenuItems()} onClose={() => setMenu(null)} />
      ) : null}
      {/* Top bar */}
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-white/10 px-3">
        <div className="flex min-w-0 shrink items-center gap-2 overflow-hidden">
          {/* Dropped first when space runs out — the document name matters more. */}
          <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 xl:inline">
            {surface === 'dev-lab' ? 'Design lab' : 'Cover art'}
          </span>
          <input
            value={document.name}
            aria-label="Artwork name"
            onChange={(event) => setDocumentQuietly((current) => ({ ...current, name: event.target.value }))}
            className="w-full min-w-0 max-w-64 border border-transparent bg-transparent px-1.5 py-1 text-sm text-white/90 outline-none hover:border-white/10 focus:border-white/40"
          />
          {/* Autosave is silent, so it needs to be visible somewhere or the
              producer has no reason to trust that closing the tab is safe. */}
          <span
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40"
          >
            {persistState === 'saving' ? <><Loader2 size={11} className="animate-spin" /> Saving</> : null}
            {persistState === 'saved' ? <><Check size={11} /> Saved</> : null}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {canAudition ? (
            <>
              <button
                type="button"
                onClick={auditionSource}
                aria-pressed={auditioning}
                aria-label={auditioning ? 'Pause source track' : 'Play source track'}
                title="Play the source so the artwork reacts to it"
                className={cn('grid h-7 w-7 place-items-center transition-colors',
                  auditioning ? 'text-white' : 'text-white/40 hover:text-white/90')}
              >
                {auditioning ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <span aria-hidden className="relative h-[3px] w-10 overflow-hidden bg-white/10">
                <span className="absolute inset-y-0 left-0 bg-white/80" style={{ width: `${Math.round(reactive.level * 100)}%` }} />
              </span>
              <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />
            </>
          ) : null}

          <button
            type="button" onClick={undo} disabled={history.length === 0}
            aria-label="Undo" title="Undo (⌘Z)"
            className="grid h-7 w-7 place-items-center text-white/40 transition-colors hover:text-white/90 disabled:opacity-30"
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button" onClick={redo} disabled={future.length === 0}
            aria-label="Redo" title="Redo (⇧⌘Z)"
            className="grid h-7 w-7 place-items-center text-white/40 transition-colors hover:text-white/90 disabled:opacity-30"
          >
            <Redo2 size={13} />
          </button>
          <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />

          <button
            type="button" onClick={() => setShowGuides((value) => !value)}
            aria-pressed={showGuides} aria-label="Toggle guides" title="Guides"
            className={cn('grid h-7 w-7 place-items-center transition-colors',
              showGuides ? 'text-white' : 'text-white/40 hover:text-white/90')}
          >
            <Grid3x3 size={13} />
          </button>
          <button
            type="button" onClick={() => setShowRulers((value) => !value)}
            aria-pressed={showRulers} aria-label="Toggle rulers" title="Rulers (Shift R) — drag from a ruler to place a guide"
            className={cn('grid h-7 w-7 place-items-center transition-colors',
              showRulers ? 'text-white' : 'text-white/40 hover:text-white/90')}
          >
            <Ruler size={13} />
          </button>
          <button
            type="button"
            onClick={() => { userZoomed.current = false; fitToWindow(); }}
            aria-label="Fit to window" title="Fit to window"
            className="grid h-7 w-7 place-items-center text-white/40 transition-colors hover:text-white/90"
          >
            <Maximize2 size={13} />
          </button>
          <span className="hidden w-12 text-right font-mono text-[10px] tabular-nums text-white/40 sm:inline">
            {Math.round(zoom * 100)}%
          </span>
          <input
            type="range" min={0.04} max={0.6} step={0.01} value={zoom}
            aria-label="Zoom"
            onChange={(event) => setZoomManually(Number(event.target.value))}
            className="hidden h-1 w-24 cursor-pointer appearance-none bg-white/10 accent-white lg:inline-block"
          />
          <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />
          <button
            type="button" onClick={() => setShowTools((value) => !value)}
            aria-pressed={showTools} aria-label="Toggle tool panel" title="Tools"
            className={cn('grid h-7 w-7 place-items-center transition-colors',
              showTools ? 'text-white' : 'text-white/40 hover:text-white/90')}
          >
            <PanelLeft size={13} />
          </button>
          <button
            type="button" onClick={() => setShowLayers((value) => !value)}
            aria-pressed={showLayers} aria-label="Toggle layers panel" title="Layers"
            className={cn('grid h-7 w-7 place-items-center transition-colors',
              showLayers ? 'text-white' : 'text-white/40 hover:text-white/90')}
          >
            <LayersIcon size={13} />
          </button>
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="grid h-7 w-7 place-items-center font-mono text-[11px] text-white/40 transition-colors hover:text-white/90"
          >
            ?
          </button>
          <StudioButton variant="accent" onClick={() => { void downloadArtwork(); }} disabled={exportState === 'exporting'}>
            <Download size={12} /> {exportState === 'exporting' ? 'Rendering…' : 'Export'}
          </StudioButton>
        </div>
      </header>

      {/* Selection-driven controls. Sits between the global header and the work
          area because that is where it is glanced at: the header is about the
          document, this is about what you are holding. */}
      <ContextualToolbar
        selected={document.layers.filter((layer) => selectedIds.includes(layer.id))}
        onPatch={patchSelected}
        onAlign={(alignment) => updateDocument((current) => alignLayers(current, selectedIds, alignment))}
        onDistribute={(axis) => updateDocument((current) => distributeLayers(current, selectedIds, axis))}
        onRemoveSelected={() => {
          updateDocument((current) => removeLayers(current, selectedIds));
          setSelectedIds([]);
        }}
      />

      {/* Column template. In compact the panels leave the grid entirely and
          float over the canvas instead, so the artboard always keeps the full
          width rather than being squeezed to a sliver behind them. */}
      <div className={cn(
        'relative grid min-h-0',
        compact && 'grid-cols-[3.5rem_minmax(0,1fr)]',
        !compact && showTools && showLayers && 'grid-cols-[3.5rem_17rem_minmax(0,1fr)_17rem]',
        !compact && showTools && !showLayers && 'grid-cols-[3.5rem_17rem_minmax(0,1fr)]',
        !compact && !showTools && showLayers && 'grid-cols-[3.5rem_minmax(0,1fr)_17rem]',
        !compact && !showTools && !showLayers && 'grid-cols-[3.5rem_minmax(0,1fr)]',
      )}>
        {/* Tool rail */}
        <nav aria-label="Studio tools" className="flex flex-col items-center gap-1 border-r border-white/10 bg-[#0D0D0A] py-2">
          {toolTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                // Picking a tool opens the panel — in compact the panel is
                // folded away by default, so setting the tab alone changed
                // nothing visible and the rail looked dead. Pressing the tool
                // you are already on closes it again.
                if (tab === item.id && showTools) setShowTools(false);
                else { setTab(item.id); setShowTools(true); }
              }}
              aria-pressed={tab === item.id && showTools}
              aria-expanded={tab === item.id && showTools}
              title={item.label}
              className={cn(
                'grid h-11 w-11 place-content-center gap-1 text-[9px] uppercase tracking-[0.1em] transition-colors',
                tab === item.id && showTools ? 'bg-white/[0.10] text-white' : 'text-white/40 hover:text-white/90',
              )}
            >
              <item.icon size={15} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Tool panel */}
        <aside
          hidden={!showTools}
          className={cn(
            'min-h-0 overflow-y-auto border-r border-white/10 bg-[#0D0D0A]',
            compact && 'absolute inset-y-0 left-14 z-30 w-[17rem] shadow-[12px_0_32px_rgba(0,0,0,0.5)]',
          )}
        >
          {tab === 'documents' ? (
            <DocumentsPanel
              documents={savedDocuments}
              activeId={document.id}
              onNew={newDocument}
              onOpen={(id) => { void openDocument(id); }}
              onDuplicate={(id) => { void duplicateDocument(id); }}
              onDelete={(id) => { void removeDocument(id); }}
            />
          ) : null}

          {tab === 'source' ? (
            <SourcePanel
              sourceKind={sourceKind}
              sourceOptions={sourceOptions}
              sourceState={sourceState}
              sourceError={sourceError}
              selectedSourceId={selectedSourceId}
              directionId={directionId}
              onSourceKind={setSourceKind}
              onSourceId={setSelectedSourceId}
              onApplyDirection={applyDirection}
            />
          ) : null}

          {tab === 'add' ? (
            <AddPanel
              onAddImages={(files) => { void addImageFiles(files); }}
              onAddText={addText}
              onAddShape={addShape}
              onAddTexture={addTexture}
              onAddWaveform={addWaveform}
            />
          ) : null}

          {tab === 'collage' ? (
            <CollagePanel
              imageCount={imageLayers.length}
              selectedImageCount={selectedImageLayers.length}
              layout={collageLayout}
              onLayout={setCollageLayout}
              onArrange={() => arrangeCollage(imageLayers)}
              onArrangeSelected={() => arrangeCollage(selectedImageLayers)}
              onAddImages={(files) => { void addImageFiles(files); }}
            />
          ) : null}

          {tab === 'ai' ? (
            <div className="p-4">
              <CoverGeneratorPanel
                palette={document.palette}
                styleName={coverArtDirections.find((d) => d.id === directionId)?.name ?? ''}
                onGenerated={handleGeneratedImage}
              />
            </div>
          ) : null}

          {tab === 'export' ? (
            <ExportPanel
              document={document}
              settings={exportSettings}
              exportState={exportState}
              uploadState={uploadState}
              attachState={attachState}
              attachError={attachError}
              uploadedUrl={uploadedUrl}
              attachTargetKind={attachTargetKind}
              attachTargetId={attachTargetId}
              attachOptions={attachOptions}
              onSettings={(patch) => setExportSettings((current) => ({ ...current, ...patch }))}
              onDownload={() => { void downloadArtwork(); }}
              onUpload={uploadArtwork}
              onAttachTargetKind={setAttachTargetKind}
              onAttachTargetId={setAttachTargetId}
              onAttach={attachArtwork}
            />
          ) : null}
        </aside>

        {/* Canvas */}
        <div ref={viewportRef} className="min-h-0">
          <StudioCanvas
            document={document}
            zoom={zoom}
            selectedIds={selectedIds}
            editingId={editingId}
            showGuides={showGuides}
            showRulers={showRulers}
            reactive={reactive}
            onGuidesChange={(guides, commit) => {
              // Same shape as a layer drag: intermediate positions mutate the
              // document without touching history, and the release commits one
              // entry — otherwise dragging a guide across the artboard would
              // fill the undo stack with a hundred near-identical steps.
              if (commit) updateDocument((current) => ({ ...current, guides }));
              else setDocumentQuietly((current) => ({ ...current, guides }));
            }}
            onSelect={setSelectedIds}
            onPatchLayers={patchLayers}
            onEditText={setEditingId}
            onDropFiles={(files, at) => { void addImageFiles(files, at); }}
            onZoom={setZoomManually}
            onContextMenu={(at) => setMenu(at)}
          />
        </div>

        {/* Layers + inspector */}
        {showLayers ? (
          <aside className={cn(
            'grid min-h-0 grid-rows-[minmax(0,14rem)_minmax(0,1fr)] border-l border-white/10 bg-[#0D0D0A]',
            compact && 'absolute inset-y-0 right-0 z-30 w-[17rem] shadow-[-12px_0_32px_rgba(0,0,0,0.5)]',
          )}>
            <div className="min-h-0 overflow-y-auto border-b border-white/10 p-2">
              <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Layers</p>
              <LayersPanel
                document={document}
                selectedIds={selectedIds}
                onSelect={setSelectedIds}
                onReorder={(id, move: LayerReorder) => updateDocument((current) => ({
                  ...current, layers: reorderLayer(current.layers, id, move),
                }))}
                onToggle={(id, patch) => {
                  // Folding a group shut is a way of LOOKING at the stack, not
                  // a change to the artwork — putting it in the undo history
                  // would mean ⌘Z sometimes just unfolds a group instead of
                  // taking back the edit the producer meant to undo.
                  const apply = (current: ArtworkDocument) => ({
                    ...current,
                    layers: current.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
                  });
                  const viewOnly = Object.keys(patch).every((key) => key === 'collapsed');
                  if (viewOnly) setDocumentQuietly(apply);
                  else updateDocument(apply);
                }}
                onRename={(id, name) => updateDocument((current) => ({
                  ...current,
                  layers: current.layers.map((layer) => (layer.id === id ? { ...layer, name } : layer)),
                }))}
                onDuplicate={(id) => updateDocument((current) => {
                  const result = duplicateLayers(current, [id]);
                  setSelectedIds(result.ids);
                  return result.document;
                })}
                onDelete={(id) => {
                  updateDocument((current) => removeLayers(current, [id]));
                  setSelectedIds((ids) => ids.filter((item) => item !== id));
                }}
              />
            </div>
            <InspectorPanel
              document={document}
              selectedIds={selectedIds}
              onPatch={patchSelected}
              onPatchDocument={(patch) => updateDocument((current) => ({ ...current, ...patch }))}
              onAlign={(alignment: LayerAlignment) => updateDocument((current) => alignLayers(current, selectedIds, alignment))}
              onDistribute={(axis) => updateDocument((current) => distributeLayers(current, selectedIds, axis))}
              // Through `updateDocument`, so a reformat is one undo step —
              // resizing the board can move every layer at once and is exactly
              // the kind of change someone tries and then wants to take back.
              onResizeArtboard={(width, height, mode) => updateDocument(
                (current) => resizeArtboard(current, width, height, mode),
              )}
              // One undo step, and scoped to the selection when there is one —
              // trying a mood on the title before committing the whole cover is
              // how a designer actually works.
              onRestyle={(moodId) => updateDocument(
                (current) => restyleDocument(current, moodId, selectedIds),
              )}
              onRemoveSelected={() => {
                updateDocument((current) => removeLayers(current, selectedIds));
                setSelectedIds([]);
              }}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
