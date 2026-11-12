'use client';

/**
 * Real 3-band spectral analysis for the beat preview waveform.
 *
 * Decodes the preview audio once, runs it through three biquad filters in
 * parallel OfflineAudioContexts (low / mid / high), and reduces each rendered
 * band to per-slice RMS. That's genuine frequency content — the previous
 * implementation faked bands with `index % 5`.
 *
 * Cost control, because this must not interfere with playback:
 *  - Renders mono at 22.05 kHz. Band *energy* doesn't need full fidelity, and
 *    this cuts the work several-fold versus native stereo 44.1k.
 *  - Offline rendering runs far faster than realtime and on its own thread, so
 *    it never competes with the audio actually playing.
 *  - Results are memo-cached per track id for the session, so reopening the
 *    preview is instant and re-analysis never happens on a track we've seen.
 *  - Bails out entirely for cross-origin/opaque audio it cannot read, and for
 *    anything over MAX_ANALYSIS_SECONDS.
 *
 * Falls back to plain amplitude peaks (uncoloured, honestly neutral) whenever
 * analysis isn't possible — a private r2:// master, a CORS-blocked URL, a
 * browser without OfflineAudioContext, or a decode failure.
 */

import { useEffect, useRef, useState } from 'react';
import { canFetchReadableAudio, cdnAudioSrc } from '@/lib/audio/cdn';
import { resampleSeries, type SpectralBands } from '@/lib/audio/spectral-peaks';
import {
  DEFAULT_COLUMNS_PER_SECOND, buildWaveformModel, waveformCacheKey, type AnalysisSource, type WaveformModel,
} from '@/lib/visuals/waveform-model';
import { detectPitchSeries, rmsToDb } from '@/lib/audio/pitch';

/** Slices in the server-written bands sidecar (lib/audio/peaks.ts BANDS_SLICES). */
const SIDECAR_SLICES = 512;

/** Longer than this and we don't bother — previews are short by design. */
const MAX_ANALYSIS_SECONDS = 60 * 8;
const ANALYSIS_SAMPLE_RATE = 22050;
/** Pitch resolution — a quarter of the band resolution; see note at the call site. */
const PITCH_SLICES = 128;

/** Nearest-neighbour stretch of a sparse series onto a denser index space. */
function stretchNullable(values: (number | null)[], target: number): (number | null)[] {
  if (values.length === 0) return new Array<number | null>(target).fill(null);
  if (values.length === target) return values.slice();
  const out = new Array<number | null>(target);
  for (let i = 0; i < target; i++) {
    out[i] = values[Math.min(values.length - 1, Math.floor((i * values.length) / target))];
  }
  return out;
}

/** Band crossovers live in lib/audio/band-filter.ts (CROSSOVER_LOW_HZ / CROSSOVER_HIGH_HZ): one source. */
type Status = 'idle' | 'analyzing' | 'ready' | 'unavailable';

export interface SpectralPeaksResult {
  bands: SpectralBands | null;
  /** The deep peak model (full in-browser analysis only; null for the coarse sidecar). */
  model: WaveformModel | null;
  /** Where the data came from and at what resolution (columns/s or slices). */
  source: AnalysisSource | null;
  resolution: number | null;
  /** Per-slice level in dBFS, aligned to `bands`. Drives the readout. */
  db: number[] | null;
  /** Per-slice dominant frequency; null entries where the audio has no pitch. */
  hz: (number | null)[] | null;
  status: Status;
}

/** Everything we cache per track — bands plus the readout series. */
interface AnalysisResult extends SpectralBands {
  model: WaveformModel | null;
  source: AnalysisSource;
  resolution: number;
  db: number[];
  hz: (number | null)[];
}

/**
 * Session cache. Analysis is deterministic per track *and audio file*, so a
 * plain module-level Map is correct and avoids re-decoding when the user
 * reopens the preview.
 *
 * Keyed on track id AND audio URL, not id alone. A track's audio can be
 * replaced (re-upload, new version) while keeping its id — with an id-only key
 * this Map lives for the whole session and would serve the OLD file's bands,
 * dB and pitch against the NEW audio forever: a waveform that doesn't match
 * what you hear, with no way to invalidate short of a reload.
 */
const cache = new Map<string, AnalysisResult>();
/** Tracks we've already failed on, so we don't retry a doomed decode. */
const failed = new Set<string>();

/** Cache identity for one analysis: the track *and* the exact file analysed. */
export function analysisKey(
  trackId: string,
  audioUrl: string,
  source: AnalysisSource = 'analysis',
  resolution: number = DEFAULT_COLUMNS_PER_SECOND,
): string {
  return waveformCacheKey(trackId, audioUrl, source, resolution);
}

/**
 * Pick a URL whose bytes `fetch()` can actually READ.
 *
 * The distinction that matters here: `<audio>` streams cross-origin sources
 * without CORS, but Web Audio *decoding* needs readable bytes. The public R2
 * bucket sends no CORS headers, so `canFetchReadableAudio` correctly reports
 * false for `.r2.dev` — playable, not readable.
 *
 * When the direct URL isn't readable we fall back to the same-origin
 * `/api/audio` proxy, which is exactly what CLAUDE.md reserves it for:
 * "surfaces that still decode audio". Playback itself is untouched and still
 * streams straight from R2/CDN — this proxied fetch happens once per track,
 * only while the preview is open, and is cached for the session.
 *
 * Returns null when there's nothing analysable at all.
 */
