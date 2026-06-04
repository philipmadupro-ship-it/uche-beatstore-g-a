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
import { cdnAudioSrc } from '@/lib/audio/cdn';
import { normalizationGain } from '@/lib/audio/loudness';
import { getOfflineSrc } from '@/lib/offline/audio-cache';

export function SimpleAudioEngine() {
  const audioRef = useRef<HTMLAudioElement>(null);

  const {
    currentTrack, isPlaying, volume, duckGain, seekTarget,
    setProgress, setPlaying, next,
  } = usePlayer();

  const trackId = currentTrack?.id;
  const url = currentTrack?.audio_url ?? null;
  const normGain = normalizationGain(currentTrack?.loudness);

  // ── Load source when the track changes (prefer offline blob) ──────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !url) return;
    let cancelled = false;

    (async () => {
      // Stream straight from R2 / CDN — a plain <audio> element needs no CORS,
      // so we skip the /api/audio proxy and keep the origin out of the stream.
      let src = cdnAudioSrc(url);
      if (trackId) {
        try {
          const offline = await getOfflineSrc(trackId);
          if (offline && !cancelled) src = offline;
        } catch {
          // best-effort; fall back to network
        }
      }
      if (cancelled) return;
      // Only reset src when it actually changes — avoids re-buffering on
      // unrelated re-renders.
      if (a.src !== src) {
        a.src = src;
        a.load();
      }
      if (isPlaying) {
        a.play().catch(() => { /* autoplay block — user will press play */ });
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, url]);

  // ── Play / pause ──────────────────────────────────────────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.play().catch(() => { /* autoplay block */ });
    } else {
      a.pause();
    }
  }, [isPlaying, trackId]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      onEnded={() => next()}
      onPlay={() => setPlaying(true)}
    />
  );
}
