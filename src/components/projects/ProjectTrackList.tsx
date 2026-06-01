'use client';

import { useRef, useState } from 'react';
import { Search, Music, Library, Plus, GripVertical } from 'lucide-react';
import { TrackCard } from '@/components/tracks/TrackCard';
import { Track } from '@/lib/types';

interface Props {
  tabs: readonly string[];
  activeTab: string;
  setActiveTab: (t: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filtered: Track[];
  onSelectTrack: (t: Track) => void;
  onPlayTrack: (t: Track) => void;
  onRemoveTrack: (id: string) => void;
  onDeleteTrack: (id: string) => void;
  onAddFromLibrary: () => void;
  onShowUpload: () => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectAll?: () => void;
  /** Called after a drag-to-reorder completes with the new ordered id list. */
  onReorder?: (orderedIds: string[]) => void;
}

/**
 * Tabs row + search + track table for the project detail page.
 *
 * Extracted from /projects/[id]/page.tsx. Pure presentation;
 * parent owns search/tab state and track mutations.
 */
export function ProjectTrackList({
  tabs, activeTab, setActiveTab,
  searchQuery, setSearchQuery,
  filtered,
  onSelectTrack, onPlayTrack, onRemoveTrack, onDeleteTrack,
  onAddFromLibrary, onShowUpload,
  selectedIds, onToggleSelect, onSelectAll, onReorder,
}: Props) {
  const selectable = !!(selectedIds && onToggleSelect);
  const allSelected = selectable && filtered.length > 0 && filtered.every((t) => selectedIds!.has(t.id));

  // Drag-to-reorder state (HTML5 DnD; no extra library).
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    dragIdxRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (toIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdx = dragIdxRef.current;
    dragIdxRef.current = null;
    setDragOverIdx(null);
    if (fromIdx == null || fromIdx === toIdx) return;
    const next = [...filtered];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorder?.(next.map((t) => t.id));
  };

  return (
    <>
      {/* Tabs + Search */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                activeTab === tab ? 'bg-[#16130e] text-white' : 'text-[#5a5142] hover:text-[#E8DCC8]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328]" size={12} />
          <input
            type="text"
            placeholder="Search tracks"
            className="w-full bg-[#14110d] border border-[#1a160f] rounded-md py-2 pl-8 pr-3 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Track list */}
      <div className="border-t border-[#161310] border-b pb-1 mb-32">
        <div className="grid grid-cols-[32px_32px_1fr_90px_32px] sm:grid-cols-[32px_32px_1fr_90px_110px_110px_32px] md:grid-cols-[32px_32px_1fr_110px_130px_120px_110px_32px] items-center gap-4 px-4 h-9 border-b border-[#161310] text-[10px] font-mono uppercase tracking-wider text-[#3a3328]">
          {selectable ? (
            <span className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSelectAll?.()}
                aria-label="Select all visible tracks"
                className="accent-[#D4BFA0] cursor-pointer"
              />
            </span>
          ) : (
            <span className="text-center">#</span>
          )}
          <span />
          <span>Title</span>
          <span className="hidden sm:block">Type</span>
          <span>BPM · Key</span>
          <span className="hidden md:block">Added</span>
          <span className="text-right hidden sm:block">Rating</span>
          <span />
        </div>

        {!filtered.length ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#14110d] border border-[#1a160f] flex items-center justify-center">
              <Music size={16} className="text-[#3a3328]" />
            </div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#3a3328]">No tracks in this project</p>
            <div className="flex items-center gap-3 mt-1">
              <button onClick={onAddFromLibrary} className="text-[11px] text-[#D4BFA0] hover:text-[#E8D8B8] font-medium flex items-center gap-1">
                <Library size={11} /> Add from library
              </button>
              <span className="text-[#2d2620]">·</span>
              <button onClick={onShowUpload} className="text-[11px] text-[#D4BFA0] hover:text-[#E8D8B8] font-medium flex items-center gap-1">
                <Plus size={11} /> Upload audio
              </button>
            </div>
          </div>
        ) : (
          filtered.map((track, i) => (
            <div
              key={track.id}
              draggable={!!onReorder}
              onDragStart={onReorder ? handleDragStart(i) : undefined}
              onDragOver={onReorder ? handleDragOver(i) : undefined}
              onDrop={onReorder ? handleDrop(i) : undefined}
              onDragEnd={() => { dragIdxRef.current = null; setDragOverIdx(null); }}
              className={`relative transition-colors ${
                dragOverIdx === i ? 'bg-[#D4BFA0]/5 border-t border-[#D4BFA0]/30' : ''
              }`}
            >
              {/* Drag handle — only shown when reorder is enabled */}
              {onReorder && (
                <div className="absolute left-0 inset-y-0 flex items-center pl-1 cursor-grab active:cursor-grabbing z-10 opacity-0 group-hover:opacity-100 hover:opacity-100 text-[#3a3328] hover:text-[#a08a6a]">
                  <GripVertical size={12} />
                </div>
              )}
              <TrackCard
                track={track}
                index={i + 1}
                onClickDetails={onSelectTrack}
                onPlayClick={() => onPlayTrack(track)}
                onRemoveFromContext={(t) => onRemoveTrack(t.id)}
                removeLabel="Remove from project"
                onDelete={(t) => onDeleteTrack(t.id)}
                selectable={selectable}
                selected={selectable && selectedIds!.has(track.id)}
                onSelectChange={(t) => onToggleSelect?.(t.id)}
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}
