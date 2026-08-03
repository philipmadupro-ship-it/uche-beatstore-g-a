'use client';

import { usePlayer } from '@/hooks/usePlayer';
import {
  Volume2, VolumeX,
  ListMusic, Music, Shuffle, Repeat, ChevronDown,
  AlertTriangle, Loader2,
} from 'lucide-react';
import { PlayGlyph, PauseGlyph, PrevGlyph, NextGlyph } from './TransportIcons';
import { MarqueeText } from './MarqueeText';
import { SimpleAudioEngine } from './SimpleAudioEngine';
import { SpectralWaveform } from './SpectralWaveform';
import { AsciiCoverArt } from './AsciiCoverArt';
import { MiniWaveform } from './MiniWaveform';
import { QueueDrawer } from './QueueDrawer';
import { useState, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { CoverImage } from '@/components/ui/CoverImage';
import { getPlayerStreamStatus } from '@/lib/audio/player-status';
import { useAudioReactivity } from '@/hooks/useAudioReactivity';
import { useNextTrackPreload } from '@/hooks/useNextTrackPreload';
import { useAmbientCoverColor } from '@/hooks/useAmbientCoverColor';
import { usePlayerKeyboardShortcuts } from '@/hooks/usePlayerKeyboardShortcuts';

const subscribeToClientSnapshot = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

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
    volume, setVolume, progress, queue, seekTo, isBuffering, playbackError,
    // Pulled from the store now, not local useState — local state
    // was decorative; the playback engine in usePlayer reads these
    // values to decide auto-advance / shuffle order.
    shuffle, toggleShuffle, repeat, cycleRepeat,
  } = usePlayer();

  useNextTrackPreload({ currentTrack, queue, isPlaying, shuffle, repeat });

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
  const mounted = useSyncExternalStore(subscribeToClientSnapshot, getClientSnapshot, getServerSnapshot);

  // Ambient colour from the cover art, used to tint the Now Playing overlay.
  const displayAmbient = useAmbientCoverColor(currentTrack?.cover_url);

  usePlayerKeyboardShortcuts({
    currentTrack, progress, volume, togglePlay, next, prev, seekTo, setVolume, prevVolumeRef,
  });

  // Analysis for the reactive cover art. Module-cached per track, so when the
  // Now Playing card is open alongside the store drawer this is a cache hit
  // rather than a second decode. Called before the early return below because
  // hooks must run unconditionally. Same hook as the store preview drawer, so
  // both surfaces react identically by construction rather than by coincidence.
  const { level: nowPlayingLevel, bass: nowPlayingBass } = useAudioReactivity(
    currentTrack?.id ?? null,
    currentTrack?.audio_url,
    progress,
    true,
    currentTrack?.bands_url,
  );

  if (!currentTrack) return null;

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalSeconds = currentTrack.duration_seconds || 0;
  const currentSeconds = totalSeconds * progress;
  const streamStatus = getPlayerStreamStatus({
    hasAudioUrl: Boolean(currentTrack.audio_url),
    isPlaying,
    isBuffering,
    playbackError,
    trackType: currentTrack.type,
    bpm: currentTrack.bpm,
  });
  const handlePrimaryPlay = () => {
    if (!streamStatus.canAttemptPlayback) return;
    togglePlay();
  };

  return (
    <>
      {/* Global audio engine — plain <audio>, plays on every viewport
          (the old WaveSurfer player only rendered at md+, so phones got
          no sound). Headless; renders nothing visible. */}
      <SimpleAudioEngine />

      <div
        className="fixed bottom-3 md:bottom-5 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-50 pointer-events-none flex justify-center"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className={cn(
            'pointer-events-auto relative flex items-center gap-2 md:gap-3 pl-2 pr-2 md:pr-3 py-2 rounded-full',
            // Frosted glass: blur + a translucent base so the page reads
            // through it, one hairline edge, one soft cast shadow to lift it
            // off the page. Previously this stacked four shadow layers plus a
            // hover swap and a gradient sheen overlay — one signal is enough.
            'backdrop-blur-2xl border border-white/[0.10]',
            'bg-white/[0.04]/55',
            'shadow-[0_16px_50px_-8px_rgba(0,0,0,0.55)]',
            'animate-in slide-in-from-bottom-4 fade-in duration-300',
            // Below md: no min-width, fill the screen edges-minus-padding.
            // md+: anchor to the center column with the original
            // proportions so the pill never blows out on ultra-wide.
            'w-full md:w-auto md:min-w-[640px] md:max-w-[920px]',
          )}
        >
          {/* Cover + name + meta — left cap of the pill. */}
          <div className="flex items-center gap-2 md:gap-3 pl-1 pr-2 md:pr-3 py-1 min-w-0">
            <button
              onClick={() => setNowPlayingOpen(true)}
              className="w-10 h-10 md:w-11 md:h-11 bg-white/[0.04] rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.08] relative group/cover transition-transform duration-200 active:scale-95"
              aria-label="Open Now Playing"
            >
              {currentTrack.cover_url ? (
                <CoverImage src={currentTrack.cover_url} alt="" sizes="44px" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/30 bg-white/[0.04]">
                  <Music size={14} />
                </div>
              )}
              <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px] opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-center justify-center">
                <ChevronDown size={15} className="text-white rotate-180" />
              </div>
            </button>
            <div className="min-w-0 flex-1 md:flex-none md:w-[160px]">
              <MarqueeText text={currentTrack.title || 'Untitled'} className="text-[11px] font-medium text-white leading-tight" />
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                  {streamStatus.metaLabel}
                </span>
                {streamStatus.badgeLabel ? (
                  <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none text-red-200 bg-red-950/50 border border-red-400/20">
                    <AlertTriangle size={9} />
                    {streamStatus.badgeLabel}
                  </span>
                ) : currentTrack.key && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none text-[#c8a47a] bg-[#1f1a10]/70 border border-[#3d3020]/35">
                    {currentTrack.key}{currentTrack.scale === 'minor' ? 'm' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Waveform + times — hidden below md (phone pill is cover +
              transport only). The bars are MiniWaveform (pure SVG, peaks
              when available else a synthetic shape — never the WaveSurfer
              decode that used to crash playback). Audio plays via the
              headless SimpleAudioEngine; this is purely the visual + seek. */}
          <div className="hidden md:flex items-center gap-2.5 min-w-0">
            <span className="text-[10px] font-mono text-[#c8b89a] tabular-nums w-9 text-right shrink-0">
              {formatTime(currentSeconds)}
            </span>
            <div className="w-[210px] h-8 flex items-center px-1.5 rounded-xl bg-black/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]">
              {currentTrack.audio_url ? (
                <MiniWaveform
                  trackId={currentTrack.id}
                  peaksUrl={currentTrack.peaks_url}
                  height={26}
                  isActive
                />
              ) : (
                <div className="w-full h-[2px] bg-white/10 rounded" />
              )}
            </div>
            <span className="text-[10px] font-mono text-white/40 tabular-nums w-9 shrink-0">
              {formatTime(totalSeconds)}
            </span>
          </div>

          {/* Transport — center-right. The play button is the dominant
              circular element so it reads as the pill's "anchor". */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={prev} className="w-8 h-8 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all" aria-label="Previous track">
              <PrevGlyph size={15} />
            </button>
            <button
              onClick={handlePrimaryPlay}
              disabled={!streamStatus.canAttemptPlayback}
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center text-black ml-0.5 mr-0.5 bg-white active:scale-95 transition-transform duration-150',
                streamStatus.canAttemptPlayback ? 'hover:scale-[1.05]' : 'cursor-not-allowed opacity-55',
              )}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={streamStatus.detail ?? streamStatus.title}
            >
              {isBuffering ? <Loader2 size={16} className="animate-spin" /> : isPlaying ? <PauseGlyph size={16} /> : <PlayGlyph size={16} className="ml-0.5" />}
            </button>
            <button onClick={next} className="w-8 h-8 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all" aria-label="Next track">
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
                shuffle ? 'text-white' : 'text-white/60 hover:text-white',
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
                repeat !== 'off' ? 'text-white' : 'text-white/60 hover:text-white',
              )}
              aria-label={`Repeat ${repeat}`}
              title={
                repeat === 'off' ? 'Repeat off' :
                repeat === 'all' ? 'Repeat all' : 'Repeat one'
              }
            >
              <Repeat size={12} />
              {repeat === 'one' && (
                <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold leading-none">1</span>
              )}
            </button>
            <button
              onClick={() => setQueueOpen(true)}
              className="relative flex items-center gap-1 px-2 h-7 text-white/60 hover:text-white transition-colors rounded-full hover:bg-white/[0.04]"
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
                className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white transition-colors rounded-full"
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
                  className="w-full h-1 cursor-pointer accent-white rounded-full"
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-300">
          {/* Ambient backdrop — a color wash + heavily blurred copy of the
              cover (the Spotify depth treatment). Clicking it closes. */}
          <button
            aria-label="Close now playing"
            onClick={() => setNowPlayingOpen(false)}
            className="absolute inset-0 cursor-default"
          >
            {displayAmbient && (
              <div
                className="absolute inset-0 transition-colors duration-700"
                style={{ background: `linear-gradient(180deg, ${displayAmbient} 0%, #090907 80%)` }}
              />
            )}
            {currentTrack.cover_url ? (
              <CoverImage
                src={currentTrack.cover_url}
                alt=""
                sizes="100vw"
                className="w-full h-full object-cover scale-125 blur-[72px] opacity-40"
              />
            ) : null}
            <div className="absolute inset-0 bg-[#090907]/70 backdrop-blur-2xl" />
          </button>

          {/* The card — solid, luxury, centered. Holds the whole now-playing
              experience: vinyl, title, waveform, transport, volume. */}
          <div className="relative z-10 w-full max-w-[400px] max-h-[94vh] overflow-y-auto no-scrollbar rounded-[20px] border border-white/[0.09] bg-[#14110d] shadow-[0_40px_120px_-12px_rgba(0,0,0,0.78)] px-6 pt-5 pb-6">
            {/* Top bar */}
            <div className="flex items-center justify-between pb-1">
              <button
                onClick={() => setNowPlayingOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label="Close"
              >
                <ChevronDown size={18} />
              </button>
              <div className="text-center">
                <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/60">Now Playing</p>
              </div>
              <button
                onClick={() => { setNowPlayingOpen(false); setQueueOpen(true); }}
                className="grid h-8 w-8 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label="Queue"
              >
                <ListMusic size={15} />
              </button>
            </div>

            {/* Cover art — clean and unobstructed. The waveform used to be
                painted over this image; artwork and waveform are two different
                jobs (one sells the beat, one lets you read it), so they're now
                separate elements. */}
            <div className="flex items-center justify-center pt-5 pb-1">
              <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.04]">
                {currentTrack.cover_url ? (
                  <>
                    <CoverImage
                      src={currentTrack.cover_url}
                      alt=""
                      sizes="400px"
                      className="h-full w-full object-cover"
                    />
                    {/* Same audio-reactive ASCII treatment as the store preview,
                        so the card and the drawer are one visual language. */}
                    <AsciiCoverArt
                      src={currentTrack.cover_url}
                      level={nowPlayingLevel}
                      bass={nowPlayingBass}
                      playing={isPlaying}
                      className="absolute inset-0 h-full w-full mix-blend-screen opacity-80"
                    />
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/25">
                    <Music size={44} />
                  </div>
                )}
                {playbackError && streamStatus.canAttemptPlayback && (
                  <button
                    onClick={togglePlay}
                    className="absolute inset-x-3 bottom-3 rounded-lg border border-white/15 bg-black/70 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white backdrop-blur-sm"
                  >
                    Retry playback
                  </button>
                )}
              </div>
            </div>

            {/* Track info */}
            <div className="pb-1">
              <h2 className="text-2xl font-black text-white uppercase tracking-tighter leading-tight text-center px-2 truncate">
                {currentTrack.title || 'Untitled'}
              </h2>
              <div className="flex items-center justify-center gap-2 flex-wrap mt-1.5">
                <span className="text-[10px] font-mono text-white/60 uppercase tracking-widest">
                  {currentTrack.type}
                </span>
                {currentTrack.bpm && (
                  <span className="text-[10px] font-mono text-white/60 tabular-nums">· {currentTrack.bpm} BPM</span>
                )}
                {currentTrack.key && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded text-[#c8a47a] bg-[#1f1a10]/70 border border-[#3d3020]/40">
                    {currentTrack.key}{currentTrack.scale === 'minor' ? 'm' : ''}
                  </span>
                )}
              </div>

              {/* Spectral waveform — its own lane, coloured by real low/mid/high
                  band energy. Doubles as the scrubber (click, drag, keyboard). */}
              <div className="mt-5">
                <SpectralWaveform
                  trackId={currentTrack.id}
                  audioUrl={currentTrack.audio_url}
                  peaksUrl={currentTrack.peaks_url}
                  progress={progress}
                  isPlaying={isPlaying}
                  canSeek={streamStatus.canSeek && totalSeconds > 0}
                  onSeek={(fraction) => seekTo(fraction)}
                  label={currentTrack.title || 'current track'}
                  durationSeconds={totalSeconds}
                />
                <div className="flex justify-between text-[10px] font-mono text-white/40 tabular-nums mt-1">
                  <span>{formatTime(currentSeconds)}</span>
                  <span>{formatTime(totalSeconds)}</span>
                </div>
              </div>

              {/* Transport — translucent glass fills, one step smaller than
                  before. The play button stays the only solid element so it
                  remains the single obvious action. Tap targets stay >= 40px
                  via padding even though the visual discs are smaller. */}
              <div className="flex items-center justify-center gap-5 mt-5 mb-4">
                <button
                  onClick={toggleShuffle}
                  className={cn(
                    'grid h-9 w-9 place-items-center rounded-full border transition-colors',
                    shuffle
                      ? 'border-white/20 bg-white/[0.12] text-white'
                      : 'border-white/[0.08] bg-white/[0.04] text-white/55 hover:text-white hover:bg-white/[0.08]',
                  )}
                  aria-label={shuffle ? 'Turn shuffle off' : 'Turn shuffle on'}
                  aria-pressed={shuffle}
                >
                  <Shuffle size={15} />
                </button>
                <button
                  onClick={prev}
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white active:scale-90"
                  aria-label="Previous track"
                >
                  <PrevGlyph size={19} />
                </button>
                <button
                  onClick={handlePrimaryPlay}
                  disabled={!streamStatus.canAttemptPlayback}
                  className={cn(
                    'grid h-[3.25rem] w-[3.25rem] place-items-center rounded-full bg-white text-[#090907] transition-transform duration-150 active:scale-95',
                    streamStatus.canAttemptPlayback ? 'hover:scale-[1.04]' : 'cursor-not-allowed opacity-55',
                  )}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  title={streamStatus.detail ?? streamStatus.title}
                >
                  {isPlaying ? <PauseGlyph size={22} /> : <PlayGlyph size={22} className="ml-0.5" />}
                </button>
                <button
                  onClick={next}
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white active:scale-90"
                  aria-label="Next track"
                >
                  <NextGlyph size={19} />
                </button>
                <button
                  onClick={cycleRepeat}
                  className={cn(
                    'relative grid h-9 w-9 place-items-center rounded-full border transition-colors',
                    repeat !== 'off'
                      ? 'border-white/20 bg-white/[0.12] text-white'
                      : 'border-white/[0.08] bg-white/[0.04] text-white/55 hover:text-white hover:bg-white/[0.08]',
                  )}
                  aria-label={
                    repeat === 'off' ? 'Turn repeat all on' :
                    repeat === 'all' ? 'Switch to repeat one' : 'Turn repeat off'
                  }
                  aria-pressed={repeat !== 'off'}
                >
                  <Repeat size={15} />
                  {repeat === 'one' && <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold leading-none">1</span>}
                </button>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-3 px-2">
                <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors" aria-label={muted ? 'Unmute' : 'Mute'}>
                  {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  type="range" min="0" max="1" step="0.01" value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1 h-1 cursor-pointer accent-white rounded-full"
                  aria-label="Volume"
                  aria-valuetext={`${Math.round(volume * 100)} percent`}
                />
                <Volume2 size={15} className="text-white/60 opacity-80" />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
