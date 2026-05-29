'use client';

/**
 * /library = VAULT
 * Flat list of every track the user owns. The source of truth.
 */

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  Loader2, Music, Search, Sparkles, Play, Shuffle, Disc3, LayoutList, LayoutGrid,
  SlidersHorizontal, Store, FolderOpen, ListMusic, Users, BarChart2,
  ShoppingBag, ArrowRight, AlertCircle, TrendingUp, DollarSign,
  Upload, Rocket, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlayer } from '@/hooks/usePlayer';
import { DropZone } from '@/components/upload/DropZone';
import { TrackCard } from '@/components/tracks/TrackCard';
import { TrackDetailsDrawer } from '@/components/tracks/TrackDetailsDrawer';
import { Track } from '@/lib/types';
import { toast, confirmToast } from '@/hooks/useToast';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { listCached } from '@/lib/offline/audio-cache';
import { TrackGridCard } from '@/components/tracks/TrackGridCard';
import MusicPortfolio, { type PortfolioTrack } from '@/components/library/MusicPortfolio';
import { FilterBar, LibraryFilters, DEFAULT_FILTERS, hasActiveFilters, activeFilterCount } from '@/components/library/FilterBar';
import { ContentShareModal } from '@/components/share/ContentShareModal';

// Sort modes — added so the library is browsable beyond "newest first."
// `recent` reflects upload time; `recently_played` would need a history
// table we don't have. Skipping for now. `store_order` activates the
// beat reorder UI so creators can control public storefront placement.
type SortMode = 'recent' | 'title' | 'bpm' | 'bpm-desc' | 'key' | 'rating' | 'store_order';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'title', label: 'Title A→Z' },
  { value: 'bpm', label: 'BPM ↑' },
  { value: 'bpm-desc', label: 'BPM ↓' },
  { value: 'key', label: 'Key' },
  { value: 'rating', label: 'Rating ↓' },
  { value: 'store_order', label: 'Store Order ↕' },
];

// Circle-of-fifths ordering — sorting by key alphabetically would
// scatter compatible keys. This puts harmonically related keys near
// each other (C / G / D / A / E / B / F# / C# / G# / D# / A# / F).
const KEY_ORDER: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5,
  'F#': 6, 'C#': 7, 'G#': 8, 'D#': 9, 'A#': 10, F: 11,
  // Flat aliases — Postgres / Essentia sometimes emits these instead
  // of sharps. Map them to the equivalent sharp slot so a mixed
  // dataset still sorts coherently.
  Db: 7, Eb: 9, Gb: 6, Ab: 8, Bb: 10,
};
function keyRank(t: { key?: string | null; scale?: string | null }): number {
  if (!t.key) return 999;
  const base = KEY_ORDER[t.key] ?? 998;
  // Minor sits after major in each slot so a key listing groups
  // C major then C minor, D major then D minor, etc.
  return base * 2 + (t.scale === 'minor' ? 1 : 0);
}

