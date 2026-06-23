'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Loader2, ListMusic, Plus, Clock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast, confirmToast } from '@/hooks/useToast';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { usePlayer } from '@/hooks/usePlayer';
import { MediaCard } from '@/components/ui/MediaCard';
import { PlaylistFilterBar } from '@/components/playlists/PlaylistFilterBar';
import { PlaylistOptionsMenu } from '@/components/playlists/PlaylistOptionsMenu';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { filterAndSortPlaylists, DEFAULT_PLAYLIST_FILTERS, type PlaylistFilterState, type PlaylistListItem } from '@/lib/playlists/filters';
import { PlayGlyph } from '@/components/player/TransportIcons';
import { seededGradient } from '@/lib/ui/cover-gradient';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { CreateProjectModal } from '@/components/layout/CreateProjectModal';

interface Playlist extends PlaylistListItem {
  cover_url?: string | null;
  total_duration?: number | null;
  preview_covers?: (string | null)[];
}
interface FolderRow { id: string; name: string; color?: string | null; cover_urls?: string[] }

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
  const [createOpen, setCreateOpen] = useState(false);
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
  const refreshPlaylistsAndFolders = () => {
    fetchPlaylists();
    fetchFolders();
  };
  useEffect(() => { fetchPlaylists(); fetchFolders(); }, []);
  useRealtimeTable({ table: 'playlists', onChange: fetchPlaylists });
  useRealtimeTable({ table: 'playlist_tags', onChange: fetchPlaylists });
  useRealtimeTable({ table: 'playlist_folder_items', onChange: fetchPlaylists });
  useRealtimeTable({ table: 'playlist_tracks', onChange: fetchPlaylists });
  useRealtimeTable({ table: 'tracks', onChange: fetchPlaylists });
  useRealtimeTable({ table: 'playlist_folders', onChange: fetchFolders });

  const togglePin = async (playlist: Playlist, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const next = !playlist.pinned;
    setTogglingPin(playlist.id);
    setPlaylists((prev) => prev.map((p) => p.id === playlist.id ? { ...p, pinned: next } : p));
    try { await fetch(`/api/playlists/${playlist.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: next }) }); }
    catch { setPlaylists((prev) => prev.map((p) => p.id === playlist.id ? { ...p, pinned: !next } : p)); }
    finally { setTogglingPin(null); }
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

  const foldersWithCovers = useMemo(() => folders.map((folder) => ({
    ...folder,
    cover_urls: playlists
      .filter((playlist) => (playlist.folder_ids ?? []).includes(folder.id))
      .flatMap((playlist) => [playlist.cover_url, ...(playlist.preview_covers ?? [])])
      .filter(Boolean)
      .filter((cover, index, all) => all.indexOf(cover) === index)
      .slice(0, 4) as string[],
  })), [folders, playlists]);

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          eyebrow="For listening"
          title="Playlists"
          description="Curated sets for sharing. Order tracks, generate links, send to people to play."
          meta={`${playlists.length} playlist${playlists.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
                variant={selectMode ? 'accent' : 'secondary'}
                size="sm"
              >
                {selectMode ? 'Done' : 'Select'}
              </Button>
              <Button
                onClick={() => setCreateOpen(true)}
                variant="primary"
                leadingIcon={<Plus size={14} aria-hidden="true" />}
              >
                New playlist
              </Button>
            </div>
          }
        />

        <PlaylistFilterBar value={filters} onChange={setFilters} folders={foldersWithCovers} onFoldersChanged={fetchFolders} resultCount={filtered.length} />

        {loading ? (
          <div className="flex items-center justify-center py-32"><Loader2 size={18} className="animate-spin text-[#837B6D]" /></div>
        ) : playlists.length === 0 ? (
          <EmptyState
            icon={<ListMusic size={22} aria-hidden="true" />}
            title="No playlists yet"
            description="Group tracks for clients, labels, or private listening."
            action={
              <Button
                onClick={() => setCreateOpen(true)}
                variant="secondary"
                leadingIcon={<Plus size={12} aria-hidden="true" />}
              >
                Create first playlist
              </Button>
            }
            className="py-32"
          />
        ) : (
          <>
          {!isFiltered && recentPlaylists.length > 0 && (
            <div className="mb-6">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] mb-3 flex items-center gap-2"><Clock size={10} /> Recently opened</p>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {recentPlaylists.map((p) => (
                  <Link key={p.id} href={`/playlists/${p.id}`} onClick={() => trackRecentOpen(p.id)}
                    className="shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[#2B2821] bg-[#171511] hover:border-[#3B372F] hover:bg-[#211F1A] transition-colors min-w-[180px] max-w-[240px]">
                    <div className="w-8 h-8 rounded-md overflow-hidden bg-[#090907] shrink-0">
                      {p.cover_url ? <img src={p.cover_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><ListMusic size={12} /></div>}
                    </div>
                    <span className="text-[11px] font-medium text-[#F7EBDD] truncate">{p.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-[#9B9282] text-[13px] mb-3">No matches</p>
              <button onClick={() => setFilters({ ...DEFAULT_PLAYLIST_FILTERS, tags: new Set() })} className="text-[#D0C3AF] hover:text-[#F7EBDD] text-[11px] underline underline-offset-2">Clear filters</button>
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((playlist) => {
              const count = playlist.track_count ?? 0;
              const toggleSelected = () => setSelectedIds((prev) => {
                    const n = new Set(prev);
                    if (n.has(playlist.id)) n.delete(playlist.id);
                    else n.add(playlist.id);
                    return n;
                  });

              return (
                <MediaCard
                  key={playlist.id}
                  title={playlist.name}
                  href={`/playlists/${playlist.id}`}
                  onOpen={() => trackRecentOpen(playlist.id)}
                  coverUrl={playlist.cover_url}
                  previewCovers={playlist.preview_covers}
                  fallbackIcon={<ListMusic size={26} className="sm:size-8" />}
                  fallbackStyle={seededGradient(playlist.id)}
                  pinned={playlist.pinned}
                  onTogglePin={(e) => togglePin(playlist, e)}
                  pinBusy={togglingPin === playlist.id}
                  selectMode={selectMode}
                  selected={selectedIds.has(playlist.id)}
                  onToggleSelect={toggleSelected}
                  optionsMenu={
                    <PlaylistOptionsMenu playlist={playlist} onChanged={refreshPlaylistsAndFolders} onDeleted={fetchPlaylists} />
                  }
                  overlay={
                    <>
                      <button
                        onClick={async (e) => { e.preventDefault(); e.stopPropagation(); try { const res = await fetch(`/api/playlists/${playlist.id}/tracks`); const data = await res.json(); const tracks = Array.isArray(data) ? data : data.tracks ?? []; if (tracks.length > 0) { setQueue(tracks); setTrack(tracks[0]); } } catch {} }}
                        className="absolute bottom-2 left-2 grid size-7 place-items-center rounded-full bg-white text-black shadow-lg transition-transform hover:scale-105 sm:size-9"
                        title="Play playlist"
                      >
                        <PlayGlyph size={11} className="ml-0.5 sm:size-[13px]" />
                      </button>
                      {count > 0 && (
                        <div className="absolute bottom-2 right-2 rounded-full bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
                          <span className="text-[8px] font-mono text-white/80 tabular-nums sm:text-[9px]">{count}</span>
                        </div>
                      )}
                    </>
                  }
                  meta={
                    <>
                      <span>{count} track{count !== 1 ? 's' : ''}</span>
                      {playlist.total_duration != null && playlist.total_duration > 0 && (
                        <><span className="text-[#3B372F]">·</span><span>{fmtDuration(playlist.total_duration)}</span></>
                      )}
                      {(playlist.tags?.length ?? 0) > 0 && (
                        <><span className="text-[#3B372F]">·</span><span className="truncate">{playlist.tags!.slice(0, 2).map((t) => t.tag).join(' / ')}</span></>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>
          )}
          </>
        )}
      </PageContainer>
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
      {createOpen && (
        <CreateProjectModal
          kind="playlist"
          onClose={() => setCreateOpen(false)}
          onSuccess={(playlist, flow) => {
            setCreateOpen(false);
            fetchPlaylists();
            router.push(`/playlists/${playlist.id}${flow === 'library' ? '?start=library' : ''}`);
          }}
        />
      )}
    </DashboardLayout>
  );
}
