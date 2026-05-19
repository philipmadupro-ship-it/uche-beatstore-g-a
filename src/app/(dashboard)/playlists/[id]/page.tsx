'use client';

/**
 * /playlists/[id] = playlist detail (consumption layer).
 * Not a workspace — just a curated list for listening / sharing.
 */

import React, { useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TrackCard } from '@/components/tracks/TrackCard';
import { TrackDetailsDrawer } from '@/components/tracks/TrackDetailsDrawer';
import { ShareModal } from '@/components/share/ShareModal';
import { PlaylistOfflineSync } from '@/components/offline/PlaylistOfflineSync';
import { Loader2, Camera, Check, X, Edit2, Play, Share2, Music, Plus, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { Track } from '@/lib/types';
import { usePlayer } from '@/hooks/usePlayer';
import { fmtDuration } from '@/lib/audio/format';
import { toast } from '@/hooks/useToast';

export default function PlaylistDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const [playlist, setPlaylist] = useState<any>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingArt, setUploadingArt] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAddTracks, setShowAddTracks] = useState(false);
  const [vaultTracks, setVaultTracks] = useState<Track[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vaultSearch, setVaultSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const { setTrack: setGlobalTrack, setQueue } = usePlayer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const plRes = await fetch(`/api/playlists/${params.id}`);
      const plData = await plRes.json();
      if (plData.playlist) {
        setPlaylist(plData.playlist);
        setTempTitle(plData.playlist.name);
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
    setPlaylist({ ...playlist, name: tempTitle.trim() });
    setIsEditingTitle(false);
  };

  const handlePlayTrack = (track: Track) => {
    setQueue(tracks);
    setGlobalTrack(track);
  };

  const openAddTracks = async () => {
    setShowAddTracks(true);
    setSelected(new Set());
    setVaultSearch('');
    try {
      const res = await fetch('/api/tracks');
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.tracks || [];
      const have = new Set(tracks.map((t) => t.id));
      setVaultTracks(list.filter((t: Track) => !have.has(t.id)));
    } catch (err) {
      console.error('Vault fetch error:', err);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submitAddTracks = async () => {
    if (!selected.size) return;
    setAdding(true);
    try {
      await fetch(`/api/playlists/${params.id}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: Array.from(selected) }),
      });
      setShowAddTracks(false);
      fetchData();
    } finally {
      setAdding(false);
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
          <Loader2 size={18} className="animate-spin text-[#4a4338]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-10 pt-10">
        {/* Side-by-side layout — cover LEFT (sticky), meta + action row
            + track list RIGHT. Same shape as the library detail and
            project detail pages so all three feel like one family. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-10">
          <div className="lg:sticky lg:top-10 lg:self-start">
            <div
              className="aspect-square w-full bg-[#14110d] rounded-2xl border border-white/[0.05] overflow-hidden group relative cursor-pointer shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
              onClick={() => fileInputRef.current?.click()}
            >
              {playlist?.cover_url ? (
                <img loading="lazy" src={playlist.cover_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[120px] font-light text-[#1a160f] bg-gradient-to-br from-[#161520] to-[#0a0907]">
                  {playlist?.name?.[0] || 'P'}
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                {uploadingArt ? <Loader2 size={20} className="animate-spin text-white" /> : <Camera size={20} className="text-white" />}
              </div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleArtChange} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex flex-col gap-4 pb-8 mb-8 border-b border-white/[0.04]">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Playlist</p>
              {isEditingTitle ? (
                <div className="flex items-center gap-2 mb-3">
                  <input
                    autoFocus
                    className="bg-transparent border-b border-[#2d2620] text-3xl font-medium tracking-tight outline-none text-white flex-1 focus:border-[#D4BFA0]"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  />
                  <button onClick={handleRename} className="p-1.5 rounded hover:bg-[#16130e] text-[#D4BFA0]"><Check size={14} /></button>
                  <button onClick={() => { setIsEditingTitle(false); setTempTitle(playlist?.name || ''); }} className="p-1.5 rounded hover:bg-[#16130e] text-[#5a5142]"><X size={14} /></button>
                </div>
              ) : (
                <div className="group flex items-center gap-2 mb-3">
                  <h1 className="text-3xl font-medium text-white leading-none tracking-tight truncate font-heading">{playlist?.name}</h1>
                  <button onClick={() => setIsEditingTitle(true)} className="opacity-0 group-hover:opacity-100 p-1.5 text-[#5a5142] hover:text-white transition-all">
                    <Edit2 size={13} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3 text-[11px] font-mono text-[#5a5142] uppercase tracking-wider">
                <span>{tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{fmtDuration(totalDuration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePlayAll}
                disabled={!tracks.length}
                className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md text-[12px] font-medium hover:bg-[#E8DCC8] disabled:opacity-30 transition-colors"
              >
                <Play size={12} fill="currentColor" className="ml-0.5" />
                Play
              </button>
              <button
                onClick={() => setShowShareModal(true)}
                disabled={!tracks.length}
                className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] disabled:opacity-30 transition-colors"
              >
                <Share2 size={12} />
                Share
              </button>
              <button
                onClick={openAddTracks}
                className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] transition-colors"
              >
                <Plus size={12} />
                Add tracks
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

        {/* Track list */}
        <div className="border-t border-[#161310] border-b pb-1 mb-32">
          <div className="grid grid-cols-[32px_32px_1fr_90px_32px] sm:grid-cols-[32px_32px_1fr_90px_110px_110px_32px] md:grid-cols-[32px_32px_1fr_110px_130px_120px_110px_32px] items-center gap-4 px-4 h-9 border-b border-[#161310] text-[10px] font-mono uppercase tracking-wider text-[#3a3328]">
            <span className="text-center">#</span>
            <span />
            <span>Title</span>
            <span className="hidden sm:block">Type</span>
            <span>BPM · Key</span>
            <span className="hidden md:block">Added</span>
            <span className="text-right hidden sm:block">Rating</span>
            <span />
          </div>

          {!tracks.length ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#14110d] border border-[#1a160f] flex items-center justify-center">
                <Music size={16} className="text-[#3a3328]" />
              </div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#3a3328]">Empty playlist</p>
              <button
                onClick={openAddTracks}
                className="mt-2 flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider hover:border-[#D4BFA0]/50 hover:text-[#D4BFA0] transition-colors"
              >
                <Plus size={12} /> Add tracks
              </button>
            </div>
          ) : (
            tracks.map((track, i) => (
              <div key={track.id} className="group relative">
                <TrackCard
                  track={track}
                  index={i + 1}
                  onClickDetails={(t) => setSelectedTrack(t)}
                  onPlayClick={() => handlePlayTrack(track)}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[#0a0907] border border-[#1a160f] rounded-md p-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveTrack(i, -1); }}
                    disabled={i === 0}
                    title="Move up"
                    className="p-1 text-[#5a5142] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveTrack(i, 1); }}
                    disabled={i === tracks.length - 1}
                    title="Move down"
                    className="p-1 text-[#5a5142] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                    title="Remove from playlist"
                    className="p-1 text-[#5a5142] hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
          </div>
          {/* end right column */}
        </div>
        {/* end side-by-side grid */}
      </div>

      {selectedTrack && (
        <TrackDetailsDrawer track={selectedTrack} onClose={() => setSelectedTrack(null)} onUpdate={fetchData} />
      )}

      {showShareModal && playlist && (
        <ShareModal
          onClose={() => setShowShareModal(false)}
          title={playlist.name}
          trackIds={tracks.map((t) => t.id)}
          coverUrl={playlist.cover_url}
          projectId={params.id}
          kind="playlist"
        />
      )}

      {showAddTracks && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setShowAddTracks(false)}>
          <div className="bg-[#0a0907] border border-[#1f1a13] rounded-2xl w-full max-w-[640px] max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-[#1f1a13] flex items-center justify-between">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#D4BFA0]">Vault</p>
                <h2 className="text-lg font-medium text-white mt-1">Add tracks to playlist</h2>
              </div>
              <button onClick={() => setShowAddTracks(false)} className="p-2 text-[#4a4338] hover:text-white hover:bg-[#1a160f] rounded-lg transition-all">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 border-b border-[#1f1a13]">
              <input
                value={vaultSearch}
                onChange={(e) => setVaultSearch(e.target.value)}
                placeholder="Search vault..."
                className="w-full bg-[#0e0c08] border border-[#1a160f] rounded-md px-3 py-2 text-[12px] text-[#E8DCC8] placeholder-[#4a4338] focus:outline-none focus:border-[#2d2620]"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {vaultTracks.length === 0 ? (
                <div className="py-16 text-center text-[11px] text-[#5a5142]">No tracks available to add. Upload some in the Vault.</div>
              ) : (
                vaultTracks
                  .filter((t) => !vaultSearch || t.title?.toLowerCase().includes(vaultSearch.toLowerCase()))
                  .map((t) => {
                    const isSelected = selected.has(t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => toggleSelected(t.id)}
                        className={`w-full flex items-center gap-3 px-5 py-2.5 border-b border-[#161310] last:border-0 text-left transition-colors ${
                          isSelected ? 'bg-[#2A2418]/40' : 'hover:bg-[#0e0c08]'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected ? 'bg-[#D4BFA0] border-[#D4BFA0]' : 'border-[#2d2620]'
                        }`}>
                          {isSelected && <Check size={11} className="text-white" />}
                        </div>
                        <div className="w-8 h-8 bg-[#14110d] rounded border border-[#1a160f] overflow-hidden shrink-0">
                          {t.cover_url ? <img loading="lazy" src={t.cover_url} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Music size={12} className="text-[#3a3328]" /></div>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-[#E8DCC8] truncate">{t.title}</p>
                          <p className="text-[10px] font-mono text-[#5a5142] uppercase tracking-wider truncate">{t.type}{t.bpm ? ` · ${t.bpm} bpm` : ''}{t.key ? ` · ${t.key}` : ''}</p>
                        </div>
                      </button>
                    );
                  })
              )}
            </div>
             <div className="p-4 border-t border-[#1f1a13] flex items-center justify-between bg-[#0a0907]">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-[#5a5142] uppercase tracking-wider">{selected.size} selected</span>
                {vaultTracks.length > 0 && (
                  <>
                    <span className="text-[#1a160f] font-mono">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        const visibleTracks = vaultTracks.filter((t) => !vaultSearch || t.title?.toLowerCase().includes(vaultSearch.toLowerCase()));
                        const allSelected = visibleTracks.every((t) => selected.has(t.id));
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (allSelected) {
                            visibleTracks.forEach((t) => next.delete(t.id));
                          } else {
                            visibleTracks.forEach((t) => next.add(t.id));
                          }
                          return next;
                        });
                      }}
                      className="text-[10px] font-mono uppercase tracking-wider text-[#D4BFA0] hover:text-[#E8D8B8] cursor-pointer transition-colors"
                    >
                      {vaultTracks.filter((t) => !vaultSearch || t.title?.toLowerCase().includes(vaultSearch.toLowerCase())).every((t) => selected.has(t.id)) ? 'Deselect All' : 'Select All'}
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={submitAddTracks}
                disabled={!selected.size || adding}
                className="flex items-center gap-2 bg-[#D4BFA0] hover:bg-[#8A7A5C] disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all"
              >
                {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Add {selected.size > 0 ? `${selected.size} ` : ''}track{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