export function resolveAnalysisUrl(audioUrl: string, publicFallback?: string | null): string | null {
  const direct = cdnAudioSrc(audioUrl);
  if (!direct) return null;
  // Already same-origin (local uploads, or the proxy) — readable as-is.
  if (direct.startsWith('/')) return direct;
  if (canFetchReadableAudio(direct)) return direct;
  // A PUBLIC surface (the storefront) must not reach for /api/audio: it is
  // session-gated and answers 401 to every buyer. Such a surface passes a
  // same-origin URL anyone may read for the same bytes instead.
  if (publicFallback) return publicFallback;
  if (/^https?:\/\//i.test(direct)) {
    return `/api/audio?src=${encodeURIComponent(direct)}`;
  }
  return null;
}

/** Shape of the `.bands.json` sidecar written at upload (see `lib/audio/peaks.ts`). */
interface BandsSidecar {
  version: number;
  slices: number;
  low: number[];
  mid: number[];
  high: number[];
  db: number[];
  hz: (number | null)[];
}

/**
 * Validate a fetched sidecar before trusting it.
 *
 * The file is fetched from a CDN and could be truncated, from an older schema,
 * or simply not the JSON we expected. Returning null routes the caller to
 * local analysis rather than rendering a waveform from a half-parsed file —
 * the same reasoning as the localStorage validation in `persisted-uploads.ts`.
 */
export function parseBandsSidecar(file: Partial<BandsSidecar> | null): AnalysisResult | null {
  if (!file || typeof file !== 'object') return null;
  const { low, mid, high, db, hz } = file;
  if (!Array.isArray(low) || !Array.isArray(mid) || !Array.isArray(high)) return null;
  if (!Array.isArray(db)) return null;
  if (low.length === 0) return null;
  // Every array must share one index space; the client looks all four up with
  // a single slice index.
  if (mid.length !== low.length || high.length !== low.length || db.length !== low.length) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    low: low.map(num),
    mid: mid.map(num),
    high: high.map(num),
    db: db.map(num),
    model: null,
    source: 'sidecar',
    resolution: low.length,
    hz: Array.isArray(hz) && hz.length === low.length
      ? hz.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
      : new Array<number | null>(low.length).fill(null),
  };
}

