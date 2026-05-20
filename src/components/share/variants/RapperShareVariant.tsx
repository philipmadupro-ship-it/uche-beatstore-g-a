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
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] font-sans flex flex-col relative overflow-hidden">
      {/* Ambient background accent */}
      <div 
        className="absolute w-[800px] h-[800px] rounded-full pointer-events-none opacity-[0.03] blur-[150px]"
        style={{
          background: 'radial-gradient(circle, #7F77DD 0%, transparent 70%)',
          top: '-20%',
          right: '-10%'
        }}
      />

      {/* Top hero — vinyl + waveform of the active track. Replaces
          the old static cover-art block on the right; the topliner
          wants the beat AT the top so they can listen while their
          eyes drop down to the lyric sheet underneath. */}
      {currentTrack && (
        <div className="w-full px-6 md:px-12 pt-12 pb-6 flex justify-center z-10">
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

      {/* Main layout */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 md:px-12 pb-32 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-12 z-10">

        {/* Left Side: Full Lyrics Studio — same component used in /studio
            so the rapper gets rhymes / syllable count / version history
            without re-implementing any of it. Reads/writes the track's
            lyrics column server-side. */}
        <div className="flex flex-col min-w-0">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">
                Vocalist Workspace
              </p>
              <h2 className="text-2xl font-bold uppercase tracking-wider text-white mt-1">
                Lyrics &amp; Topline Sheet
              </h2>
            </div>
            {(currentTrack?.bpm || currentTrack?.key) && (
              <div className="flex items-center gap-2">
                {currentTrack.key && (
                  <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg ${
                    currentTrack.scale === 'minor'
                      ? 'text-[#9d95e8] bg-[#1a1833]/60 border border-[#534AB7]/30'
                      : 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/40'
                  }`}>
                    {currentTrack.key}{currentTrack.scale === 'minor' ? 'm' : ''}
                  </span>
                )}
                {currentTrack.bpm && (
                  <span className="text-[10px] font-mono text-[#6a5d4a] bg-[#14110d] border border-[#1f1a13] px-2.5 py-1 rounded-lg tabular-nums">
                    {currentTrack.bpm} BPM
                  </span>
                )}
              </div>
            )}
          </div>

          {currentTrack ? (
            <LyricsStudio trackId={currentTrack.id} />
          ) : (
            <div className="flex-1 min-h-[450px] bg-[#14110d]/40 border border-[#1f1a13] rounded-2xl p-8 flex items-center justify-center text-[#6a5d4a]">
              <p className="text-sm font-bold uppercase tracking-wider text-[#a08a6a]">No track selected</p>
            </div>
          )}
        </div>

        {/* Right Side: Writers Session Notepad & Tracks Drawer.
            The vinyl + player card moved to the top hero above —
            no need to duplicate the cover art here. */}
        <div className="flex flex-col gap-8">

          {/* Interactive Writers Notepad — lyric sheet style */}
          <div className="bg-[#0e0c09] border border-[#1f1a13] rounded-2xl shadow-xl flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f1a13] bg-[#14110d]">
              <div className="flex items-center gap-2 text-[#a08a6a]">
                <Edit3 size={12} />
                <span className="text-[9px] font-mono uppercase tracking-[0.25em]">Session Notepad</span>
              </div>
              <div className="flex items-center gap-3">
                {sessionNotes && (
                  <span className="text-[9px] font-mono text-[#4a4338] tabular-nums">
                    {sessionNotes.split('\n').length} lines · {sessionNotes.replace(/\s/g, '').length} chars
                  </span>
                )}
                <button
                  onClick={() => setEditingNotepad(!editingNotepad)}
                  className="text-[9px] font-mono uppercase tracking-wider text-[#D4BFA0] hover:text-[#8A7A5C] transition-colors"
                >
                  {editingNotepad ? 'Done' : 'Edit'}
                </button>
              </div>
            </div>

            <div className="flex flex-1 min-h-[240px] font-mono text-xs">
              {/* Line numbers */}
              <div className="shrink-0 w-8 bg-[#0a0907] border-r border-[#1f1a13] pt-3 pb-3 text-right pr-2 select-none">
                {(sessionNotes || ' ').split('\n').map((_, i) => (
                  <div key={i} className="leading-6 text-[9px] text-[#2d2620]">{i + 1}</div>
                ))}
              </div>
              {/* Content */}
              {editingNotepad ? (
                <textarea
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  autoFocus
                  placeholder={"Hook:\n\nVerse 1:\n\nBridge:"}
                  className="flex-1 bg-[#0a0907] px-3 pt-3 pb-3 text-[12px] text-[#E8DCC8] placeholder:text-[#2d2620] focus:outline-none resize-none leading-6 tracking-wide"
                  style={{ fontFamily: 'monospace' }}
                />
              ) : (
                <div
                  onClick={() => setEditingNotepad(true)}
                  className="flex-1 px-3 pt-3 pb-3 text-[12px] leading-6 cursor-pointer whitespace-pre-wrap select-text tracking-wide"
                  style={{ fontFamily: 'monospace' }}
                >
                  {sessionNotes
                    ? <span className="text-[#E8DCC8]">{sessionNotes}</span>
                    : <span className="text-[#2d2620]">Click to write bars, hooks, or session notes…</span>
                  }
                </div>
              )}
            </div>
          </div>

          {/* Projects Track List (if multiple tracks) */}
          {tracks.length > 1 && (
            <div className="bg-[#14110d]/30 border border-[#1f1a13] rounded-2xl p-5 shadow-xl">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-3">Workspace Tracks</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {tracks.map((t, i) => {
                  const active = playingId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPlay(t)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.02] transition-colors text-left text-xs ${
                        active ? 'bg-[#14110d]/80 border border-[#1f1a13]' : 'border border-transparent'
                      }`}
                    >
                      <span className="font-mono text-[#6a5d4a]">{String(i + 1).padStart(2, '0')}</span>
                      <span className={`flex-1 font-medium truncate ${active ? 'text-[#D4BFA0]' : 'text-white/80'}`}>{t.title}</span>
                      <span className="text-[9px] font-mono text-[#4a4338] uppercase tracking-wider">{t.key || 'Key'}</span>
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
