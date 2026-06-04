'use client';

/**
 * WavePlayer — thin chrome around `useWaveSurfer`.
 *
 * Before P2, this component owned its own WaveSurfer lifecycle (dynamic
 * import, abort controller, peaks-sidecar fetch, cancel-on-unmount, etc.)
 * — duplicated across four call sites. Now it delegates all of that to
 * the shared `useWaveSurfer` hook and only keeps its WavePlayer-specific
 * concerns:
 *
 *   - Mini transport chrome (single play button + timecode strip)
 *   - Offline IndexedDB blob preference (via getOfflineSrc) when trackId
 *     is provided — the hook is unaware of this; we resolve the URL
 *     upstream and pass the resolved value in.
 *   - Auto-retry: one silent retry 800ms after the first failure to
 *     soak up transient 504/CORS hiccups right after an R2 upload
 *     finalizes. A second failure surfaces a Retry button.
 *   - Active-audio guard: only one WavePlayer in the app produces sound
 *     at a time — the one whose trackId matches the global `currentTrack`.
 *     Other instances render the waveform silently and promote themselves
 *     to the global PlayerBar on play-click. Prevents "two audio streams
 *     playing different files at once" when a drawer opens while the
 *     bottom bar is mid-playback.
 */

import { useEffect, useState } from 'react';
import { usePlayer } from '@/hooks/usePlayer';
import { useWaveSurfer } from '@/hooks/useWaveSurfer';
import { PlayGlyph, PauseGlyph } from './TransportIcons';
import { audioSrc } from '@/lib/audio/url';
import { cdnAudioSrc } from '@/lib/audio/cdn';
import { normalizationGain } from '@/lib/audio/loudness';
import { getOfflineSrc } from '@/lib/offline/audio-cache';
import { useRef } from 'react';
import type { Track } from '@/lib/types';

interface WavePlayerProps {
  url: string;
  /** Optional track id — when provided, an IndexedDB-cached blob is used if present. */
  trackId?: string;
  /**
   * Optional full track object. When set, clicking the play button on
   * an inactive WavePlayer (one whose trackId isn't the global current
   * track) promotes the track to the bottom PlayerBar instead of playing
   * locally. Without this, the play button only works for the global track.
   */
  track?: Track | null;
  /** Optional URL of a precomputed peaks JSON sidecar. */
  peaksUrl?: string | null;
  hideControls?: boolean;
  onFinish?: () => void;
  height?: number;
  accent?: string;
}

const AUTO_RETRY_DELAY_MS = 800;

