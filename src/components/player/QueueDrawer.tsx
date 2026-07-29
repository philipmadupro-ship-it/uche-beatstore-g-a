'use client';

import { useState } from 'react';
import { Track } from '@/lib/types';
import { Play, Music, ListMusic, Trash2, Minus, History as HistoryIcon, ArrowRight, GripVertical } from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { Modal } from '@/components/ui/Modal';

interface QueueDrawerProps {
  onClose: () => void;
}

export function QueueDrawer({ onClose }: QueueDrawerProps) {
  const {
    queue,
    history,
    currentTrack,
    setTrack,
    isPlaying,
    removeFromQueue,
    clearQueue,
    reorderQueue,
  } = usePlayer();

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTo, setDropTo] = useState<number | null>(null);

  // The full queue is always shown — splitting it around the cursor created
  // empty "Up next" sections that made the drawer look broken when the user
  // played the last track. We mark the current track inline instead.
  const currentIndex = currentTrack
    ? queue.findIndex((t) => t.id === currentTrack.id)
    : -1;
  const upNextCount = currentIndex >= 0 ? queue.length - currentIndex - 1 : queue.length;

  return (
    <Modal
      open
      onClose={onClose}
      title="Playback Queue"
      description={`${queue.length} in queue · ${upNextCount} up next · ${history.length} played`}
      icon={<ListMusic size={16} aria-hidden="true" />}
      size="lg"
      placement="top"
      className="bg-[#090907] shadow-[0_28px_90px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.04)]"
      contentClassName="p-0 custom-scrollbar"
    >
      {queue.length > 0 && (
        <div className="flex justify-end border-b border-[#0E0E0E] px-5 py-3">
          <button
            onClick={clearQueue}
            className="tap flex items-center gap-1 rounded border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-white/60 hover:border-red-900/40 hover:text-red-400"
            title="Clear queue"
          >
            <Trash2 size={10} /> Clear
          </button>
        </div>
      )}

      <div>
        {/* Three distinct sections so the user's mental model maps
              1:1 onto what they're seeing — was previously one merged
              "Queue" list with the current track marked inline, which
              made "Up Next" effectively invisible. */}

        {/* 1. Now Playing — the active track. Always its own card so
                 the user can spot it without scanning. */}
        {currentTrack && (
          <Section title="Now playing" icon={<Play size={10} fill="currentColor" />}>
            <Row
              track={currentTrack}
              isCurrent
              isPlaying={isPlaying}
              onPlay={() => setTrack(currentTrack)}
              onRemove={null}
            />
          </Section>
        )}

        {/* 2. Up Next — the slice of the queue AFTER the current
                 track. This is what the user actually cares about
                 when they open the queue. */}
        {(() => {
          const upNext = currentIndex >= 0
            ? queue.slice(currentIndex + 1)
            : queue.filter((t) => t.id !== currentTrack?.id);
          return (
            <Section
              title="Up next"
              count={upNext.length}
              icon={<ArrowRight size={11} />}
              empty={
                upNext.length === 0
                  ? currentTrack
                    ? 'Nothing queued after the current track. Click any track from your library to queue it.'
                    : 'Queue is empty. Click any track from your library, project, or playlist to start playback.'
                  : null
              }
            >
              {upNext.map((t, i) => {
                const isDraggingThis = dragFrom === i;
                const isDropTarget = dropTo === i && dragFrom !== null && dragFrom !== i;
                return (
                  <div
                    key={`up-${t.id}-${i}`}
                    draggable
                    onDragStart={() => setDragFrom(i)}
                    onDragOver={(e) => { e.preventDefault(); if (dropTo !== i) setDropTo(i); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragFrom !== null && dragFrom !== i) {
                        const base = currentIndex >= 0 ? currentIndex + 1 : 0;
                        reorderQueue(base + dragFrom, base + i);
                      }
                      setDragFrom(null);
                      setDropTo(null);
                    }}
                    onDragEnd={() => { setDragFrom(null); setDropTo(null); }}
                    className={`relative transition-opacity ${isDraggingThis ? 'opacity-40' : ''}`}
                  >
                    {isDropTarget && (
                      <div className="absolute -top-px left-2 right-2 h-0.5 bg-white/60 rounded-full z-10 pointer-events-none" />
                    )}
                    <Row
                      track={t}
                      dragHandle
                      onPlay={() => setTrack(t)}
                      onRemove={() => removeFromQueue(t.id)}
                    />
                  </div>
                );
              })}
            </Section>
          );
        })()}

        {/* 3. Recently played — the history stack, newest first. */}
        {history.length > 0 && (
          <Section title="Recently played" count={history.length} icon={<HistoryIcon size={11} />}>
            {history
              .slice()
              .reverse()
              .slice(0, 20)
              .map((t, i) => (
                <Row
                  key={`hist-${t.id}-${i}`}
                  track={t}
                  muted
                  onPlay={() => setTrack(t)}
                  onRemove={null}
                />
              ))}
          </Section>
        )}

        {!currentTrack && queue.length === 0 && history.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-white/40 text-center px-10">
            <Music size={36} className="mb-5 opacity-20" />
            <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Queue is currently empty</p>
            <p className="text-[9px] uppercase tracking-widest mt-2 leading-relaxed">
              Select a project or track from your library to begin playback.
            </p>
          </div>
        )}
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #222222; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #333333; }
      `}</style>
    </Modal>
  );
}

function Section({
  title,
  count,
  icon,
  empty,
  children,
}: {
  title: string;
  count?: number;
  icon?: React.ReactNode;
  empty?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-3 border-b border-[#0E0E0E] last:border-b-0">
      <div className="flex items-center gap-2 px-2 mb-2">
        {icon}
        <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-white/60">{title}</h3>
        {count !== undefined && (
          <span className="text-[9px] font-mono text-white/40">{count}</span>
        )}
      </div>
      {empty ? (
        <p className="text-[10px] text-white/40 px-3 py-4 leading-relaxed">{empty}</p>
      ) : (
        <div className="space-y-1">{children}</div>
      )}
    </div>
  );
}

function Row({
  track,
  isCurrent,
  isPlaying,
  muted,
  dragHandle,
  onPlay,
  onRemove,
}: {
  track: Track;
  isCurrent?: boolean;
  isPlaying?: boolean;
  muted?: boolean;
  dragHandle?: boolean;
  onPlay: () => void;
  onRemove: (() => void) | null;
}) {
  const durationSeconds = track.duration_seconds ?? 0;

  return (
    <div
      onClick={onPlay}
      className={`group flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
        isCurrent
          ? 'bg-white/10 border-white/ shadow-lg shadow-white/10'
          : muted
            ? 'bg-transparent border-transparent hover:bg-[#101010] opacity-70 hover:opacity-100'
            : 'bg-transparent border-transparent hover:bg-[#0E0E0E] hover:border-white/10'
      }`}
    >
      {dragHandle && (
        <GripVertical size={12} className="text-white/30 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
      )}
      <div className="w-9 h-9 bg-[#0E0E0E] rounded-lg overflow-hidden shrink-0 border border-white/10 relative">
        {track.cover_url ? (
          <img loading="lazy" src={track.cover_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/30">
            <Music size={14} />
          </div>
        )}
        {isCurrent && isPlaying && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="flex gap-0.5 items-end h-3">
              <div className="w-0.5 bg-white animate-bounce h-2" style={{ animationDelay: '0ms' }} />
              <div className="w-0.5 bg-white animate-bounce h-3" style={{ animationDelay: '150ms' }} />
              <div className="w-0.5 bg-white animate-bounce h-1.5" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className={`text-[12px] font-medium truncate tracking-tight ${
          isCurrent ? 'text-white' : muted ? 'text-white/80' : 'text-white'
        }`}>
          {track.title}
        </h4>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[9px] text-white/40 uppercase font-mono tracking-widest">{track.type}</span>
          {track.bpm && (
            <span className="text-[9px] font-mono text-white/30 tabular-nums">{track.bpm} bpm</span>
          )}
          {track.key && (
            <span className={`text-[8px] font-mono font-bold px-1 py-px rounded uppercase leading-none ${
              track.scale === 'minor'
                ? 'text-[#c8a47a] bg-[#1f1a10]/50'
                : 'text-[#c8a47a] bg-[#1f1a10]/50'
            }`}>
              {track.key}{track.scale === 'minor' ? 'm' : ''}
            </span>
          )}
          {durationSeconds > 0 && (
            <span className="text-[9px] font-mono text-white/30 tabular-nums ml-auto">
              {Math.floor(durationSeconds / 60)}:{String(Math.floor(durationSeconds % 60)).padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {!isCurrent && (
          <span className="text-white/40 p-1">
            <Play size={11} fill="currentColor" />
          </span>
        )}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-white/40 hover:text-red-400 p-1 rounded"
            title="Remove from queue"
          >
            <Minus size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