export function useSpectralPeaks(
  trackId: string | null,
  audioUrl: string | null | undefined,
  sliceCount: number,
  /**
   * Precomputed `.bands.json` produced at upload. When present the whole
   * decode path below is skipped: one cached JSON fetch instead of pulling the
   * audio and running three OfflineAudioContext renders in the visitor's
   * browser. Undefined for tracks uploaded before the sidecar existed, which
   * still fall back to analysing locally.
   */
  bandsUrl?: string | null,
  /**
   * For public surfaces: a same-origin URL anyone may read, used instead of
   * the session-gated `/api/audio` proxy when the direct URL is not readable
   * (the public R2 bucket sends no CORS headers). The storefront passes
   * `/api/store/preview/<id>`.
   */
  publicFallback?: string | null,
): SpectralPeaksResult {
  const [bands, setBands] = useState<SpectralBands | null>(null);
  const [db, setDb] = useState<number[] | null>(null);
  const [model, setModel] = useState<WaveformModel | null>(null);
  const [source, setSource] = useState<AnalysisSource | null>(null);
  const [resolution, setResolution] = useState<number | null>(null);
  const [hz, setHz] = useState<(number | null)[] | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  // Guards against a resolved analysis for a previous track landing after the
  // user has already skipped to the next one.
  const activeTrackRef = useRef<string | null>(null);

  useEffect(() => {
    // Identity is the track AND its audio file — see `analysisKey`. Tracked as
    // the active key (not the bare track id) so that replacing a track's audio
    // in place correctly invalidates an in-flight analysis of the old file.
    const key = trackId && audioUrl ? analysisKey(trackId, audioUrl) : null;
    // The coarse server sidecar is cached under ITS OWN key (source + resolution), so it can
    // never be served as, or stretched into, a full analysis.
    const sidecarKey = trackId && audioUrl ? analysisKey(trackId, audioUrl, 'sidecar', SIDECAR_SLICES) : null;
    activeTrackRef.current = key;

    /** Resample a cached analysis down to the requested slice count. */
    const applyResult = (r: AnalysisResult, slices: number) => {
      setBands({
        low: resampleSeries(r.low, slices),
        mid: resampleSeries(r.mid, slices),
        high: resampleSeries(r.high, slices),
      });
      setDb(resampleSeries(r.db, slices));
      setModel(r.model); setSource(r.source); setResolution(r.resolution);
      setHz(stretchNullable(r.hz, slices));
    };

    if (!trackId || !audioUrl || !key) {
      setBands(null); setDb(null); setHz(null); setModel(null); setSource(null); setResolution(null);
      setStatus('idle');
      return;
    }

    const cached = cache.get(key) ?? (sidecarKey ? cache.get(sidecarKey) : undefined);
    if (cached) {
      applyResult(cached, sliceCount);
      setStatus('ready');
      return;
    }

    if (failed.has(key)) {
      setBands(null); setDb(null); setHz(null); setModel(null); setSource(null); setResolution(null);
      setStatus('unavailable');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    // ── Fast path: precomputed sidecar ────────────────────────────────────
    // Immutable and CDN-cached, so this is usually a disk hit and always
    // cheaper than decoding. Only on failure do we fall through to the
    // in-browser analysis below.
    if (bandsUrl) {
      setStatus('analyzing');
      (async () => {
        try {
          const res = await fetch(bandsUrl, { signal: controller.signal, cache: 'force-cache' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const file = await res.json() as Partial<BandsSidecar>;
          if (cancelled) return;
          const parsed = parseBandsSidecar(file);
          if (!parsed) throw new Error('malformed bands sidecar');
          if (sidecarKey) cache.set(sidecarKey, parsed);
          if (activeTrackRef.current !== key) return;
          applyResult(parsed, sliceCount);
          setStatus('ready');
        } catch {
          // Sidecar missing or unreadable — fall back to decoding locally so
          // a bad sidecar degrades to "slower" rather than "no waveform".
          if (!cancelled && activeTrackRef.current === key) runLocalAnalysis();
        }
      })();
      return () => { cancelled = true; controller.abort(); };
    }

    const analysisUrl = resolveAnalysisUrl(audioUrl, publicFallback);
    if (!analysisUrl) {
      setBands(null); setDb(null); setHz(null); setModel(null); setSource(null); setResolution(null);
      setStatus('unavailable');
      return;
    }

    setStatus('analyzing');
    setBands(null); setDb(null); setHz(null); setModel(null); setSource(null); setResolution(null);

    runLocalAnalysis();

    // The original in-browser path: fetch the audio, decode it, run three
    // filtered renders. Kept as the fallback for tracks with no sidecar yet.
    function runLocalAnalysis() {
      const src = analysisUrl;
      const cacheKey = key;
      if (!src || !cacheKey) return;
      (async () => {
      try {
        if (typeof window === 'undefined' || !('OfflineAudioContext' in window)) {
          throw new Error('OfflineAudioContext unavailable');
        }

        const res = await fetch(src, { signal: controller.signal, cache: 'force-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.arrayBuffer();
        if (cancelled) return;

        // Decode at reduced rate/mono — enough for band energy, much cheaper.
        const decodeCtx = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
        const decoded = await decodeCtx.decodeAudioData(raw);
        if (cancelled) return;
        if (decoded.duration > MAX_ANALYSIS_SECONDS) throw new Error('too long to analyse');


        // The DEEP model: 441 columns/s of true peaks for the mix and three 4th-order
        // bands (lib/visuals/waveform-model.ts). The legacy slice series the older
        // consumers read (bands / db / hz) are derived from it, so there is one analysis.
        const CACHE_SLICES = 4096;
        const mono = decoded.getChannelData(0);
        const model = buildWaveformModel(mono, decoded.sampleRate, DEFAULT_COLUMNS_PER_SECOND);
        const toSlices = (col: Uint8Array): number[] => {
          const out: number[] = new Array(CACHE_SLICES).fill(0);
          const n = col.length;
          if (n === 0) return out;
          for (let i = 0; i < CACHE_SLICES; i++) {
            const a = Math.floor((i * n) / CACHE_SLICES);
            const b = Math.max(a + 1, Math.floor(((i + 1) * n) / CACHE_SLICES));
            let p = 0;
            for (let j = a; j < b && j < n; j++) if (col[j] > p) p = col[j];
            out[i] = p / 255;
          }
          return out;
        };
        const allSlices = toSlices(model.all);
        const result: AnalysisResult = {
          low: toSlices(model.low),
          mid: toSlices(model.mid),
          high: toSlices(model.high),
          // Level readout: the peak level of each slice, in dBFS.
          db: allSlices.map((v) => rmsToDb(v * model.peak)),
          // Pitch is the expensive part (autocorrelation), so it runs at a
          // quarter resolution and is stretched — a readout does not need
          // sub-second pitch detail.
          hz: stretchNullable(
            detectPitchSeries(mono, decoded.sampleRate, PITCH_SLICES),
            CACHE_SLICES,
          ),
          model,
          source: 'analysis',
          resolution: DEFAULT_COLUMNS_PER_SECOND,
        };
        cache.set(cacheKey, result);

        if (activeTrackRef.current !== cacheKey) return;
        applyResult(result, sliceCount);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        failed.add(cacheKey);
        if (activeTrackRef.current !== cacheKey) return;
        setBands(null); setDb(null); setHz(null); setModel(null); setSource(null); setResolution(null);
        setStatus('unavailable');
      }
      })();
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [trackId, audioUrl, sliceCount, publicFallback]);

  return { bands, model, source, resolution, db, hz, status };
}
