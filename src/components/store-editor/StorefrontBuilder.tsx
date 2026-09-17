'use client';

/**
 * The storefront builder.
 *
 * Replaces filling in a form with arranging the actual page. The canvas renders
 * the producer's real storefront components with their real data at a real
 * device width, so what is arranged here is what buyers get.
 *
 * Three things are deliberately borrowed from the Cover Art Studio next door,
 * because they were solved there and the two editors should feel like one
 * product:
 *
 *   - Undo history is ONE piece of state (`{ doc, past, future }`). It was
 *     three `useState`s there, and because React may run an updater twice the
 *     stacks desynced and redo silently did nothing.
 *   - Autosave is debounced and gated on a dirty flag, so opening the editor
 *     never writes, and a burst of slider drags is one save.
 *   - Panels collapse below a width threshold measured on the element rather
 *     than the window, so the canvas keeps its space inside the dashboard
 *     shell whatever else is on screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check, Loader2, Monitor, Plus, Redo2, Smartphone, Tablet, Trash2, Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/useToast';
import {
  addSection, breakpointWidths, clearSectionOverride, createSection,
  duplicateSection, moveSection, normalizeLayout, removeSection, reorderSection,
  resolveSection, setSectionSetting, storeBreakpoints, updateSection,
  type SectionSettings, type StoreBreakpoint, type StoreLayout, type StoreSectionKind,
} from '@/lib/store-editor/layout';
import { SectionRenderer, type StorefrontData } from './SectionRenderer';
import { moveCanvasBlock } from '@/lib/store-editor/canvas-blocks';
import { SectionsPanel } from './SectionsPanel';
import { SectionInspector } from './SectionInspector';
import { ThemePanel } from './ThemePanel';
import { HistoryPanel } from './HistoryPanel';
import { recordSnapshot } from '@/lib/store-editor/history';
import {
  deleteSavedSection, listSavedSections, loadSavedSection, saveSection,
  type SavedSectionSummary,
} from '@/lib/store-editor/library';
import {
  applySectionStyle, copySectionStyle, describeStyle, styleAppliesTo,
  type SectionStyle,
} from '@/lib/store-editor/section-style';

type BuilderState = {
  doc: StoreLayout;
  past: StoreLayout[];
  future: StoreLayout[];
};

const HISTORY_LIMIT = 50;
const AUTOSAVE_MS = 900;

const deviceIcons: Record<StoreBreakpoint, React.ComponentType<{ size?: number }>> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

/** Sections a producer can add. The data-backed ones already exist by default. */
const addableKinds: StoreSectionKind[] = ['text', 'image', 'video', 'links', 'canvas'];

