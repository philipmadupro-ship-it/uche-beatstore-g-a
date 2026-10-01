'use client';

import type { ReactNode } from 'react';

import { SkipForward, SkipBack } from 'lucide-react';
import { ShareTrackRow, type ShareRowDownload } from '@/components/share/ShareTrackRow';
import { ShareWaveformVinyl } from '@/components/share/ShareWaveformVinyl';

interface CreatorProfile {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  instagram_handle?: string | null;
}

interface Track {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  cover_url?: string | null;
  duration_seconds?: number | null;
}

interface Project {
  id: string;
  name: string;
  cover_url?: string | null;
  description?: string | null;
}

interface Props {
  project: Project;
  tracks: Track[];
  creator: CreatorProfile | null;
  onPlay: (track: Track) => void;
  playingId?: string | null;
  isPlaying?: boolean;
  /** Share options the producer set (downloads, playback, collaboration). ShareActions. */
  actions?: ReactNode;
  /** The page's one audio engine renders its waveform here, under the vinyl. */
  waveRef?: React.RefObject<HTMLDivElement | null>;
  /** Download on the row itself, beside the beat it belongs to. */
  rowDownload?: ShareRowDownload;
}

export function FriendShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying, actions, waveRef, rowDownload }: Props) {
  const currentTrack = tracks.find((t) => t.id === playingId) || tracks[0];
  const displayName = creator?.display_name || project.name;

  const handlePrev = () => {
    if (!playingId || tracks.length <= 1) return;
    const idx = tracks.findIndex((t) => t.id === playingId);
    if (idx > 0) onPlay(tracks[idx - 1]);
  };

  const handleNext = () => {
    if (!playingId || tracks.length <= 1) return;
    const idx = tracks.findIndex((t) => t.id === playingId);
    if (idx < tracks.length - 1) onPlay(tracks[idx + 1]);
  };

  return (
    <div className="min-h-screen bg-[#090907] flex flex-col items-center justify-center text-white p-6 relative overflow-hidden font-sans">
      {/* Soft elegant ambient background glow */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full pointer-events-none opacity-[0.04] blur-[120px]"
        style={{
          background: 'radial-gradient(circle, #FFFFFF 0%, transparent 70%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)'
        }}
      />

      <div className="w-full max-w-[420px] z-10 flex flex-col items-center">
        {/* Creator credit above vinyl */}
        <div className="mb-4 text-center">
          <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/40">Shared by</p>
          <p className="text-[13px] font-bold text-white/80 mt-0.5 tracking-wide">{displayName}</p>
        </div>

        {/* Vinyl + waveform hero */}
        <div className="w-full mb-4">
          <ShareWaveformVinyl
            track={currentTrack ?? null}
            projectCover={project.cover_url}
            caption={displayName}
            isPlaying={isPlaying}
            playingId={playingId}
            onTogglePlay={(t) => onPlay(t)}
            size="large"
            waveRef={waveRef}
          />
        </div>

        {/* Track position indicator */}
        {tracks.length > 1 && playingId && (
          <p className="text-[9px] font-mono text-white/40 mb-4 tabular-nums tracking-widest">
            {tracks.findIndex((t) => t.id === playingId) + 1} / {tracks.length}
          </p>
        )}

        {/* Prev / Next controls */}
        <div className="flex items-center justify-center gap-6 mb-8">
          <button
            onClick={handlePrev}
            disabled={tracks.length <= 1}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.02] border border-transparent hover:border-white/[0.05] transition-all"
          >
            <SkipBack size={16} />
          </button>
          <button
            onClick={handleNext}
            disabled={tracks.length <= 1}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.02] border border-transparent hover:border-white/[0.05] transition-all"
          >
            <SkipForward size={16} />
          </button>
        </div>

        {/* Tracks list */}
        {tracks.length > 1 && (
          <div className="w-full bg-[#0e0c09] border border-white/10 rounded-2xl overflow-hidden max-h-52 overflow-y-auto">
            <div className="px-4 py-2.5 border-b border-white/10">
              <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/40">{tracks.length} tracks</p>
            </div>
            <div className="divide-y divide-white/10">
              {tracks.map((t, i) => (
                <ShareTrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  active={playingId === t.id}
                  isPlaying={!!isPlaying}
                  onPlay={() => onPlay(t)}
                  download={rowDownload}
                />
              ))}
            </div>
          </div>
        )}

        {/* Project description if present */}
        {project.description && (
          <p className="mt-6 text-center text-[11px] text-white/60 leading-relaxed max-w-[320px]">
            {project.description}
          </p>
        )}
        {actions}
      </div>
    </div>
  );
}
