'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Trash2, RotateCcw, Play } from 'lucide-react';
import { audioSrc } from '@/lib/audio/url';
import { cn } from '@/lib/utils';

interface Props {
  /** Track id — keys the persisted arrangement (one per user per track). */
  trackId: string;
  /** Active studio track. Used as the audio source the clips slice from. */
  url: string | null | undefined;
  /** Total source-track duration (seconds). */
  duration: number;
  /** Playhead position on the SOURCE track (seconds). Drives both the
   *  cursor line on the source-track view and the "split at playhead"
   *  affordance. */
  currentTime: number;
  /** Seek the source track to a specific second. Wired to click-to-seek
   *  on either the source ribbon or any clip. */
  onSeek: (t: number) => void;
  /** Optional precomputed peaks JSON (Float[]). Matches the same shape
   *  StudioWaveform consumes. */
  peaksUrl?: string | null;
  /** BPM of the source track. When set, the ribbon draws bar / beat
   *  tick marks aligned to the tempo so the user can land splits on
   *  musical boundaries instead of arbitrary seconds. */
  bpm?: number | null;
  /**
   * Bubbles the current ordered clip list + playback mode up to the
   * parent so the workstation's playback tick can enforce clip
   * boundaries (jump to the next clip's sourceStart when the current
   * one ends). When `mode === false` or `clips === []` the parent
   * falls back to normal linear source playback.
   */
  onPlayConfigChange?: (config: {
    mode: boolean;
    clips: Array<{ id: string; sourceStart: number; sourceEnd: number }>;
  }) => void;
}

/**
 * In-memory arrangement editor — round-6 scope:
 *
 *   • Source ribbon at top showing the track waveform with the playhead.
 *     Click anywhere to seek; click the [Split at playhead] button to
 *     drop a marker. Markers cut the track into clips.
 *
 *   • Clip lane below — each clip is a draggable card (sortable list).
 *     Drag horizontally to reorder. Delete with the trash icon. The
 *     clip width reflects its duration in the source.
 *
 *   • State is purely in-memory: refresh wipes it. Round 7 will add
 *     persistence (an `arrangements` table keyed by track_id + the
 *     user's session), and round 8 will rewire audio playback to
 *     follow the clip order. For now, clicking a clip just seeks the
 *     source track to that clip's start — playback continues on the
 *     ORIGINAL track timeline.
 *
 * Design rationale: split this into 3 rounds because doing a real
 * arrangement view (visual + persistence + rearranged playback) in
 * one round produces shallow work on all three. The visual surface
 * is the hardest piece UX-wise and lands here in one pass.
 */
const PEAKS_CACHE = new Map<string, number[]>();

interface Clip {
  /** Stable id used as the React key + drag handle. */
  id: string;
  /** Slice start in the SOURCE track (seconds). */
  sourceStart: number;
  /** Slice end in the SOURCE track (seconds). */
  sourceEnd: number;
}

