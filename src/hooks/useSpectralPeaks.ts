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

/** Longer than this and we don't bother — previews are short by design. */
const MAX_ANALYSIS_SECONDS = 60 * 8;
const ANALYSIS_SAMPLE_RATE = 22050;

/** Crossovers roughly matching how a DAW splits a mix for metering. */
const LOW_CUTOFF_HZ = 250;
const MID_CENTER_HZ = 1400;
const HIGH_CUTOFF_HZ = 4000;

type Status = 'idle' | 'analyzing' | 'ready' | 'unavailable';

export interface SpectralPeaksResult {
  bands: SpectralBands | null;
  status: Status;
}

/**
 * Session cache. Analysis is deterministic per track, so a plain module-level
 * Map is correct and avoids re-decoding when the user reopens the preview.
 */
const cache = new Map<string, SpectralBands>();
/** Tracks we've already failed on, so we don't retry a doomed decode. */
const failed = new Set<string>();

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
function resolveAnalysisUrl(audioUrl: string): string | null {
  const direct = cdnAudioSrc(audioUrl);
  if (!direct) return null;
  // Already same-origin (local uploads, or the proxy) — readable as-is.
  if (direct.startsWith('/')) return direct;
  if (canFetchReadableAudio(direct)) return direct;
  if (/^https?:\/\//i.test(direct)) {
    return `/api/audio?src=${encodeURIComponent(direct)}`;
  }
  return null;
}

function sliceRms(channel: Float32Array, sliceCount: number): number[] {
  const out: number[] = new Array(sliceCount).fill(0);
  if (channel.length === 0) return out;
  const per = channel.length / sliceCount;
  for (let i = 0; i < sliceCount; i++) {
    const start = Math.floor(i * per);
    const end = Math.min(channel.length, Math.max(start + 1, Math.floor((i + 1) * per)));
    let sumSquares = 0;
    for (let j = start; j < end; j++) sumSquares += channel[j] * channel[j];
    out[i] = Math.sqrt(sumSquares / Math.max(1, end - start));
  }
  return out;
}

/** Render `buffer` through one biquad and return the filtered samples. */
async function renderBand(
  buffer: AudioBuffer,
  configure: (filter: BiquadFilterNode) => void,
): Promise<Float32Array> {
  const OfflineCtx: typeof OfflineAudioContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  const ctx = new OfflineCtx(1, buffer.length, buffer.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  configure(filter);
  source.connect(filter);
  filter.connect(ctx.destination);
  source.start(0);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

export function useSpectralPeaks(
  trackId: string | null,
  audioUrl: string | null | undefined,
  sliceCount: number,
): SpectralPeaksResult {
  const [bands, setBands] = useState<SpectralBands | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  // Guards against a resolved analysis for a previous track landing after the
  // user has already skipped to the next one.
  const activeTrackRef = useRef<string | null>(null);

  useEffect(() => {
    activeTrackRef.current = trackId;

    if (!trackId || !audioUrl) {
      setBands(null);
      setStatus('idle');
      return;
    }

    const cached = cache.get(trackId);
    if (cached) {
      setBands({
        low: resampleSeries(cached.low, sliceCount),
        mid: resampleSeries(cached.mid, sliceCount),
        high: resampleSeries(cached.high, sliceCount),
      });
      setStatus('ready');
      return;
    }

    if (failed.has(trackId)) {
      setBands(null);
      setStatus('unavailable');
      return;
    }

    const analysisUrl = resolveAnalysisUrl(audioUrl);
    if (!analysisUrl) {
      setBands(null);
      setStatus('unavailable');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setStatus('analyzing');
    setBands(null);

    (async () => {
      try {
        if (typeof window === 'undefined' || !('OfflineAudioContext' in window)) {
          throw new Error('OfflineAudioContext unavailable');
        }

        const res = await fetch(analysisUrl, { signal: controller.signal, cache: 'force-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.arrayBuffer();
        if (cancelled) return;

        // Decode at reduced rate/mono — enough for band energy, much cheaper.
        const decodeCtx = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
        const decoded = await decodeCtx.decodeAudioData(raw);
        if (cancelled) return;
        if (decoded.duration > MAX_ANALYSIS_SECONDS) throw new Error('too long to analyse');

        const [low, mid, high] = await Promise.all([
          renderBand(decoded, (f) => {
            f.type = 'lowpass';
            f.frequency.value = LOW_CUTOFF_HZ;
          }),
          renderBand(decoded, (f) => {
            f.type = 'bandpass';
            f.frequency.value = MID_CENTER_HZ;
            f.Q.value = 0.7;
          }),
          renderBand(decoded, (f) => {
            f.type = 'highpass';
            f.frequency.value = HIGH_CUTOFF_HZ;
          }),
        ]);
        if (cancelled) return;

        // Cache at a generous fixed resolution, then resample down to whatever
        // the current lane needs — so a re-render at a different bar count
        // never re-decodes.
        const CACHE_SLICES = 512;
        const result: SpectralBands = {
          low: sliceRms(low, CACHE_SLICES),
          mid: sliceRms(mid, CACHE_SLICES),
          high: sliceRms(high, CACHE_SLICES),
        };
        cache.set(trackId, result);

        if (activeTrackRef.current !== trackId) return;
        setBands({
          low: resampleSeries(result.low, sliceCount),
          mid: resampleSeries(result.mid, sliceCount),
          high: resampleSeries(result.high, sliceCount),
        });
        setStatus('ready');
      } catch {
        if (cancelled) return;
        failed.add(trackId);
        if (activeTrackRef.current !== trackId) return;
        setBands(null);
        setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [trackId, audioUrl, sliceCount]);

  return { bands, status };
}
