'use client';

/**
 * /playlists = CONSUMPTION LAYER
 * Lightweight track collections for listening, sharing, sending.
 * Not a production workspace (that's /projects).
 */

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Loader2, Music, ListMusic, Plus, Check } from 'lucide-react';
import Link from 'next/link';
import { toast, confirmToast } from '@/hooks/useToast';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { cn } from '@/lib/utils';

interface Playlist {
  id: string;
  name: string;
  cover_url?: string | null;
  track_count?: number;
}

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // Selection mode for batch-delete. Disabled by default so the
  // common case (clicking a card to open it) stays one click. A small
  // "Select" toggle near the New-playlist button activates this mode;
  // cards become checkable and the action bar appears.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchPlaylists = async () => {
    try {
      const res = await fetch('/api/playlists');
      const data = await res.json();
      setPlaylists(Array.isArray(data) ? data : data.playlists || []);
    } catch (err) {
      console.error('Error fetching playlists:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylists();
  }, []);

  const createPlaylist = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Create playlist failed', data.error || `HTTP ${res.status}`);
        return;
      }
      if (data.playlist) {
        await fetchPlaylists();
      }
    } catch (err: any) {
      console.error('Create playlist error:', err);
      toast.error('Create playlist failed', err?.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-10 pt-10">
        {/* Header */}
        <div className="relative mb-10 rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d]/50 via-[#0a0907]/30 to-[#0a0907] p-8">
          {/* Abstract Image Background */}
          <div className="absolute inset-0 z-0 bg-[url('/images/hero-abstract-4.jpg')] bg-cover bg-center opacity-20 mix-blend-overlay" />
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] mb-2">For listening</p>
              <h1 className="text-[40px] font-bold tracking-tight text-white leading-none font-heading mb-3">Playlists</h1>
              <p className="text-[11px] text-[#a08a6a] max-w-md">Curated sets for sharing. Order tracks, generate links, send to people to play.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-[#E8D8B8] uppercase tracking-wider">
                {playlists.length} playlist{playlists.length !== 1 ? 's' : ''}
              </span>
              {/* Select-mode toggle. Activating it converts cards from
                  "click → open" to "click → toggle selected", which
                  surfaces the floating BatchActionBar at the bottom. */}
              <button
                onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
                className={cn(
                  'text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-md border transition-colors',
                  selectMode
                    ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]'
                    : 'bg-[#14110d] border-[#1a160f] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620]',
                )}
              >
                {selectMode ? 'Done' : 'Select'}
              </button>
              {selectMode && playlists.length > 0 && (
                <button
                  onClick={() => {
                    const allSelected = playlists.every((p) => selectedIds.has(p.id));
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (allSelected) {
                        playlists.forEach((p) => next.delete(p.id));
                      } else {
                        playlists.forEach((p) => next.add(p.id));
                      }
                      return next;
                    });
                  }}
                  className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-md border bg-[#14110d] border-[#1a160f] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620] transition-colors"
                >
                  {playlists.every((p) => selectedIds.has(p.id)) ? 'Deselect All' : 'Select All'}
                </button>
              )}
              <button
                onClick={createPlaylist}
                disabled={creating}
                className="flex items-center gap-2 bg-white text-black hover:bg-[#E8DCC8] px-4 py-2 rounded-full text-[12px] font-medium transition-colors active:scale-[0.98] disabled:opacity-40"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                New playlist
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={18} className="animate-spin text-[#4a4338]" />
          </div>
        ) : playlists.length === 0 ? (
          <div className="text-center py-32">
            <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-[#14110d] border border-[#1a160f] flex items-center justify-center">
              <ListMusic size={22} className="text-[#3a3328]" />
            </div>
            <p className="text-sm text-[#E8DCC8] mb-1">No playlists yet</p>
            <p className="text-[11px] text-[#5a5142] mb-6">Group tracks for clients, labels, or private listening</p>
            <button
              onClick={createPlaylist}
              disabled={creating}
              className="inline-flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] disabled:opacity-40 transition-colors"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create first playlist
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
            {playlists.map((playlist) => {
              const selected = selectedIds.has(playlist.id);
              const cardInner = (
                <>
                  <div className={cn(
                    'relative aspect-square bg-[#14110d] rounded-lg mb-3 overflow-hidden border transition-colors',
                    selected ? 'border-[#D4BFA0]' : 'border-[#1a160f] group-hover:border-[#2d2620]',
                  )}>
                    {playlist.cover_url ? (
                      <img loading="lazy" src={playlist.cover_url} alt={playlist.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music size={28} className="text-[#1a160f]" />
                      </div>
                    )}
                    {/* Checkbox overlay — only rendered in select mode.
                        Sits top-right with a backdrop so it's readable on
                        both dark and light cover art. */}
                    {selectMode && (
                      <div className={cn(
                        'absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center backdrop-blur-md transition-colors',
                        selected
                          ? 'bg-[#D4BFA0] border border-[#E8D8B8]'
                          : 'bg-black/40 border border-white/20',
                      )}>
                        {selected && <Check size={13} className="text-white" />}
                      </div>
                    )}
                  </div>
                  <h3 className={cn('text-[13px] font-medium truncate leading-tight mb-1', selected ? 'text-white' : 'text-[#E8DCC8] group-hover:text-white')}>
                    {playlist.name}
                  </h3>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142]">
                    {playlist.track_count || 0} track{(playlist.track_count || 0) !== 1 ? 's' : ''}
                  </p>
                </>
              );
              return selectMode ? (
                // In select mode a plain button toggles selection — no nav.
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(playlist.id)) next.delete(playlist.id); else next.add(playlist.id);
                    return next;
                  })}
                  className="group text-left"
                >
                  {cardInner}
                </button>
              ) : (
                <Link href={`/playlists/${playlist.id}`} key={playlist.id} className="group">
                  {cardInner}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Batch-delete bar — only shown in select mode with ≥1 chosen.
          Parallel DELETE per id; the playlist_tracks junction cascades
          via FK, so no separate junction cleanup needed. */}
      <BatchActionBar
        count={selectedIds.size}
        noun={['playlist', 'playlists']}
        onClear={() => setSelectedIds(new Set())}
        busy={bulkDeleting}
        actions={[{
          label: 'Delete',
          icon: <DeleteIcon size={11} />,
          intent: 'danger',
          onClick: async () => {
            const ok = await confirmToast(
              `Delete ${selectedIds.size} playlist${selectedIds.size === 1 ? '' : 's'}?`,
              'Tracks stay in your library. This removes the playlists themselves.',
              { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
            );
            if (!ok) return;
            setBulkDeleting(true);
            const ids = Array.from(selectedIds);
            const results = await Promise.allSettled(
              ids.map((id) =>
                fetch(`/api/playlists/${id}`, { method: 'DELETE' }).then((r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                }),
              ),
            );
            const failed = results.filter((r) => r.status === 'rejected').length;
            setBulkDeleting(false);
            setSelectedIds(new Set());
            setSelectMode(false);
            await fetchPlaylists();
            if (failed === 0) {
              toast.success(`Deleted ${ids.length} playlist${ids.length === 1 ? '' : 's'}`);
            } else {
              toast.warning(`Deleted ${ids.length - failed}, ${failed} failed`);
            }
          },
        }]}
      />
    </DashboardLayout>
  );
}
