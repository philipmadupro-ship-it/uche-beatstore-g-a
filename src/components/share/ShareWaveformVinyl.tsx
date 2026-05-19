'use client';

import { Music, Play, Pause } from 'lucide-react';
import { WavePlayer } from '@/components/player/WavePlayer';

interface Track {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  cover_url?: string | null;
  peaks_url?: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

interface Props {
  track: Track | null;
  /** Project-level cover used as the fallback when the track has none. */
  projectCover?: string | null;
  /** Display name on the meta row above the title. */
  caption?: string | null;
  /** Global play state from the parent. */
  isPlaying?: boolean;
  /** Currently-playing id from the parent. The vinyl only spins when
   *  this matches our track. */
  playingId?: string | null;
  /** Toggle play/pause for this track via the parent's player. */
  onTogglePlay?: (track: Track) => void;
  /** Visual variant — `compact` is for sidebars where 200px is the
   *  cap; `large` is for hero spots. */
  size?: 'compact' | 'large';
}

/**
 * Spinning vinyl + waveform — the signature share-page hero that
 * was previously only in FriendShareVariant. Now extracted so the
 * Client, Producer, and Rapper variants can all embed the same
 * "this is the track you're listening to" surface without each
 * re-inventing the layout.
 *
 * The vinyl spins via tailwind's animate-spin keyframe; it only
 * runs when the parent says `isPlaying && playingId === track.id`.
 * The waveform underneath uses the existing WavePlayer which
 * integrates with the global PlayerBar so a click promotes the
 * track to the persistent bottom player. Both surfaces stay in
 * sync because they both read `usePlayer`.
 */
export function ShareWaveformVinyl({
  track,
  projectCover,
  caption,
  isPlaying = false,
  playingId,
  onTogglePlay,
  size = 'large',
}: Props) {
  if (!track) return null;

  const spinning = isPlaying && playingId === track.id;
  const dim = size === 'compact'
    ? { vinyl: 'w-44 h-44 md:w-48 md:h-48', inner: 'w-32 h-32 md:w-36 md:h-36', label: 'w-16 h-16' }
    : { vinyl: 'w-64 h-64 md:w-72 md:h-72', inner: 'w-48 h-48 md:w-56 md:h-56', label: 'w-24 h-24' };

  const cover = track.cover_url || projectCover || null;

  return (
    <div className="w-full flex flex-col items-center">
      {/* Vinyl disc — concentric grooves, cover in the center label,
          spindle hole drawn in the middle of the label so the spin
          looks anchored. */}
      <div className={`relative ${dim.vinyl} rounded-full bg-[#0c0907] border border-black/40 shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_0_40px_rgba(0,0,0,0.6)] flex items-center justify-center group mb-6 ${
        spinning ? 'animate-[spin_8s_linear_infinite]' : ''
      }`}>
        {/* Concentric grooves — thin opacities so the disc doesn't read
            as a flat black circle. */}
        <div className="absolute inset-2 rounded-full border border-white/[0.025]" />
        <div className="absolute inset-6 rounded-full border border-white/[0.02]" />
        <div className="absolute inset-12 rounded-full border border-white/[0.015]" />
        <div className="absolute inset-20 rounded-full border border-white/[0.01]" />

        {/* Center label — slightly inset, holds the cover art with a
            tiny spindle hole punched through. */}
        <div className={`${dim.inner} rounded-full overflow-hidden border-4 border-[#0a0907] relative`}>
          {cover ? (
            <img src={cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#2A2418] to-[#0a0907] flex items-center justify-center text-[#a08a6a]">
              <Music size={32} />
            </div>
          )}
          {/* Spindle hole — the bit that holds the record on the
              turntable. Drawn as a tiny inset circle. */}
          <div className="absolute inset-0 m-auto w-3 h-3 rounded-full bg-[#0a0907] border border-black/60" />
        </div>

        {/* Center play button — appears on hover OR when paused, so
            the user can resume from the vinyl itself without aiming
            at a separate transport. */}
        {onTogglePlay && (
          <button
            onClick={() => onTogglePlay(track)}
            aria-label={spinning ? 'Pause' : 'Play'}
            className={`absolute inset-0 flex items-center justify-center rounded-full transition-opacity ${
              spinning ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
            }`}
          >
            <div className="w-14 h-14 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-2xl">
              {spinning
                ? <Pause size={20} className="text-white" fill="currentColor" />
                : <Play size={20} className="text-white ml-0.5" fill="currentColor" />}
            </div>
          </button>
        )}
      </div>

      {/* Title block — caption (creator/project) + track title +
          quick meta line. */}
      <div className="text-center w-full mb-4 px-4">
        {caption && (
          <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-1">
            {caption}
          </p>
        )}
        <h3 className="text-base md:text-lg font-bold text-white tracking-wide truncate">
          {track.title}
        </h3>
        {(track.bpm || track.key) && (
          <p className="text-[10px] font-mono text-[#6a5d4a] uppercase tracking-widest mt-1">
            {track.bpm ? `${track.bpm} bpm` : ''}
            {track.bpm && track.key ? ' · ' : ''}
            {track.key ? `${track.key}${track.scale ? ' ' + track.scale : ''}` : ''}
          </p>
        )}
      </div>

      {/* Inline waveform — wired to the global PlayerBar via WavePlayer's
          `track` prop. Clicking the embedded play button promotes the
          track to the bottom player instead of starting a second
          decoder; the vinyl above mirrors the play state because it
          reads the same usePlayer store the parent uses. */}
      <div className="w-full max-w-2xl">
        <WavePlayer
          url={track.audio_url}
          peaksUrl={track.peaks_url ?? null}
          trackId={track.id}
          track={track as any}
          height={48}
        />
      </div>
    </div>
  );
}