export function StorefrontBuilder({
  initialLayout,
  data,
  onPersist,
}: {
  initialLayout: unknown;
  data: StorefrontData;
  onPersist: (layout: StoreLayout) => Promise<void>;
}) {
  const [editor, setEditor] = useState<BuilderState>(() => ({
    doc: normalizeLayout(initialLayout),
    past: [],
    future: [],
  }));
  const layout = editor.doc;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [breakpoint, setBreakpoint] = useState<StoreBreakpoint>('desktop');
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [panel, setPanel] = useState<'sections' | 'theme' | 'history'>('sections');
  /** Bumped after a snapshot lands, so an open history list picks it up. */
  const [historyKey, setHistoryKey] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [compact, setCompact] = useState(false);
  const [adding, setAdding] = useState(false);
  /** Selected free-form block inside a `canvas` section, if any. */
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  /** Copied presentation, waiting to be pasted onto another section. */
  const [clipboardStyle, setClipboardStyle] = useState<SectionStyle | null>(null);
  const [saved, setSaved] = useState<SavedSectionSummary[]>([]);

  const refreshLibrary = useCallback(() => {
    // Failures are swallowed: the library is a convenience, and IndexedDB is
    // denied outright in some private-browsing modes.
    listSavedSections().then(setSaved).catch(() => setSaved([]));
  }, []);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);

  const selected = layout.sections.find((section) => section.id === selectedId) ?? null;

  /* ── History ──────────────────────────────────────────────────────────── */

  /**
   * Mark the document dirty and show the saving indicator.
   *
   * Called from the event handlers that actually change something rather than
   * from the autosave effect. Setting state inside an effect body schedules a
   * second render pass for every edit — on a slider drag that is a cascading
   * re-render per pointermove, which is exactly the kind of waste that makes an
   * editor feel heavy.
   */
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState('saving');
  }, []);

  const commit = useCallback((mutate: (current: StoreLayout) => StoreLayout) => {
    markDirty();
    setEditor((state) => {
      const next = mutate(state.doc);
      if (next === state.doc) return state;
      return {
        doc: { ...next, updatedAt: new Date().toISOString() },
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
  }, [markDirty]);

  const undo = useCallback(() => {
    markDirty();
    setEditor((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, [markDirty]);

  const redo = useCallback(() => {
    markDirty();
    setEditor((state) => {
      if (state.future.length === 0) return state;
      return {
        doc: state.future[0],
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
      };
    });
  }, [markDirty]);

  /* ── Autosave ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      onPersist(layout)
        .then(async () => {
          setSaveState('saved');
          // Snapshot AFTER the server accepts it, so history never offers to
          // restore a version that was never actually saved. `recordSnapshot`
          // decides for itself whether this one is worth keeping, and swallows
          // its own failures — history is an aid, not part of the save path.
          if (await recordSnapshot(layout)) setHistoryKey((key) => key + 1);
        })
        .catch((error: unknown) => {
          setSaveState('idle');
          toast.error(error instanceof Error ? error.message : 'Could not save the layout.');
        });
    }, AUTOSAVE_MS);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [layout, onPersist]);

  /* ── Layout measurement ───────────────────────────────────────────────── */

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    // Measured on the element, not the window: the dashboard shell and the
    // panels both sit inside the viewport, so window width says nothing useful
    // about how much room the canvas actually has.
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 1180);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * Fit the device frame to the stage.
   *
   * Keeps watching rather than measuring once: a one-shot read races the grid
   * and returns a near-zero box on first paint, which is how a canvas ends up
   * scaled to nothing until you touch something.
   */
  useEffect(() => {
    const element = stageRef.current;
    if (!element || !autoFit) return;
    const observer = new ResizeObserver(([entry]) => {
      const available = entry.contentRect.width - 64;
      const target = breakpointWidths[breakpoint];
      setZoom(Math.min(1, Math.max(0.25, available / target)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [breakpoint, autoFit]);

  /* ── Shortcuts ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal a key from a field the producer is typing in.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 's') {
        // The layout autosaves; intercepting Save stops the browser's
        // "save this page" dialog from appearing over the editor.
        event.preventDefault();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd' && selectedId) {
        event.preventDefault();
        commit((current) => duplicateSection(current, selectedId).layout);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        commit((current) => removeSection(current, selectedId));
        setSelectedId(null);
        return;
      }
      if (event.key === '1') setBreakpoint('desktop');
      if (event.key === '2') setBreakpoint('tablet');
      if (event.key === '3') setBreakpoint('mobile');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, commit, selectedId]);

  /* ── Section operations ───────────────────────────────────────────────── */

  const setSetting = <K extends keyof SectionSettings>(key: K, value: SectionSettings[K]) => {
    if (!selectedId) return;
    commit((current) => updateSection(current, selectedId, (section) => setSectionSetting(section, breakpoint, key, value)));
  };

  const clearOverride = (key: keyof SectionSettings) => {
    if (!selectedId) return;
    commit((current) => updateSection(current, selectedId, (section) => clearSectionOverride(section, breakpoint, key)));
  };

  const width = breakpointWidths[breakpoint];

  return (
    <div
      ref={rootRef}
      className="relative grid h-[calc(100vh-10.5rem)] grid-rows-[3rem_minmax(0,1fr)] overflow-hidden border border-white/10 bg-[#090907]"
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <header className="flex min-w-0 items-center gap-2 border-b border-white/10 px-3">
        <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 lg:inline">
          Storefront
        </span>

        <span className="mx-1 h-5 w-px shrink-0 bg-white/10" />

        {/* Device switch. Numbered shortcuts are in the titles rather than a
            legend, so they are discoverable at the point of use. */}
        <div className="flex shrink-0 items-center gap-1">
          {storeBreakpoints.map((point, index) => {
            const Icon = deviceIcons[point];
            return (
              <button
                key={point}
                type="button"
                aria-pressed={breakpoint === point}
                title={`${point} · ${breakpointWidths[point]}px (${index + 1})`}
                onClick={() => setBreakpoint(point)}
                className={cn(
                  'flex h-7 items-center gap-1.5 border px-2 text-[11px] capitalize transition-colors',
                  breakpoint === point
                    ? 'border-white/40 bg-white/[0.12] text-white/90'
                    : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/90',
                )}
              >
                <Icon size={12} />
                <span className="hidden sm:inline">{point}</span>
              </button>
            );
          })}
        </div>

        <span className="mx-1 h-5 w-px shrink-0 bg-white/10" />

        <button
          type="button"
          onClick={undo}
          disabled={editor.past.length === 0}
          title="Undo (⌘Z)"
          aria-label="Undo"
          className="grid size-7 shrink-0 place-items-center text-white/60 transition-colors hover:text-white/90 disabled:text-white/15"
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={editor.future.length === 0}
          title="Redo (Shift ⌘Z)"
          aria-label="Redo"
          className="grid size-7 shrink-0 place-items-center text-white/60 transition-colors hover:text-white/90 disabled:text-white/15"
        >
          <Redo2 size={13} />
        </button>

        <span className="mx-1 h-5 w-px shrink-0 bg-white/10" />

        <label className="flex shrink-0 items-center gap-1.5" title="Zoom">
          <span className="font-mono text-[10px] tabular-nums text-white/40">{Math.round(zoom * 100)}%</span>
          <input
            type="range"
            min={25}
            max={100}
            value={Math.round(zoom * 100)}
            aria-label="Zoom"
            onChange={(event) => { setAutoFit(false); setZoom(Number(event.target.value) / 100); }}
            className="h-1 w-20 cursor-pointer appearance-none bg-white/10 accent-white"
          />
        </label>
        <button
          type="button"
          onClick={() => setAutoFit(true)}
          title="Fit to window"
          className={cn(
            'shrink-0 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors',
            autoFit ? 'border-white/40 text-white/90' : 'border-white/10 text-white/50 hover:border-white/25',
          )}
        >
          Fit
        </button>

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {/* Announced: the save state changes on its own, so a screen
              reader user gets no other signal that work was persisted. */}
          <span
            aria-live="polite"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/30"
          >
            {saveState === 'saving' ? <><Loader2 size={11} className="animate-spin" /> Saving</> : null}
            {saveState === 'saved' ? <><Check size={11} /> Saved</> : null}
          </span>
        </span>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className={cn(
        'relative grid min-h-0',
        compact ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[16rem_minmax(0,1fr)_18rem]',
      )}
      >
        {/* Left: sections / theme */}
        <aside className={cn(
          'flex min-h-0 flex-col border-r border-white/10 bg-[#0D0D0A]',
          compact && 'absolute inset-y-0 left-0 z-30 w-64 border-r shadow-[0_0_40px_rgba(0,0,0,0.6)]',
        )}
        >
          <div className="flex shrink-0 border-b border-white/10">
            {(['sections', 'theme', 'history'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={panel === tab}
                onClick={() => setPanel(tab)}
                className={cn(
                  'flex-1 py-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
                  panel === tab ? 'bg-white/[0.06] text-white/90' : 'text-white/40 hover:text-white/70',
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {panel === 'sections' ? (
            <>
              <SectionsPanel
                layout={layout}
                selectedId={selectedId}
                breakpoint={breakpoint}
                onSelect={setSelectedId}
                onReorder={(id, toIndex) => commit((current) => reorderSection(current, id, toIndex))}
                onMove={(id, delta) => commit((current) => moveSection(current, id, delta))}
                onToggle={(id, patch) => commit((current) => updateSection(current, id, (section) => {
                  if (patch.locked !== undefined) return { ...section, locked: patch.locked };
                  // Visibility is per breakpoint, like every other setting —
                  // hiding a section on mobile must not hide it on desktop.
                  if (patch.visible !== undefined) return setSectionSetting(section, breakpoint, 'visible', patch.visible);
                  return section;
                }))}
                onDuplicate={(id) => commit((current) => duplicateSection(current, id).layout)}
                onDelete={(id) => {
                  commit((current) => removeSection(current, id));
                  setSelectedId((current) => (current === id ? null : current));
                }}
                onRename={(id, name) => commit((current) => updateSection(current, id, (section) => ({
                  ...section, name: name.trim() || section.name,
                })))}
              />

              <div className="relative shrink-0 border-t border-white/10 p-2">
                <button
                  type="button"
                  onClick={() => setAdding((open) => !open)}
                  className="flex h-8 w-full items-center justify-center gap-1.5 border border-white/10 text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
                >
                  <Plus size={12} /> Add section
                </button>
                {adding ? (
                  <div className="absolute bottom-12 left-2 right-2 z-40 max-h-80 overflow-y-auto border border-white/20 bg-[#0D0D0A] shadow-[0_0_40px_rgba(0,0,0,0.7)]">
                    {addableKinds.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => {
                          const section = createSection(kind);
                          commit((current) => addSection(current, section));
                          setSelectedId(section.id);
                          setAdding(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-[11px] capitalize text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white/90"
                      >
                        {kind}
                      </button>
                    ))}

                    {/* The producer's own saved blocks, alongside the built-in
                        kinds — reusing one should be no harder than adding a
                        blank section, because it is the same intention. */}
                    {saved.length > 0 ? (
                      <>
                        <p className="border-t border-white/10 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
                          Saved
                        </p>
                        {saved.map((item) => (
                          <span key={item.id} className="group flex items-center">
                            <button
                              type="button"
                              onClick={async () => {
                                const section = await loadSavedSection(item.id);
                                if (!section) {
                                  toast.error('That saved section could not be read.');
                                  return;
                                }
                                commit((current) => addSection(current, section));
                                setSelectedId(section.id);
                                setAdding(false);
                              }}
                              className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[11px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white/90"
                            >
                              {item.name}
                              <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/25">
                                {item.kind}
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete saved section ${item.name}`}
                              title="Delete from library"
                              onClick={async () => {
                                await deleteSavedSection(item.id);
                                refreshLibrary();
                              }}
                              className="grid size-6 shrink-0 place-items-center text-white/25 transition-colors hover:text-white/90"
                            >
                              <Trash2 size={11} />
                            </button>
                          </span>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : panel === 'theme' ? (
            <ThemePanel
              theme={layout.theme}
              onChange={(patch) => commit((current) => ({ ...current, theme: { ...current.theme, ...patch } }))}
            />
          ) : (
            <HistoryPanel
              refreshKey={historyKey}
              // Through `commit`, so a restore lands on the undo stack like any
              // other edit and an unwanted one is a single ⌘Z away.
              onRestore={(restored) => commit(() => restored)}
            />
          )}
        </aside>

        {/* Centre: the canvas */}
        <div
          ref={stageRef}
          onClick={() => setSelectedId(null)}
          className="min-h-0 overflow-auto bg-[#050504] p-8"
          style={{
            // A faint grid reads as "surface you are composing on" without
            // competing with the artwork sitting on it.
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),'
              + 'linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        >
          <div className="mx-auto" style={{ width: width * zoom }}>
            <p className="mb-2 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-white/25">
              {breakpoint} · {width}px
            </p>
            {/* The frame is the real device width; zoom is a visual scale on
                top, so every media query inside resolves as it would on the
                actual device rather than at whatever the panel happens to be. */}
            <div
              className="origin-top border border-white/15 bg-[#090907]"
              style={{ width, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            >
              {layout.sections.map((section) => {
                const settings = resolveSection(section, breakpoint);
                const isSelected = section.id === selectedId;
                return (
                  <div
                    key={section.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={`${section.name} section`}
                    aria-pressed={isSelected}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (section.id !== selectedId) setSelectedBlockId(null);
                      setSelectedId(section.id);
                    }}
                    className={cn(
                      'relative outline-none transition-shadow',
                      isSelected ? 'ring-1 ring-inset ring-white/60' : 'hover:ring-1 hover:ring-inset hover:ring-white/20',
                      !settings.visible && 'opacity-30',
                    )}
                  >
                    {/* A hidden section stays on the canvas, greyed and
                        labelled, rather than vanishing — otherwise hiding
                        something on mobile makes it unselectable to unhide. */}
                    {!settings.visible ? (
                      <span className="pointer-events-none absolute left-2 top-2 z-10 border border-white/20 bg-[#090907] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/50">
                        Hidden on {breakpoint}
                      </span>
                    ) : null}
                    {isSelected ? (
                      <span className="pointer-events-none absolute right-0 top-0 z-10 bg-white/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-black">
                        {section.name}
                      </span>
                    ) : null}
                    <div className={cn(!settings.visible && 'pointer-events-none')}>
                      <SectionRenderer
                        section={section}
                        breakpoint={breakpoint}
                        theme={layout.theme}
                        data={data}
                        editBlocks={section.kind === 'canvas' ? {
                          selectedId: selectedBlockId,
                          onSelect: setSelectedBlockId,
                          onMove: (blockId, x, y, commitNow) => {
                            const apply = (current: StoreLayout) => updateSection(
                              current,
                              section.id,
                              (item) => ({
                                ...item,
                                content: {
                                  ...(item.content ?? {}),
                                  blocks: moveCanvasBlock(item.content?.blocks ?? [], blockId, x, y),
                                },
                              }),
                            );
                            // One history entry per drag, not one per
                            // pointermove — the same rule the cover art canvas
                            // follows for layer drags.
                            if (commitNow) commit(apply);
                            else { markDirty(); setEditor((state) => ({ ...state, doc: apply(state.doc) })); }
                          },
                        } : undefined}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: inspector */}
        <aside className={cn(
          'min-h-0 border-l border-white/10 bg-[#0D0D0A]',
          compact && 'absolute inset-y-0 right-0 z-30 w-72 shadow-[0_0_40px_rgba(0,0,0,0.6)]',
        )}
        >
          <SectionInspector
            section={selected}
            breakpoint={breakpoint}
            onSet={setSetting}
            onClear={clearOverride}
            selectedBlockId={selectedBlockId}
            onSelectBlock={setSelectedBlockId}
            clipboardStyle={clipboardStyle}
            onCopyStyle={() => {
              if (!selected) return;
              setClipboardStyle(copySectionStyle(selected));
              toast.success(`Copied the style from ${selected.name}.`);
            }}
            onPasteStyle={() => {
              if (!selected || !clipboardStyle) return;
              commit((current) => updateSection(
                current, selected.id, (item) => applySectionStyle(item, clipboardStyle),
              ));
            }}
            canPasteStyle={Boolean(selected && clipboardStyle && styleAppliesTo(selected, clipboardStyle))}
            pasteStyleLabel={clipboardStyle ? describeStyle(clipboardStyle) : ''}
            onSaveToLibrary={async () => {
              if (!selected) return;
              try {
                const name = await saveSection(selected);
                refreshLibrary();
                toast.success(`Saved "${name}" — reuse it from Add section.`);
              } catch {
                toast.error('Could not save that section.');
              }
            }}
            onBlocks={(blocks) => {
              if (!selectedId) return;
              commit((current) => updateSection(current, selectedId, (item) => ({
                ...item,
                content: { ...(item.content ?? {}), blocks },
              })));
            }}
            onContent={(patch) => {
              if (!selectedId) return;
              commit((current) => updateSection(current, selectedId, (section) => ({
                ...section,
                content: { ...(section.content ?? {}), ...patch },
              })));
            }}
          />
        </aside>
      </div>
    </div>
  );
}

