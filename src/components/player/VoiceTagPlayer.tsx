'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '@/hooks/usePlayer';

/**
 * Voice-tag overlay for store previews (mig 072).
 *
 * When the current track carries a `voice_tag_url` (only store-served tracks
 * that opted in do — the owner's dashboard tracks never have it), this plays
 * the producer's tag at the start and then every `voice_tag_interval` seconds
 * over the preview. The purchased download is always the clean file; this is a
 * client-side, preview-only anti-rip layer.
 *
 * No precise Web Audio scheduling needed — we ride the player's `progress`
 * stream and fire the tag when playback crosses each interval bucket. Mount
 * once in the store layout; renders nothing.
 */
export function VoiceTagPlayer() {
  const currentTrack = usePlayer((s) => s.currentTrack);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const progress = usePlayer((s) => s.progress);
  const volume = usePlayer((s) => s.volume);
  const setDuckGain = usePlayer((s) => s.setDuckGain);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastBucketRef = useRef<number>(-1);
  const trackIdRef = useRef<string | null>(null);
  // Restore the beat volume when the tag finishes (or as a safety timeout).
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set if the tag asset fails to load (404 / CORS) — we then stop trying so
  // it never ducks the beat or spams retries.
  const failedRef = useRef(false);

  const tagUrl = (currentTrack as any)?.voice_tag_url as string | undefined;
  const interval = Math.max(5, Number((currentTrack as any)?.voice_tag_interval) || 20);

  // Lazily create the audio element + load the tag when the track changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
      audioRef.current.crossOrigin = 'anonymous';
      // Restore the ducked beat the moment the tag finishes.
      audioRef.current.addEventListener('ended', () => setDuckGain(1));
      // If the tag can't load, never duck — and stop retrying.
      audioRef.current.addEventListener('error', () => { failedRef.current = true; setDuckGain(1); });
    }
    if (tagUrl && audioRef.current.src !== tagUrl) {
      failedRef.current = false; // new url — give it a fresh chance
      audioRef.current.src = tagUrl;
    }
    // Reset the interval bucket on track change so the tag fires near the start.
    if (trackIdRef.current !== (currentTrack?.id ?? null)) {
      trackIdRef.current = currentTrack?.id ?? null;
      lastBucketRef.current = -1;
    }
  }, [tagUrl, currentTrack?.id, setDuckGain]);

  // Keep the tag at a sensible level relative to the player volume.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(1, volume * 0.9);
  }, [volume]);

  // Fire the tag at each interval bucket while a tagged track is playing.
  useEffect(() => {
    if (!tagUrl || failedRef.current || !isPlaying || !currentTrack) return;
    const dur = currentTrack.duration_seconds || 0;
    if (dur <= 0) return;
    const seconds = progress * dur;
    const bucket = Math.floor(seconds / interval);
    if (bucket !== lastBucketRef.current) {
      lastBucketRef.current = bucket;
      const el = audioRef.current;
      if (el && el.src) {
        try {
          el.currentTime = 0;
          el.play().then(() => {
            // Duck the beat under the tag, then restore on `ended` (above)
            // or after a safety window keyed to the tag length.
            setDuckGain(0.35);
            if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
            const ms = Math.max(800, Math.min(4000, (el.duration || 1.5) * 1000 + 150));
            restoreTimerRef.current = setTimeout(() => setDuckGain(1), ms);
          }).catch(() => setDuckGain(1)); // transient (e.g. pause interrupt) — don't disable
        } catch { setDuckGain(1); }
      }
    }
  }, [progress, isPlaying, tagUrl, interval, currentTrack, setDuckGain]);

  // Stop the tag + un-duck if playback pauses.
  useEffect(() => {
    if (!isPlaying) {
      if (audioRef.current) { try { audioRef.current.pause(); } catch { /* ignore */ } }
      setDuckGain(1);
    }
  }, [isPlaying, setDuckGain]);

  // Safety: always restore the beat gain on unmount (e.g. leaving the store).
  useEffect(() => () => {
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    setDuckGain(1);
  }, [setDuckGain]);

  return null;
}
