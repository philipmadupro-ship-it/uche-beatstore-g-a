'use client';

import { useState } from 'react';
import { Music, Sliders, Play, Pause, Download, Volume2, HardDrive, Info } from 'lucide-react';
import { StemPlayer } from '@/components/stems/StemPlayer';
import { ShareWaveformVinyl } from '@/components/share/ShareWaveformVinyl';

interface CreatorProfile {
  display_name?: string | null;
}

interface Track {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

interface Stem {
  track_id: string;
  status: string;
  vocals_url?: string | null;
  drums_url?: string | null;
  bass_url?: string | null;
  other_url?: string | null;
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
  stems?: Stem[] | null;
  onPlay: (track: Track) => void;
  playingId?: string | null;
  isPlaying?: boolean;
}

export function ProducerShareVariant({ project, tracks, creator, stems = [], onPlay, playingId, isPlaying }: Props) {
  const currentTrack = tracks.find((t) => t.id === playingId) || tracks[0];
  const displayName = creator?.display_name || project.name;

  // Find stems for current track
  const currentStems = stems?.find((s) => s.track_id === currentTrack?.id);
  const hasStems = !!(
    currentStems &&
    currentStems.status === 'done' &&
    currentStems.vocals_url &&
    currentStems.drums_url &&
    currentStems.bass_url &&
    currentStems.other_url
  );

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] font-sans flex flex-col relative overflow-hidden">
      {/* Dynamic ambient accent */}
      <div 
        className="absolute w-[800px] h-[800px] rounded-full pointer-events-none opacity-[0.03] blur-[150px]"
        style={{
          background: 'radial-gradient(circle, #7F77DD 0%, transparent 70%)',
          bottom: '-10%',
          left: '-20%'
        }}
      />

      <div className="flex-1 max-w-6xl mx-auto w-full px-6 md:px-12 pt-16 pb-32 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 z-10">
        
        {/* Left Side: Technical Info & Stems Mixer */}
        <div className="flex flex-col min-w-0">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">
                Collaborator Sandbox
              </p>
              <h2 className="text-2xl font-bold uppercase tracking-wider text-white mt-1">
                Technical stems mixer
              </h2>
            </div>
          </div>

          {/* Master vinyl + waveform — always shown so the producer
              sees their beat at the top, even when stems exist. The
              StemPlayer below operates on the same track but offers
              per-channel mixing. */}
          {currentTrack && (
            <div className="mb-6 flex justify-center">
              <ShareWaveformVinyl
                track={currentTrack as any}
                projectCover={project.cover_url}
                caption={displayName}
                isPlaying={isPlaying}
                playingId={playingId ?? null}
                onTogglePlay={onPlay}
                size="compact"
              />
            </div>
          )}

