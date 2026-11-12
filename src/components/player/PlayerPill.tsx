'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Loader2, Music } from 'lucide-react';
import { PlayGlyph, PauseGlyph, PrevGlyph, NextGlyph } from './TransportIcons';
import { MarqueeText } from './MarqueeText';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { cn } from '@/lib/utils';

export function formatPillTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export interface PlayerPillProps {
  track: { id: string; title: string; cover_url?: string | null; key?: string | null; scale?: string | null };
  artworkTags?: string[];
  metaLabel: string;
  badgeLabel?: string | null;
  isPlaying: boolean;
  isBuffering?: boolean;
  canPlay?: boolean;
  playTitle?: string;
  currentSeconds: number;
  totalSeconds: number;
  /** The seekable waveform between the two times (hidden below md). */
  waveform: ReactNode;
  onOpenNowPlaying?: () => void;
  onPrev: () => void;
  onPlay: () => void;
  onNext: () => void;
  /** Right-hand utilities (shuffle, repeat, queue, volume). Omitted on a share page. */
  children?: ReactNode;
}

/**
 * The floating bottom pill of the app's player: cover and title, times with a
 * waveform, and prev / play / next. Presentational only. `PlayerBar` (the
 * store's and dashboard's global player) and the share page's transport bar
 * render this same component, so they cannot drift apart; what drives it is
 * the caller's business (the global store there, the page's one engine here).
 */
export function PlayerPill({
  track, artworkTags = [], metaLabel, badgeLabel = null, isPlaying, isBuffering = false, canPlay = true, playTitle,
  currentSeconds, totalSeconds, waveform, onOpenNowPlaying, onPrev, onPlay, onNext, children,
}: PlayerPillProps) {
  return (
    <div
      className={cn(
        'pointer-events-auto relative flex items-center gap-2 md:gap-3 pl-2 pr-2 md:pr-3 py-2 rounded-full',
        // Frosted glass: blur + a translucent base so the page reads
        // through it, one hairline edge, one soft cast shadow to lift it
        // off the page. Previously this stacked four shadow layers plus a
        // hover swap and a gradient sheen overlay — one signal is enough.
        // A lighter blur than before (2xl): at that strength the pill read
        // as a solid slab. md + saturate keeps text legible over artwork
        // while the page visibly moves underneath.
        'backdrop-blur-md backdrop-saturate-150 border border-white/[0.10]',
        'bg-white/[0.025]',
        'shadow-[0_16px_50px_-8px_rgba(0,0,0,0.55)]',
'ui-pop-up duration-300',
        // Below md: no min-width, fill the screen edges-minus-padding.
        // md+: anchor to the center column with the original
        // proportions so the pill never blows out on ultra-wide.
        'w-full md:w-auto md:min-w-[640px] md:max-w-[920px]',
      )}
    >
      {/* Cover + name + meta — left cap of the pill. */}
      <div className="flex items-center gap-2 md:gap-3 pl-1 pr-2 md:pr-3 py-1 min-w-0">
        <button
          onClick={onOpenNowPlaying}
          className="w-10 h-10 md:w-11 md:h-11 bg-white/[0.04] rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.08] relative group/cover transition-transform duration-200 active:scale-95"
          aria-label="Open Now Playing"
        >
          {/* The player is on screen on every route, so a coverless beat
              showed a grey glyph app-wide while its own row two inches
              above rendered generated artwork. */}
          <ArtworkFallback
            src={track.cover_url}
            seed={track.id}
            tags={artworkTags}
            kind="track"
            sizes="44px"
            className="w-full h-full object-cover"
          >
            <Music size={14} aria-hidden />
          </ArtworkFallback>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px] opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-center justify-center">
            <ChevronDown size={15} className="text-white rotate-180" />
          </div>
        </button>
        <div className="min-w-0 flex-1 md:flex-none md:w-[160px]">
          <MarqueeText text={track.title || 'Untitled'} className="text-[11px] font-medium text-white leading-tight" />
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
              {metaLabel}
            </span>
            {badgeLabel ? (
              <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none text-red-200 bg-red-950/50 border border-red-400/20">
                <AlertTriangle size={9} />
                {badgeLabel}
              </span>
            ) : track.key && (
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none text-[#c8a47a] bg-[#1f1a10]/70 border border-[#3d3020]/35">
                {track.key}{track.scale === 'minor' ? 'm' : ''}
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
          {formatPillTime(currentSeconds)}
        </span>
        <div className="w-[210px] h-8 flex items-center px-1.5 rounded-xl bg-black/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]">
          {waveform}
        </div>
        <span className="text-[10px] font-mono text-white/40 tabular-nums w-9 shrink-0">
          {formatPillTime(totalSeconds)}
        </span>
      </div>

      {/* Transport — center-right. No filled discs; the play button reads
          as the pill's "anchor" via larger glyph size, not a solid fill. */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Transport hit areas are 44px on phones (Apple's minimum touch
            target) and shrink to 32px from md up, where a mouse makes the
            smaller target fine. The glyph size is unchanged — this grows
            the tappable box, not the visual weight. */}
        <button onClick={onPrev} className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all" aria-label="Previous track">
          <PrevGlyph size={15} />
        </button>
        <button
          onClick={onPlay}
          disabled={!canPlay}
          className={cn(
            'glass-play-surface w-12 h-12 md:w-10 md:h-10 rounded-full flex items-center justify-center ml-0.5 mr-0.5 active:scale-95 transition-transform duration-150',
            canPlay ? 'hover:scale-[1.05]' : 'cursor-not-allowed opacity-55',
          )}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-playing={isPlaying ? 'true' : 'false'}
          title={playTitle}
        >
          {isBuffering ? <Loader2 size={18} className="animate-spin" /> : isPlaying ? <PauseGlyph size={20} /> : <PlayGlyph size={20} className="ml-0.5" />}
        </button>
        <button onClick={onNext} className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all" aria-label="Next track">
          <NextGlyph size={15} />
        </button>
      </div>
{children}
        </div>
  );
}
