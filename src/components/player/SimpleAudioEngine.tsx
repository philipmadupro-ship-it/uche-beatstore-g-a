'use client';

/**
 * SimpleAudioEngine — the global audio source for the bottom PlayerBar.
 *
 * Replaces the WaveSurfer-based WavePlayer that used to live inline in the
 * PlayerBar. WaveSurfer coupled audio playback to waveform decoding: with no
 * peaks sidecar it had to download + decode the entire file just to draw bars,
 * and any decode/CORS hiccup killed BOTH the waveform AND playback
 * ("waveform unavailable / Retry", songs not loading).
 *
 * This engine is a plain HTML5 <audio> element. It never decodes for visuals,
 * so it can't fail that way — it just plays. The PlayerBar renders a simple
 * progress line instead of a waveform (real waveforms live only on the beat
 * page + preview drawer via MiniWaveform, which is pure SVG and never fails).
 *
 * Responsibilities (mirrors what WavePlayer used to do for the global bar):
 *   - Load currentTrack.audio_url (preferring an IndexedDB offline blob).
 *   - Play / pause from the global `isPlaying`.
 *   - Apply volume × duckGain.
 *   - Report progress (0..1 fraction) every timeupdate.
 *   - Consume seekTarget (0..1) written by MiniWaveform / keyboard shortcuts.
 *   - Advance to the next track on `ended`.
 *
 * Headless: renders only a hidden <audio>. Mount once, near the PlayerBar.
 */

import { useEffect, useRef } from 'react';
import { usePlayer } from '@/hooks/usePlayer';
import { playbackAudioSrc } from '@/lib/audio/cdn';
import { normalizationGain } from '@/lib/audio/loudness';
import { getOfflineSrc } from '@/lib/offline/audio-cache';
import { getPreviewSrc, peekPreviewSrc } from '@/lib/audio/preview-cache';

export function SimpleAudioEngine() {
  const audioRef = useRef<HTMLAudioElement>(null);

  const {
    currentTrack, isPlaying, volume, duckGain, seekTarget,
    setProgress, setPlaying, setBuffering, setPlaybackError, next,
  } = usePlayer();

  const trackId = currentTrack?.id;
  const url = currentTrack?.audio_url ?? null;
  const normGain = normalizationGain(currentTrack?.loudness);

  // ── Load source when the track changes ────────────────────────────────
  // Latency-critical: nothing async may sit between the tap and play().
  // Awaiting IndexedDB before setting src added tens/hundreds of ms per tap
  // (and risked iOS revoking the user-gesture autoplay grant). Fast path is
  // fully synchronous: in-memory prefetched blob if warmed, else the direct
  // CDN/R2 URL. The persistent caches are consulted in the background and
  // only swapped in if buffering hasn't produced audio yet.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !url) return;
    let cancelled = false;

    const instant = peekPreviewSrc(trackId) ?? playbackAudioSrc(url);
    // Only reset src when it actually changes — avoids re-buffering on
    // unrelated re-renders.
    if (a.src !== instant) {
      setBuffering(true);
      setPlaybackError(null);
      a.src = instant;
      a.load();
    }
    if (isPlaying) {
      a.play().catch(() => {
        setBuffering(false);
        setPlaybackError('Tap play to start this preview.');
        setPlaying(false);
      });
    }

    // Background: prefer an explicit offline download, then a persisted (but
    // not yet memory-warmed) preview blob. Swap only while nothing has played
    // yet, so we never restart audible playback.
    if (trackId && !instant.startsWith('blob:')) {
      (async () => {
        try {
          const offline = await getOfflineSrc(trackId);
          const blob = offline ?? (await getPreviewSrc(trackId));
          if (cancelled || !blob || a.src === blob) return;
          if (a.currentTime > 0 && !a.paused) return; // already audible — leave it
          a.src = blob;
          a.load();
          if (isPlaying) a.play().catch(() => {
            setBuffering(false);
            setPlaybackError('Tap play to start this preview.');
            setPlaying(false);
          });
        } catch {
          // best-effort; the network stream is already loading
        }
      })();
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, url]);

  // ── Play / pause ──────────────────────────────────────────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      setPlaybackError(null);
      a.play().catch(() => {
        setBuffering(false);
        setPlaybackError('Tap play to start this preview.');
        setPlaying(false);
      });
    } else {
      a.pause();
      setBuffering(false);
    }
  }, [isPlaying, trackId, setBuffering, setPlaybackError, setPlaying]);

  // ── Volume (× duck × loudness normalization) ──────────────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = Math.max(0, Math.min(1, volume * duckGain * normGain));
  }, [volume, duckGain, normGain]);

  // ── Seek — consume seekTarget (0..1) from the store ───────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a || seekTarget == null) return;
    const dur = a.duration;
    if (isFinite(dur) && dur > 0) {
      a.currentTime = Math.max(0, Math.min(1, seekTarget)) * dur;
    }
    usePlayer.setState({ seekTarget: null });
  }, [seekTarget]);

  return (
    <audio
      ref={audioRef}
      hidden
      preload="auto"
      onTimeUpdate={(e) => {
        const a = e.currentTarget;
        if (isFinite(a.duration) && a.duration > 0) {
          setProgress(a.currentTime / a.duration);
        }
      }}
      onLoadStart={() => {
        if (isPlaying) setBuffering(true);
      }}
      onWaiting={() => setBuffering(true)}
      onCanPlay={() => setBuffering(false)}
      onPlaying={() => {
        setBuffering(false);
        setPlaybackError(null);
        setPlaying(true);
      }}
      onPause={() => setBuffering(false)}
      onEnded={() => {
        setBuffering(false);
        next();
      }}
      onError={() => {
        setBuffering(false);
        setPlaybackError('Preview stream unavailable. Try another beat.');
        setPlaying(false);
      }}
    />
  );
}
