'use client';

import { useState } from 'react';
import { Edit3 } from 'lucide-react';
import type { ShareRowDownload } from '@/components/share/ShareTrackList';
import { SharePageFrame, type ShareFrameOptions } from '@/components/share/SharePageFrame';
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
  /** Share options the producer set (downloads, playback, collaboration), for the header. */
  options: ShareFrameOptions;
  /** The page's one audio engine renders its waveform here, under the vinyl. */
  waveRef?: React.RefObject<HTMLDivElement | null>;
  /** Download on the row itself, beside the beat it belongs to. */
  rowDownload?: ShareRowDownload;
}

export function RapperShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying, options, waveRef, rowDownload }: Props) {
  const currentTrack = tracks.find((t) => t.id === playingId) || tracks[0];

  // Local state for interactive lyric session notepad
  const [sessionNotes, setSessionNotes] = useState<string>('');
  const [editingNotepad, setEditingNotepad] = useState(false);

  return (
    <SharePageFrame
      project={project}
      producerName={creator?.display_name || null}
      tracks={tracks}
      options={options}
      playingId={playingId}
      isPlaying={isPlaying}
      onPlay={onPlay}
      waveRef={waveRef}
      rowDownload={rowDownload}
    >
      {/* The vocalist's workspace sits under the list, for the track on the
          engine: the full Lyrics Studio (the same component as /studio) and a
          session notepad. */}
      <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_400px] lg:gap-12">
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
            <div className="flex-1 min-h-[450px] bg-white/[0.04] border border-white/10 rounded-2xl p-8 flex items-center justify-center text-white/60">
              <p className="text-sm font-bold uppercase tracking-wider text-white/80">No track selected</p>
            </div>
          )}
        </div>

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
                  className="flex-1 bg-[#090907] px-3 pt-3 pb-3 text-[11px] text-white placeholder:text-white/30 focus:outline-none resize-none leading-6 tracking-wide"
                  style={{ fontFamily: 'monospace' }}
                />
              ) : (
                <div
                  onClick={() => setEditingNotepad(true)}
                  className="flex-1 px-3 pt-3 pb-3 text-[11px] leading-6 cursor-pointer whitespace-pre-wrap select-text tracking-wide"
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
        </div>
      </div>
    </SharePageFrame>
  );
}
