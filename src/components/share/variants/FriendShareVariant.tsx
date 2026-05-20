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
        {/* Vinyl + waveform hero */}
        <div className="w-full mb-6">
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

        {/* Prev / Next controls */}
        <div className="flex items-center justify-center gap-6 mb-10">
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

        {/* Small Tracks List */}
        {tracks.length > 1 && (
          <div className="w-full bg-[#14110d]/50 border border-[#1f1a13]/50 rounded-xl overflow-hidden backdrop-blur-sm max-h-48 overflow-y-auto">
            <div className="divide-y divide-[#1f1a13]/50">
              {tracks.map((t, i) => {
                const active = playingId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => onPlay(t)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left text-xs ${
                      active ? 'bg-white/[0.01]' : ''
                    }`}
                  >
                    <span className="font-mono text-[#6a5d4a]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className={`flex-1 font-medium truncate ${active ? 'text-[#D4BFA0]' : 'text-white/90'}`}>
                      {t.title}
                    </span>
                    {active && isPlaying && (
                      <span className="flex gap-0.5 items-end h-2 shrink-0">
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
      </div>
    </div>
  );
}
