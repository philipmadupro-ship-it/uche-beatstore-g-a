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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastBucketRef = useRef<number>(-1);
  const trackIdRef = useRef<string | null>(null);

  const tagUrl = (currentTrack as any)?.voice_tag_url as string | undefined;
  const interval = Math.max(5, Number((currentTrack as any)?.voice_tag_interval) || 20);

  // Lazily create the audio element + load the tag when the track changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
      audioRef.current.crossOrigin = 'anonymous';
    }
    if (tagUrl && audioRef.current.src !== tagUrl) {
      audioRef.current.src = tagUrl;
    }
    // Reset the interval bucket on track change so the tag fires near the start.
    if (trackIdRef.current !== (currentTrack?.id ?? null)) {
      trackIdRef.current = currentTrack?.id ?? null;
      lastBucketRef.current = -1;
    }
  }, [tagUrl, currentTrack?.id]);

  // Keep the tag at a sensible level relative to the player volume.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(1, volume * 0.9);
  }, [volume]);

  // Fire the tag at each interval bucket while a tagged track is playing.
  useEffect(() => {
    if (!tagUrl || !isPlaying || !currentTrack) return;
    const dur = currentTrack.duration_seconds || 0;
    if (dur <= 0) return;
    const seconds = progress * dur;
    const bucket = Math.floor(seconds / interval);
    if (bucket !== lastBucketRef.current) {
      lastBucketRef.current = bucket;
      const el = audioRef.current;
      if (el && el.src) {
        try { el.currentTime = 0; el.play().catch(() => undefined); } catch { /* ignore */ }
      }
    }
  }, [progress, isPlaying, tagUrl, interval, currentTrack]);

  // Stop the tag if playback pauses.
  useEffect(() => {
    if (!isPlaying && audioRef.current) {
      try { audioRef.current.pause(); } catch { /* ignore */ }
    }
  }, [isPlaying]);

  return null;
}
