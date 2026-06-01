'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Loader2, Music, ListMusic, Plus, Check, Clock, Pin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast, confirmToast } from '@/hooks/useToast';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { usePlayer } from '@/hooks/usePlayer';
import { cn } from '@/lib/utils';
import { PlaylistFilterBar } from '@/components/playlists/PlaylistFilterBar';
import { PlaylistOptionsMenu } from '@/components/playlists/PlaylistOptionsMenu';
import { filterAndSortPlaylists, DEFAULT_PLAYLIST_FILTERS, type PlaylistFilterState, type PlaylistListItem } from '@/lib/playlists/filters';
import { PlayGlyph } from '@/components/player/TransportIcons';

interface Playlist extends PlaylistListItem {
  cover_url?: string | null;
  total_duration?: number | null;
  preview_covers?: (string | null)[];
}
interface FolderRow { id: string; name: string; color?: string | null }

const RECENTLY_KEY = 'antigravity-recent-playlists';
const MAX_RECENT = 6;
function loadRecentIds(): string[] { try { return JSON.parse(localStorage.getItem(RECENTLY_KEY) || '[]'); } catch { return []; } }
function trackRecentOpen(id: string) { const prev = loadRecentIds().filter((x) => x !== id); localStorage.setItem(RECENTLY_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENT))); }

