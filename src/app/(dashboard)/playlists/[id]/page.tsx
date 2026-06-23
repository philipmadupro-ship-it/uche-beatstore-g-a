'use client';

/**
 * /playlists/[id] = playlist detail (consumption layer).
 * Not a workspace — just a curated list for listening / sharing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageContainer } from '@/components/layout/PageHeader';
import { TrackCard } from '@/components/tracks/TrackCard';
import { TrackDetailsDrawer } from '@/components/tracks/TrackDetailsDrawer';
import { ContentShareModal } from '@/components/share/ContentShareModal';
import { PlaylistOfflineSync } from '@/components/offline/PlaylistOfflineSync';
import { Loader2, Camera, Check, X, Edit2, Play, Share2, Music, Plus, Search, Tag, ListMusic, CheckSquare, ListPlus, UploadCloud } from 'lucide-react';
import { PlaylistSuggestions } from '@/components/playlists/PlaylistSuggestions';
import { seededGradient } from '@/lib/ui/cover-gradient';
import { AddFromLibraryModal } from '@/components/projects/AddFromLibraryModal';
import { Track } from '@/lib/types';
import { usePlayer } from '@/hooks/usePlayer';
import { fmtDuration } from '@/lib/audio/format';
import { toast, confirmToast } from '@/hooks/useToast';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { DropZone } from '@/components/upload/DropZone';

type PlaylistDetail = {
  id: string;
  name: string;
  cover_url: string | null;
  description?: string | null;
  store_featured?: boolean | null;
};

type TrackWithTags = Track & {
  track_tags?: { tag: string }[];
};

function trackTags(track: Track): { tag: string }[] {
  return (track as TrackWithTags).track_tags ?? [];
}

export default function PlaylistDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const searchParams = useSearchParams();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingArt, setUploadingArt] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [tempDescription, setTempDescription] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAddTracks, setShowAddTracks] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [trackSearch, setTrackSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const { setTrack: setGlobalTrack, setQueue } = usePlayer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startHandledRef = useRef(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const plRes = await fetch(`/api/playlists/${params.id}`);
      const plData = await plRes.json();
      if (plData.playlist) {
        setPlaylist(plData.playlist);
        setTempTitle(plData.playlist.name);
        setTempDescription(plData.playlist.description ?? '');
      }
      const trRes = await fetch(`/api/tracks?playlist_id=${params.id}`);
      const trData = await trRes.json();
      setTracks(Array.isArray(trData) ? trData : trData.tracks || []);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [params.id]);

  useEffect(() => {
    if (startHandledRef.current || loading || !playlist) return;
    const start = searchParams.get('start');
    if (start === 'library') {
      setShowAddTracks(true);
      startHandledRef.current = true;
    } else if (start === 'upload') {
      setShowUpload(true);
      startHandledRef.current = true;
    }
  }, [loading, playlist, searchParams]);

  const handleArtChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingArt(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload/image', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        toast.error('Cover upload failed', data.error || `HTTP ${res.status}`);
        return;
      }
      const patch = await fetch(`/api/playlists/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_url: data.url }),
      });
      if (!patch.ok) {
        const e = await patch.json().catch(() => ({}));
        toast.error('Could not save cover', e.error || `HTTP ${patch.status}`);
        return;
      }
      fetchData();
    } finally {
      setUploadingArt(false);
    }
  };

  const handleRename = async () => {
    if (!tempTitle.trim() || tempTitle === playlist?.name) {
      setIsEditingTitle(false);
      return;
    }
    await fetch(`/api/playlists/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tempTitle.trim() }),
    });
    setPlaylist((p) => p ? ({ ...p, name: tempTitle.trim() }) : p);
    setIsEditingTitle(false);
  };

  const handleDescriptionSave = async () => {
    const next = tempDescription.trim();
    if (next === (playlist?.description ?? '')) {
      setIsEditingDescription(false);
      return;
    }
    const res = await fetch(`/api/playlists/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: next || null }),
    });
    if (res.ok) {
      setPlaylist((p) => p ? ({ ...p, description: next || null }) : p);
      toast.success(next ? 'Description saved' : 'Description cleared');
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error('Could not save', j.error ?? 'try again');
    }
    setIsEditingDescription(false);
  };

  const toggleStoreFeatured = async () => {
    const next = !playlist?.store_featured;
    const res = await fetch(`/api/playlists/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_featured: next }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error('Failed to update', e.error || `HTTP ${res.status}`);
      return;
    }
    setPlaylist((p) => p ? ({ ...p, store_featured: next }) : p);
    toast.success(next ? 'Featured in store' : 'Removed from featured');
  };

  const handlePlayTrack = (track: Track) => {
    setQueue(tracks);
    setGlobalTrack(track);
  };

  const openAddTracks = async () => {
    setShowAddTracks(true);
  };

  // Derived tag filter for the track list
  const availableTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of tracks) for (const tt of trackTags(t)) s.add(tt.tag);
    return [...s].sort();
  }, [tracks]);

  const visibleTracks = useMemo(() => {
    let list = tracks;
    if (trackSearch.trim()) list = list.filter((t) => t.title.toLowerCase().includes(trackSearch.trim().toLowerCase()));
    if (selectedTags.size > 0) list = list.filter((t) => {
      const tags = trackTags(t).map((tt) => tt.tag);
      return [...selectedTags].every((sel) => tags.includes(sel));
    });
    return list;
  }, [tracks, trackSearch, selectedTags]);

  const trackIndexById = useMemo(
    () => new Map(tracks.map((track, index) => [track.id, index])),
    [tracks],
  );

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkPlay = () => {
    const selectedTracks = tracks.filter((track) => selectedIds.has(track.id));
    if (!selectedTracks.length) return;
    setQueue(selectedTracks);
    setGlobalTrack(selectedTracks[0]);
  };

  const handleBulkRemove = async () => {
    const count = selectedIds.size;
    const ok = await confirmToast(
      `Remove ${count} track${count === 1 ? '' : 's'} from playlist?`,
      'Tracks stay in your library — only this playlist changes.',
      { confirmLabel: 'Remove', cancelLabel: 'Keep' },
    );
    if (!ok) return;

    const ids = Array.from(selectedIds);
    setBulkBusy(true);
    setTracks((prev) => prev.filter((track) => !selectedIds.has(track.id)));
    const results = await Promise.allSettled(
      ids.map((trackId) =>
        fetch(`/api/playlists/${params.id}/tracks`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track_id: trackId }),
        }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        }),
      ),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    setBulkBusy(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    await fetchData();
    if (failed === 0) {
      toast.success(`Removed ${ids.length} from playlist`);
    } else {
      toast.warning(`Removed ${ids.length - failed}, ${failed} failed`);
    }
  };

  const removeTrack = async (trackId: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    try {
      await fetch(`/api/playlists/${params.id}/tracks`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId }),
      });
    } catch (err) {
      console.error('Remove error:', err);
      fetchData();
    }
  };

  const moveTrack = async (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= tracks.length) return;
    const next = tracks.slice();
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setTracks(next);
    try {
      await fetch(`/api/playlists/${params.id}/tracks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: next.map((t) => t.id) }),
      });
    } catch (err) {
      console.error('Reorder error:', err);
      fetchData();
    }
  };

  const handlePlayAll = () => {
    if (tracks.length) handlePlayTrack(tracks[0]);
  };

  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration_seconds || 0), 0);

  if (loading && !playlist) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 size={18} className="animate-spin text-[#837B6D]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer>
        <div className="mb-4 lg:hidden">
          <p className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282]">Playlist</p>
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                className="min-w-0 flex-1 border-b border-[#3B372F] bg-transparent text-2xl font-medium text-white outline-none focus:border-[#E7D7BE]"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              />
              <button type="button" aria-label="Save playlist title" onClick={handleRename} className="grid h-10 w-10 place-items-center rounded-md text-[#E7D7BE] hover:bg-[#1A1813]"><Check size={15} /></button>
              <button type="button" aria-label="Cancel title edit" onClick={() => { setIsEditingTitle(false); setTempTitle(playlist?.name || ''); }} className="grid h-10 w-10 place-items-center rounded-md text-[#9B9282] hover:bg-[#1A1813]"><X size={15} /></button>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <h1 className="min-w-0 flex-1 break-words font-heading text-2xl font-medium leading-tight text-white">{playlist?.name}</h1>
              <button type="button" aria-label="Edit playlist title" onClick={() => setIsEditingTitle(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-[#9B9282] hover:bg-[#1A1813] hover:text-white">
                <Edit2 size={14} />
              </button>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">
            <span>{tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
            <span className="text-[#3B372F]">·</span>
            <span>{fmtDuration(totalDuration)}</span>
          </div>
        </div>

        {/* Side-by-side layout — cover LEFT (sticky), meta + action row
            + track list RIGHT. Same shape as the library detail and
            project detail pages so all three feel like one family. */}
        <div className="grid grid-cols-1 gap-5 sm:gap-8 lg:grid-cols-[minmax(280px,360px)_1fr] lg:gap-10">
          <div className="mx-auto w-full max-w-[240px] sm:max-w-none lg:sticky lg:top-10 lg:self-start">
            <div
              className="group relative aspect-square w-full cursor-pointer overflow-hidden rounded-xl border border-white/[0.05] bg-[#171511] shadow-[0_8px_32px_rgba(0,0,0,0.4)] sm:rounded-2xl"
              onClick={() => fileInputRef.current?.click()}
            >
              {playlist?.cover_url ? (
                <img loading="lazy" src={playlist.cover_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[120px] font-light text-white/[0.07]" style={seededGradient(playlist?.id ?? 'pl')}>
                  <ListMusic size={64} className="text-white/15" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                {uploadingArt ? <Loader2 size={20} className="animate-spin text-white" /> : <Camera size={20} className="text-white" />}
              </div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleArtChange} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-4 flex flex-col gap-3 pb-2 sm:mb-8 sm:gap-4 sm:border-b sm:border-white/[0.04] sm:pb-8">
            <div className="min-w-0">
              <div className="hidden lg:block">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">Playlist</p>
              {isEditingTitle ? (
                <div className="flex items-center gap-2 mb-3">
                  <input
                    autoFocus
                    className="bg-transparent border-b border-[#3B372F] text-3xl font-medium tracking-tight outline-none text-white flex-1 focus:border-[#E7D7BE]"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  />
                  <button onClick={handleRename} className="p-1.5 rounded hover:bg-[#1A1813] text-[#E7D7BE]"><Check size={14} /></button>
                  <button onClick={() => { setIsEditingTitle(false); setTempTitle(playlist?.name || ''); }} className="p-1.5 rounded hover:bg-[#1A1813] text-[#9B9282]"><X size={14} /></button>
                </div>
              ) : (
                <div className="group flex items-center gap-2 mb-3">
                  <h1 className="text-3xl font-medium text-white leading-none tracking-tight truncate font-heading">{playlist?.name}</h1>
                  <button onClick={() => setIsEditingTitle(true)} className="opacity-0 group-hover:opacity-100 p-1.5 text-[#9B9282] hover:text-white transition-all">
                    <Edit2 size={13} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3 text-[11px] font-mono text-[#9B9282] uppercase tracking-wider">
                <span>{tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{fmtDuration(totalDuration)}</span>
              </div>
              </div>

              {/* Curator description — shows on the public playlist page
                  (mig 061). Click to edit; blur or ⌘+Enter to save. */}
              {isEditingDescription ? (
                <div className="mt-3">
                  <textarea
                    autoFocus
                    value={tempDescription}
                    onChange={(e) => setTempDescription(e.target.value)}
                    onBlur={handleDescriptionSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleDescriptionSave();
                      if (e.key === 'Escape') { setTempDescription(playlist?.description ?? ''); setIsEditingDescription(false); }
                    }}
                    rows={4}
                    maxLength={2000}
                    placeholder="What's this playlist about? Late-night drives, gospel chops, etc."
                    className="w-full bg-[#090907] border border-[#3B372F] rounded-lg px-3 py-2.5 text-[15px] font-light leading-[1.7] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#E7D7BE] resize-none"
                  />
                  <p className="mt-1 text-[9px] font-mono text-[#6E685B]">
                    {tempDescription.length}/2000 · ⌘/Ctrl+Enter to save
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => setIsEditingDescription(true)}
                  className="group mt-2 block w-full text-left sm:mt-4"
                >
                  {playlist?.description ? (
                    <p className="text-[15px] text-[#D0C3AF] leading-[1.7] whitespace-pre-line group-hover:text-[#F7EBDD] transition-colors font-light tracking-wide">
                      {playlist.description}
                    </p>
                  ) : (
                    <p className="text-[14px] text-[#6E685B] italic group-hover:text-[#9B9282] transition-colors">
                      + Add a description
                    </p>
                  )}
                </button>
              )}

              {/* Featured in Store toggle — owner only, persists via PATCH */}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">Featured in Store</span>
                <button
                  onClick={toggleStoreFeatured}
                  className={`relative inline-flex w-9 h-5 rounded-full transition-colors ${playlist?.store_featured ? 'bg-[#E7D7BE]' : 'bg-[#2B2821] border border-[#3B372F]'}`}
                  aria-pressed={!!playlist?.store_featured}
                  title="Toggle visibility on the public /store page"
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${playlist?.store_featured ? 'translate-x-4' : ''}`}
                  />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handlePlayAll}
                disabled={!tracks.length}
                className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md text-[12px] font-medium hover:bg-[#F7EBDD] disabled:opacity-30 transition-colors"
              >
                <Play size={12} fill="currentColor" className="ml-0.5" />
                Play
              </button>
              <button
                onClick={() => setShowShareModal(true)}
                disabled={!tracks.length}
                className="flex items-center gap-2 bg-[#171511] border border-[#211F1A] text-[#F7EBDD] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#3B372F] disabled:opacity-30 transition-colors"
              >
                <Share2 size={12} />
                Share
              </button>
              <button
                onClick={openAddTracks}
                className="flex items-center gap-2 bg-[#171511] border border-[#211F1A] text-[#F7EBDD] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#3B372F] transition-colors"
              >
                <Plus size={12} />
                Add tracks
              </button>
              <button
                type="button"
                onClick={() => setShowUpload((value) => !value)}
                aria-expanded={showUpload}
                className="flex items-center gap-2 rounded-md border border-[#211F1A] bg-[#171511] px-4 py-2 text-[12px] font-medium text-[#F7EBDD] transition-colors hover:border-[#3B372F]"
              >
                <UploadCloud size={12} />
                Upload
              </button>
              {/* "Sync offline" — caches every track's audio blob in
                  IndexedDB so the artist can play the curated set
                  with no network. Hidden when the playlist is empty.
                  Same per-track cache as the TrackCard's compact
                  toggle — the playlist button is just a bulk loop. */}
              <PlaylistOfflineSync
                tracks={tracks.map((t) => ({ id: t.id, audio_url: t.audio_url, title: t.title }))}
              />
            </div>
            </div>
            {/* end meta panel — track list follows inside the right column */}

        {showUpload && (
          <div className="mb-5 rounded-xl border border-[#211F1A] bg-[#11100D] p-3 sm:mb-8 sm:p-4">
            <DropZone
              playlistId={params.id}
              onUploadSuccess={() => {
                void fetchData();
              }}
            />
          </div>
        )}

        {/* Track list */}
        <div className="mb-24 pb-1 sm:mb-32 sm:border-y sm:border-[#24211B]">
          {/* Search + tag chips */}
          {tracks.length > 0 && (
            <div className="space-y-2 py-2 sm:border-b sm:border-[#24211B] sm:px-4 sm:py-3">
              <div className="relative max-w-xs">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6E685B] pointer-events-none" />
                <input value={trackSearch} onChange={(e) => setTrackSearch(e.target.value)} placeholder="Search tracks or tags…"
                  className="w-full bg-[#171511] border border-[#211F1A] rounded-md py-1.5 pl-8 pr-3 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectMode((value) => {
                    if (value) setSelectedIds(new Set());
                    return !value;
                  });
                }}
                aria-pressed={selectMode}
                className={`inline-flex min-h-8 items-center gap-2 rounded-md border px-3 text-[10px] font-mono uppercase tracking-[0.14em] transition-colors ${
                  selectMode
                    ? 'border-[#E7D7BE]/45 bg-[#E7D7BE]/14 text-[#E7D7BE]'
                    : 'border-[#211F1A] bg-[#171511] text-[#B4AA99] hover:border-[#3B372F] hover:text-[#F7EBDD]'
                }`}
              >
                <CheckSquare size={12} />
                {selectMode ? 'Done' : 'Select'}
              </button>
              {availableTags.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Tag size={10} className="text-[#6E685B] shrink-0" />
                  {availableTags.map((tag) => {
                    const on = selectedTags.has(tag);
                    return (
                      <button key={tag} onClick={() => setSelectedTags((prev) => {
                        const n = new Set(prev);
                        if (n.has(tag)) n.delete(tag);
                        else n.add(tag);
                        return n;
                      })}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${on ? 'bg-[#E7D7BE] text-black border-[#E7D7BE]' : 'bg-transparent border-[#2B2821] text-[#B4AA99] hover:text-[#D0C3AF] hover:border-[#3B372F]'}`}>
                        {tag}
                      </button>
                    );
                  })}
                  {selectedTags.size > 0 && <button onClick={() => setSelectedTags(new Set())} className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#F7EBDD] ml-1 flex items-center gap-1"><X size={9} /> Clear</button>}
                </div>
              )}
            </div>
          )}
          <div className="hidden h-9 grid-cols-[32px_32px_1fr_90px_72px_110px_110px_32px] items-center gap-4 border-b border-[#24211B] px-4 text-[10px] font-mono uppercase tracking-wider text-[#6E685B] sm:grid md:grid-cols-[32px_32px_1fr_110px_72px_130px_110px_110px_32px] lg:grid-cols-[32px_32px_1fr_110px_72px_130px_110px_100px_110px_32px]">
            <span className="text-center">#</span>
            <span />
            <span>Title</span>
            <span className="hidden sm:block">Type</span>
            <span className="hidden sm:block">BPM · Key</span>
            <span className="hidden sm:block">Added</span>
            <span className="text-right hidden sm:block">Rating</span>
            <span className="hidden lg:block">Tags</span>
            <span />
          </div>

          {!tracks.length ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#171511] border border-[#211F1A] flex items-center justify-center">
                <Music size={16} className="text-[#6E685B]" />
              </div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#6E685B]">Empty playlist</p>
              <button
                onClick={openAddTracks}
                className="mt-2 flex items-center gap-2 bg-[#171511] border border-[#211F1A] text-[#F7EBDD] px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider hover:border-[#E7D7BE]/50 hover:text-[#E7D7BE] transition-colors"
              >
                <Plus size={12} /> Add tracks
              </button>
            </div>
          ) : (
            visibleTracks.map((track, i) => {
              const trackIndex = trackIndexById.get(track.id) ?? i;
              return (
                <TrackCard
                  key={track.id}
                  track={track}
                  index={i + 1}
                  onClickDetails={(t) => setSelectedTrack(t)}
                  onPlayClick={() => handlePlayTrack(track)}
                  rowAction="play"
                  selectable={selectMode}
                  selected={selectedIds.has(track.id)}
                  onSelectChange={() => toggleSelectOne(track.id)}
                  selectionBehavior="button"
                  draggableTrack={false}
                  onMoveUp={() => moveTrack(trackIndex, -1)}
                  onMoveDown={() => moveTrack(trackIndex, 1)}
                  moveControls="menu"
                  isFirstInOrder={trackIndex <= 0}
                  isLastInOrder={trackIndex === tracks.length - 1}
                  onRemoveFromContext={() => removeTrack(track.id)}
                  removeLabel="Remove from playlist"
                />
              );
            })
          )}
        </div>
          {/* Similar track suggestions — collapsed by default, opens on demand.
              Seeds from up to 3 spread playlist tracks to capture the full vibe. */}
          <PlaylistSuggestions
            playlistId={params.id}
            playlistTracks={tracks}
            onAdded={fetchData}
          />
          </div>
          {/* end right column */}
        </div>
        {/* end side-by-side grid */}
      </PageContainer>

      {selectedTrack && (
        <TrackDetailsDrawer track={selectedTrack} onClose={() => setSelectedTrack(null)} onUpdate={fetchData} />
      )}

      {showShareModal && playlist && (
        <ContentShareModal
          contentType="playlist"
          contentId={params.id}
          contentTitle={playlist.name}
          coverUrl={playlist.cover_url}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {showAddTracks && (
        <AddFromLibraryModal
          endpoint={`/api/playlists/${params.id}/tracks`}
          excludeIds={tracks.map((t) => t.id)}
          title={`Add to ${playlist?.name || 'playlist'}`}
          onClose={() => setShowAddTracks(false)}
          onAdded={(count) => { fetchData(); if (count > 0) setShowAddTracks(false); }}
        />
      )}

      <BatchActionBar
        count={selectedIds.size}
        noun={['track', 'tracks']}
        onClear={() => { setSelectedIds(new Set()); setSelectMode(false); }}
        busy={bulkBusy}
        actions={[
          {
            label: `Play ${selectedIds.size}`,
            icon: <ListPlus size={11} />,
            intent: 'primary',
            onClick: handleBulkPlay,
          },
          {
            label: 'Remove',
            icon: <DeleteIcon size={11} />,
            intent: 'danger',
            onClick: handleBulkRemove,
          },
        ]}
      />
    </DashboardLayout>
  );
}