export function StudioArrangement({ trackId, url, duration, currentTime, onSeek, peaksUrl, bpm, onPlayConfigChange }: Props) {
  // Arrangement-playback toggle. When `playArranged` is true, the
  // parent workstation enforces clip boundaries on the audio engine —
  // hitting "end of clip A" jumps the source's currentTime to the
  // start of clip B in display order. Off by default so the panel
  // doesn't change playback behaviour without intent.
  const [playArranged, setPlayArranged] = useState(false);
  // Markers as seconds in the source track. Clips are derived from
  // pairs of adjacent markers (with 0 and duration as implicit
  // endpoints). Keeping markers as the source of truth makes split /
  // delete trivial — operations are array splices on a sorted list.
  const [markers, setMarkers] = useState<number[]>([]);
  // The user's clip order. By default it's just `clipsInTime.map(c => c.id)`
  // — but reorder operations mutate this independently so the lane
  // can show them in any sequence.
  const [order, setOrder] = useState<string[]>([]);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [ribbonWidth, setRibbonWidth] = useState(0);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const ribbonCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragId = useRef<string | null>(null);

  // Persistence — load from /api/tracks/[id]/arrangement on mount,
  // debounce-save on every change. We track `hydratedTrackId` so the
  // save effect doesn't fire on first paint (which would clobber the
  // server state with the default empty arrays before the GET landed).
  const [hydratedTrackId, setHydratedTrackId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trim state — non-null while the user is dragging a clip edge.
  // `markerValue` holds the sorted-markers value being moved; clamps
  // are the surrounding boundaries (0 / duration / adjacent markers)
  // minus the 100ms slack so a trim can't cross its neighbor or
  // collapse the clip to zero length.
  const trimRef = useRef<{
    markerValue: number;
    startX: number;
    pxPerSecond: number;
    min: number;
    max: number;
  } | null>(null);

  // ── Hydrate from server ─────────────────────────────────────────────
  useEffect(() => {
    let aborted = false;
    setHydratedTrackId(null);
    (async () => {
      try {
        const res = await fetch(`/api/tracks/${trackId}/arrangement`, { cache: 'no-store' });
        if (!res.ok) {
          // Don't surface an error toast — falling back to empty
          // markers is a fine user experience.
          if (!aborted) {
            setMarkers([]);
            setOrder([]);
            setHydratedTrackId(trackId);
          }
          return;
        }
        const data = await res.json();
        if (aborted) return;
        setMarkers(Array.isArray(data?.markers) ? data.markers : []);
        setOrder(Array.isArray(data?.ordering) ? data.ordering : []);
        setHydratedTrackId(trackId);
      } catch {
        if (!aborted) setHydratedTrackId(trackId);
      }
    })();
    return () => { aborted = true; };
  }, [trackId]);

  // ── Debounced save ──────────────────────────────────────────────────
  // Persists any change to markers / order 600ms after the last edit.
  // Skips while the component is hydrating (hydratedTrackId !== trackId)
  // so the server isn't asked to overwrite itself with the empty
  // defaults the client briefly holds before the GET lands.
  useEffect(() => {
    if (hydratedTrackId !== trackId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const res = await fetch(`/api/tracks/${trackId}/arrangement`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markers, ordering: order }),
        });
        setSaveState(res.ok ? 'saved' : 'error');
        // Flash "Saved" briefly then fall back to idle so the panel
        // doesn't permanently advertise success.
        if (res.ok) setTimeout(() => setSaveState('idle'), 1200);
      } catch {
        setSaveState('error');
      }
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [markers, order, trackId, hydratedTrackId]);

  // ── Derived clips ───────────────────────────────────────────────────
  // Sorted markers turn into [0, m0, m1, ..., duration] which then
  // become N+1 clips. The clip ids are stable across re-renders by
  // hashing the start+end (so a split changes ids only for the
  // affected segment, not the rest of the lane).
  const clipsInTime = useMemo<Clip[]>(() => {
    if (duration <= 0) return [];
    const ms = [...markers].sort((a, b) => a - b);
    const bounds = [0, ...ms.filter((m) => m > 0 && m < duration), duration];
    const out: Clip[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i];
      const end = bounds[i + 1];
      if (end - start < 0.01) continue; // ignore degenerate zero-length slices
      out.push({
        id: `clip-${start.toFixed(3)}-${end.toFixed(3)}`,
        sourceStart: start,
        sourceEnd: end,
      });
    }
    return out;
  }, [markers, duration]);

  // Keep `order` in sync with derived clip ids. When the clip set
  // changes (split / merge), we splice the new ids in at the same
  // position as the old, removing ids that no longer exist. This
  // preserves the user's manual reorder across edits.
  useEffect(() => {
    setOrder((prev) => {
      const ids = clipsInTime.map((c) => c.id);
      // Drop ids that no longer exist + append new ones at the end.
      const kept = prev.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [clipsInTime]);

  const clipById = useMemo(() => {
    const m = new Map<string, Clip>();
    for (const c of clipsInTime) m.set(c.id, c);
    return m;
  }, [clipsInTime]);

  // ── Peaks for the ribbon (same fetch + decode strategy as StudioWaveform) ──
  useEffect(() => {
    if (!url) { setPeaks(null); return; }
    const cached = PEAKS_CACHE.get(url);
    if (cached) { setPeaks(cached); return; }

    let aborted = false;
    (async () => {
      if (peaksUrl) {
        try {
          const r = await fetch(peaksUrl);
          if (r.ok) {
            const j = await r.json();
            const arr = Array.isArray(j) ? j : j?.data?.[0] ?? null;
            if (Array.isArray(arr) && arr.length > 0) {
              PEAKS_CACHE.set(url, arr as number[]);
              if (!aborted) setPeaks(arr as number[]);
              return;
            }
          }
        } catch { /* fall through */ }
      }
      try {
        const r = await fetch(audioSrc(url));
        if (!r.ok) return;
        const buf = await r.arrayBuffer();
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        const channel = decoded.getChannelData(0);
        const samples = 1024;
        const block = Math.max(1, Math.floor(channel.length / samples));
        const out: number[] = [];
        for (let i = 0; i < samples; i++) {
          let max = 0;
          const s = i * block;
          const e = Math.min(channel.length, s + block);
          for (let j = s; j < e; j++) {
            const v = Math.abs(channel[j]);
            if (v > max) max = v;
          }
          out.push(max);
        }
        await ctx.close();
        PEAKS_CACHE.set(url, out);
        if (!aborted) setPeaks(out);
      } catch { /* silent */ }
    })();
    return () => { aborted = true; };
  }, [url, peaksUrl]);

  // ── Ribbon resize observer ──────────────────────────────────────────
  useEffect(() => {
    if (!ribbonRef.current) return;
    const ro = new ResizeObserver(([entry]) => setRibbonWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ribbonRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Ribbon paint ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = ribbonCanvasRef.current;
    if (!canvas || !ribbonWidth) return;
    const height = 56;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = ribbonWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${ribbonWidth}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, ribbonWidth, height);

    // Mirrored bars (same idiom as the studio scrub waveform).
    const barW = 2;
    const gap = 1;
    const bars = Math.max(1, Math.floor(ribbonWidth / (barW + gap)));
    const mid = height / 2;
    for (let i = 0; i < bars; i++) {
      const x = i * (barW + gap);
      const norm = peaks ? peaks[Math.floor((i / bars) * peaks.length)] ?? 0 : 0;
      const halfH = Math.max(1, norm * (height / 2 - 2));
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, mid - halfH, barW, halfH * 2);
    }

    // Tempo-aligned ruler. With a known BPM we draw a vertical tick
    // every beat (subtle) and a brighter tick + bar number every 4
    // beats (assumes 4/4 — same assumption as most popular DAWs;
    // future round can expose meter as a track property). Without
    // BPM we draw a fallback ruler every 5 seconds.
    if (duration > 0) {
      const validBpm = bpm && bpm > 40 && bpm < 240 ? bpm : null;
      const beatSec = validBpm ? 60 / validBpm : 5;
      const barEvery = validBpm ? 4 : null; // 4 beats per bar in 4/4
      ctx.font = '8px ui-monospace, SF Mono, Menlo, monospace';
      ctx.textBaseline = 'top';
      let beat = 0;
      for (let t = beatSec; t < duration; t += beatSec, beat++) {
        const x = (t / duration) * ribbonWidth;
        const isBar = barEvery != null && (beat + 1) % barEvery === 0;
        ctx.fillStyle = isBar ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, isBar ? 0 : height - 6, 1, isBar ? height : 6);
        if (isBar && validBpm) {
          // Bar number — 1-based, drawn once per bar at the top.
          const barNum = Math.floor((beat + 1) / barEvery!) + 1;
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillText(String(barNum), x + 2, 1);
        }
      }
    }

    // Marker lines — colored vertical bars at each cut point. Painted
    // OVER the ruler so they always read as the dominant edit feature.
    if (duration > 0) {
      ctx.fillStyle = '#E7D7BE';
      for (const m of markers) {
        const x = (m / duration) * ribbonWidth;
        ctx.fillRect(x - 0.5, 0, 1.5, height);
      }
      // Playhead.
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const px = (currentTime / duration) * ribbonWidth;
      ctx.fillRect(Math.max(0, Math.min(ribbonWidth - 1, px)), 0, 1, height);
    }
  }, [peaks, ribbonWidth, markers, currentTime, duration, bpm]);

  // ── Operations ──────────────────────────────────────────────────────
  const splitAtPlayhead = () => {
    if (duration <= 0) return;
    // Reject splits that would create a too-short sliver (< 100ms),
    // and dedupe — clicking Split twice without seeking shouldn't
    // double the marker.
    if (markers.some((m) => Math.abs(m - currentTime) < 0.1)) return;
    if (currentTime < 0.1 || currentTime > duration - 0.1) return;
    setMarkers((ms) => [...ms, currentTime]);
  };

  // Document-level pointer listeners for trim. We attach once and
  // gate on `trimRef.current` — when it's null we do nothing. Using
  // document means the cursor can leave the small handle and the
  // drag still tracks correctly (same trick as resizing a panel
  // divider).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const t = trimRef.current;
      if (!t || t.pxPerSecond <= 0) return;
      const deltaSec = (e.clientX - t.startX) / t.pxPerSecond;
      const newVal = Math.max(t.min, Math.min(t.max, t.markerValue + deltaSec));
      // Replace the original marker value with the new one. We find
      // by exact equality on the *original* — `t.markerValue` stays
      // the anchor for the entire drag so deltas accumulate cleanly.
      setMarkers((ms) => ms.map((m) => (m === t.markerValue ? newVal : m)));
      // Update the anchor so subsequent moves track from the new
      // value (otherwise tiny rounding compounds and the marker
      // walks faster than the cursor).
      t.markerValue = newVal;
      t.startX = e.clientX;
    };
    const onUp = () => { trimRef.current = null; };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // Keyboard shortcut — `S` splits at the playhead. Scoped to the
  // document but ignores keystrokes that originate inside form
  // elements so the user can type "s" into search boxes elsewhere on
  // the studio page without accidentally cutting their track. Bound
  // through a ref so handler identity stays stable across renders.
  const splitRef = useRef(splitAtPlayhead);
  splitRef.current = splitAtPlayhead;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 's' && e.key !== 'S') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // Skip if any modifier is held (Cmd+S is the browser's Save and
      // shouldn't get hijacked into our split action).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      splitRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const removeClip = (id: string) => {
    const clip = clipById.get(id);
    if (!clip) return;
    // Removing the segment between two markers = removing one of the
    // bounding markers. We drop the marker AT clip.sourceEnd (or
    // sourceStart for the last clip) so the surrounding segment
    // absorbs this one.
    if (markers.length === 0) {
      // Single full-length clip — clearing it just leaves duration
      // intact but order will skip it.
      setOrder((o) => o.filter((x) => x !== id));
      return;
    }
    const sortedMarkers = [...markers].sort((a, b) => a - b);
    // Find a marker that bounds this clip and drop it.
    const candidate = sortedMarkers.find((m) =>
      Math.abs(m - clip.sourceEnd) < 0.01 || Math.abs(m - clip.sourceStart) < 0.01,
    );
    if (candidate != null) {
      setMarkers((ms) => ms.filter((m) => m !== candidate));
    } else {
      setOrder((o) => o.filter((x) => x !== id));
    }
  };

  const resetAll = () => {
    setMarkers([]);
    setOrder([]);
  };

  // ── Reorder via HTML5 drag-and-drop (no extra deps) ─────────────────
  const onDragStart = (id: string) => () => {
    dragId.current = id;
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragId.current;
    dragId.current = null;
    if (!src || src === targetId) return;
    setOrder((cur) => {
      const next = cur.filter((id) => id !== src);
      const idx = next.indexOf(targetId);
      next.splice(idx, 0, src);
      return next;
    });
  };

  // Ordered clips — derived from `order` (display sequence) + `clipById`
  // (id→clip lookup). Hoisted to a useMemo so we can both render it and
  // feed it up to the parent's playback engine via the `onPlayConfigChange`
  // callback without recomputing twice per render.
  const orderedClips = useMemo<Clip[]>(
    () => order.map((id) => clipById.get(id)).filter((c): c is Clip => !!c),
    [order, clipById],
  );

  // Bubble up the current ordered clip list + play mode whenever either
  // changes. Parent stores a snapshot and uses it in the playback tick
  // to enforce clip boundaries. Defensive: drop the call when the mode
  // is off OR clips collapse to a single full-length sliver, which is
  // indistinguishable from "no arrangement" and shouldn't gate
  // playback at all.
  useEffect(() => {
    if (!onPlayConfigChange) return;
    const hasCuts = orderedClips.length > 1 || markers.length > 0;
    onPlayConfigChange({
      mode: playArranged && hasCuts,
      clips: hasCuts
        ? orderedClips.map((c) => ({ id: c.id, sourceStart: c.sourceStart, sourceEnd: c.sourceEnd }))
        : [],
    });
  }, [orderedClips, playArranged, markers.length, onPlayConfigChange]);

  if (!url) return null;

  return (
    <div className="border border-[#1A1813] rounded-lg p-5 bg-[#090907]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#F7EBDD]">Arrangement</p>
          {/* Save-state indicator — quiet by default, briefly flashes
              "Saved" 1.2s after each persist, lights up red on error.
              Keeps the user honest about whether their work is sticking. */}
          {saveState === 'saving' && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99]">Saving…</span>
          )}
          {saveState === 'saved' && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#6DC6A4]">Saved</span>
          )}
          {saveState === 'error' && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-red-400">Save failed</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Play-arranged toggle — when on, the parent's playback tick
              jumps the source audio's currentTime across clip boundaries
              in the display order. Off by default to preserve normal
              linear playback for users who haven't made arrangements yet.
              Disabled until at least one cut exists. */}
          <button
            onClick={() => setPlayArranged((v) => !v)}
            disabled={markers.length === 0}
            className={cn(
              'flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
              playArranged
                ? 'bg-[#1a3a2a] border-[#6DC6A4]/50 text-[#8edfa8] hover:bg-[#1f4a36]'
                : 'bg-[#171511] border-[#211F1A] text-[#B4AA99] hover:text-white hover:border-[#3B372F]',
            )}
            title={
              markers.length === 0
                ? 'Add at least one split to enable arranged playback'
                : playArranged
                  ? 'Playing in clip order — click to revert to linear'
                  : 'Play through clips in display order'
            }
          >
            <Play size={10} fill="currentColor" /> Play arranged
          </button>
          <button
            onClick={splitAtPlayhead}
            disabled={duration <= 0}
            className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-md bg-[#342F27] border border-[#C9BCA8]/30 text-[#F3E6D1] hover:bg-[#221d4a] hover:border-[#E7D7BE]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Split at playhead (S)"
          >
            <Scissors size={11} /> Split
          </button>
          <button
            onClick={resetAll}
            disabled={markers.length === 0 && order.length === clipsInTime.length}
            className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-md bg-[#171511] border border-[#211F1A] text-[#B4AA99] hover:text-white hover:border-[#3B372F] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Clear all cuts"
          >
            <RotateCcw size={11} /> Reset
          </button>
        </div>
      </div>

      {/* Source ribbon — full track, click to seek, vertical markers
          show the cut points. The ribbon doesn't reorder; it's the
          "what the file looks like raw" reference view. */}
      <div
        ref={ribbonRef}
        onClick={(e) => {
          if (!ribbonRef.current || duration <= 0) return;
          const r = ribbonRef.current.getBoundingClientRect();
          onSeek(Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration)));
        }}
        className="relative w-full rounded-md bg-gradient-to-b from-[#090907] to-[#070707] border border-white/[0.04] cursor-pointer overflow-hidden mb-4"
        style={{ height: 56 }}
      >
        <canvas ref={ribbonCanvasRef} className="block w-full h-full" />
      </div>

      {/* Clip lane — drag-to-reorder list. Empty state shows the hint
          to use Split. */}
      {orderedClips.length <= 1 && markers.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-[#211F1A] rounded-md">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#837B6D]">No cuts yet</p>
          <p className="text-[10px] text-[#6E685B] mt-1">
            Move the playhead and hit <span className="text-[#B4AA99]">Split</span> to slice this track.
          </p>
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {orderedClips.map((clip, i) => {
            const len = clip.sourceEnd - clip.sourceStart;
            const widthPx = Math.max(80, Math.min(280, (len / Math.max(1, duration)) * 800));
            // Find this clip's TIME-ORDER index — the trim handle on
            // the right edge mutates the marker that sits between
            // this clip and its time-neighbor. Cards rendered in
            // display order, but trim is a source-time operation.
            const timeIdx = clipsInTime.findIndex((c) => c.id === clip.id);
            const sortedMarkers = [...markers].sort((a, b) => a - b);
            // The bounding marker on this clip's right is the
            // `timeIdx`-th entry in sortedMarkers — provided this
            // isn't the last clip in time (which is bounded by the
            // implicit `duration` end, not a movable marker).
            const rightMarkerIdx = timeIdx >= 0 && timeIdx < clipsInTime.length - 1 ? timeIdx : -1;
            const rightMarker = rightMarkerIdx >= 0 ? sortedMarkers[rightMarkerIdx] : null;
            // Trim bounds — the marker can move between the clip's
            // own sourceStart (plus slack) and the next clip's
            // sourceEnd (minus slack). 100ms slack on each side
            // matches the split guard so we never produce zero-
            // length clips.
            const trimMin = clip.sourceStart + 0.1;
            const trimMax = timeIdx + 1 < clipsInTime.length
              ? clipsInTime[timeIdx + 1].sourceEnd - 0.1
              : duration - 0.1;

            const startTrim = (e: React.PointerEvent) => {
              if (rightMarker == null || !ribbonRef.current) return;
              e.stopPropagation();
              e.preventDefault();
              const ribbonW = ribbonRef.current.getBoundingClientRect().width;
              trimRef.current = {
                markerValue: rightMarker,
                startX: e.clientX,
                pxPerSecond: duration > 0 ? ribbonW / duration : 0,
                min: trimMin,
                max: trimMax,
              };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            };
            return (
              <div
                key={clip.id}
                draggable
                onDragStart={onDragStart(clip.id)}
                onDragOver={onDragOver}
                onDrop={onDrop(clip.id)}
                onClick={() => onSeek(clip.sourceStart)}
                className={cn(
                  'shrink-0 group relative rounded-lg overflow-hidden cursor-grab active:cursor-grabbing',
                  'bg-gradient-to-br from-[#342F27] to-[#0a0820] border border-[#C9BCA8]/30',
                  'hover:border-[#E7D7BE]/60 transition-colors',
                )}
                style={{ width: widthPx, height: 72 }}
                title={`Clip ${i + 1}: ${fmt(clip.sourceStart)} → ${fmt(clip.sourceEnd)}`}
              >
                <ClipWaveform clip={clip} duration={duration} peaks={peaks} />
                <div className="absolute inset-x-0 top-0 px-2 py-1 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-[#F3E6D1]">#{i + 1}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeClip(clip.id); }}
                    className="p-1 rounded text-[#B4AA99] hover:text-red-400 hover:bg-black/40 opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove clip"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
                <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
                  <span className="text-[9px] font-mono text-[#D0C3AF]">{fmt(len)}</span>
                </div>
                {/* Right-edge trim handle. Hidden unless this clip has
                    a movable right marker (i.e. it isn't the last in
                    time). Stop click + drag propagation so trimming
                    doesn't seek or initiate reorder-drag. */}
                {rightMarker != null && (
                  <div
                    onPointerDown={startTrim}
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    draggable={false}
                    className="absolute top-0 right-0 h-full w-2 cursor-ew-resize group/handle"
                    title={`Trim to ${fmt(rightMarker)}`}
                  >
                    <div className="absolute right-0 top-0 h-full w-0.5 bg-[#E7D7BE]/60 group-hover/handle:bg-[#F3E6D1] transition-colors" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[9px] text-[#6E685B] mt-3 leading-relaxed">
        Drag clips to reorder. Click a clip to seek the source track to its start. Edits persist per-track —
        playback still follows the source for now; rearranged playback lands next round.
      </p>
    </div>
  );
}

function ClipWaveform({ clip, duration, peaks }: { clip: Clip; duration: number; peaks: number[] | null }) {
  // Compute the slice of the peaks array that this clip covers and
  // render mini mirrored bars. Cheap because we draw at clip widths
  // not full ribbon width.
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !w) return;
    const h = 72;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const barW = 2;
    const gap = 1;
    const bars = Math.max(1, Math.floor(w / (barW + gap)));
    const mid = h / 2;

    // Slice the peaks array to this clip's source range.
    let slice: number[] = [];
    if (peaks && duration > 0) {
      const startIdx = Math.floor((clip.sourceStart / duration) * peaks.length);
      const endIdx = Math.ceil((clip.sourceEnd / duration) * peaks.length);
      slice = peaks.slice(startIdx, Math.max(startIdx + 1, endIdx));
    }
    for (let i = 0; i < bars; i++) {
      const x = i * (barW + gap);
      const norm = slice.length > 0 ? slice[Math.floor((i / bars) * slice.length)] ?? 0 : 0;
      const halfH = Math.max(1, norm * (h / 2 - 6));
      ctx.fillStyle = 'rgba(175,169,236,0.7)';
      ctx.fillRect(x, mid - halfH, barW, halfH * 2);
    }
  }, [peaks, w, clip, duration]);
  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