function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`; return `${Math.max(1, m)} min`;
}

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [filters, setFilters] = useState<PlaylistFilterState>(() => ({ ...DEFAULT_PLAYLIST_FILTERS, tags: new Set() }));
  const [togglingPin, setTogglingPin] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const hasMounted = useRef(false);
  useEffect(() => { setRecentIds(loadRecentIds()); hasMounted.current = true; }, []);

  const { setTrack, setQueue } = usePlayer();
  const router = useRouter();

  const fetchPlaylists = async () => {
    try {
      const res = await fetch('/api/playlists');
      const data = await res.json();
      setPlaylists(Array.isArray(data) ? data : data.playlists || []);
    } catch (err) { console.error('Error fetching playlists:', err); }
    finally { setLoading(false); }
  };
  const fetchFolders = async () => {
    try { const res = await fetch('/api/playlists/folders'); if (!res.ok) return; const d = await res.json(); setFolders(d.folders ?? []); } catch {}
  };
  useEffect(() => { fetchPlaylists(); fetchFolders(); }, []);

  const togglePin = async (playlist: Playlist, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const next = !playlist.pinned;
    setTogglingPin(playlist.id);
    setPlaylists((prev) => prev.map((p) => p.id === playlist.id ? { ...p, pinned: next } : p));
    try { await fetch(`/api/playlists/${playlist.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: next }) }); }
    catch { setPlaylists((prev) => prev.map((p) => p.id === playlist.id ? { ...p, pinned: !next } : p)); }
    finally { setTogglingPin(null); }
  };

  const createPlaylist = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error('Create playlist failed', data.error || `HTTP ${res.status}`); return; }
      if (data.playlist?.id) { await fetchPlaylists(); router.push(`/playlists/${data.playlist.id}`); }
    } catch (err: any) { toast.error('Create playlist failed', err?.message); }
    finally { setCreating(false); }
  };

  const filtered = useMemo(() => {
    const result = filterAndSortPlaylists(playlists, filters) as Playlist[];
    return [...result.filter((p) => p.pinned), ...result.filter((p) => !p.pinned)];
  }, [playlists, filters]);

  const isFiltered = filters.search.trim() !== '' || filters.folder !== 'all' || filters.tags.size > 0;

  const recentPlaylists = useMemo(() => {
    if (!hasMounted.current) return [];
    const byId = new Map(playlists.map((p) => [p.id, p]));
    return recentIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 4) as Playlist[];
  }, [recentIds, playlists]);

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-10">
        {/* Header */}
        <div className="relative mb-8 rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d]/50 via-[#0a0907]/30 to-[#0a0907] p-5 sm:p-7 md:p-8">
          <div className="absolute inset-0 z-0 bg-[url('/images/hero-abstract-4.jpg')] bg-cover bg-center opacity-20 mix-blend-overlay" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] mb-2">For listening</p>
              <h1 className="text-[28px] sm:text-[36px] md:text-[40px] font-bold tracking-tight text-white leading-none font-heading mb-3">Playlists</h1>
              <p className="text-[11px] text-[#a08a6a] max-w-md">Curated sets for sharing. Order tracks, generate links, send to people to play.</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-mono text-[#E8D8B8] uppercase tracking-wider">{playlists.length} playlist{playlists.length !== 1 ? 's' : ''}</span>
              <button onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
                className={cn('text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-md border transition-colors', selectMode ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]' : 'bg-[#14110d] border-[#1a160f] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620]')}>
                {selectMode ? 'Done' : 'Select'}
              </button>
              <button onClick={createPlaylist} disabled={creating}
                className="flex items-center gap-2 bg-white text-black hover:bg-[#E8DCC8] px-4 py-2 rounded-full text-[12px] font-medium transition-colors active:scale-[0.98] disabled:opacity-40">
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                New playlist
              </button>
            </div>
          </div>
        </div>

        <PlaylistFilterBar value={filters} onChange={setFilters} folders={folders} onFoldersChanged={fetchFolders} resultCount={filtered.length} />

        {loading ? (
          <div className="flex items-center justify-center py-32"><Loader2 size={18} className="animate-spin text-[#4a4338]" /></div>
        ) : playlists.length === 0 ? (
          <div className="text-center py-32">
            <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-[#14110d] border border-[#1a160f] flex items-center justify-center"><ListMusic size={22} className="text-[#3a3328]" /></div>
            <p className="text-sm text-[#E8DCC8] mb-1">No playlists yet</p>
            <p className="text-[11px] text-[#5a5142] mb-6">Group tracks for clients, labels, or private listening</p>
            <button onClick={createPlaylist} disabled={creating}
              className="inline-flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] disabled:opacity-40 transition-colors">
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create first playlist
            </button>
          </div>
        ) : (
          <>
          {!isFiltered && recentPlaylists.length > 0 && (
            <div className="mb-6">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] mb-3 flex items-center gap-2"><Clock size={10} /> Recently opened</p>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {recentPlaylists.map((p) => (
                  <Link key={p.id} href={`/playlists/${p.id}`} onClick={() => trackRecentOpen(p.id)}
                    className="shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[#1f1a13] bg-[#14110d] hover:border-[#2d2620] hover:bg-[#1a160f] transition-colors min-w-[180px] max-w-[240px]">
                    <div className="w-8 h-8 rounded-md overflow-hidden bg-[#0a0907] shrink-0">
                      {p.cover_url ? <img src={p.cover_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><ListMusic size={12} /></div>}
                    </div>
                    <span className="text-[11px] font-medium text-[#E8DCC8] truncate">{p.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-[#5a5142] text-[13px] mb-3">No matches</p>
              <button onClick={() => setFilters({ ...DEFAULT_PLAYLIST_FILTERS, tags: new Set() })} className="text-[#a08a6a] hover:text-[#E8DCC8] text-[11px] underline underline-offset-2">Clear filters</button>
            </div>
          ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
            {filtered.map((playlist) => {
              const sel = selectedIds.has(playlist.id);
              const covers = playlist.preview_covers?.filter(Boolean) ?? [];
              const count = playlist.track_count ?? 0;
              const artBlock = (
                <div className={cn('relative aspect-square rounded-xl mb-3 overflow-hidden border transition-all duration-200', sel ? 'border-[#D4BFA0]/60' : 'border-[#1a160f] group-hover:border-[#2d2620]')}>
                  {playlist.cover_url ? <img loading="lazy" src={playlist.cover_url} alt={playlist.name} className="w-full h-full object-cover" />
                    : covers.length >= 4 ? (
                      <div className="w-full h-full grid grid-cols-2 gap-px bg-[#1a160f]">
                        {covers.slice(0, 4).map((url, i) => <div key={i} className="overflow-hidden bg-[#14110d]">{url ? <img loading="lazy" src={url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Music size={12} className="text-[#2d2620]" /></div>}</div>)}
                      </div>
                    ) : <div className="w-full h-full bg-gradient-to-br from-[#2A2418] to-[#0a0907] flex items-center justify-center"><ListMusic size={32} className="text-[#2d2620]" /></div>}
                  {!selectMode && (
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button onClick={async (e) => { e.preventDefault(); e.stopPropagation(); try { const res = await fetch(`/api/playlists/${playlist.id}/tracks`); const data = await res.json(); const tracks = Array.isArray(data) ? data : data.tracks ?? []; if (tracks.length > 0) { setQueue(tracks); setTrack(tracks[0]); } } catch {} }}
                        className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform shadow-xl">
                        <PlayGlyph size={16} className="ml-0.5" />
                      </button>
                    </div>
                  )}
                  {playlist.pinned && !selectMode && (
                    <button onClick={(e) => togglePin(playlist, e)} disabled={togglingPin === playlist.id}
                      className="absolute top-2 left-2 z-20 w-6 h-6 rounded-full bg-[#D4BFA0] text-black flex items-center justify-center shadow-sm" title="Unpin">
                      <Pin size={10} fill="currentColor" />
                    </button>
                  )}
                  {!selectMode && <div className="absolute top-2 right-2 z-10"><PlaylistOptionsMenu playlist={playlist} onChanged={fetchPlaylists} onDeleted={fetchPlaylists} /></div>}
                  {selectMode && <div className={cn('absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center backdrop-blur-md border', sel ? 'bg-[#D4BFA0] border-[#E8D8B8]' : 'bg-black/50 border-white/20')}>{sel && <Check size={12} className="text-black" strokeWidth={3} />}</div>}
                  {count > 0 && !selectMode && <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm"><span className="text-[9px] font-mono text-white/80 tabular-nums">{count}</span></div>}
                </div>
              );
              const meta = (
                <>
                  <h3 className={cn('text-[15px] font-bold truncate leading-tight mb-0.5 transition-colors', sel ? 'text-white' : 'text-white group-hover:text-[#E8D8B8]')}>{playlist.name}</h3>
                  <p className="text-[10px] font-mono text-[#5a5142] flex items-center gap-2">
                    <span>{count} track{count !== 1 ? 's' : ''}</span>
                    {playlist.total_duration != null && playlist.total_duration > 0 && <><span className="text-[#2d2620]">·</span><span>{fmtDuration(playlist.total_duration)}</span></>}
                  </p>
                  {(playlist.tags?.length ?? 0) > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      {playlist.tags!.slice(0, 3).map((t) => <span key={t.tag} className="text-[8px] font-mono uppercase tracking-wider text-[#a08a6a] bg-[#1a160f] border border-[#2d2620] px-1.5 py-0.5 rounded">{t.tag}</span>)}
                      {playlist.tags!.length > 3 && <span className="text-[8px] font-mono text-[#4a4338]">+{playlist.tags!.length - 3}</span>}
                    </div>
                  )}
                </>
              );
              return selectMode ? (
                <button key={playlist.id} type="button" onClick={() => setSelectedIds((prev) => { const n = new Set(prev); n.has(playlist.id) ? n.delete(playlist.id) : n.add(playlist.id); return n; })} className="group text-left">{artBlock}{meta}</button>
              ) : (
                <Link href={`/playlists/${playlist.id}`} key={playlist.id} onClick={() => trackRecentOpen(playlist.id)} className="group">{artBlock}{meta}</Link>
              );
            })}
          </div>
          )}
          </>
        )}
      </div>
      <BatchActionBar count={selectedIds.size} noun={['playlist', 'playlists']} onClear={() => setSelectedIds(new Set())} busy={bulkDeleting}
        actions={[{ label: 'Delete', icon: <DeleteIcon size={11} />, intent: 'danger', onClick: async () => {
          const ok = await confirmToast(`Delete ${selectedIds.size} playlist${selectedIds.size === 1 ? '' : 's'}?`, 'Tracks stay in your library.', { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
          if (!ok) return; setBulkDeleting(true);
          const ids = Array.from(selectedIds);
          const results = await Promise.allSettled(ids.map((id) => fetch(`/api/playlists/${id}`, { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error(); })));
          const failed = results.filter((r) => r.status === 'rejected').length;
          setBulkDeleting(false); setSelectedIds(new Set()); setSelectMode(false);
          await fetchPlaylists();
          if (failed === 0) toast.success(`Deleted ${ids.length} playlist${ids.length === 1 ? '' : 's'}`); else toast.error(`${failed} failed to delete`);
        }}]}
      />
    </DashboardLayout>
  );
}