export function WavePlayer({
  url,
  trackId,
  track,
  peaksUrl,
  hideControls = false,
  onFinish,
  height = 40,
  accent = '#D4BFA0',
}: WavePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { isPlaying, setPlaying, setProgress, volume, currentTrack, setTrack,
          seekTarget, duckGain } = usePlayer();

  // A WavePlayer is the "active" audio source for the app only when its
  // track matches the global current track — see header comment.
  const isActiveAudio = !trackId || currentTrack?.id === trackId;

  // Resolved URL: prefer an IndexedDB-cached blob when offline; fall back
  // to the network. Async because getOfflineSrc reads IDB. While we wait
  // we pass `null` to the hook (which skips load).
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  // retryNonce > 0 means we appended a cache-bust query string to force
  // useWaveSurfer to reload. Used by the manual Retry button after the
  // silent auto-retry also fails.
  const [retryNonce, setRetryNonce] = useState(0);
  const [autoRetryTried, setAutoRetryTried] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  useEffect(() => {
    let aborted = false;
    setShowFailed(false);
    setResolvedUrl(null);
    (async () => {
      if (!url) return;
      let finalUrl = audioSrc(url);
      if (trackId) {
        try {
          const offline = await getOfflineSrc(trackId);
          if (offline && !aborted) finalUrl = offline;
        } catch {
          // Offline lookup is best-effort; fall back to network silently.
        }
      }
      // Cache-bust on manual retry so useWaveSurfer treats it as a new URL.
      // Blob URLs (offline) don't accept query params, so we only append
      // when we're hitting the network.
      if (retryNonce > 0 && !finalUrl.startsWith('blob:')) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        finalUrl = `${finalUrl}${sep}_retry=${retryNonce}`;
      }
      if (!aborted) setResolvedUrl(finalUrl);
    })();
    return () => { aborted = true; };
  }, [url, trackId, retryNonce]);

  const {
    ready, currentTime, duration, failed,
    play, pause, setVolume, seek,
  } = useWaveSurfer({
    container: containerRef,
    url: resolvedUrl,
    peaksUrl,
    height,
    // Frosted unplayed bars + warm-accent played; a faint warm playhead gives
    // a precise scrub reference without the heavy old vertical line.
    waveColor: 'rgba(232,220,200,0.20)',
    progressColor: accent,
    cursorColor: 'rgba(232,220,200,0.55)',
    barWidth: 2,
    barGap: 1.6,
    barRadius: 3,
    initialVolume: isActiveAudio ? volume : 0,
    // Don't auto-play in the hook — we drive play/pause manually below
    // so the active-audio guard fully controls when this instance sounds.
    autoPlay: false,
    onTimeUpdate: (t) => {
      if (!isActiveAudio) return;
      const d = duration || 1;
      setProgress(t / d);
    },
    onFinish: () => {
      if (isActiveAudio) setPlaying(false);
      onFinish?.();
    },
  });

  // Auto-retry once on first failure (transient R2 hiccup).
  useEffect(() => {
    if (!failed || autoRetryTried) {
      // Show the manual retry UI as soon as we've exhausted the silent
      // retry. `failed` flips back to false when the new URL loads.
      if (failed && autoRetryTried) setShowFailed(true);
      return;
    }
    setAutoRetryTried(true);
    const t = setTimeout(() => setRetryNonce((n) => n + 1), AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [failed, autoRetryTried]);

  // Per-track loudness normalization gain. Attenuates hot masters so the
  // catalogue plays at a consistent volume (the active track's loudness
  // drives it; unknown loudness → gain 1, no change).
  const normGain = isActiveAudio ? normalizationGain(currentTrack?.loudness) : 1;

  // Drive play / pause / volume from the global store, gated on
  // isActiveAudio. Inactive instances stay paused and muted regardless
  // of what the global player is doing.
  useEffect(() => {
    if (!ready) return;
    if (!isActiveAudio) {
      pause();
      setVolume(0);
      return;
    }
    setVolume(volume * normGain * duckGain);
    if (isPlaying) play();
    else pause();
  }, [ready, isActiveAudio, isPlaying, volume, normGain, duckGain, play, pause, setVolume]);

  // Consume seekTarget from the store — external components (store grid
  // waveform, share page) write a 0..1 fraction here to seek the active
  // audio engine without holding a direct ref to this WaveSurfer instance.
  useEffect(() => {
    if (!isActiveAudio || !ready || seekTarget == null) return;
    seek(seekTarget);
    // Clear so this effect doesn't re-fire on the same value.
    // We write directly to the store because seekTo() only accepts 0..1.
    usePlayer.setState({ seekTarget: null });
  // seekTarget is the only dep that matters — seek/seekTo are stable callbacks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTarget]);

  // ── Plain-audio fallback ────────────────────────────────────────────────
  // When WaveSurfer fails to decode (no peaks + a CORS/decode hiccup on a
  // share link opened externally), the waveform dies AND so would playback,
  // since the same engine owns both. This hidden <audio> takes over so the
  // listener still HEARS the beat — the waveform shows "unavailable" but the
  // transport keeps working. Streams direct from R2/CDN (no proxy/CORS).
  const fallbackRef = useRef<HTMLAudioElement>(null);
  const fallbackActive = showFailed && isActiveAudio;

  useEffect(() => {
    const a = fallbackRef.current;
    if (!a) return;
    if (!fallbackActive) { a.pause(); return; }
    const want = cdnAudioSrc(url);
    if (want && a.getAttribute('src') !== want) { a.src = want; a.load(); }
    a.volume = Math.max(0, Math.min(1, volume * normGain * duckGain));
    if (isPlaying) a.play().catch(() => {});
    else a.pause();
  }, [fallbackActive, isPlaying, volume, normGain, duckGain, url]);

  // Seek the fallback element when a seekTarget arrives while it's active.
  useEffect(() => {
    const a = fallbackRef.current;
    if (!a || !fallbackActive || seekTarget == null) return;
    if (isFinite(a.duration) && a.duration > 0) a.currentTime = seekTarget * a.duration;
    usePlayer.setState({ seekTarget: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTarget, fallbackActive]);

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full flex items-center gap-3">
      {!hideControls && (
        <button
          type="button"
          onClick={() => {
            // When this WavePlayer isn't already the global source,
            // promote its track to the bottom PlayerBar instead of
            // playing locally. Audio always plays through the global
            // bar, no matter which surface initiated it.
            if (!isActiveAudio && track) {
              setTrack(track);
              return;
            }
            setPlaying(!isPlaying);
          }}
          className="w-8 h-8 rounded-full bg-[#16130e]/80 border border-white/[0.08] flex items-center justify-center text-[#E8DCC8] hover:border-[#D4BFA0]/50 hover:text-[#D4BFA0] hover:scale-105 active:scale-95 transition-all shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
        >
          {isPlaying ? (
            <PauseGlyph size={14} />
          ) : (
            <PlayGlyph size={14} className="ml-0.5" />
          )}
        </button>
      )}

      {!hideControls && (
        <span className="text-[10px] font-mono text-[#5a5142] tabular-nums w-10 text-right shrink-0">
          {formatTime(currentTime)}
        </span>
      )}

      <div className="flex-1 relative min-w-0" style={{ minHeight: height }}>
        <div ref={containerRef} className="w-full" style={{ minHeight: height }} />
        {!ready && !showFailed && (
          <div className="absolute inset-0 flex items-center pointer-events-none">
            <div className="w-full h-[2px] bg-[#1a160f] rounded animate-pulse" />
          </div>
        )}
        {showFailed && (
          <div className="absolute inset-0 flex items-center justify-center gap-2">
            {/* Audio still plays via the fallback element below — only the
                visual waveform is unavailable. */}
            <span className="text-[10px] font-mono text-[#4a4338]">{fallbackActive ? 'playing (no waveform)' : 'waveform unavailable'}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowFailed(false);
                // Reset the auto-retry guard so the next failure (after
                // a successful URL change) follows the same one-retry
                // policy as the initial load.
                setAutoRetryTried(false);
                setRetryNonce((n) => n + 1);
              }}
              className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-[#1a160f] text-[#a08a6a] hover:text-white hover:border-[#2d2620] pointer-events-auto"
            >
              Retry
            </button>
          </div>
        )}
        {/* Plain-audio fallback element — hidden, only sounds when WaveSurfer
            has failed AND this instance is the active audio source. */}
        <audio
          ref={fallbackRef}
          hidden
          preload="none"
          onTimeUpdate={(e) => {
            if (!fallbackActive) return;
            const a = e.currentTarget;
            if (isFinite(a.duration) && a.duration > 0) setProgress(a.currentTime / a.duration);
          }}
          onEnded={() => { if (fallbackActive) { setPlaying(false); onFinish?.(); } }}
        />
      </div>

      {!hideControls && (
        <span className="text-[10px] font-mono text-[#5a5142] tabular-nums w-10 shrink-0">
          {formatTime(duration)}
        </span>
      )}
    </div>
  );
}
