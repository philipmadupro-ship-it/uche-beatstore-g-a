'use client';

import { useState } from 'react';
import { SkipForward, SkipBack } from 'lucide-react';
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
}

export function FriendShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying }: Props) {
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
    <div className="min-h-screen bg-[#0a0907] flex flex-col items-center justify-center text-[#E8DCC8] p-6 relative overflow-hidden font-sans">
      {/* Soft elegant ambient background glow */}
      <div 
        className="absolute w-[600px] h-[600px] rounded-full pointer-events-none opacity-[0.04] blur-[120px]"
        style={{
          background: 'radial-gradient(circle, #7F77DD 0%, transparent 70%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)'
        }}
      />

      <div className="w-full max-w-[420px] z-10 flex flex-col items-center">
        {/* Creator credit above vinyl */}
        <div className="mb-4 text-center">
          <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#4a4338]">Shared by</p>
          <p className="text-[13px] font-bold text-[#a08a6a] mt-0.5 tracking-wide">{displayName}</p>
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
          />
        </div>

        {/* Track position indicator */}
        {tracks.length > 1 && playingId && (
          <p className="text-[9px] font-mono text-[#4a4338] mb-4 tabular-nums tracking-widest">
            {tracks.findIndex((t) => t.id === playingId) + 1} / {tracks.length}
          </p>
        )}

        {/* Prev / Next controls */}
        <div className="flex items-center justify-center gap-6 mb-8">
          <button
            onClick={handlePrev}
            disabled={tracks.length <= 1}
            className="w-10 h-10 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-[#E8DCC8] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.02] border border-transparent hover:border-white/[0.05] transition-all"
          >
            <SkipBack size={16} />
          </button>
          <button
            onClick={handleNext}
            disabled={tracks.length <= 1}
            className="w-10 h-10 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-[#E8DCC8] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.02] border border-transparent hover:border-white/[0.05] transition-all"
          >
            <SkipForward size={16} />
          </button>
        </div>

        {/* Tracks list */}
        {tracks.length > 1 && (
          <div className="w-full bg-[#0e0c09] border border-[#1f1a13] rounded-2xl overflow-hidden max-h-52 overflow-y-auto">
            <div className="px-4 py-2.5 border-b border-[#1f1a13]">
              <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#4a4338]">{tracks.length} tracks</p>
            </div>
            <div className="divide-y divide-[#1a160f]">
              {tracks.map((t, i) => {
                const active = playingId === t.id;
                const dur = (t as any).duration_seconds;
                return (
                  <button
                    key={t.id}
                    onClick={() => onPlay(t)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015] transition-colors text-left ${
                      active ? 'bg-[#14110d]/60' : ''
                    }`}
                  >
                    <span className="font-mono text-[9px] text-[#4a4338] w-5 shrink-0 tabular-nums">{i + 1}</span>
                    <span className={`flex-1 text-[12px] font-medium truncate ${active ? 'text-[#D4BFA0]' : 'text-[#E8DCC8]/80'}`}>
                      {t.title}
                    </span>
                    {dur > 0 && (
                      <span className="text-[9px] font-mono text-[#4a4338] tabular-nums shrink-0">
                        {Math.floor(dur / 60)}:{String(Math.floor(dur % 60)).padStart(2, '0')}
                      </span>
                    )}
                    {active && isPlaying && (
                      <span className="flex gap-0.5 items-end h-2 shrink-0 ml-1">
                        <span className="w-0.5 h-1 bg-[#D4BFA0] animate-[pulse_0.6s_ease-in-out_infinite]" />
                        <span className="w-0.5 h-2 bg-[#D4BFA0] animate-[pulse_0.8s_ease-in-out_infinite]" />
                        <span className="w-0.5 h-1.5 bg-[#D4BFA0] animate-[pulse_0.7s_ease-in-out_infinite]" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Project description if present */}
        {project.description && (
          <p className="mt-6 text-center text-[11px] text-[#6a5d4a] leading-relaxed max-w-[320px]">
            {project.description}
          </p>
        )}
      </div>
    </div>
  );
}
