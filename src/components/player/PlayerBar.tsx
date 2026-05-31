'use client';

import { usePlayer } from '@/hooks/usePlayer';
import {
  Volume2, VolumeX,
  ListMusic, Music, Shuffle, Repeat, ChevronDown, X,
} from 'lucide-react';
import { PlayGlyph, PauseGlyph, PrevGlyph, NextGlyph } from './TransportIcons';
import { WavePlayer } from './WavePlayer';
import { MiniWaveform } from './MiniWaveform';
import { QueueDrawer } from './QueueDrawer';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { extractCoverColor } from '@/lib/audio/cover-color';
import { audioSrc } from '@/lib/audio/url';

/**
 * Floating mini-player pill, centered along the bottom edge.
 *
 * Replaces the previous full-width bottom bar. The pill is content-sized
 * (not edge-to-edge), backdrop-blurred, with the waveform inline so the
 * whole player reads as one floating surface rather than chrome glued
 * to the page edge.
 *
 * Business logic is identical to the old PlayerBar — only the visual
 * layer changed. Queue, volume, transport all behave the same.
 */
export function PlayerBar() {
  const {
    currentTrack, isPlaying, togglePlay, next, prev,
    volume, setVolume, progress, queue, seekTo,
    // Pulled from the store now, not local useState — local state
    // was decorative; the playback engine in usePlayer reads these
    // values to decide auto-advance / shuffle order.
    shuffle, toggleShuffle, repeat, cycleRepeat,
  } = usePlayer();

  // ── Preload the next track for near-gapless advance ──────────────
  // The gap between tracks today is the next file's network fetch. We
  // warm the browser HTTP cache (audio + peaks sidecar) for the next
  // sequential track while the current one plays, so useWaveSurfer's
  // load() resolves instantly on advance. Skipped in shuffle (next is
  // unpredictable) and when paused (don't burn data in the background).
  useEffect(() => {
    if (!isPlaying || shuffle || !currentTrack || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    const upcoming = queue[idx + 1] ?? (repeat === 'all' ? queue[0] : null);
    if (!upcoming?.audio_url || upcoming.id === currentTrack.id) return;
    const ctrl = new AbortController();
    // Low-priority so it never competes with the current track's stream.
    fetch(audioSrc(upcoming.audio_url), { signal: ctrl.signal, priority: 'low' as RequestPriority }).catch(() => {});
    if (upcoming.peaks_url) {
      fetch(upcoming.peaks_url, { signal: ctrl.signal, cache: 'force-cache' }).catch(() => {});
    }
    return () => ctrl.abort();
  }, [currentTrack?.id, isPlaying, shuffle, repeat, queue]);
  // Mute is implemented by setting engine volume to 0 and stashing
  // the previous level so we can restore it on unmute. Without this,
  // clicking mute just flipped a local boolean — the audio kept
  // playing at the previous volume.
  const muted = volume === 0;
  const prevVolumeRef = useRef(volume || 0.8);
  const toggleMute = () => {
    if (volume > 0) {
      prevVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(prevVolumeRef.current || 0.8);
    }
  };
  const [queueOpen, setQueueOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Ambient color from cover art ────────────────────────────────
  // Extracted once per cover and used to tint the Now Playing overlay.
  const [ambient, setAmbient] = useState<string | null>(null);
  const coverUrl = currentTrack?.cover_url ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!coverUrl) { setAmbient(null); return; }
    extractCoverColor(coverUrl).then((c) => { if (!cancelled) setAmbient(c); });
    return () => { cancelled = true; };
  }, [coverUrl]);

  // ── Global keyboard shortcuts ───────────────────────────────────
  // Space play/pause · ←/→ seek 5s · ↑/↓ volume · n/p next/prev · m mute.
  // Ignored while the user is typing in a field or a modal input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const dur = currentTrack?.duration_seconds || 0;
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowRight': if (dur > 0) { e.preventDefault(); seekTo(Math.min(1, progress + 5 / dur)); } break;
        case 'ArrowLeft':  if (dur > 0) { e.preventDefault(); seekTo(Math.max(0, progress - 5 / dur)); } break;
        case 'ArrowUp':   e.preventDefault(); setVolume(Math.min(1, volume + 0.1)); break;
        case 'ArrowDown': e.preventDefault(); setVolume(Math.max(0, volume - 0.1)); break;
        case 'n': case 'N': next(); break;
        case 'p': case 'P': prev(); break;
        case 'm': case 'M':
          if (volume > 0) { prevVolumeRef.current = volume; setVolume(0); }
          else setVolume(prevVolumeRef.current || 0.8);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentTrack, progress, volume, togglePlay, next, prev, seekTo, setVolume]);

  if (!currentTrack) return null;

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalSeconds = currentTrack.duration_seconds || 0;
  const currentSeconds = totalSeconds * progress;

  return (
    <>
      <div className="fixed bottom-3 md:bottom-5 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-50 pointer-events-none flex justify-center">
        <div
          className={cn(
            'pointer-events-auto relative flex items-center gap-2 md:gap-3 pl-2 pr-2 md:pr-3 py-2 rounded-[28px]',
            // Deep frosted glass: maximal blur + saturation, a very translucent
            // warm base so the page reads clearly through it, a bright top
            // edge-light + a faint bottom shade, and a soft far-cast shadow.
            'backdrop-blur-3xl backdrop-saturate-[1.8] border border-white/[0.10]',
            'bg-[#14110d]/55',
            'shadow-[0_16px_50px_-8px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.3)]',
            'transition-shadow duration-300 hover:shadow-[0_22px_60px_-8px_rgba(0,0,0,0.68),0_2px_8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.14)]',
            'animate-in slide-in-from-bottom-4 fade-in duration-300',
            // Below md: no min-width, fill the screen edges-minus-padding.
            // md+: anchor to the center column with the original
            // proportions so the pill never blows out on ultra-wide.
            'w-full md:w-auto md:min-w-[640px] md:max-w-[920px]',
          )}
        >
          {/* Glass sheen — a top-down light reflection across the surface,
              clipped to the pill radius. Pure decoration, no hit-testing. */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-[28px] pointer-events-none bg-gradient-to-b from-white/[0.07] via-transparent to-white/[0.015]"
          />

          {/* Cover + name + meta — left cap of the pill. */}
          <div className="flex items-center gap-2 md:gap-3 pl-1 pr-2 md:pr-3 py-1 min-w-0">
            <button
              onClick={() => setNowPlayingOpen(true)}
              className="w-10 h-10 md:w-11 md:h-11 bg-[#14110d] rounded-[13px] overflow-hidden flex-shrink-0 border border-white/[0.08] relative group/cover shadow-[0_2px_10px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)] transition-transform duration-200 hover:scale-[1.04] active:scale-95"
              aria-label="Open Now Playing"
            >
              {currentTrack.cover_url ? (
                <img loading="lazy" src={currentTrack.cover_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#3a3328] bg-gradient-to-br from-[#2A2418] to-[#0a0907]">
                  <Music size={14} />
                </div>
              )}
              <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px] opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-center justify-center">
                <ChevronDown size={15} className="text-white rotate-180" />
              </div>
            </button>
            <div className="min-w-0 flex-1 md:flex-initial md:max-w-[160px]">
              <h4 className="text-[12px] font-medium text-[#E8DCC8] truncate leading-tight">{currentTrack.title || 'Untitled'}</h4>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] font-mono text-[#5a5142] uppercase tracking-wider">
                  {currentTrack.type}{currentTrack.bpm ? ` · ${currentTrack.bpm}` : ''}
                </span>
                {currentTrack.key && (
                  <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none ${
                    (currentTrack as any).scale === 'minor'
                      ? 'text-[#9d95e8] bg-[#1a1833]/70 border border-[#534AB7]/25'
                      : 'text-[#c8a47a] bg-[#1f1a10]/70 border border-[#3d3020]/35'
                  }`}>
                    {currentTrack.key}{(currentTrack as any).scale === 'minor' ? 'm' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Waveform + scrub + times — hidden below md (phone pill is
              cover + transport only). md+ keeps the inline waveform. */}
          <div className="hidden md:flex items-center gap-2.5 min-w-0">
            <span className="text-[10px] font-mono text-[#c8b89a] tabular-nums w-9 text-right shrink-0">
              {formatTime(currentSeconds)}
            </span>
            <div className="relative w-[210px] h-8 flex items-center px-1.5 rounded-xl bg-black/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]">
              {currentTrack.audio_url ? (
                <WavePlayer
                  url={currentTrack.audio_url}
                  trackId={currentTrack.id}
                  peaksUrl={currentTrack.peaks_url ?? null}
                  hideControls
                  onFinish={next}
                  height={28}
                />
              ) : (
                <div className="w-full h-[2px] bg-white/10 rounded" />
              )}
              {/* Progression playhead — a slim warm line that tracks the song
                  across the waveform, glowing softly. Driven by the global
                  `progress` (0..1); offset by the 6px wrapper padding. */}
              {currentTrack.audio_url && totalSeconds > 0 && (
                <div
                  className="absolute top-1 bottom-1 w-[2px] bg-[#F0E6D2] rounded-full pointer-events-none shadow-[0_0_8px_rgba(240,230,210,0.8)] transition-[left] duration-150 ease-linear"
                  style={{ left: `calc(6px + ${Math.min(1, Math.max(0, progress))} * (100% - 12px))` }}
                />
              )}
            </div>
            <span className="text-[10px] font-mono text-[#5a5142] tabular-nums w-9 shrink-0">
              {formatTime(totalSeconds)}
            </span>
          </div>

          {/* Transport — center-right. The play button is the dominant
              circular element so it reads as the pill's "anchor". */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={prev} className="w-8 h-8 flex items-center justify-center rounded-full text-[#a08a6a] hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all" aria-label="Previous track">
              <PrevGlyph size={15} />
            </button>
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full flex items-center justify-center text-black ml-0.5 mr-0.5 bg-gradient-to-b from-white to-[#ece4d4] hover:scale-[1.07] active:scale-95 transition-transform duration-150 shadow-[0_3px_12px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <PauseGlyph size={16} /> : <PlayGlyph size={16} className="ml-0.5" />}
            </button>
            <button onClick={next} className="w-8 h-8 flex items-center justify-center rounded-full text-[#a08a6a] hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all" aria-label="Next track">
              <NextGlyph size={15} />
            </button>
          </div>

          {/* Right utilities — shuffle, repeat, queue, volume. Compact
              icon row; only the icons are visible, no labels. Volume
              uses a small range; full mixer-grade control lives in the
              studio. Progressive disclosure on narrow screens — phone
              keeps only Queue, tablet adds Shuffle/Repeat, desktop adds
              the volume slider. */}
          <div className="flex items-center gap-1 shrink-0 pl-2 md:border-l md:border-white/[0.07] md:ml-1">
            {/* Shuffle + Repeat — hidden below sm (phones) since the
                pill is already cramped with transport + cover. Volume
                stays hidden until md per its hover-slider design. */}
            <button
              onClick={toggleShuffle}
              className={cn(
                'hidden sm:flex w-7 h-7 items-center justify-center transition-all rounded-full active:scale-90 hover:bg-white/[0.05]',
                shuffle ? 'text-[#E8D8B8]' : 'text-[#6a5d4a] hover:text-white',
              )}
              aria-label="Shuffle"
              aria-pressed={shuffle}
              title={shuffle ? 'Shuffle on' : 'Shuffle off'}
            >
              <Shuffle size={12} />
            </button>
            {/* Three-state repeat: off → all → one → off. The Repeat icon
                gets a tiny "1" badge in `one` mode so the user can tell
                the two on-states apart at a glance — same convention
                Apple / Spotify use. */}
            <button
              onClick={cycleRepeat}
              className={cn(
                'hidden sm:flex relative w-7 h-7 items-center justify-center transition-all rounded-full active:scale-90 hover:bg-white/[0.05]',
                repeat !== 'off' ? 'text-[#E8D8B8]' : 'text-[#6a5d4a] hover:text-white',
              )}
              aria-label={`Repeat ${repeat}`}
              title={
                repeat === 'off' ? 'Repeat off' :
                repeat === 'all' ? 'Repeat all' : 'Repeat one'
              }
            >
              <Repeat size={12} />
              {repeat === 'one' && (
                <span className="absolute -top-0.5 -right-0.5 text-[7px] font-bold leading-none">1</span>
              )}
            </button>
            <button
              onClick={() => setQueueOpen(true)}
              className="relative flex items-center gap-1 px-2 h-7 text-[#6a5d4a] hover:text-white transition-colors rounded-full hover:bg-white/[0.04]"
              aria-label="Queue"
            >
              <ListMusic size={12} />
              {queue.length > 0 && (() => {
                const pos = queue.findIndex((t) => t.id === currentTrack?.id);
                return (
                  <span className="text-[9px] font-mono tabular-nums leading-none">
                    {pos >= 0 ? `${pos + 1}/${queue.length}` : queue.length}
                  </span>
                );
              })()}
            </button>
            {/* Volume — clickable mute toggle + hover-revealed slider so
                the pill stays compact in the resting state. Hidden on
                touch-only screens where hover isn't a thing anyway. */}
            <div className="hidden md:flex group relative items-center">
              <button
                onClick={toggleMute}
                className="w-7 h-7 flex items-center justify-center text-[#6a5d4a] hover:text-white transition-colors rounded-full"
                aria-label={muted ? 'Unmute' : 'Mute'}
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              <div className="w-0 group-hover:w-20 overflow-hidden transition-[width] duration-200 flex items-center">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full h-1 cursor-pointer accent-[#E8DCC8] rounded-full"
                  aria-label="Volume"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {queueOpen && <QueueDrawer onClose={() => setQueueOpen(false)} />}

      {/* Full-screen Now Playing overlay — portaled to body so it escapes
          the pill's stacking context and covers everything. */}
      {mounted && nowPlayingOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex flex-col animate-in fade-in duration-300">
          {/* Ambient color wash extracted from the cover, layered under a
              blurred copy of the art — the Spotify now-playing treatment. */}
          <div className="absolute inset-0">
            {ambient && (
              <div
                className="absolute inset-0 transition-colors duration-700"
                style={{ background: `linear-gradient(180deg, ${ambient} 0%, #0a0907 75%)` }}
              />
            )}
            {currentTrack.cover_url ? (
              <img
                src={currentTrack.cover_url}
                alt=""
                className="w-full h-full object-cover scale-110 blur-3xl opacity-30"
              />
            ) : null}
            <div className="absolute inset-0 bg-[#0a0907]/80" />
          </div>

          {/* Content */}
          <div className="relative z-10 flex flex-col h-full max-w-lg mx-auto w-full px-8 pt-safe">
            {/* Top bar */}
            <div className="flex items-center justify-between pt-8 pb-6">
              <button
                onClick={() => setNowPlayingOpen(false)}
                className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[#a08a6a] hover:text-white transition-colors"
                aria-label="Close"
              >
                <ChevronDown size={18} />
              </button>
              <div className="text-center">
                <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#6a5d4a]">Now Playing</p>
              </div>
              <button
                onClick={() => { setNowPlayingOpen(false); setQueueOpen(true); }}
                className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[#a08a6a] hover:text-white transition-colors"
                aria-label="Queue"
              >
                <ListMusic size={15} />
              </button>
            </div>

            {/* Large album art */}
            <div className="flex-1 flex items-center justify-center pb-2">
              <div className="w-full max-w-[300px] aspect-square rounded-2xl overflow-hidden border border-white/[0.08] shadow-[0_32px_80px_rgba(0,0,0,0.6)]">
                {currentTrack.cover_url ? (
                  <img src={currentTrack.cover_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#2A2418] to-[#0a0907] flex items-center justify-center">
                    <Music size={48} className="text-[#3a3328]" />
                  </div>
                )}
              </div>
            </div>

            {/* Track info */}
            <div className="pb-6">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter leading-tight truncate flex-1">
                  {currentTrack.title || 'Untitled'}
                </h2>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-[#6a5d4a] uppercase tracking-widest">
                  {currentTrack.type}
                </span>
                {currentTrack.bpm && (
                  <span className="text-[10px] font-mono text-[#6a5d4a] tabular-nums">· {currentTrack.bpm} BPM</span>
                )}
                {currentTrack.key && (
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    (currentTrack as any).scale === 'minor'
                      ? 'text-[#9d95e8] bg-[#1a1833]/70 border border-[#534AB7]/30'
                      : 'text-[#c8a47a] bg-[#1f1a10]/70 border border-[#3d3020]/40'
                  }`}>
                    {currentTrack.key}{(currentTrack as any).scale === 'minor' ? 'm' : ''}
                  </span>
                )}
              </div>

              {/* Waveform — MiniWaveform reads global progress; no second
                  WaveSurfer instance so the audio can't double-play. */}
              <div className="mt-5 mb-2">
                {currentTrack.audio_url ? (
                  <MiniWaveform
                    trackId={currentTrack.id}
                    peaksUrl={currentTrack.peaks_url ?? null}
                    height={48}
                    isActive
                  />
                ) : (
                  <div className="w-full h-12 bg-[#1a160f] rounded-lg" />
                )}
              </div>
              <div className="flex justify-between text-[10px] font-mono text-[#5a5142] tabular-nums">
                <span>{formatTime(currentSeconds)}</span>
                <span>{formatTime(totalSeconds)}</span>
              </div>

              {/* Transport */}
              <div className="flex items-center justify-center gap-6 mt-6 mb-4">
                <button
                  onClick={toggleShuffle}
                  className={cn('w-10 h-10 flex items-center justify-center rounded-full transition-colors', shuffle ? 'text-[#E8D8B8]' : 'text-[#6a5d4a] hover:text-white')}
                >
                  <Shuffle size={18} />
                </button>
                <button onClick={prev} className="w-10 h-10 flex items-center justify-center rounded-full text-[#a08a6a] hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all">
                  <PrevGlyph size={24} />
                </button>
                <button
                  onClick={togglePlay}
                  className="w-16 h-16 rounded-full flex items-center justify-center text-black bg-gradient-to-b from-white to-[#ece4d4] hover:scale-[1.06] active:scale-95 transition-transform duration-150 shadow-[0_6px_28px_rgba(0,0,0,0.4),0_0_0_0.5px_rgba(0,0,0,0.06),inset_0_2px_0_rgba(255,255,255,0.9)]"
                >
                  {isPlaying ? <PauseGlyph size={24} /> : <PlayGlyph size={24} className="ml-1" />}
                </button>
                <button onClick={next} className="w-10 h-10 flex items-center justify-center rounded-full text-[#a08a6a] hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all">
                  <NextGlyph size={24} />
                </button>
                <button
                  onClick={cycleRepeat}
                  className={cn('relative w-10 h-10 flex items-center justify-center rounded-full transition-colors', repeat !== 'off' ? 'text-[#E8D8B8]' : 'text-[#6a5d4a] hover:text-white')}
                >
                  <Repeat size={18} />
                  {repeat === 'one' && <span className="absolute -top-0.5 -right-0.5 text-[7px] font-bold leading-none">1</span>}
                </button>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-3 px-2">
                <button onClick={toggleMute} className="text-[#6a5d4a] hover:text-white transition-colors">
                  {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  type="range" min="0" max="1" step="0.01" value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1 h-1 cursor-pointer accent-[#E8DCC8] rounded-full"
                />
                <Volume2 size={15} className="text-[#6a5d4a] opacity-80" />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
