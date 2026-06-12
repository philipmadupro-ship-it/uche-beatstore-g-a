'use client';

import { useMemo, useRef, useState } from 'react';
import { Search, Music, Library, Plus, GripVertical, X, Tag } from 'lucide-react';
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

type InlineTrackTag = { tag: string; category?: string | null };
type TrackWithInlineTags = Track & { track_tags?: InlineTrackTag[] };

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
  // Internal tag filter — derive available tags from all tracks, let user
  // narrow within the already type/search filtered list.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const availableTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of filtered) {
      for (const tt of (t as TrackWithInlineTags).track_tags ?? []) s.add(tt.tag);
    }
    return [...s].sort();
  }, [filtered]);

  const visibleTracks = useMemo(() => {
    if (selectedTags.size === 0) return filtered;
    return filtered.filter((t) => {
      const tags = ((t as TrackWithInlineTags).track_tags ?? []).map((tt) => tt.tag);
      return [...selectedTags].every((sel) => tags.includes(sel));
    });
  }, [filtered, selectedTags]);

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => {
      const n = new Set(prev);
      if (n.has(tag)) n.delete(tag);
      else n.add(tag);
      return n;
    });

  const selectable = !!(selectedIds && onToggleSelect);
  const allSelected = selectable && visibleTracks.length > 0 && visibleTracks.every((t) => selectedIds!.has(t.id));

  // Drag-to-reorder state (HTML5 DnD; no extra library).
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Only the grip handle itself is draggable — making the whole row draggable
  // fights TrackCard's click/pointer handlers and the drag never starts reliably.
  const handleGripDragStart = (idx: number) => (e: React.DragEvent) => {
    dragIdxRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    // Stop the event reaching the parent row so clicks on non-grip areas stay clicks.
    e.stopPropagation();
  };
  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    if (dragIdxRef.current == null) return; // not our drag
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (toIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdx = dragIdxRef.current;
    dragIdxRef.current = null;
    setDragOverIdx(null);
    if (fromIdx == null || fromIdx === toIdx) return;
    // Use visibleTracks (what the user sees) not filtered (the full unfiltered prop).
    const next = [...visibleTracks];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorder?.(next.map((t) => t.id));
  };

  return (
    <>
      {/* Tabs + Search */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                activeTab === tab ? 'bg-[#1A1813] text-white' : 'text-[#9B9282] hover:text-[#F7EBDD]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="relative w-56 sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6E685B]" size={12} />
          <input
            type="text"
            placeholder="Search tracks or tags"
            className="w-full bg-[#171511] border border-[#211F1A] rounded-md py-2 pl-8 pr-3 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F] transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tag chips — only when there are tags to filter on */}
      {availableTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          <Tag size={11} className="text-[#6E685B] shrink-0" />
          {availableTags.map((tag) => {
            const on = selectedTags.has(tag);
            return (
              <button key={tag} onClick={() => toggleTag(tag)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all ${
                  on ? 'bg-[#E7D7BE] text-black border-[#E7D7BE]' : 'bg-[#171511] border-[#2B2821] text-[#B4AA99] hover:text-[#D0C3AF] hover:border-[#3B372F]'
                }`}>
                {tag}
              </button>
            );
          })}
          {selectedTags.size > 0 && (
            <button onClick={() => setSelectedTags(new Set())}
              className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#F7EBDD] transition-colors ml-1">
              <X size={10} /> Clear
            </button>
          )}
        </div>
      )}

      {/* Track list */}
      <div className="space-y-1.5 pb-1 mb-32">
        {/* Header mirrors the Store-style product row: cover/play,
            title/meta, vibe, time, rating/offline, actions. */}
        <div className="hidden md:grid md:grid-cols-[40px_minmax(0,1.45fr)_minmax(0,1fr)_70px_112px_32px] items-center gap-4 px-3 h-8 text-[9px] font-mono uppercase tracking-wider text-[#6E685B]">
          {selectable ? (
            <span className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSelectAll?.()}
                aria-label="Select all visible tracks"
                className="accent-[#E7D7BE] cursor-pointer"
              />
            </span>
          ) : (
            <span />
          )}
          <span>Title</span>
          <span className="hidden md:block">Tags · Rating</span>
          <span className="hidden md:block text-right">Time</span>
          <span className="hidden md:block text-right">State</span>
          <span />
        </div>

        {!visibleTracks.length ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#171511] border border-[#211F1A] flex items-center justify-center">
              <Music size={16} className="text-[#6E685B]" />
            </div>
            {selectedTags.size > 0 || searchQuery ? (
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#6E685B]">No tracks match</p>
            ) : (
              <>
                <p className="text-[11px] font-mono uppercase tracking-wider text-[#6E685B]">No tracks in this project</p>
                <div className="flex items-center gap-3 mt-1">
                  <button onClick={onAddFromLibrary} className="text-[11px] text-[#E7D7BE] hover:text-[#F3E6D1] font-medium flex items-center gap-1">
                    <Library size={11} /> Add from library
                  </button>
                  <span className="text-[#3B372F]">·</span>
                  <button onClick={onShowUpload} className="text-[11px] text-[#E7D7BE] hover:text-[#F3E6D1] font-medium flex items-center gap-1">
                    <Plus size={11} /> Upload audio
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          visibleTracks.map((track, i) => (
            <div
              key={track.id}
              onDragOver={onReorder ? handleDragOver(i) : undefined}
              onDrop={onReorder ? handleDrop(i) : undefined}
              onDragEnd={() => { dragIdxRef.current = null; setDragOverIdx(null); }}
              className={`group relative transition-colors ${
                dragOverIdx === i ? 'bg-[#E7D7BE]/5 border-t-2 border-[#E7D7BE]/60' : ''
              }`}
            >
              {/* Grip handle — THIS element is draggable, not the whole row.
                  Dragging the full row fights TrackCard's pointer handlers;
                  dragging only the handle is reliable and intentional. */}
              {onReorder && (
                <div
                  draggable
                  onDragStart={handleGripDragStart(i)}
                  className="absolute left-0 inset-y-0 flex items-center pl-1 cursor-grab active:cursor-grabbing z-10 opacity-0 group-hover:opacity-100 transition-opacity text-[#6E685B] hover:text-[#D0C3AF]"
                  title="Drag to reorder"
                >
                  <GripVertical size={13} />
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
