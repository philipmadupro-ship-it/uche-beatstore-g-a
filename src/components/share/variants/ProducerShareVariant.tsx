'use client';

import { Music } from 'lucide-react';
import { ShareWaveformVinyl } from '@/components/share/ShareWaveformVinyl';

/**
 * Producer / collaborator variant — "loops + technical metadata."
 *
 * Earlier iterations centered on a multi-channel stems mixer; that's
 * been stripped. Per the producer flow: this variant is mainly used
 * for sending LOOPS to collaborators, and loops don't have stems —
 * they ARE the stems, basically. Stems-on-exclusive belongs on the
 * Rapper variant (where exclusive licenses unlock the bundle).
 *
 * So the producer page is now intentionally simple:
 *   - Vinyl + waveform at the top
 *   - BPM / key / scale chip card
 *   - Track directory with per-row BPM/key labels
 *
 * The right rail just lists the project's tracks so the collaborator
 * can flip through what's in the share without leaving the page.
 */

interface CreatorProfile {
  display_name?: string | null;
}

interface Track {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
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

export function ProducerShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying }: Props) {
  const currentTrack = tracks.find((t) => t.id === playingId) || tracks[0];
  const displayName = creator?.display_name || project.name;

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] font-sans flex flex-col relative overflow-hidden">
      <div
        className="absolute w-[800px] h-[800px] rounded-full pointer-events-none opacity-[0.03] blur-[150px]"
        style={{ background: 'radial-gradient(circle, #7F77DD 0%, transparent 70%)', bottom: '-10%', left: '-20%' }}
      />

      <div className="flex-1 max-w-6xl mx-auto w-full px-6 md:px-12 pt-16 pb-32 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 z-10">

        {/* Left: vinyl + waveform of whichever track is selected */}
        <div className="flex flex-col min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mb-1">
            Loop pack
          </p>
          <h2 className="text-2xl font-bold uppercase tracking-wider text-white mb-8">
            {displayName}
          </h2>

          {currentTrack && (
            <div className="flex justify-center mb-8">
              <ShareWaveformVinyl
                track={currentTrack as any}
                projectCover={project.cover_url}
                caption={null}
                isPlaying={isPlaying}
                playingId={playingId ?? null}
                onTogglePlay={onPlay}
                size="large"
              />
            </div>
          )}

          {/* BPM / Key / Scale strip for the active track. Read-only —
              the OWNER edits these on /library/[id]; the collaborator
              just consumes. */}
          {currentTrack && (
            <div className="grid grid-cols-3 gap-2 max-w-md mx-auto w-full">
              <MetaCell label="BPM" value={currentTrack.bpm ? String(currentTrack.bpm) : '—'} />
              <MetaCell label="KEY" value={currentTrack.key ?? '—'} />
              <MetaCell label="SCALE" value={currentTrack.scale ?? '—'} dim />
            </div>
          )}

          {project.description && (
            <p className="mt-8 text-[13px] text-[#a08a6a] leading-relaxed max-w-md mx-auto text-center">
              {project.description}
            </p>
          )}
        </div>

        {/* Right: project directory */}
        <div className="flex flex-col gap-6">
          <div className="bg-[#14110d]/30 border border-[#1f1a13] rounded-2xl p-5 shadow-xl">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-3">
              In this share · {tracks.length} loop{tracks.length === 1 ? '' : 's'}
            </p>
            <div className="space-y-1 max-h-[480px] overflow-y-auto">
              {tracks.map((t, i) => {
                const active = playingId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => onPlay(t)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors text-left ${
                      active ? 'bg-[#14110d]/80 border border-[#1f1a13]' : 'border border-transparent'
                    }`}
                  >
                    <span className="font-mono text-[10px] text-[#6a5d4a] tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="w-8 h-8 rounded bg-[#0a0907] border border-[#1f1a13] overflow-hidden shrink-0">
                      {t.cover_url ? (
                        <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                          <Music size={11} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[12px] font-medium truncate ${active ? 'text-[#D4BFA0]' : 'text-white/85'}`}>
                        {t.title}
                      </p>
                      <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mt-0.5">
                        {t.bpm ? `${t.bpm} bpm` : ''}
                        {t.bpm && t.key ? ' · ' : ''}
                        {t.key ? `${t.key}${t.scale ? ' ' + t.scale : ''}` : ''}
                      </p>
                    </div>
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

function MetaCell({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="bg-[#0c0c0c] border border-[#1f1a13]/60 py-3 rounded-lg text-center">
      <p className="text-[9px] font-mono uppercase tracking-widest text-[#6a5d4a]">{label}</p>
      <p className={`text-sm font-bold mt-1 font-mono ${dim ? 'text-[#a08a6a]' : 'text-white'}`}>{value}</p>
    </div>
  );
}
