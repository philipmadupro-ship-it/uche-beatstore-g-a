'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Track } from '@/lib/types';
import { X, Play, Music, ListMusic, Trash2, Minus, History as HistoryIcon, ArrowRight, GripVertical } from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';

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

  // The popup must escape its parent's stacking context to render
  // reliably above everything else. PlayerBar (the parent that mounts
  // us) sits at `position:fixed z-50` and creates its own stacking
  // context — any z-index we use here is relative to PlayerBar, not
  // the document. The TopBar (separate, `z-30`) and other fixed
  // elements live in the root context, so the popup was sometimes
  // hidden behind them depending on the page.
  //
  // Render through a portal to `document.body` so the popup is a
  // top-level child — its z-index now competes in the root stacking
  // context and reliably wins. SSR-safe via the `mounted` guard.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const content = (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[60] animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div
        // Inline width + height — guarantees the computed style ships
        // regardless of Tailwind JIT behavior. The previous version used
        // arbitrary `min(...)` and `calc(...)` Tailwind values that were
        // getting dropped by the build, leaving the popup with no width
        // constraint and falling back to its default block layout at
        // the bottom of the page.
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 160px)',
        }}
        className="fixed top-6 left-1/2 -translate-x-1/2 bg-[#0a0907] border border-[#1f1a13] rounded-2xl z-[70] flex flex-col shadow-2xl animate-in slide-in-from-top-4 fade-in duration-300 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Playback queue"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1f1a13] flex justify-between items-center bg-gradient-to-b from-[#16130e] to-[#0a0907] shrink-0">
          <div className="flex items-center gap-3">
            <ListMusic size={16} className="text-[#D4BFA0]" />
            <div>
              <h2 className="text-[12px] font-black uppercase tracking-[0.25em] text-white leading-none">
                Playback Queue
              </h2>
              <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-widest mt-1">
                {queue.length} in queue · {upNextCount} up next · {history.length} played
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <button
                onClick={clearQueue}
                className="text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-[#1f1a13] text-[#6a5d4a] hover:text-red-400 hover:border-red-900/40 flex items-center gap-1"
                title="Clear queue"
              >
                <Trash2 size={10} /> Clear
              </button>
            )}
            <button onClick={onClose} className="text-[#4a4338] hover:text-white transition-colors p-1">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
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
                        <div className="absolute -top-px left-2 right-2 h-0.5 bg-[#D4BFA0]/60 rounded-full z-10 pointer-events-none" />
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
            <div className="flex flex-col items-center justify-center py-16 text-[#4a4338] text-center px-10">
              <Music size={36} className="mb-5 opacity-20" />
              <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Queue is currently empty</p>
              <p className="text-[9px] uppercase tracking-widest mt-2 leading-relaxed">
                Select a project or track from your library to begin playback.
              </p>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1f1a13; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #2d2620; }
      `}</style>
    </>
  );

  // createPortal places the popup at the end of document.body — outside
  // every parent stacking context — so its z-index wins unconditionally.
  return createPortal(content, document.body);
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
    <div className="px-3 py-3 border-b border-[#16130e] last:border-b-0">
      <div className="flex items-center gap-2 px-2 mb-2">
        {icon}
        <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-[#6a5d4a]">{title}</h3>
        {count !== undefined && (
          <span className="text-[9px] font-mono text-[#4a4338]">{count}</span>
        )}
      </div>
      {empty ? (
        <p className="text-[10px] text-[#5a5142] px-3 py-4 leading-relaxed">{empty}</p>
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
  return (
    <div
      onClick={onPlay}
      className={`group flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
        isCurrent
          ? 'bg-[#2A2418] border-[#8A7A5C]/40 shadow-lg shadow-[#D4BFA0]/10'
          : muted
            ? 'bg-transparent border-transparent hover:bg-[#101010] opacity-70 hover:opacity-100'
            : 'bg-transparent border-transparent hover:bg-[#16130e] hover:border-[#1f1a13]'
      }`}
    >
      {dragHandle && (
        <GripVertical size={12} className="text-[#3a3328] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
      )}
      <div className="w-9 h-9 bg-[#16130e] rounded-lg overflow-hidden shrink-0 border border-[#1f1a13] relative">
        {track.cover_url ? (
          <img loading="lazy" src={track.cover_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#2d2620]">
            <Music size={14} />
          </div>
        )}
        {isCurrent && isPlaying && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="flex gap-0.5 items-end h-3">
              <div className="w-0.5 bg-[#D4BFA0] animate-bounce h-2" style={{ animationDelay: '0ms' }} />
              <div className="w-0.5 bg-[#D4BFA0] animate-bounce h-3" style={{ animationDelay: '150ms' }} />
              <div className="w-0.5 bg-[#D4BFA0] animate-bounce h-1.5" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className={`text-[12px] font-medium truncate tracking-tight ${
          isCurrent ? 'text-[#E8D8B8]' : muted ? 'text-[#a08a6a]' : 'text-[#E8DCC8]'
        }`}>
          {track.title}
        </h4>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[9px] text-[#4a4338] uppercase font-mono tracking-widest">{track.type}</span>
          {(track as any).bpm && (
            <span className="text-[9px] font-mono text-[#3a3328] tabular-nums">{(track as any).bpm} bpm</span>
          )}
          {(track as any).key && (
            <span className={`text-[8px] font-mono font-bold px-1 py-px rounded uppercase leading-none ${
              (track as any).scale === 'minor'
                ? 'text-[#9d95e8] bg-[#1a1833]/50'
                : 'text-[#c8a47a] bg-[#1f1a10]/50'
            }`}>
              {(track as any).key}{(track as any).scale === 'minor' ? 'm' : ''}
            </span>
          )}
          {(track as any).duration_seconds > 0 && (
            <span className="text-[9px] font-mono text-[#2d2620] tabular-nums ml-auto">
              {Math.floor((track as any).duration_seconds / 60)}:{String(Math.floor((track as any).duration_seconds % 60)).padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {!isCurrent && (
          <span className="text-[#5a5142] p-1">
            <Play size={11} fill="currentColor" />
          </span>
        )}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-[#5a5142] hover:text-red-400 p-1 rounded"
            title="Remove from queue"
          >
            <Minus size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
