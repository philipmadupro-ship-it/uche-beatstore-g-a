'use client';

/**
 * Single source of truth for WaveSurfer lifecycle.
 *
 * Pre-extraction, four call sites set up WaveSurfer identically:
 *   - components/player/WavePlayer.tsx
 *   - app/share/[token]/page.tsx
 *   - app/projects/share/[token]/page.tsx
 *   - components/share/PublicPlayer.tsx (legacy)
 *
 * Each one re-implemented:
 *   - dynamic import of wavesurfer.js
 *   - cancellation flag for fast track-skip / route change
 *   - peaks-sidecar fetch + load with duration hint
 *   - error / abort swallow on destroy mid-load
 *   - volume + play sync to React state
 *
 * Drift between them was already costing us — peaks-sidecar acceleration
 * landed in WavePlayer but not the share pages, so long tracks paint slow
 * for shared links. This hook centralizes the lifecycle so a fix lands
 * once and reaches every player.
 *
 * DAW-grade features bolted on at the same seam:
 *   - `zoom(px)` — set px-per-second; controls horizontal density. Bigger
 *     numbers = more detail per second + horizontal scroll.
 *   - `regions` plugin — drag a region on the waveform; loop or jump.
 *   - `keyboardShortcuts` — opt-in space/arrow handlers.
 *
 * The hook is intentionally opinionated about WHAT it manages (the
 * WaveSurfer instance, audio loading, peaks, plugins) and leaves the UI
 * shell (play/pause buttons, transport bar, track switcher) to the caller.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type WaveSurferType from 'wavesurfer.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RegionsPluginInstance = any; // wavesurfer plugin types are loose; we
                                  // duck-type. Region API is small and stable.

export interface RegionInfo {
  id: string;
  start: number;
  end: number;
  color?: string;
}

export interface UseWaveSurferOptions {
  /** Container ref the waveform renders into. */
  container: React.RefObject<HTMLDivElement | null>;
  /** Audio URL — pass through `audioSrc()` first if you need same-origin proxying. */
  url: string | null | undefined;
  /** Optional peaks sidecar JSON URL. When set + reachable, skip browser decode. */
  peaksUrl?: string | null;
  /** Visual options forwarded to WaveSurfer.create */
  waveColor?: string;
  progressColor?: string;
  cursorColor?: string;
  barWidth?: number;
  barGap?: number;
  barRadius?: number;
  height?: number;
  /** Auto-play once `ready` fires. Useful for queued tracks. */
  autoPlay?: boolean;
  /** Initial volume 0..1. */
  initialVolume?: number;
  /** Initial mute. */
  initialMuted?: boolean;
  /**
   * Enable the regions plugin (drag-to-select on the waveform). Set to
   * `true` to allow region creation; pass `{ loop: true }` to auto-loop
   * playback inside an active region.
   */
  regions?: boolean | { loop?: boolean; defaultColor?: string };
  /**
   * Initial zoom in px-per-second. WaveSurfer renders 1 minute of audio
   * across the container width by default; bumping this number expands
   * the waveform and enables horizontal scrolling for detailed editing.
   */
  initialZoom?: number;
  /**
   * Mount the timeline plugin (ruler with time markers above the waveform).
   * Cheap, mostly a visual aid for editors. Default off so non-DAW
   * consumers (PlayerBar, mini waveforms) don't pay for it.
   */
  timeline?: boolean | {
    /** Major tick spacing in seconds. Default: auto. */
    primaryLabelInterval?: number;
    /** Minor tick spacing. */
    secondaryLabelInterval?: number;
  };
  /**
   * Mount the spectrogram plugin (frequency-domain visualization below
   * the waveform). Expensive — adds an FFT canvas + redraws on zoom.
   * Default off; expose a toggle in the consumer's chrome when you want
   * to give users on-demand access.
   */
  spectrogram?: boolean | {
    /** Height in px. Default: 128. */
    height?: number;
    /** FFT size. Default: 1024. Higher = better frequency resolution. */
    fftSamples?: number;
    /** Visual color scheme. Default: a purple/cyan gradient. */
    colorMap?: number[][];
  };
  /** Called once the audio decodes and is playable. */
  onReady?: () => void;
  /** Called on every playback frame. */
  onTimeUpdate?: (t: number) => void;
  /** Called when playback reaches the end of the audio. */
  onFinish?: () => void;
  /** Called on a non-abort error. */
  onError?: (err: unknown) => void;
  /** Called when a region is created / updated / removed. */
  onRegionsChange?: (regions: RegionInfo[]) => void;
}