export default function LibraryPage() {
  // Proper Track typing rather than the previous `any[]` — catches column
  // renames at compile time and gives the drawer call sites real
  // intellisense on `track.bpm`, `track.energy`, etc.
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'beat' | 'instrumental' | 'song' | 'remix'>('all');
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());

  const refreshOfflineList = async () => {
    try {
      const list = await listCached();
      setCachedIds(new Set(list.map((item) => item.id)));
    } catch (err) {
      console.error('Failed to list cached tracks:', err);
    }
  };

  useEffect(() => {
    refreshOfflineList();
  }, [tracks]);

  const [sortMode, setSortMode] = useState<SortMode>('recent');
  // Batch-select state for delete. Same UX as the playlists page —
  // a "Select" toggle near the bulk-analyze button activates select
  // mode, then TrackCards expose checkboxes via the `selectable` prop.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [shareTarget, setShareTarget] = useState<Track | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'portfolio'>('list');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<LibraryFilters>(() => ({
    ...DEFAULT_FILTERS,
    genres: new Set<string>(),
    statuses: new Set<string>(),
    keys: new Set<string>(),
  }));
  useEffect(() => {
    const saved = localStorage.getItem('library-view') as 'list' | 'grid' | 'portfolio' | null;
    if (saved === 'list' || saved === 'grid' || saved === 'portfolio') setViewMode(saved);
  }, []);
  useEffect(() => { localStorage.setItem('library-view', viewMode); }, [viewMode]);
  const { setTrack, setQueue, currentTrack, isPlaying } = usePlayer();
  const router = useRouter();

  // ── New Release dropdown ─────────────────────────────────────────
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [releaseDropdownOpen, setReleaseDropdownOpen] = useState(false);

  const handleNewRelease = async (mode: 'both' | 'project' | 'playlist') => {
    if (creatingRelease) return;
    setCreatingRelease(true);
    setReleaseDropdownOpen(false);
    try {
      if (mode === 'project') {
        const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        toast.success('Project created');
        router.push(`/projects/${data.project.id}`);
      } else if (mode === 'playlist') {
        const res = await fetch('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        toast.success('Playlist created');
        router.push(`/playlists/${data.playlist.id}`);
      } else {
        const [projRes, playRes] = await Promise.all([
          fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
          fetch('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        ]);
        const [projData] = await Promise.all([projRes.json(), playRes.json()]);
        if (!projRes.ok) throw new Error(projData.error || 'Failed');
        toast.success('New release started', 'Project + playlist created — add tracks and cover art.');
        router.push(`/projects/${projData.project.id}`);
      }
    } catch (err: any) {
      toast.error('Could not create', err.message);
    } finally {
      setCreatingRelease(false);
    }
  };

  const fetchTracks = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/tracks');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Failed to load tracks (${res.status})`);
      }
      setTracks(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Error fetching tracks:', err);
      setFetchError(err?.message || 'Failed to load tracks');
      setTracks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTracks(); }, []);

  // Light analytics summary for the dashboard — plays, sales, gross.
  const [analyticsStats, setAnalyticsStats] = useState<{ plays: number; sales_count: number; gross_usd: number } | null>(null);
  useEffect(() => {
    fetch('/api/analytics')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.totals) setAnalyticsStats(d.totals); })
      .catch(() => undefined);
  }, []);

  // Auto-refresh on track inserts/updates/deletes. Replaces the previous
  // "refresh only on user action" behavior — uploads from elsewhere or
  // analyze jobs landing now surface immediately in the library.
  useRealtimeTable({ table: 'tracks', onChange: fetchTracks });

  // Whenever the tracks list refreshes, re-sync the open drawer's track so
  // edits (re-analyze, rating, status, replace audio) reflect immediately
  // without requiring the user to close + reopen.
  useEffect(() => {
    if (!selectedTrack) return;
    const fresh = tracks.find((t) => t.id === selectedTrack.id);
    if (fresh && fresh !== selectedTrack) setSelectedTrack(fresh);
  }, [tracks, selectedTrack]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = tracks.filter((t) => {
      if (offlineOnly && !cachedIds.has(t.id)) return false;
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (filters.bpmMin != null && (t.bpm == null || t.bpm < filters.bpmMin)) return false;
      if (filters.bpmMax != null && (t.bpm == null || t.bpm > filters.bpmMax)) return false;
      if (filters.keys.size > 0 && (!t.key || !filters.keys.has(t.key))) return false;
      if (filters.scale === 'major' && t.scale === 'minor') return false;
      if (filters.scale === 'minor' && t.scale !== 'minor') return false;
      if (filters.statuses.size > 0 && (!t.status || !filters.statuses.has(t.status))) return false;
      if (filters.rating != null && (t.rating == null || t.rating < filters.rating)) return false;
      // Genre filter — track_tags come down from the API rich select
      if (filters.genres.size > 0) {
        const trackGenres: string[] = ((t as any).track_tags ?? [])
          .filter((tt: any) => tt.category === 'genre')
          .map((tt: any) => tt.tag);
        if (!Array.from(filters.genres).some((g) => trackGenres.includes(g))) return false;
      }
      if (!q) return true;
      // Match against title, key (e.g. "C minor", "Am"), and BPM
      // string (e.g. "140"). Tags aren't on the Track row by default,
      // so we skip them here — TagPicker filtering belongs in a
      // dedicated chip strip if/when surfaced.
      const haystack = [
        t.title,
        t.key ? `${t.key} ${t.scale ?? ''}` : '',
        t.bpm != null ? String(t.bpm) : '',
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    // Stable sort by the chosen mode. We don't mutate `tracks` directly —
    // returning a fresh array also retriggers downstream memos cleanly.
    const sorted = [...matched];
    switch (sortMode) {
      case 'title':
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'bpm':
        sorted.sort((a, b) => (a.bpm ?? Infinity) - (b.bpm ?? Infinity));
        break;
      case 'bpm-desc':
        sorted.sort((a, b) => (b.bpm ?? -Infinity) - (a.bpm ?? -Infinity));
        break;
      case 'key':
        sorted.sort((a, b) => keyRank(a) - keyRank(b));
        break;
      case 'rating':
        sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        break;
      case 'store_order':
        // Tracks with a set store_sort_order come first (ascending),
        // then tracks with no order fall to the bottom sorted by created_at.
        sorted.sort((a, b) => {
          const ao = (a as any).store_sort_order;
          const bo = (b as any).store_sort_order;
          if (ao == null && bo == null) return String(b.created_at).localeCompare(String(a.created_at));
          if (ao == null) return 1;
          if (bo == null) return -1;
          return ao - bo;
        });
        break;
      case 'recent':
      default:
        sorted.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    return sorted;
  }, [tracks, search, typeFilter, offlineOnly, cachedIds, sortMode, filters]);

  const currentHeroTrack = currentTrack || filtered[0] || null;
  const heroCoverUrl = currentHeroTrack?.cover_url || null;

  // ── Browse mode: 'sections' (homepage-style) or 'all' (paginated list) ──
  const [browseMode, setBrowseMode] = useState<'sections' | 'all'>('sections');
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 50;

  // Reset page when filters change
  useEffect(() => { setCurrentPage(0); }, [search, typeFilter, offlineOnly, sortMode, filters]);

  // Paginated slice for 'all' view
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageTracks = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // ── Sections for homepage-style browse ──────────────────────────
  const sections = useMemo(() => {
    const byDate = [...tracks].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const result: Array<{ title: string; subtitle?: string; tracks: Track[] }> = [];

    // Helper: get genres for a track from the nested track_tags
    const getGenres = (t: any): string[] =>
      (t.track_tags ?? []).filter((tt: any) => tt.category === 'genre').map((tt: any) => tt.tag);

    // ── Recently added
    const recentlyAdded = byDate.slice(0, 10);
    if (recentlyAdded.length) result.push({ title: 'Recently Added', tracks: recentlyAdded });

    // ── MAQ ideas — maquette/bare demos
    const maq = tracks.filter((t) => t.status === 'maq').slice(0, 10);
    if (maq.length) result.push({ title: 'MAQ — Maquette Ideas', subtitle: 'Stripped demos to develop', tracks: maq });

    // ── WIP — in progress
    const wip = tracks.filter((t) => t.status === 'needs_work').slice(0, 10);
    if (wip.length) result.push({ title: 'WIP — In Progress', subtitle: 'Needs more work', tracks: wip });

    // ── Finished & ready
    const finished = tracks.filter((t) => t.status === 'finished').slice(0, 10);
    if (finished.length) result.push({ title: 'Finished — Ready', subtitle: 'Polished and ready to share', tracks: finished });

    // ── Genre rows — derive from track_tags
    const TOP_GENRES = ['Drill', 'Trap', 'R&B', 'Afrobeats', 'Amapiano', 'Hip-hop', 'Lo-fi'];
    for (const genre of TOP_GENRES) {
      const genreTracks = tracks.filter((t) => getGenres(t).includes(genre)).slice(0, 10);
      if (genreTracks.length >= 2) {
        result.push({ title: genre, subtitle: `${genreTracks.length} track${genreTracks.length === 1 ? '' : 's'}`, tracks: genreTracks });
      }
    }

    // ── In your store
    const listed = tracks.filter((t: any) => t.store_listed).slice(0, 10);
    if (listed.length) result.push({ title: 'In Your Store', subtitle: `${listed.length} listed`, tracks: listed });

    return result;
  }, [tracks]);

  // Total library duration shown in the hero.
  const totalDurationLabel = useMemo(() => {
    const secs = tracks.reduce((s, t) => s + (t.duration_seconds || 0), 0);
    if (secs <= 0) return '';
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    if (hours > 0) return `${hours} hr ${mins} min`;
    return `${Math.max(1, mins)} min`;
  }, [tracks]);

  // Aggregate stats computed from the full library (not the filtered
  // view) so the stat strip reflects the vault state, not search state.
  const libraryStats = useMemo(() => {
    const withBpm = tracks.filter((t) => t.bpm != null);
    const avgBpm = withBpm.length
      ? Math.round(withBpm.reduce((s, t) => s + (t.bpm ?? 0), 0) / withBpm.length)
      : null;

    // Most common key (e.g. "C# minor")
    const keyCount: Record<string, number> = {};
    for (const t of tracks) {
      if (t.key) {
        const k = `${t.key}${t.scale === 'minor' ? 'm' : ''}`;
        keyCount[k] = (keyCount[k] ?? 0) + 1;
      }
    }
    const topKey = Object.entries(keyCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const topKeyScale = topKey?.endsWith('m') ? 'minor' : 'major';

    // Most common type
    const typeCount: Record<string, number> = {};
    for (const t of tracks) {
      if (t.type) typeCount[t.type] = (typeCount[t.type] ?? 0) + 1;
    }
    const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // Average rating (only rated tracks)
    const rated = tracks.filter((t) => t.rating != null && t.rating > 0);
    const avgRating = rated.length
      ? (rated.reduce((s, t) => s + (t.rating ?? 0), 0) / rated.length).toFixed(1)
      : null;

    return { avgBpm, topKey, topKeyScale, topType, avgRating };
  }, [tracks]);

  const listedTracks = useMemo(() => tracks.filter((t: any) => t.store_listed), [tracks]);
  const attentionCount = useMemo(() => {
    return listedTracks.filter((t: any) =>
      !t.cover_url || (!t.lease_price_usd && !t.exclusive_price_usd) || !t.bpm
    ).length;
  }, [listedTracks]);

  const playAll = () => {
    if (filtered.length === 0) return;
    setQueue(filtered);
    setTrack(filtered[0]);
  };
  const shuffleAll = () => {
    if (filtered.length === 0) return;
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    setQueue(shuffled);
    setTrack(shuffled[0]);
  };

  // Store reorder — swap store_sort_order between positions fromIdx and toIdx
  // within the current filtered list (only valid in store_order sort mode).
  // We assign contiguous integers on first move if tracks haven't been ordered.
  const moveTrack = async (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= filtered.length) return;

    // Build a working copy with sort orders assigned (fill nulls with position)
    const withOrder = filtered.map((t, i) => ({
      ...t,
      store_sort_order: (t as any).store_sort_order ?? i,
    }));

    // Swap the two
    const aOrder = withOrder[fromIdx].store_sort_order as number;
    const bOrder = withOrder[toIdx].store_sort_order as number;
    withOrder[fromIdx] = { ...withOrder[fromIdx], store_sort_order: bOrder };
    withOrder[toIdx] = { ...withOrder[toIdx], store_sort_order: aOrder };

    // Optimistic state update — rebuild the full tracks array
    setTracks((prev) => {
      const updated = new Map(withOrder.map((t) => [t.id, t]));
      return prev.map((t) => updated.get(t.id) ?? t);
    });

    // Persist both affected tracks in parallel
    await Promise.all([withOrder[fromIdx], withOrder[toIdx]].map((t) =>
      fetch(`/api/tracks/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_sort_order: t.store_sort_order }),
      }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }),
    )).catch(() => {
      // On failure re-fetch the true server state
      fetchTracks();
    });
  };

  const playTrack = (track: any) => {
    // Queue rule: the filtered view if it's the user's current context
    // (multiple visible tracks → they're browsing a subset), otherwise
    // the full library. A filter-of-one would otherwise leave "next"
    // dead, which surprises users who expect Library = album-like queue.
    setQueue(filtered.length > 1 ? filtered : tracks);
    setTrack(track);
  };

  // Tracks that look like they predate the heuristic-features fix.
  // We treat "missing intelligence" as null/undefined on the four AudD-ish
  // fields. Tracks where AudD genuinely returned 0 are skipped — re-analyzing
  // them won't help.
  const stale = useMemo(
    () =>
      tracks.filter(
        (t: any) =>
          !!t.audio_url &&
          (t.energy == null ||
            t.danceability == null ||
            t.valence == null ||
            t.acousticness == null),
      ),
    [tracks],
  );

  const [bulkAnalyzing, setBulkAnalyzing] = useState<{ done: number; total: number } | null>(null);

  const runBulkAnalyze = async () => {
    if (stale.length === 0 || bulkAnalyzing) return;
    setBulkAnalyzing({ done: 0, total: stale.length });
    let ok = 0;
    // Collect per-track failure reasons. The old version just counted
    // fails — users would see "3 failed" with no idea which tracks or
    // why. Now we surface the first few reasons in the toast.
    const failures: { title: string; reason: string }[] = [];
    for (let i = 0; i < stale.length; i++) {
      const t = stale[i];
      try {
        const res = await fetch(`/api/tracks/${t.id}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (res.ok) {
          ok++;
        } else {
          const j = await res.json().catch(() => ({}));
          failures.push({ title: t.title || t.id, reason: j?.error || `HTTP ${res.status}` });
        }
      } catch (err) {
        failures.push({ title: t.title || t.id, reason: err instanceof Error ? err.message : 'Network error' });
      }
      setBulkAnalyzing({ done: i + 1, total: stale.length });
    }
    setBulkAnalyzing(null);
    await fetchTracks();
    if (failures.length === 0) {
      toast.success(`Analyzed ${ok} tracks`);
    } else {
      // Truncate to first 3 reasons; the rest are summarised. Keeps the
      // toast readable for big bulk runs that pile up failures.
      const sample = failures.slice(0, 3).map((f) => `• ${f.title}: ${f.reason}`).join('\n');
      const more = failures.length > 3 ? `\n…and ${failures.length - 3} more.` : '';
      toast.warning(`Analyzed ${ok}, ${failures.length} failed`, `${sample}${more}`);
    }
  };

  const handleDeleteTrack = async (track: Track) => {
    const ok = await confirmToast(
      `Delete "${track.title}"?`,
      'This permanently removes the track from your library.',
      { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/tracks/${track.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error('Delete failed', j.error || `HTTP ${res.status}`);
        return;
      }
      setTracks((prev) => prev.filter((t) => t.id !== track.id));
      if (selectedTrack?.id === track.id) setSelectedTrack(null);
      toast.success('Track deleted');
    } catch (err: any) {
      toast.error('Delete failed', err?.message);
    }
  };

  // Map library tracks to the PortfolioTrack shape MusicPortfolio expects.
  const portfolioTracks = useMemo<PortfolioTrack[]>(() => {
    return filtered.map((track) => ({
      id: track.id,
      title: track.title,
      artist: (track as { creator?: { display_name?: string } }).creator?.display_name ?? 'U2C',
      type: track.type,
      cover_url: track.cover_url ?? null,
      bpm: track.bpm,
      key: track.key,
      year: track.created_at ? new Date(track.created_at).getFullYear().toString() : '',
    }));
  }, [filtered]);

  const handlePortfolioPlay = useCallback((trackId: string) => {
    const track = filtered.find((t) => t.id === trackId);
    if (track) playTrack(track);
  }, [filtered]);

  // Portfolio is an immersive full-bleed mode — early-return replaces
  // the entire library page chrome with just MusicPortfolio (which
  // exposes its own onExit chip to come back to list view).
  if (viewMode === 'portfolio') {
    return (
      <DashboardLayout>
        <MusicPortfolio
          tracks={portfolioTracks}
          onTrackPlay={handlePortfolioPlay}
          currentTrackId={currentTrack?.id ?? null}
          isPlaying={isPlaying}
          onExit={() => setViewMode('list')}
        />
        {shareTarget && (
          <ContentShareModal
            contentType="track"
            contentId={shareTarget.id}
            contentTitle={shareTarget.title}
            coverUrl={shareTarget.cover_url}
            onClose={() => setShareTarget(null)}
          />
        )}
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-10">
        {/* Hero — gradient panel with the library "cover" tile, title,
            stats, and the two primary actions (Play / Shuffle). Builds on
            the same gradient + glass language as the project detail
            cover, only flatter and wider. Filter chips and the secondary
            toolbar sit underneath, outside the hero, so the hero only
            owns identity + primary intent. */}
        {/* ── Hero — Spotify-style: large cover + blurred backdrop ── */}
        <div className="relative mb-5 rounded-[28px] overflow-hidden border border-white/[0.06] shadow-[0_24px_60px_rgba(0,0,0,0.6)] transition-all duration-700" style={{ minHeight: 160 }}>
          {/* Full-bleed blurred backdrop from cover art */}
          <div
            className="absolute inset-0 z-0 bg-cover bg-center scale-110 transition-all duration-700"
            style={{
              backgroundImage: heroCoverUrl ? `url(${heroCoverUrl})` : "url('/images/hero-abstract-1.png')",
              filter: 'blur(48px) saturate(1.3)',
              opacity: heroCoverUrl ? 0.55 : 0.3,
            }}
          />
          {/* Dark overlay so text stays readable */}
          <div className="absolute inset-0 z-0" style={{ background: 'linear-gradient(135deg, rgba(10,9,7,0.45) 0%, rgba(10,9,7,0.75) 60%, rgba(10,9,7,0.92) 100%)' }} />

          <div className="relative z-10 flex items-end gap-5 md:gap-7 p-5 sm:p-7">
            {/* Square cover tile — like Spotify playlist header */}
            <div className={`w-[100px] h-[100px] sm:w-[132px] sm:h-[132px] rounded-2xl overflow-hidden shrink-0 shadow-[0_16px_40px_rgba(0,0,0,0.7)] border border-white/[0.08] bg-[#14110d] transition-all duration-500 ${isPlaying ? 'ring-2 ring-white/20' : ''}`}>
              {heroCoverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={heroCoverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#D4BFA0]/20 to-[#1a1a3a]/30">
                  <Disc3 size={36} className={`text-white/30 ${isPlaying ? 'animate-[spin_6s_linear_infinite]' : ''}`} strokeWidth={0.75} />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 pb-1">
              <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/50 mb-1.5">
                {currentTrack ? 'Now playing' : 'Your workspace'}
              </p>
              <h1 className="text-[24px] sm:text-[36px] md:text-[46px] font-bold tracking-tight text-white leading-none font-heading mb-2 drop-shadow-lg">
                {currentTrack?.title ?? 'Home'}
              </h1>
              <p className="text-[11px] font-mono text-white/50 mb-4">
                {currentTrack
                  ? [currentTrack.bpm && `${currentTrack.bpm} BPM`, currentTrack.key && `${currentTrack.key}${currentTrack.scale === 'minor' ? 'm' : ''}`].filter(Boolean).join(' · ')
                  : `${tracks.length} track${tracks.length !== 1 ? 's' : ''}${totalDurationLabel ? ` · ${totalDurationLabel}` : ''}`}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={playAll} disabled={!filtered.length} className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-[12px] font-bold hover:bg-[#E8DCC8] active:scale-[0.98] disabled:opacity-40 transition-all shadow-lg">
                  <Play size={13} fill="currentColor" className="ml-0.5" />
                  Play all
                </button>
                <button onClick={shuffleAll} disabled={!filtered.length} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.10] border border-white/[0.12] text-[#E8DCC8] text-[12px] font-medium hover:bg-white/[0.18] disabled:opacity-40 transition-colors backdrop-blur-sm">
                  <Shuffle size={12} />
                  Shuffle
                </button>
                {stale.length > 0 && (
                  <button onClick={runBulkAnalyze} disabled={!!bulkAnalyzing} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-white/60 text-[12px] font-medium hover:bg-white/[0.12] disabled:opacity-40 transition-colors">
                    {bulkAnalyzing ? <><Loader2 size={11} className="animate-spin" /><span>{bulkAnalyzing.done}/{bulkAnalyzing.total}</span></> : <><Sparkles size={11} /><span>Analyze {stale.length}</span></>}
                  </button>
                )}
                <button onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }} className={`text-[11px] font-medium px-4 py-2.5 rounded-full transition-colors ml-auto backdrop-blur-sm ${selectMode ? 'bg-white/[0.15] border border-white/[0.20] text-white' : 'bg-white/[0.06] border border-white/[0.08] text-white/50 hover:text-white'}`}>
                  {selectMode ? 'Done' : 'Select'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Quick actions ──────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button onClick={() => window.scrollTo({ top: 9999, behavior: 'smooth' })} className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#14110d] border border-[#1f1a13] text-[11px] font-medium text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620] hover:bg-[#18140f] transition-all">
            <Upload size={13} />Upload beat
          </button>

          {/* New Release — split button with dropdown */}
          <div className="relative">
            <div className="flex items-center rounded-full overflow-hidden bg-[#D4BFA0] text-black shadow-sm">
              <button
                onClick={() => handleNewRelease('both')}
                disabled={creatingRelease}
                className="flex items-center gap-1.5 pl-3.5 pr-2.5 py-2 text-[11px] font-bold hover:bg-[#E8D8B8] transition-colors disabled:opacity-60"
              >
                {creatingRelease ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
                New release
              </button>
              <div className="w-px h-4 bg-black/20" />
              <button
                onClick={() => setReleaseDropdownOpen((v) => !v)}
                className="px-2 py-2 hover:bg-[#E8D8B8] transition-colors"
                aria-label="Release options"
              >
                <ChevronDown size={12} />
              </button>
            </div>
            {releaseDropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setReleaseDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-1.5 z-40 w-48 bg-[#14110d] border border-[#1f1a13] rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                  {[
                    { mode: 'both' as const, label: 'Project + Playlist', sub: 'Full release flow' },
                    { mode: 'project' as const, label: 'Project only', sub: 'Production session' },
                    { mode: 'playlist' as const, label: 'Playlist only', sub: 'Curated set' },
                  ].map(({ mode, label, sub }) => (
                    <button
                      key={mode}
                      onClick={() => handleNewRelease(mode)}
                      className="w-full flex flex-col items-start px-4 py-3 text-left hover:bg-[#1a160f] transition-colors border-b border-[#1a160f] last:border-0"
                    >
                      <span className="text-[12px] font-medium text-[#E8DCC8]">{label}</span>
                      <span className="text-[9px] font-mono text-[#5a5142] mt-0.5">{sub}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {[
            { label: 'Store editor', icon: <Store size={13} />, href: '/store-editor' },
            { label: 'View sales',   icon: <ShoppingBag size={13} />, href: '/sales' },
            { label: 'Analytics',    icon: <BarChart2 size={13} />,   href: '/analytics' },
          ].map(({ label, icon, href }) => (
            <Link key={label} href={href} className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#14110d] border border-[#1f1a13] text-[11px] font-medium text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620] hover:bg-[#18140f] transition-all">
              {icon}{label}
            </Link>
          ))}
        </div>

        {/* ── Dashboard — Spotify-style home content ────────────── */}
        <div className="mb-6 space-y-4">

          {/* Row A: Spotify pinned-style grid — 2 per row on mobile, 4 on md */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([
              {
                href: '/store-editor',
                label: 'Your Store',
                sub: `${listedTracks.length} listed`,
                icon: <Store size={15} />,
                accent: '#9d95e8',
                cover: listedTracks.find((t: any) => t.cover_url)?.cover_url ?? null,
              },
              {
                href: '/projects',
                label: 'Projects',
                sub: 'Sessions',
                icon: <FolderOpen size={15} />,
                accent: '#D4BFA0',
                cover: tracks.filter((t: any) => t.cover_url)[1]?.cover_url ?? null,
              },
              {
                href: '/sales',
                label: 'Sales',
                sub: analyticsStats ? `$${analyticsStats.gross_usd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : 'Revenue',
                icon: <ShoppingBag size={15} />,
                accent: '#6DC6A4',
                cover: tracks.filter((t: any) => t.cover_url)[2]?.cover_url ?? null,
              },
              {
                href: '/analytics',
                label: 'Analytics',
                sub: analyticsStats ? `${analyticsStats.plays} plays` : 'Engagement',
                icon: <BarChart2 size={15} />,
                accent: '#c8a84b',
                cover: tracks.filter((t: any) => t.cover_url)[3]?.cover_url ?? null,
              },
            ] as const).map(({ href, label, sub, icon, accent, cover }) => (
              <Link key={href} href={href} className="group relative flex items-center gap-0 rounded-xl border border-[#1f1a13] bg-[#14110d] hover:bg-[#1e1a14] overflow-hidden transition-all hover:border-[#2d2620] hover:shadow-xl">
                {/* Square cover — left quarter of the card */}
                <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 flex items-center justify-center overflow-hidden" style={{ backgroundColor: `${accent}18` }}>
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cover} alt="" className="w-full h-full object-cover" />
                    : <span style={{ color: accent }}>{icon}</span>}
                </div>
                <div className="flex-1 min-w-0 px-3 py-3.5">
                  <p className="text-[12px] font-bold text-[#E8DCC8] truncate leading-tight">{label}</p>
                  <p className="text-[9px] font-mono text-[#5a5142] mt-0.5 truncate">{sub}</p>
                </div>
                {/* Hover play dot */}
                <div className="absolute right-2.5 bottom-2.5 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100" style={{ backgroundColor: accent }}>
                  <Play size={10} fill="#000" className="text-black ml-0.5" />
                </div>
              </Link>
            ))}
          </div>

          {/* Row B: Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { label: 'Plays', value: analyticsStats != null ? String(analyticsStats.plays) : '—', icon: <TrendingUp size={12} />, color: 'text-[#a08a6a]' },
              { label: 'Sales', value: analyticsStats != null ? String(analyticsStats.sales_count) : '—', icon: <ShoppingBag size={12} />, color: 'text-[#6DC6A4]' },
              { label: 'Gross', value: analyticsStats != null ? `$${analyticsStats.gross_usd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—', icon: <DollarSign size={12} />, color: 'text-[#c8a84b]' },
              { label: 'In store', value: String(listedTracks.length), icon: <Store size={12} />, color: 'text-[#9d95e8]' },
            ].map(({ label, value, icon, color }) => (
              <div key={label} className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-4 py-2.5 flex items-center gap-3">
                <span className={color}>{icon}</span>
                <div>
                  <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142]">{label}</p>
                  <p className="text-[16px] font-bold text-white tabular-nums leading-tight">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Row C: Nav shortcuts + attention */}
          <div className="flex flex-wrap gap-2 items-center">
            {([
              { href: '/playlists', label: 'Playlists', icon: <ListMusic size={12} /> },
              { href: '/contacts', label: 'Contacts', icon: <Users size={12} /> },
              { href: '/calendar', label: 'Calendar', icon: <TrendingUp size={12} /> },
            ] as const).map(({ href, label, icon }) => (
              <Link key={href} href={href} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#1f1a13] bg-[#14110d] text-[10px] font-mono text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620] transition-all">
                {icon}{label}<ArrowRight size={9} className="opacity-50" />
              </Link>
            ))}
            {attentionCount > 0 && (
              <Link href="/store-editor" className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#3a2f1f]/50 bg-[#1f1510]/60 text-[10px] font-mono text-[#c8a84b] hover:bg-[#241a0e]/80 transition-colors ml-auto">
                <AlertCircle size={11} className="shrink-0" />
                {attentionCount} beat{attentionCount === 1 ? '' : 's'} need attention
              </Link>
            )}
          </div>
        </div>

        {/* ── Library section header + browse toggle ─────────────── */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Music size={13} className="text-[#5a5142]" />
            <h2 className="text-[11px] font-mono uppercase tracking-[0.25em] text-[#a08a6a]">Library</h2>
            <span className="text-[9px] font-mono text-[#3a3328] tabular-nums">· {tracks.length}</span>
          </div>
          {/* Browse mode toggle */}
          <div className="flex items-center bg-white/[0.04] border border-white/[0.06] rounded-full p-0.5">
            <button
              onClick={() => setBrowseMode('sections')}
              className={`px-3 py-1 rounded-full text-[10px] font-medium transition-colors ${browseMode === 'sections' ? 'bg-white text-black' : 'text-[#6a5d4a] hover:text-[#a08a6a]'}`}
            >Browse</button>
            <button
              onClick={() => setBrowseMode('all')}
              className={`px-3 py-1 rounded-full text-[10px] font-medium transition-colors ${browseMode === 'all' ? 'bg-white text-black' : 'text-[#6a5d4a] hover:text-[#a08a6a]'}`}
            >All tracks</button>
          </div>
        </div>

        {/* ── Sections view (Browse mode) ────────────────────────── */}
        {browseMode === 'sections' && !loading && (
          <div className="mb-6 space-y-6">
            {sections.length === 0 ? (
              <p className="text-[12px] text-[#5a5142] py-8 text-center">Upload your first track to see sections here.</p>
            ) : sections.map((sec) => (
              <div key={sec.title}>
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <h3 className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">{sec.title}</h3>
                    {(sec as any).subtitle && <p className="text-[9px] font-mono text-[#3a3328] mt-0.5">{(sec as any).subtitle}</p>}
                  </div>
                  <button
                    onClick={() => { setBrowseMode('all'); }}
                    className="text-[9px] font-mono text-[#5a5142] hover:text-[#a08a6a] transition-colors"
                  >See all →</button>
                </div>
                {/* Horizontal scrolling row of mini cards */}
                <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
                  {sec.tracks.map((t) => (
                    <MiniTrackCard
                      key={t.id}
                      track={t}
                      isCurrent={currentTrack?.id === t.id}
                      isPlaying={isPlaying && currentTrack?.id === t.id}
                      onPlay={() => { setTrack(t); setQueue(sec.tracks); }}
                      onOpen={() => { setSelectedTrack(t); playTrack(t); }}
                    />
                  ))}
                </div>
              </div>
            ))}
            {/* Upload zone in sections view too */}
            <div className="pt-2">
              <DropZone onUploadSuccess={fetchTracks} />
            </div>
          </div>
        )}

        {/* Filter chips — Beat and Instrumental are mutually exclusive
            single-type filters. "All" resets. Only shown in 'all' list view. */}
        {browseMode === 'all' && (
          <>
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {([
            { value: 'all',          label: 'All' },
            { value: 'beat',         label: 'Beats' },
            { value: 'instrumental', label: 'Instrumentals' },
            { value: 'song',         label: 'Songs' },
            { value: 'remix',        label: 'Remixes' },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setOfflineOnly(false); setTypeFilter(value); }}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                typeFilter === value && !offlineOnly
                  ? 'bg-white text-black'
                  : 'bg-white/[0.04] border border-white/[0.06] text-[#a08a6a] hover:text-white hover:bg-white/[0.08]'
              }`}
            >{label}</button>
          ))}
          
          <button
            onClick={() => {
              setOfflineOnly(true);
              refreshOfflineList();
            }}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-medium capitalize transition-colors flex items-center gap-1.5 ${
              offlineOnly
                ? 'bg-[#7F77DD] text-white border border-[#7F77DD]/40 shadow-[0_0_8px_rgba(127,119,221,0.4)]'
                : 'bg-white/[0.04] border border-white/[0.06] text-[#a08a6a] hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            <span>Offline</span>
            {cachedIds.size > 0 && (
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded font-mono ${
                offlineOnly ? 'bg-white text-[#7F77DD]' : 'bg-[#7F77DD]/20 text-[#AFA9EC]'
              }`}>
                {cachedIds.size}
              </span>
            )}
          </button>
        </div>

        {/* Secondary toolbar — search on the left, sort dropdown on the
            right. Lives below the chips so the hero + chip strip read
            as the identity row, and the toolbar is the actual control. */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6">
          <div className="relative flex-1 min-w-[160px] sm:max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
            <input
              placeholder="Search tracks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-full pl-8 pr-3 py-2 text-[12px] text-[#E8DCC8] placeholder-[#4a4338] focus:outline-none focus:border-white/[0.12] transition-colors"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-medium transition-colors ${
                showFilters || hasActiveFilters(filters)
                  ? 'bg-[#2A2418] border border-[#8A7A5C]/40 text-[#E8D8B8]'
                  : 'bg-white/[0.04] border border-white/[0.06] text-[#a08a6a] hover:text-[#E8DCC8] hover:bg-white/[0.08]'
              }`}
            >
              <SlidersHorizontal size={11} />
              Filters
              {hasActiveFilters(filters) && (
                <span className="w-4 h-4 rounded-full bg-[#D4BFA0] text-black text-[8px] font-bold flex items-center justify-center leading-none">
                  {activeFilterCount(filters)}
                </span>
              )}
            </button>
            <Dropdown
              value={sortMode}
              onChange={(v) => setSortMode(v as SortMode)}
              options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              label="Sort"
              aria-label="Sort tracks"
            />
            <div className="flex items-center bg-white/[0.04] border border-white/[0.06] rounded-full p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-full transition-colors ${
                  viewMode === 'list' ? 'bg-white text-black' : 'text-[#6a5d4a] hover:text-[#a08a6a]'
                }`}
                title="List view"
              >
                <LayoutList size={13} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-full transition-colors ${
                  viewMode === 'grid' ? 'bg-white text-black' : 'text-[#6a5d4a] hover:text-[#a08a6a]'
                }`}
                title="Grid view"
              >
                <LayoutGrid size={13} />
              </button>
              <button
                onClick={() => setViewMode('portfolio')}
                className="p-1.5 rounded-full transition-colors text-[#6a5d4a] hover:text-[#a08a6a]"
                title="Portfolio view"
              >
                <Disc3 size={13} />
              </button>
            </div>
          </div>
        </div>

        {showFilters && (
          <FilterBar filters={filters} onChange={setFilters} />
        )}

        {/* Upload */}
        <div className="mb-8">
          <DropZone onUploadSuccess={fetchTracks} />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={18} className="animate-spin text-[#4a4338]" />
          </div>
        ) : fetchError ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-red-950/30 border border-red-900/40 flex items-center justify-center">
              <Music size={22} className="text-red-400" />
            </div>
            <p className="text-sm text-[#E8DCC8] mb-1">Couldn&apos;t load your library</p>
            <p className="text-[11px] text-red-400 max-w-md mx-auto mb-4">{fetchError}</p>
            <button
              onClick={fetchTracks}
              className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-md border border-[#1a160f] bg-[#14110d] text-[#E8DCC8] hover:border-[#2d2620]"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-[#14110d] border border-[#1a160f] flex items-center justify-center">
              <Music size={22} className="text-[#3a3328]" />
            </div>
            <p className="text-sm text-[#E8DCC8] mb-1">
              {tracks.length === 0 ? 'No tracks yet' : 'No matches'}
            </p>
            <p className="text-[11px] text-[#5a5142]">
              {tracks.length === 0
                ? 'Upload above to start building your Vault'
                : 'Try a different search or filter'}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="border-t border-[#161310] border-b mb-32">
            {sortMode === 'store_order' && (
              <div className="flex items-center gap-2 px-4 py-2 bg-[#0e0c09] border-b border-[#1a160f]">
                <Store size={10} className="text-[#D4BFA0]" />
                <span className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a]">
                  Store order — use ↑↓ to rearrange how beats appear on your public store
                </span>
              </div>
            )}
            {/* Column header — grid must match TrackCard's 9-col md template */}
            <div className="grid grid-cols-[32px_32px_1fr_90px_32px] sm:grid-cols-[32px_32px_1fr_90px_110px_110px_32px] md:grid-cols-[32px_32px_1fr_110px_130px_50px_120px_110px_32px] items-center gap-4 px-4 h-9 border-b border-[#161310] text-[9px] font-mono uppercase tracking-wider">
              <span className="text-center flex items-center justify-center text-[#3a3328]">
                {sortMode === 'store_order' ? (
                  <Store size={10} className="text-[#D4BFA0]" />
                ) : selectMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      const allSelected = filtered.every((t: any) => selectedIds.has(t.id));
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (allSelected) {
                          filtered.forEach((t: any) => next.delete(t.id));
                        } else {
                          filtered.forEach((t: any) => next.add(t.id));
                        }
                        return next;
                      });
                    }}
                    className={`w-4 h-4 rounded flex items-center justify-center transition-colors cursor-pointer border ${
                      filtered.length > 0 && filtered.every((t: any) => selectedIds.has(t.id))
                        ? 'bg-[#D4BFA0] border-[#E8D8B8]'
                        : 'border-[#2d2620] hover:border-[#4a4338]'
                    }`}
                  >
                    {filtered.length > 0 && filtered.every((t: any) => selectedIds.has(t.id)) && (
                      <span className="text-white text-[9px] leading-none">✓</span>
                    )}
                  </button>
                ) : (
                  '#'
                )}
              </span>
              <span />
              {/* Clickable sort headers */}
              {(
                [
                  { label: 'Title', sort: 'title' as SortMode, always: true },
                  { label: 'Type', sort: null, always: false, cls: 'hidden sm:block' },
                  { label: 'BPM · Key', sort: sortMode === 'bpm' ? 'bpm-desc' as SortMode : 'bpm' as SortMode, always: true, activeSort: sortMode === 'bpm' || sortMode === 'bpm-desc' },
                  { label: 'Len', sort: null, always: false, cls: 'hidden md:block' },
                  { label: 'Added', sort: 'recent' as SortMode, always: false, cls: 'hidden md:block' },
                  { label: '★', sort: 'rating' as SortMode, always: false, cls: 'hidden sm:block text-right' },
                ] as Array<{ label: string; sort: SortMode | null; always: boolean; cls?: string; activeSort?: boolean }>
              ).map(({ label, sort, cls, activeSort }) => {
                const isActive = activeSort ?? (sort != null && sortMode === sort);
                if (!sort) return <span key={label} className={`${cls ?? ''} text-[#3a3328]`}>{label}</span>;
                return (
                  <button
                    key={label}
                    onClick={() => setSortMode(sort)}
                    className={`flex items-center gap-1 transition-colors hover:text-[#E8DCC8] ${cls ?? ''} ${
                      isActive ? 'text-[#D4BFA0]' : 'text-[#3a3328]'
                    }`}
                  >
                    {label}
                    <span className="text-[8px]">
                      {isActive ? (sortMode === 'bpm-desc' ? '↓' : '↑') : ''}
                    </span>
                  </button>
                );
              })}
              <span />
            </div>
            {pageTracks.map((t: any, i: number) => {
              const absIdx = currentPage * PAGE_SIZE + i;
              return (
                <TrackCard
                  key={t.id}
                  track={t}
                  index={absIdx + 1}
                  onClickDetails={(track) => { setSelectedTrack(track); playTrack(track); }}
                  onPlayClick={() => playTrack(t)}
                  onDelete={(track) => handleDeleteTrack(track)}
                  onShare={(track) => setShareTarget(track)}
                  selectable={selectMode && sortMode !== 'store_order'}
                  selected={selectedIds.has(t.id)}
                  onSelectChange={(track, sel) => setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (sel) next.add(track.id); else next.delete(track.id);
                    return next;
                  })}
                  {...(sortMode === 'store_order' ? {
                    onMoveUp: () => moveTrack(absIdx, absIdx - 1),
                    onMoveDown: () => moveTrack(absIdx, absIdx + 1),
                    isFirstInOrder: absIdx === 0,
                    isLastInOrder: absIdx === filtered.length - 1,
                  } : {})}
                />
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-8">
            {pageTracks.map((t) => (
              <TrackGridCard
                key={t.id}
                track={t}
                onClickDetails={(track) => { setSelectedTrack(track); playTrack(track); }}
                onPlayClick={() => playTrack(t)}
                onDelete={(track) => handleDeleteTrack(track)}
                onShare={(track) => setShareTarget(track)}
                selectable={selectMode}
                selected={selectedIds.has(t.id)}
                onSelectChange={(track, sel) => setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (sel) next.add(track.id); else next.delete(track.id);
                  return next;
                })}
              />
            ))}
          </div>
        )}

        {/* ── Pagination controls (all view) ─────────────────────── */}
        {browseMode === 'all' && totalPages > 1 && (
          <div className="flex items-center justify-between py-4 mb-24 border-t border-[#1a160f]">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#1f1a13] bg-[#14110d] text-[11px] font-medium text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft size={13} /> Previous
            </button>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                // Show first, last, current ± 1, with ellipsis
                const page = totalPages <= 7 ? i : (i === 0 ? 0 : i === 6 ? totalPages - 1 : currentPage - 2 + i);
                if (page < 0 || page >= totalPages) return null;
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-7 h-7 rounded-full text-[11px] font-mono tabular-nums transition-colors ${
                      page === currentPage
                        ? 'bg-white text-black font-bold'
                        : 'text-[#6a5d4a] hover:text-[#E8DCC8] hover:bg-white/[0.06]'
                    }`}
                  >{page + 1}</button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#1f1a13] bg-[#14110d] text-[11px] font-medium text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        )}

        </>
        )}{/* end browseMode === 'all' */}
      </div>

      {selectedTrack && (
        <TrackDetailsDrawer
          track={selectedTrack}
          onClose={() => setSelectedTrack(null)}
          onUpdate={fetchTracks}
        />
      )}

      {shareTarget && (
        <ContentShareModal
          contentType="track"
          contentId={shareTarget.id}
          contentTitle={shareTarget.title}
          coverUrl={shareTarget.cover_url}
          onClose={() => setShareTarget(null)}
        />
      )}

      {/* Batch-delete bar — visible only in select mode with ≥1 chosen.
          Loops the existing DELETE /api/tracks/[id] (already gated by
          requireRowOwnership + cascades on project/playlist junctions).
          No bulk endpoint needed; parallel HTTP keeps wall time flat. */}
      <BatchActionBar
        count={selectedIds.size}
        noun={['track', 'tracks']}
        onClear={() => setSelectedIds(new Set())}
        busy={bulkDeleting}
        actions={[{
          label: 'Delete',
          icon: <DeleteIcon size={11} />,
          intent: 'danger',
          onClick: async () => {
            const ok = await confirmToast(
              `Delete ${selectedIds.size} track${selectedIds.size === 1 ? '' : 's'}?`,
              'Permanently removes the audio files, stems, and history. Cannot be undone.',
              { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
            );
            if (!ok) return;
            setBulkDeleting(true);
            const ids = Array.from(selectedIds);
            const results = await Promise.allSettled(
              ids.map((id) =>
                fetch(`/api/tracks/${id}`, { method: 'DELETE' }).then((r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                }),
              ),
            );
            const failed = results.filter((r) => r.status === 'rejected').length;
            setBulkDeleting(false);
            setSelectedIds(new Set());
            setSelectMode(false);
            await fetchTracks();
            if (failed === 0) {
              toast.success(`Deleted ${ids.length} track${ids.length === 1 ? '' : 's'}`);
            } else {
              toast.warning(`Deleted ${ids.length - failed}, ${failed} failed`);
            }
          },
        }]}
      />
    </DashboardLayout>
  );
}

// ── MiniTrackCard — compact card for the sections/browse row ─────
function MiniTrackCard({
  track,
  isCurrent,
  isPlaying,
  onPlay,
  onOpen,
}: {
  track: Track;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="group relative shrink-0 w-[130px] sm:w-[150px] cursor-pointer"
      onClick={onOpen}
    >
      {/* Cover art + overlays */}
      <div className={`relative w-full aspect-square rounded-xl overflow-hidden bg-[#14110d] border mb-2 transition-all ${isCurrent ? 'border-[#D4BFA0]/60 ring-1 ring-[#D4BFA0]/30' : 'border-[#1f1a13] group-hover:border-[#2d2620]'}`}>
        {track.cover_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1a160f] to-[#0a0907]"><Music size={24} className="text-[#3a3328]" /></div>}
        {/* State badge */}
        {track.status && track.status !== 'archived' && (
          <span className={`absolute top-1.5 left-1.5 text-[7px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
            track.status === 'maq'        ? 'bg-[#1a1033] text-[#b39ddb] border-[#534AB7]/40' :
            track.status === 'finished'   ? 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]'   :
            track.status === 'needs_work' ? 'bg-[#1f1a0a] text-[#c8a84b] border-[#3a2f1f]'   : ''
          }`}>
            {track.status === 'maq' ? 'MAQ' : track.status === 'finished' ? '✓' : 'WIP'}
          </span>
        )}
        {/* Play overlay */}
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          className={`absolute inset-0 flex items-center justify-center transition-all ${isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          aria-label="Play"
        >
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center">
            {isPlaying
              ? <div className="flex items-end gap-[2px] h-4">{[3,5,7,5,3].map((h,i)=><span key={i} className="w-[3px] rounded-sm bg-[#D4BFA0] animate-bounce" style={{height:h,animationDelay:`${i*80}ms`}}/>)}</div>
              : <Play size={14} fill="white" className="text-white ml-0.5" />}
          </div>
        </button>
      </div>
      {/* Meta */}
      <p className={`text-[11px] font-medium truncate leading-tight ${isCurrent ? 'text-[#D4BFA0]' : 'text-[#E8DCC8]'}`}>{track.title}</p>
      <p className="text-[9px] font-mono text-[#5a5142] mt-0.5 truncate">
        {[track.bpm && `${track.bpm}`, track.key && `${track.key}${track.scale === 'minor' ? 'm' : ''}`].filter(Boolean).join(' · ') || track.type || '—'}
      </p>
    </div>
  );
}
