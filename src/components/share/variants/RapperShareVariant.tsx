'use client';

import { useState } from 'react';
import { Edit3 } from 'lucide-react';
import { ShareWaveformVinyl } from '@/components/share/ShareWaveformVinyl';
import { LyricsStudio } from '@/components/lyrics/LyricsStudio';

interface CreatorProfile {
  display_name?: string | null;
  instagram_handle?: string | null;
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
  lyrics?: string | null;
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

export function RapperShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying }: Props) {
  const currentTrack = tracks.find((t) => t.id === playingId) || tracks[0];
  const displayName = creator?.display_name || project.name;

  // Local state for interactive lyric session notepad
  const [sessionNotes, setSessionNotes] = useState<string>('');
  const [editingNotepad, setEditingNotepad] = useState(false);

  return (
    <div className="min-h-screen bg-[#090907] text-white font-sans flex flex-col relative overflow-hidden">
      {/* Ambient background accent */}
      <div
        className="absolute w-[800px] h-[800px] rounded-full pointer-events-none opacity-[0.03] blur-[150px]"
        style={{
          background: 'radial-gradient(circle, #FFFFFF 0%, transparent 70%)',
          top: '-20%',
          right: '-10%'
        }}
      />

      {/* Top hero — vinyl + waveform of the active track. Replaces
          the old static cover-art block on the right; the topliner
          wants the beat AT the top so they can listen while their
          eyes drop down to the lyric sheet underneath. */}
      {currentTrack && (
        <div className="w-full px-4 sm:px-6 md:px-12 pt-10 sm:pt-12 pb-6 flex justify-center z-10">
          <ShareWaveformVinyl
            track={currentTrack}
            projectCover={project.cover_url}
            caption={displayName}
            isPlaying={isPlaying}
            playingId={playingId ?? null}
            onTogglePlay={onPlay}
            size="compact"
          />
        </div>
      )}

      {/* Main layout */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 md:px-12 pb-32 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 lg:gap-12 z-10">

        {/* Left Side: Full Lyrics Studio — same component used in /studio
            so the rapper gets rhymes / syllable count / version history
            without re-implementing any of it. Reads/writes the track's
            lyrics column server-side. */}
        <div className="flex flex-col min-w-0">
          <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/80">
                Vocalist Workspace
              </p>
              <h2 className="text-xl sm:text-2xl font-bold uppercase tracking-wider text-white mt-1">
                Lyrics &amp; Topline Sheet
              </h2>
            </div>
            {(currentTrack?.bpm || currentTrack?.key) && (
              <div className="flex items-center gap-2 shrink-0">
                {currentTrack.key && (
                  <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg ${
                    currentTrack.scale === 'minor'
                      ? 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/30'
                      : 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/40'
                  }`}>
                    {currentTrack.key}{currentTrack.scale === 'minor' ? 'm' : ''}
                  </span>
                )}
                {currentTrack.bpm && (
                  <span className="text-[10px] font-mono text-white/60 bg-white/[0.04] border border-white/10 px-2.5 py-1 rounded-lg tabular-nums">
                    {currentTrack.bpm} BPM
                  </span>
                )}
              </div>
            )}
          </div>

          {currentTrack ? (
            <LyricsStudio trackId={currentTrack.id} />
          ) : (
            <div className="flex-1 min-h-[450px] bg-white/[0.04]/40 border border-white/10 rounded-2xl p-8 flex items-center justify-center text-white/60">
              <p className="text-sm font-bold uppercase tracking-wider text-white/80">No track selected</p>
            </div>
          )}
        </div>

        {/* Right Side: Writers Session Notepad & Tracks Drawer.
            The vinyl + player card moved to the top hero above —
            no need to duplicate the cover art here. */}
        <div className="flex flex-col gap-8">

          {/* Interactive Writers Notepad — lyric sheet style */}
          <div className="bg-[#0e0c09] border border-white/10 rounded-2xl shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.04]">
              <div className="flex items-center gap-2 text-white/80">
                <Edit3 size={12} />
                <span className="text-[9px] font-mono uppercase tracking-[0.25em]">Session Notepad</span>
              </div>
              <div className="flex items-center gap-3">
                {sessionNotes && (
                  <span className="text-[9px] font-mono text-white/40 tabular-nums">
                    {sessionNotes.split('\n').length} lines · {sessionNotes.replace(/\s/g, '').length} chars
                  </span>
                )}
                <button
                  onClick={() => setEditingNotepad(!editingNotepad)}
                  className="text-[9px] font-mono uppercase tracking-wider text-white hover:text-white/80 transition-colors"
                >
                  {editingNotepad ? 'Done' : 'Edit'}
                </button>
              </div>
            </div>

            <div className="flex flex-1 min-h-[240px] font-mono text-xs">
              {/* Line numbers */}
              <div className="shrink-0 w-8 bg-[#090907] border-r border-white/10 pt-3 pb-3 text-right pr-2 select-none">
                {(sessionNotes || ' ').split('\n').map((_, i) => (
                  <div key={i} className="leading-6 text-[9px] text-white/30">{i + 1}</div>
                ))}
              </div>
              {/* Content */}
              {editingNotepad ? (
                <textarea
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  autoFocus
                  placeholder={"Hook:\n\nVerse 1:\n\nBridge:"}
                  className="flex-1 bg-[#090907] px-3 pt-3 pb-3 text-[12px] text-white placeholder:text-white/30 focus:outline-none resize-none leading-6 tracking-wide"
                  style={{ fontFamily: 'monospace' }}
                />
              ) : (
                <div
                  onClick={() => setEditingNotepad(true)}
                  className="flex-1 px-3 pt-3 pb-3 text-[12px] leading-6 cursor-pointer whitespace-pre-wrap select-text tracking-wide"
                  style={{ fontFamily: 'monospace' }}
                >
                  {sessionNotes
                    ? <span className="text-white">{sessionNotes}</span>
                    : <span className="text-white/30">Click to write bars, hooks, or session notes…</span>
                  }
                </div>
              )}
            </div>
          </div>

          {/* Projects Track List (if multiple tracks) */}
          {tracks.length > 1 && (
            <div className="bg-white/[0.04]/30 border border-white/10 rounded-2xl p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/60 mb-3">Workspace Tracks</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {tracks.map((t, i) => {
                  const active = playingId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPlay(t)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.02] transition-colors text-left text-xs ${
                        active ? 'bg-white/[0.04]/80 border border-white/10' : 'border border-transparent'
                      }`}
                    >
                      <span className="font-mono text-white/60">{String(i + 1).padStart(2, '0')}</span>
                      <span className={`flex-1 font-medium truncate ${active ? 'text-white' : 'text-white/80'}`}>{t.title}</span>
                      <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">{t.key || 'Key'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