interface PeaksFile {
  version: number;
  peaks: number[];
  duration: number;
  length: number;
}

async function fetchPeaks(peaksUrl: string, signal: AbortSignal): Promise<PeaksFile | null> {
  try {
    const r = await fetch(peaksUrl, { signal, cache: 'force-cache' });
    if (!r.ok) return null;
    const json = (await r.json()) as PeaksFile;
    if (
      !json ||
      json.version !== 1 ||
      !Array.isArray(json.peaks) ||
      typeof json.duration !== 'number'
    ) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

export interface UseWaveSurferReturn {
  /** True once WaveSurfer has decoded and is playable. */
  ready: boolean;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Total duration in seconds. Falls back to peaks-hint pre-decode. */
  duration: number;
  /** Failed-to-load flag — caller decides how to render. */
  failed: boolean;
  /** Imperative controls. Safe to call before `ready`; they no-op. */
  play: () => void;
  pause: () => void;
  setVolume: (v: number) => void;
  seek: (fractionOrSeconds: number) => void;
  /** Set the zoom level in px-per-second. Higher = more detail + scroll. */
  zoom: (pxPerSecond: number) => void;
  /** Current zoom level (echoed back; useful for UI knobs). */
  currentZoom: number;
  /** Currently active regions (mostly for read-out and serialization). */
  regions: RegionInfo[];
  /** Programmatically add a region. Returns the new region's id. */
  addRegion: (start: number, end: number, color?: string) => string | null;
  /** Clear all regions. */
  clearRegions: () => void;
  /** Direct access to the underlying instance for advanced calls. */
  instanceRef: React.MutableRefObject<WaveSurferType | null>;
}

export function useWaveSurfer({
  container,
  url,
  peaksUrl,
  // Frosted, clearly-visible unplayed bars (warm off-white at low alpha) so
  // the played/unplayed split reads at a glance on the glass panel — the old
  // near-black #3B372F vanished against the pill. Played stays the warm accent.
  waveColor = 'rgba(232,220,200,0.20)',
  progressColor = '#E7D7BE',
  cursorColor = 'transparent',
  // Thin, rounded, slightly-spaced bars = the modern "liquid" waveform look.
  barWidth = 2,
  barGap = 1.6,
  barRadius = 3,
  height = 40,
  autoPlay = false,
  initialVolume = 0.8,
  initialMuted = false,
  regions = false,
  initialZoom = 0,
  onReady,
  onTimeUpdate,
  onFinish,
  onError,
  onRegionsChange,
  timeline = false,
  spectrogram = false,
}: UseWaveSurferOptions): UseWaveSurferReturn {
  const wsRef = useRef<WaveSurferType | null>(null);
  const regionsPluginRef = useRef<RegionsPluginInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(initialZoom);
  const [regionList, setRegionList] = useState<RegionInfo[]>([]);

  // Use a ref to track the latest callbacks so re-renders of the parent
  // don't rebuild WaveSurfer (would cause flicker every time the user
  // moves a slider or types in the comment box).
  const callbacksRef = useRef({ onReady, onTimeUpdate, onFinish, onError, onRegionsChange });
  callbacksRef.current = { onReady, onTimeUpdate, onFinish, onError, onRegionsChange };

  // Resolve regions option to its shape — supports `true` (defaults) or
  // `{ loop, defaultColor }`. Memoize so the load effect dep array is stable.
  const regionsLoop = typeof regions === 'object' && regions !== null ? regions.loop ?? false : false;
  const regionsDefaultColor =
    typeof regions === 'object' && regions !== null ? regions.defaultColor ?? 'rgba(127, 119, 221, 0.2)' : 'rgba(127, 119, 221, 0.2)';
  const regionsEnabled = regions !== false;

  // Plugin toggle resolution — same shape as `regions`. Booleans are the
  // ergonomic on/off; objects let consumers tune the plugin. We treat
  // these as opt-in (default off) because the spectrogram in particular
  // is a real FFT pass and not free.
  const timelineEnabled = timeline !== false;
  const spectrogramEnabled = spectrogram !== false;
  const spectrogramHeight =
    typeof spectrogram === 'object' && spectrogram !== null ? spectrogram.height ?? 128 : 128;
  const spectrogramFft =
    typeof spectrogram === 'object' && spectrogram !== null ? spectrogram.fftSamples ?? 1024 : 1024;

  useEffect(() => {
    if (!container.current || !url) return;

    setReady(false);
    setFailed(false);
    setCurrentTime(0);
    setDuration(0);

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      // Dynamic import — see comment in this file's header.
      const mod = await import('wavesurfer.js').catch(() => null);
      if (cancelled || !mod || !container.current) return;
      const WaveSurferLib = mod.default;

      // Optionally mount the regions plugin BEFORE construction so it
      // observes the first 'ready' fire and registers its DOM hooks.
      const plugins: unknown[] = [];
      if (regionsEnabled) {
        try {
          const regMod = await import('wavesurfer.js/dist/plugins/regions.js');
          if (cancelled) return;
          // The plugin module exports a default with .create()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const RegionsPlugin = (regMod as any).default;
          const plugin = RegionsPlugin.create();
          regionsPluginRef.current = plugin;
          plugins.push(plugin);
        } catch (err) {
          // Plugin import failure is non-fatal — degrade to plain player.
          console.warn('Regions plugin failed to load:', err);
        }
      }

      if (timelineEnabled) {
        try {
          // Timeline plugin renders a ruler at the top of the waveform
          // container — useful in DAW mode for orienting clicks/drags
          // against real time codes.
          const tlMod = await import('wavesurfer.js/dist/plugins/timeline.js');
          if (cancelled) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const TimelinePlugin = (tlMod as any).default;
          plugins.push(TimelinePlugin.create());
        } catch (err) {
          console.warn('Timeline plugin failed to load:', err);
        }
      }

      if (spectrogramEnabled) {
        try {
          // Spectrogram plugin renders a frequency-domain view BELOW the
          // waveform. Costs an FFT pass on decode and re-renders on zoom,
          // so consumers opt in deliberately (DAW mode toggle, etc).
          const spMod = await import('wavesurfer.js/dist/plugins/spectrogram.js');
          if (cancelled) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const SpectrogramPlugin = (spMod as any).default;
          plugins.push(SpectrogramPlugin.create({
            height: spectrogramHeight,
            fftSamples: spectrogramFft,
            labels: false,
          }));
        } catch (err) {
          console.warn('Spectrogram plugin failed to load:', err);
        }
      }

      const w = WaveSurferLib.create({
        container: container.current,
        waveColor,
        progressColor,
        cursorColor,
        barWidth,
        barGap,
        barRadius,
        height,
        normalize: true,
        interact: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugins: plugins as any,
      });
      wsRef.current = w;

      w.on('ready', () => {
        if (cancelled) return;
        setReady(true);
        setDuration(w.getDuration() || 0);
        w.setVolume(initialMuted ? 0 : initialVolume);
        if (autoPlay) w.play().catch(() => {});
        // Apply initial zoom now that geometry is known.
        if (initialZoom > 0) {
          try { w.zoom(initialZoom); } catch {}
        }
        // Wire region drag-to-create + change events.
        const plugin = regionsPluginRef.current;
        if (plugin) {
          plugin.enableDragSelection?.({ color: regionsDefaultColor });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const emit = (regions: any[]) => {
            const mapped: RegionInfo[] = (regions ?? []).map((r) => ({
              id: String(r.id),
              start: r.start,
              end: r.end,
              color: r.color,
            }));
            setRegionList(mapped);
            callbacksRef.current.onRegionsChange?.(mapped);
          };
          plugin.on('region-created', () => emit(plugin.getRegions()));
          plugin.on('region-updated', () => emit(plugin.getRegions()));
          plugin.on('region-removed', () => emit(plugin.getRegions()));
          if (regionsLoop) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            plugin.on('region-out', (region: any) => {
              // When playback exits the region while it's the active loop,
              // jump back to its start and keep playing.
              if (w.isPlaying()) {
                w.setTime(region.start);
              }
            });
          }
        }
        callbacksRef.current.onReady?.();
      });
      w.on('timeupdate', (t: number) => {
        if (cancelled) return;
        setCurrentTime(t);
        callbacksRef.current.onTimeUpdate?.(t);
      });
      w.on('finish', () => {
        if (!cancelled) callbacksRef.current.onFinish?.();
      });
      w.on('error', (err: unknown) => {
        const msg = (err as Error)?.message ?? String(err);
        // AbortError is the expected outcome of destroy-mid-load.
        if (/abort/i.test(msg)) return;
        if (cancelled) return;
        setFailed(true);
        callbacksRef.current.onError?.(err);
      });

      // Peaks sidecar — skip browser decode entirely when present.
      let peaks: number[][] | undefined;
      let durationHint: number | undefined;
      if (peaksUrl) {
        const file = await fetchPeaks(peaksUrl, controller.signal);
        if (file && !cancelled) {
          peaks = [file.peaks];
          durationHint = file.duration;
          // Show the duration immediately so the timecode UI doesn't read "0:00".
          setDuration(file.duration);
        }
      }
      if (cancelled) return;

      try {
        await w.load(url, peaks, durationHint);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (/abort/i.test(msg)) return;
        if (cancelled) return;
        setFailed(true);
        callbacksRef.current.onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      const w = wsRef.current;
      wsRef.current = null;
      if (w) {
        try {
          w.unAll();
          w.pause();

          // Release underlying media element to prevent mobile browser memory leaks
          const media = (w as any).mediaElement ?? (w as any).audio;
          if (media) {
            media.removeAttribute('src');
            media.load();
          }

          w.destroy();
        } catch {
          // Destroy can throw if WaveSurfer is still initializing; ignore.
        }
      }
    };
    // We intentionally exclude callbacks/visual-config from the dep array.
    // Visual props rarely change at runtime and we'd rather not tear down
    // the whole WaveSurfer instance for a color tweak. Callers needing a
    // hard reset can change `url` or remount the consumer.
    // Plugin toggles are in the dep array so flipping spectrogram on/off
    // forces a clean rebuild (WaveSurfer doesn't support hot-attaching
    // plugins). Playback position is lost across the rebuild — acceptable
    // because these toggles are deliberate user actions, not frequent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, peaksUrl, regionsEnabled, timelineEnabled, spectrogramEnabled]);

  // Imperative controls. Stable identity via useCallback so consumer
  // effects can include them in dep arrays without churn.
  const play = useCallback(() => {
    wsRef.current?.play().catch(() => {});
  }, []);
  const pause = useCallback(() => {
    wsRef.current?.pause();
  }, []);
  const setVolume = useCallback((v: number) => {
    try { wsRef.current?.setVolume(v); } catch {}
  }, []);
  const seek = useCallback((v: number) => {
    try {
      const dur = wsRef.current?.getDuration() ?? duration;
      const fraction = v <= 1 ? v : (dur > 0 ? v / dur : 0);
      wsRef.current?.seekTo(Math.max(0, Math.min(1, fraction)));
    } catch {}
  }, [duration]);
  const zoom = useCallback((pxPerSecond: number) => {
    const clamped = Math.max(0, Math.min(2000, pxPerSecond));
    try { wsRef.current?.zoom(clamped); } catch {}
    setCurrentZoom(clamped);
  }, []);
  const addRegion = useCallback((start: number, end: number, color?: string): string | null => {
    const plugin = regionsPluginRef.current;
    if (!plugin) return null;
    try {
      const r = plugin.addRegion({
        start,
        end,
        color: color ?? regionsDefaultColor,
      });
      return String(r?.id ?? '');
    } catch {
      return null;
    }
  }, [regionsDefaultColor]);
  const clearRegions = useCallback(() => {
    const plugin = regionsPluginRef.current;
    try { plugin?.clearRegions?.(); } catch {}
  }, []);

  return {
    ready,
    currentTime,
    duration,
    failed,
    play,
    pause,
    setVolume,
    seek,
    zoom,
    currentZoom,
    regions: regionList,
    addRegion,
    clearRegions,
    instanceRef: wsRef,
  };
}
