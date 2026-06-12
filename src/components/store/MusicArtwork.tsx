'use client';

/**
 * MusicArtwork — vinyl record visual that peeks out from behind a cover
 * on hover and spins while playing.
 *
 * Composition contract: the parent renders the cover art at full size
 * and this component absolutely-positioned behind it (z-index lower
 * than the cover image). On parent `:hover` the vinyl translates out
 * to the left via the `.vinyl-slide` class from globals.css.
 *
 * Spin: uses the existing `vinylSpin` @keyframes (8s linear infinite).
 * Pause: sets `animationPlayState: 'paused'`, which freezes the CSS
 * animation at its current rotation — no JS rotation capture needed.
 */

import { useState } from 'react';
import { Music as MusicIcon, Loader2 } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';

export interface MusicArtworkProps {
  /** Producer / artist label shown on the vinyl center label */
  artist?: string | null;
  /** Track / project title shown in the hover tooltip */
  music?: string | null;
  /** Mini cover printed on the vinyl center label */
  albumArt?: string | null;
  /** True for single tracks, false for project/album bundles. Drives the
   *  label copy on the vinyl center (centered "song" vs spread "album"). */
  isSong: boolean;
  /** Show a loading state instead of the play/pause affordance */
  isLoading?: boolean;
  /** Whether the parent's audio is currently playing */
  isPlaying: boolean;
  /** Click handler — parent decides what play/pause means in its context */
  onTogglePlay?: () => void;
}

export function MusicArtwork({
  artist,
  music,
  albumArt,
  isSong,
  isLoading,
  isPlaying,
  onTogglePlay,
}: MusicArtworkProps) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div
      // Vinyl wrapper — same size as the cover, sits in the same square
      // before the slide. The .vinyl-slide class handles the hover-driven
      // translate via globals.css (so reduced-motion can disable it).
      className="vinyl-slide pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <div
        // The disc itself. Slightly smaller than the cover so it reads
        // as a record peeking out, not a parallel square.
        className="relative w-[92%] h-[92%] rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.55)]"
        style={{
          background:
            'radial-gradient(circle at center, #211F1A 0%, #090907 24%, #171511 27%, #090907 32%, #171511 35%, #090907 40%, #171511 43%, #090907 48%, #171511 51%, #090907 56%, #171511 59%, #090907 64%, #171511 67%, #090907 72%, #090907 100%)',
          // Spin while playing; pause freezes the rotation in place.
          animation: 'vinylSpin 8s linear infinite',
          animationPlayState: isPlaying ? 'running' : 'paused',
        }}
      >
        {/* Sheen highlight — reads as light catching on vinyl */}
        <div
          className="absolute inset-0 rounded-full opacity-30 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 30% 25%, rgba(232,220,200,0.35) 0%, transparent 35%)',
          }}
        />

        {/* Center label */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36%] h-[36%] rounded-full overflow-hidden border border-[#3B372F] bg-[#171511] flex items-center justify-center">
          {albumArt ? (
            <img src={albumArt} alt="" className="w-full h-full object-cover" />
          ) : (
            <MusicIcon size={16} className="text-[#3B372F]" />
          )}
          {/* Center spindle hole */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[12%] h-[12%] rounded-full bg-[#090907] border border-[#2B2821]" />
          {/* Label text — tiny artist credit visible on the vinyl center */}
          {artist && (
            <div className="absolute bottom-1 left-0 right-0 px-1 text-[7px] font-mono uppercase tracking-[0.1em] text-[#F7EBDD]/70 text-center truncate">
              {isSong ? 'A · ' : ''}{artist}
            </div>
          )}
        </div>
      </div>

      {/* Play / pause hit target — pointer-events-auto re-enables clicks
          on just this central button (parent wrapper is pointer-events-none). */}
      {onTogglePlay && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePlay();
          }}
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:scale-105 active:scale-95"
        >
          {isLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : isPlaying ? (
            <PauseGlyph size={18} />
          ) : (
            <PlayGlyph size={18} className="ml-0.5" />
          )}
        </button>
      )}

      {/* Hover tooltip — title chip floating near the slid-out vinyl edge */}
      {showTip && music && (
        <div className="pointer-events-none absolute left-2 bottom-2 px-2 py-1 rounded bg-black/75 backdrop-blur text-[9px] font-mono uppercase tracking-[0.15em] text-[#F7EBDD] z-20 max-w-[80%] truncate">
          {music}
        </div>
      )}
    </div>
  );
}