          {/* Stems player container */}
          {hasStems ? (
            <div className="flex-1 flex flex-col gap-6">
              <StemPlayer
                vocalsUrl={currentStems.vocals_url!}
                drumsUrl={currentStems.drums_url!}
                bassUrl={currentStems.bass_url!}
                otherUrl={currentStems.other_url!}
              />

              {/* Individual Stems Downloads block */}
              <div className="bg-[#14110d]/40 border border-[#1f1a13] rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4 text-[#a08a6a]">
                  <HardDrive size={14} />
                  <h4 className="text-[10px] font-mono uppercase tracking-[0.2em]">Stem downloads (wav/mp3)</h4>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StemDownloadButton name="Vocals" url={currentStems.vocals_url!} trackTitle={currentTrack.title} />
                  <StemDownloadButton name="Drums" url={currentStems.drums_url!} trackTitle={currentTrack.title} />
                  <StemDownloadButton name="Bass" url={currentStems.bass_url!} trackTitle={currentTrack.title} />
                  <StemDownloadButton name="Other" url={currentStems.other_url!} trackTitle={currentTrack.title} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-[400px] bg-[#14110d]/40 border border-[#1f1a13] rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-xl backdrop-blur-sm">
              <Sliders size={36} className="text-[#a08a6a] mb-4 opacity-40" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#E8DCC8] mb-2">No isolated stems found</h3>
              <p className="text-xs text-[#6a5d4a] leading-relaxed max-w-sm">
                No stem groupings have been attached to this track yet. Upload isolated audio stems (vocals, drums, bass, other) in the detail drawer to activate this synchronised multi-channel sandbox mixer.
              </p>
            </div>
          )}
        </div>

        {/* Right Side: Track technical specs & listing */}
        <div className="flex flex-col gap-6">
          
          {/* Tech specs card */}
          <div className="bg-gradient-to-b from-[#14110d] to-[#0a0907] border border-[#1f1a13] rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="flex gap-4 items-center mb-6">
              <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-[#1f1a13] bg-[#0a0907] relative group">
                {currentTrack?.cover_url || project.cover_url ? (
                  <img src={currentTrack?.cover_url || project.cover_url || ''} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={20} /></div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">{displayName}</p>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider truncate mt-0.5">{currentTrack?.title}</h3>
                <p className="text-[10px] font-mono text-[#6a5d4a] uppercase tracking-widest mt-1">{currentTrack?.type || 'Track'}</p>
              </div>
            </div>

            {/* Technical Metadata Row */}
            <div className="grid grid-cols-3 gap-2 border-t border-[#1f1a13] pt-4 mb-6 text-center">
              <div className="bg-[#0c0c0c] border border-[#1f1a13]/60 py-2.5 rounded-lg">
                <p className="text-[8px] font-mono uppercase tracking-widest text-[#6a5d4a]">BPM</p>
                <p className="text-xs font-bold text-white mt-1 font-mono">{currentTrack?.bpm || '—'}</p>
              </div>
              <div className="bg-[#0c0c0c] border border-[#1f1a13]/60 py-2.5 rounded-lg">
                <p className="text-[8px] font-mono uppercase tracking-widest text-[#6a5d4a]">KEY</p>
                <p className="text-xs font-bold text-[#E8D8B8] mt-1 font-mono">{currentTrack?.key || '—'}</p>
              </div>
              <div className="bg-[#0c0c0c] border border-[#1f1a13]/60 py-2.5 rounded-lg">
                <p className="text-[8px] font-mono uppercase tracking-widest text-[#6a5d4a]">SCALE</p>
                <p className="text-xs font-bold text-[#a08a6a] mt-1 font-mono uppercase">{currentTrack?.scale || '—'}</p>
              </div>
            </div>

            {/* Main Master Playback button */}
            {!hasStems && (
              <button
                onClick={() => onPlay(currentTrack)}
                className="w-full flex items-center justify-center gap-3 bg-[#D4BFA0] hover:bg-[#8A7A5C] text-black font-bold uppercase tracking-[0.2em] text-[10px] py-3.5 rounded-xl transition-all shadow-lg shadow-[#D4BFA0]/10"
              >
                {isPlaying && playingId === currentTrack.id ? (
                  <>
                    <Pause size={14} fill="currentColor" /> Pause Master
                  </>
                ) : (
                  <>
                    <Play size={14} className="ml-0.5" fill="currentColor" /> Play Master
                  </>
                )}
              </button>
            )}
          </div>

          {/* Project track directory */}
          <div className="bg-[#14110d]/30 border border-[#1f1a13] rounded-2xl p-5 shadow-xl">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-3">Project Directory</p>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {tracks.map((t, i) => {
                const active = playingId === t.id;
                const hasStemsRow = stems?.some((s) => s.track_id === t.id && s.status === 'done');
                return (
                  <button
                    key={t.id}
                    onClick={() => onPlay(t)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.02] transition-colors text-left text-xs ${
                      active ? 'bg-[#14110d]/80 border border-[#1f1a13]' : 'border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="font-mono text-[#6a5d4a]">{String(i + 1).padStart(2, '0')}</span>
                      <span className={`font-medium truncate ${active ? 'text-[#D4BFA0]' : 'text-white/80'}`}>{t.title}</span>
                    </div>
                    {hasStemsRow && (
                      <span className="bg-[#7F77DD]/10 border border-[#7F77DD]/30 text-[#AFA9EC] text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0">
                        STEMS
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function StemDownloadButton({ name, url, trackTitle }: { name: string; url: string; trackTitle: string }) {
  return (
    <a
      href={url}
      download={`${trackTitle}_${name.toLowerCase()}.wav`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center justify-center p-3 rounded-xl bg-[#0c0c0c] border border-[#1f1a13]/85 hover:border-[#D4BFA0]/50 hover:bg-[#14110d] transition-all text-center text-xs group"
    >
      <span className="text-[10px] font-bold text-white uppercase tracking-wider mb-1">{name}</span>
      <Download size={12} className="text-[#6a5d4a] group-hover:text-[#D4BFA0] transition-colors mt-1" />
    </a>
  );
}
