'use client';

import { useState } from 'react';
import { Play, Pause, Music, Sliders, Disc, Plus, Edit3, Save } from 'lucide-react';
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
            {currentTrack?.bpm || currentTrack?.key ? (
              <div className="flex items-center gap-3 bg-[#14110d] border border-[#1f1a13] px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase text-[#D4BFA0]">
                {currentTrack.key && <span>Key: {currentTrack.key} {currentTrack.scale || ''}</span>}
                {currentTrack.bpm && <span>BPM: {currentTrack.bpm}</span>}
              </div>
            ) : null}
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

          {/* Interactive Writers Notepad */}
          <div className="bg-[#14110d]/50 border border-[#1f1a13] rounded-2xl p-6 shadow-xl flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[#a08a6a]">
                <Edit3 size={14} />
                <span className="text-[10px] font-mono uppercase tracking-[0.2em]">Session Notepad</span>
              </div>
              <button 
                onClick={() => setEditingNotepad(!editingNotepad)}
                className="text-[9px] font-mono uppercase text-[#D4BFA0] hover:text-[#8A7A5C] transition-colors"
              >
                {editingNotepad ? 'Save Sketch' : 'Edit Text'}
              </button>
            </div>

            {editingNotepad ? (
              <textarea
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="Sketch out your lyrics, bars, hooks, or notes here while the track plays..."
                className="w-full flex-1 min-h-[220px] bg-[#0a0907] border border-[#1f1a13] rounded-xl px-4 py-3 text-xs text-[#E8DCC8] placeholder:text-[#4a4338] focus:outline-none focus:border-[#D4BFA0] resize-none font-sans leading-relaxed"
              />
            ) : (
              <div 
                onClick={() => setEditingNotepad(true)}
                className="w-full flex-1 min-h-[220px] bg-[#0a0907]/30 border border-[#1f1a13]/60 rounded-xl px-4 py-3 text-xs text-[#6a5d4a] hover:border-[#1f1a13] cursor-pointer whitespace-pre-wrap leading-relaxed select-text"
              >
                {sessionNotes || "Write notes or lyrics here during your session... (Click to edit)"}
              </div>
            )}
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
