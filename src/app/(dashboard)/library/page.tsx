'use client';

/**
 * /library = VAULT
 * Flat list of every track the user owns. The source of truth.
 */

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageContainer } from '@/components/layout/PageHeader';
import {
  Loader2, Music, Search, Sparkles, Shuffle, Disc3, LayoutList, LayoutGrid,
  SlidersHorizontal, Store, FolderOpen, ListMusic, BarChart2,
  ShoppingBag, ArrowRight,
  Upload, Rocket, ChevronLeft, ChevronRight, ChevronDown, X, Package, Tag,
} from 'lucide-react';
import { PlayGlyph } from '@/components/player/TransportIcons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_HOME_ROWS, type HomeRowConfig } from '@/lib/dashboard/home-config';
import { getCached, setCached } from '@/lib/client-cache';
import { usePlayer } from '@/hooks/usePlayer';
import { DropZone } from '@/components/upload/DropZone';
import { TrackCard, TRACK_ROW_GRID } from '@/components/tracks/TrackCard';
import { TrackDetailsDrawer } from '@/components/tracks/TrackDetailsDrawer';
import { Track, Playlist, Project } from '@/lib/types';
import { errorMessage } from '@/lib/errors';
import { toast, confirmToast } from '@/hooks/useToast';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { Dropdown } from '@/components/ui/Dropdown';
import { Drawer } from '@/components/ui/Drawer';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { listCached } from '@/lib/offline/audio-cache';
import { TrackGridCard } from '@/components/tracks/TrackGridCard';
import MusicPortfolio, { type PortfolioTrack } from '@/components/library/MusicPortfolio';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { BulkEditPanel } from '@/components/crm/BulkEditPanel';
import { FilterBar, LibraryFilters, DEFAULT_FILTERS, hasActiveFilters, activeFilterCount, serializeFilters, deserializeFilters } from '@/components/library/FilterBar';
import { SellReadinessPanel } from '@/components/library/SellReadinessPanel';
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

// The API's rich track select inlines `track_tags(tag, category)` as a join —
// extend Track locally rather than growing the shared type for one filtering
// concern (mirrors the same pattern already used in TrackCard.tsx).
type TrackTag = { tag: string; category?: string | null };
type TrackWithInlineTags = Track & { track_tags?: TrackTag[] };

// List APIs attach `track_count` at read time (junction-count join).
type HomePlaylist = Playlist & { track_count?: number };
type HomeProject = Project & { track_count?: number };

export default function LibraryPage() {
  // Proper Track typing rather than the previous `any[]` — catches column
  // renames at compile time and gives the drawer call sites real
  // intellisense on `track.bpm`, `track.energy`, etc.
  // Seeded from the session cache so returning to the library paints the last
  // known list instantly (no skeleton); the mount fetch then refreshes it.
  const [tracks, setTracks] = useState<Track[]>(() => getCached<Track[]>('library:tracks') ?? []);

  /**
   * Whether the producer has a fallback price on their profile.
   *
   * The store falls back to `creator_profiles.license_*_price_usd` when a track
   * has no override, so a track without its own price is only truly blocked
   * when there is no default either. Flagging every track regardless would be
   * noise, and noise is what makes a checklist get ignored.
   */
  const [hasDefaultPrice, setHasDefaultPrice] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        const p = j.profile ?? j;
        setHasDefaultPrice(
          (p?.license_lease_price_usd ?? null) != null
          || (p?.license_exclusive_price_usd ?? null) != null,
        );
      })
      // Assume a default exists on failure: a false "no price" on every track
      // is worse than staying quiet.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [loading, setLoading] = useState(() => !getCached('library:tracks'));
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  const [sortMode, setSortMode] = useState<SortMode>('recent');
  // Launches the DropZone's file picker from the hero "Upload beat" button —
  // the button used to just scroll to a drop panel at the bottom of the page.
  const uploadOpenRef = useRef<(() => void) | null>(null);
  // Batch-select state for delete. Same UX as the playlists page —
  // a "Select" toggle near the bulk-analyze button activates select
  // mode, then TrackCards expose checkboxes via the `selectable` prop.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkTagPanel, setBulkTagPanel] = useState<'addTags' | 'removeTags' | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [shareTarget, setShareTarget] = useState<Track | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'portfolio'>('list');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<LibraryFilters>(() => ({
    ...DEFAULT_FILTERS,
    genres: new Set<string>(),
    statuses: new Set<string>(),
    keys: new Set<string>(),
  }));

  // Re-read the cached-id list when the offline facet is switched on. The old
  // Offline pill refreshed on click; without this the filter could show a stale
  // set for anything cached since the page loaded.
  useEffect(() => {
    if (filters.offlineOnly) refreshOfflineList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.offlineOnly]);
  // ── Smart playlists — saved auto-updating filter views (mig 067) ──
  const [smartPlaylists, setSmartPlaylists] = useState<Array<{ id: string; name: string; filter: Record<string, unknown> }>>([]);
  const [activeSmartId, setActiveSmartId] = useState<string | null>(null);
  const fetchSmartPlaylists = useCallback(() => {
    fetch('/api/smart-playlists').then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.smart_playlists) setSmartPlaylists(d.smart_playlists); })
      .catch(() => undefined);
  }, []);
  useEffect(() => { fetchSmartPlaylists(); }, [fetchSmartPlaylists]);

  // Smart-playlist save uses a real modal (not window.prompt) for a name.
  const [smartNameOpen, setSmartNameOpen] = useState(false);
  const [smartNameDraft, setSmartNameDraft] = useState('');
  const [savingSmart, setSavingSmart] = useState(false);
  const saveSmartPlaylist = () => { setSmartNameDraft(''); setSmartNameOpen(true); };
  const confirmSaveSmartPlaylist = async () => {
    const name = smartNameDraft.trim();
    if (!name) return;
    setSavingSmart(true);
    try {
      const res = await fetch('/api/smart-playlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filter: serializeFilters(filters) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
      toast.success('Smart playlist saved', 'It updates automatically as new tracks match.');
      setSmartNameOpen(false);
      fetchSmartPlaylists();
    } catch (e) { toast.error('Could not save', errorMessage(e)); }
    finally { setSavingSmart(false); }
  };

  const applySmartPlaylist = (sp: { id: string; filter: Record<string, unknown> }) => {
    // Smart playlists saved before type moved into the filter model carry it
    // as a sibling `typeFilter` key; fold that in so they still apply correctly.
    const legacyType = sp.filter?.typeFilter;
    const restored = deserializeFilters(sp.filter);
    setFilters(
      legacyType === 'beat' || legacyType === 'instrumental' || legacyType === 'song'
        || legacyType === 'remix' || legacyType === 'all'
        ? { ...restored, type: legacyType }
        : restored,
    );
    setActiveSmartId(sp.id);
    setShowFilters(true);
    setBrowseMode('all');
  };

  const deleteSmartPlaylist = async (id: string) => {
    setSmartPlaylists((prev) => prev.filter((s) => s.id !== id));
    if (activeSmartId === id) setActiveSmartId(null);
    await fetch(`/api/smart-playlists/${id}`, { method: 'DELETE' }).catch(() => undefined);
  };
  useEffect(() => {
    const saved = localStorage.getItem('library-view') as 'list' | 'grid' | 'portfolio' | null;
    // 'vision' is no longer a view; anyone whose saved preference still
    // names it falls back to the track list rather than a blank surface.
    if (saved === 'list' || saved === 'grid' || saved === 'portfolio') setViewMode(saved);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const sync = () => {
      const mobile = media.matches;
      setIsMobileViewport(mobile);
      if (mobile) {
        setViewMode('list');
        setBrowseMode('all');
      }
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (!isMobileViewport) localStorage.setItem('library-view', viewMode);
  }, [isMobileViewport, viewMode]);
  const { setTrack, setQueue, currentTrack, isPlaying, history } = usePlayer();
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
    } catch (err) {
      toast.error('Could not create', errorMessage(err));
    } finally {
      setCreatingRelease(false);
    }
  };

  // ── Beat-pack builder ───────────────────────────────────────────
  // Bundle the selected beats into a project, priced at a ~20% discount off
  // the summed lease prices, and list it as a store bundle (reuses the whole
  // project-bundle checkout + delivery flow).
  const [packing, setPacking] = useState(false);
  const [packModalOpen, setPackModalOpen] = useState(false);

  // Opens the builder modal (real UI with live discount math) instead of
  // a chain of window.prompts.
  const createPackFromSelected = () => {
    if (selectedIds.size < 2) { toast.error('Pick at least 2 beats', 'A pack needs 2+ beats.'); return; }
    setPackModalOpen(true);
  };

  const submitPack = async (name: string, price: number, coverUrl: string | null) => {
    const ids = Array.from(selectedIds);
    setPacking(true);
    try {
      const projRes = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const projData = await projRes.json();
      if (!projRes.ok) throw new Error(projData.error || 'Project create failed');
      const projectId = projData.project.id;

      const addRes = await fetch(`/api/projects/${projectId}/tracks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: ids }),
      });
      if (!addRes.ok) throw new Error((await addRes.json().catch(() => ({}))).error || 'Adding beats failed');

      const patchRes = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_usd: price,
          store_featured: true,
          description: `${ids.length}-beat pack`,
          ...(coverUrl ? { cover_url: coverUrl } : {}),
        }),
      });
      if (!patchRes.ok) throw new Error((await patchRes.json().catch(() => ({}))).error || 'Pricing failed');

      toast.success('Pack created & listed', `${ids.length} beats · $${price} bundle`);
      setPackModalOpen(false);
      setSelectedIds(new Set());
      setSelectMode(false);
      router.push(`/projects/${projectId}`);
    } catch (err) {
      toast.error('Could not create pack', errorMessage(err));
    } finally {
      setPacking(false);
    }
  };

  const TRACK_PAGE_SIZE = 100;
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [nextTrackCursor, setNextTrackCursor] = useState<string | null>(null);
  const [loadingMoreTracks, setLoadingMoreTracks] = useState(false);

  const fetchTracks = async ({ cursor = null, append = false }: { cursor?: string | null; append?: boolean } = {}) => {
    if (append) setLoadingMoreTracks(true);
    // Only gate the UI behind the skeleton when there's nothing painted yet —
    // with a cached list on screen this is a silent background refresh.
    else if (!getCached('library:tracks')) setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({
        paged: '1',
        lean: '1',
        limit: String(TRACK_PAGE_SIZE),
      });
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/tracks?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Failed to load tracks (${res.status})`);
      }
      const page = Array.isArray(data) ? data : data.tracks ?? [];
      setTracks((prev) => {
        let next: Track[];
        if (!append) {
          next = page;
        } else {
          const seen = new Set(prev.map((track) => track.id));
          const incoming = page.filter((track: Track) => !seen.has(track.id));
          next = [...prev, ...incoming];
        }
        setCached('library:tracks', next);
        return next;
      });
      setHasMoreTracks(Boolean(data.pageInfo?.hasMore));
      setNextTrackCursor(data.pageInfo?.nextCursor ?? null);
    } catch (err) {
      console.error('Error fetching tracks:', err);
      setFetchError(errorMessage(err) || 'Failed to load tracks');
      // Keep any cached list on screen (stale-while-revalidate) — only blank
      // the view when we never had data to show.
      if (!append && !getCached('library:tracks')) setTracks([]);
    } finally {
      if (append) setLoadingMoreTracks(false);
      else setLoading(false);
    }
  };

  const loadMoreTracks = () => {
    if (!hasMoreTracks || !nextTrackCursor || loadingMoreTracks) return;
    void fetchTracks({ cursor: nextTrackCursor, append: true });
  };

  useEffect(() => { fetchTracks(); }, []);

  // Light analytics summary for the dashboard — plays, sales, gross.
  const [analyticsStats, setAnalyticsStats] = useState<{ plays: number; sales_count: number; gross_usd: number } | null>(null);
  // Per-track play counts for "most played" sort in config rows
  const [playsByTrack, setPlaysByTrack] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('/api/analytics')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.totals) setAnalyticsStats(d.totals);
        if (d?.by_track) {
          const map: Record<string, number> = {};
          for (const row of d.by_track) map[row.track_id] = row.plays;
          setPlaysByTrack(map);
        }
      })
      .catch(() => undefined);
  }, []);

  // Playlists + projects for the home grid. `track_count` is attached by both
  // list APIs at read time (junction-count join), so extend the base types here.
  const [playlists, setPlaylists] = useState<HomePlaylist[]>([]);
  const [projects, setProjects] = useState<HomeProject[]>([]);
  useEffect(() => {
    fetch('/api/playlists').then(r => r.ok ? r.json() : null).then(d => { if (d?.playlists) setPlaylists(d.playlists); }).catch(() => undefined);
    fetch('/api/projects').then(r => r.ok ? r.json() : null).then(d => { if (d?.projects) setProjects(d.projects); }).catch(() => undefined);
  }, []);

  // ── Home filter chips (genre, state, type) ───────────────────────
  // These are the lightweight filters shown on the Home page itself.
  // They narrow ALL config rows at once without touching the full FilterBar.
  const [homeGenre, setHomeGenre] = useState<string | null>(null);
  const [homeStatus, setHomeStatus] = useState<string | null>(null);
  const [homeType, setHomeType] = useState<string | null>(null);
  const hasHomeFilters = homeGenre != null || homeStatus != null || homeType != null;
  const clearHomeFilters = () => { setHomeGenre(null); setHomeStatus(null); setHomeType(null); };

  // Auto-refresh on track inserts/updates/deletes. Replaces the previous
  // "refresh only on user action" behavior — uploads from elsewhere or
  // analyze jobs landing now surface immediately in the library.
  const refreshTracks = useDebouncedCallback(fetchTracks, 500);
  useRealtimeTable({ table: 'tracks', onChange: refreshTracks });

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
      if (filters.offlineOnly && !cachedIds.has(t.id)) return false;
      if (filters.type !== 'all' && t.type !== filters.type) return false;
      if (filters.bpmMin != null && (t.bpm == null || t.bpm < filters.bpmMin)) return false;
      if (filters.bpmMax != null && (t.bpm == null || t.bpm > filters.bpmMax)) return false;
      if (filters.keys.size > 0 && (!t.key || !filters.keys.has(t.key))) return false;
      if (filters.scale === 'major' && t.scale === 'minor') return false;
      if (filters.scale === 'minor' && t.scale !== 'minor') return false;
      if (filters.statuses.size > 0 && (!t.status || !filters.statuses.has(t.status))) return false;
      if (filters.rating != null && (t.rating == null || t.rating < filters.rating)) return false;
      // Genre filter — track_tags come down from the API rich select
      if (filters.genres.size > 0) {
        const trackGenres: string[] = ((t as TrackWithInlineTags).track_tags ?? [])
          .filter((tt) => tt.category === 'genre')
          .map((tt) => tt.tag);
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
          const ao = a.store_sort_order;
          const bo = b.store_sort_order;
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
  }, [tracks, search, cachedIds, sortMode, filters]);

  const currentHeroTrack = currentTrack || filtered[0] || null;
  const heroCoverUrl = currentHeroTrack?.cover_url || null;

  // ── Browse mode: 'sections' (homepage-style) or 'all' (paginated list) ──
  const [browseMode, setBrowseMode] = useState<'sections' | 'all'>('sections');
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 50;

  // Reset page when filters change
  useEffect(() => { setCurrentPage(0); }, [search, sortMode, filters]);

  // Paginated slice for 'all' view
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageTracks = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // ── Config-driven sections ────────────────────────────────────────
  // Derives rendered rows from DEFAULT_HOME_ROWS, applying home filter
  // chips and the analytics play counts for sort=plays.
  const homeRows = useMemo(() => {
    const getGenres = (t: Track): string[] =>
      ((t as TrackWithInlineTags).track_tags ?? []).filter((tt) => tt.category === 'genre').map((tt) => tt.tag);

    const applyTrackFilter = (cfg: HomeRowConfig): Track[] => {
      const f = cfg.filter ?? {};
      let pool = tracks.filter((t) => {
        // Row-level filters
        if (f.genres?.length && !f.genres.some(g => getGenres(t).includes(g))) return false;
        if (f.statuses?.length && (!t.status || !f.statuses.includes(t.status))) return false;
        if (f.types?.length && !f.types.includes(t.type)) return false;
        if (f.storeListed && !t.store_listed) return false;
        if (f.notStoreListed && t.store_listed) return false;
        if (f.minRating != null && (t.rating ?? 0) < f.minRating) return false;
        // Home filter chips (additive on top of row filter)
        if (homeGenre && !getGenres(t).includes(homeGenre)) return false;
        if (homeStatus && t.status !== homeStatus) return false;
        if (homeType && t.type !== homeType) return false;
        return true;
      });
      // Sort
      switch (cfg.sortBy) {
        case 'plays':    pool = [...pool].sort((a, b) => (playsByTrack[b.id] ?? 0) - (playsByTrack[a.id] ?? 0)); break;
        case 'rating':   pool = [...pool].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)); break;
        case 'alphabetical': pool = [...pool].sort((a, b) => a.title.localeCompare(b.title)); break;
        default: pool = [...pool].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      }
      return pool.slice(0, cfg.maxItems ?? 10);
    };

    return DEFAULT_HOME_ROWS
      .map((cfg) => {
        if (cfg.source === 'recent') {
          // "Recently played" comes from player history (Zustand persist)
          return { cfg, tracks: [] as Track[], playlists: [] as HomePlaylist[], projects: [] as HomeProject[], isRecent: true };
        }
        if (cfg.source === 'playlists') {
          const pl = [...playlists].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, cfg.maxItems ?? 8);
          return { cfg, tracks: [] as Track[], playlists: pl, projects: [] as HomeProject[], isRecent: false };
        }
        if (cfg.source === 'projects') {
          const pr = [...projects].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, cfg.maxItems ?? 8);
          return { cfg, tracks: [] as Track[], playlists: [] as HomePlaylist[], projects: pr, isRecent: false };
        }
        // tracks
        const rowTracks = applyTrackFilter(cfg);
        return { cfg, tracks: rowTracks, playlists: [] as HomePlaylist[], projects: [] as HomeProject[], isRecent: false };
      })
      .filter((row) => {
        if (row.isRecent) return true; // always show, content is from player state
        if (row.cfg.source === 'tracks' && row.tracks.length === 0 && row.cfg.hideWhenEmpty) return false;
        if (row.cfg.source === 'playlists' && row.playlists.length === 0) return false;
        if (row.cfg.source === 'projects' && row.projects.length === 0) return false;
        return true;
      });
  }, [tracks, playlists, projects, playsByTrack, homeGenre, homeStatus, homeType]);

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

  const listedTracks = useMemo(() => tracks.filter((t) => t.store_listed), [tracks]);

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
      store_sort_order: t.store_sort_order ?? i,
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

  const playTrack = (track: Track) => {
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
  // Tracks that still need a protected MP3 preview generated. Re-analyzing a
  // track is the preview-backfill path (it reads the master from R2, makes a
  // small mp3 clip, and sets preview_status='ready'). Without this, mp3/wav
  // masters with no preview keep serving the full ~80MB WAV on share/store,
  // which is unplayably slow on mobile. We target preview-missing masters
  // directly rather than audio-feature gaps so the button surfaces the work
  // that actually matters for playback.
  const stale = useMemo(
    () =>
      tracks.filter(
        (t) =>
          !!t.audio_url &&
          /\.(mp3|wav)(?:\?|$)/i.test(t.audio_url) &&
          t.preview_status !== 'ready',
      ),
    [tracks],
  );

  const [bulkAnalyzing, setBulkAnalyzing] = useState<{ done: number; total: number } | null>(null);

  // Auto-tagging exists to feed the discovery engine: landing pages are
  // generated from genre/mood tags, so an untagged catalogue produces no entry
  // points and the store stays invisible to search. The toast reports pages
  // gained rather than tags written, because that is the thing worth knowing.
  const [autoTagPlan, setAutoTagPlan] = useState<{ totalTags: number; tracksAffected: number } | null>(null);
  const [autoTagging, setAutoTagging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tracks/auto-tag')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.totalTags) setAutoTagPlan(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tracks.length]);

  const runAutoTag = async () => {
    setAutoTagging(true);
    try {
      const res = await fetch('/api/tracks/auto-tag', { method: 'POST' });
      const j = await res.json();
      if (!res.ok) {
        toast.error('Auto-tag failed', j?.error ?? 'Please try again.');
        return;
      }
      toast.success(
        `Tagged ${j.tracksAffected} beats`,
        j.newDiscoveryPages > 0
          ? `${j.newDiscoveryPages} new discovery page${j.newDiscoveryPages === 1 ? '' : 's'} — ${j.totalDiscoveryPages} total.`
          : `${j.applied} tags added.`,
      );
      setAutoTagPlan(null);
      fetchTracks();
    } catch (e) {
      toast.error('Auto-tag failed', errorMessage(e));
    } finally {
      setAutoTagging(false);
    }
  };

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
    } catch (err) {
      toast.error('Delete failed', errorMessage(err));
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
      scale: track.scale,
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
  const effectiveViewMode = isMobileViewport ? 'list' : viewMode;
  const effectiveBrowseMode = isMobileViewport ? 'all' : browseMode;

  if (effectiveViewMode === 'portfolio') {
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
      <PageContainer className="md:pt-10">
        {/* Hero — gradient panel with the library "cover" tile, title,
            stats, and the two primary actions (Play / Shuffle). Builds on
            the same gradient + glass language as the project detail
            cover, only flatter and wider. Filter chips and the secondary
            toolbar sit underneath, outside the hero, so the hero only
            owns identity + primary intent. */}
        {/* ── Hero — Spotify-style: large cover + blurred backdrop ── */}
        <div className="relative mb-5 rounded-[28px] overflow-hidden border border-white/[0.06] transition-all duration-700" style={{ minHeight: 160 }}>
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
            <div className={`w-[100px] h-[100px] sm:w-[132px] sm:h-[132px] rounded-2xl overflow-hidden shrink-0 border border-white/[0.08] bg-white/[0.04] transition-all duration-500 ${isPlaying ? 'ring-2 ring-white/20' : ''}`}>
              {heroCoverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={heroCoverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white/20 to-[#1a1a3a]/30">
                  <Disc3 size={36} className={`text-white/30 ${isPlaying ? 'animate-[spin_6s_linear_infinite]' : ''}`} strokeWidth={0.75} />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 pb-1">
              <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/50 mb-1.5">
                {currentTrack ? 'Now playing' : 'Your workspace'}
              </p>
              <h1 className="text-[24px] sm:text-[36px] md:text-[46px] font-bold tracking-tight text-white leading-none font-heading mb-2">
                {currentTrack?.title ?? 'Home'}
              </h1>
              <p className="text-[11px] font-mono text-white/50 mb-4">
                {currentTrack
                  ? [currentTrack.bpm && `${currentTrack.bpm} BPM`, currentTrack.key && `${currentTrack.key}${currentTrack.scale === 'minor' ? 'm' : ''}`].filter(Boolean).join(' · ')
                  : `${tracks.length} track${tracks.length !== 1 ? 's' : ''}${totalDurationLabel ? ` · ${totalDurationLabel}` : ''}`}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <LiquidGlassButton onClick={playAll} disabled={!filtered.length}>
                  <PlayGlyph size={12} className="mr-1.5" /> Play all
                </LiquidGlassButton>
                <LiquidGlassButton onClick={shuffleAll} disabled={!filtered.length}>
                  <Shuffle size={12} className="mr-1.5" /> Shuffle
                </LiquidGlassButton>
                {stale.length > 0 && (
                  <LiquidGlassButton onClick={runBulkAnalyze} disabled={!!bulkAnalyzing}>
                    {bulkAnalyzing ? <><Loader2 size={12} className="animate-spin mr-1.5" /><span>{bulkAnalyzing.done}/{bulkAnalyzing.total}</span></> : <><Sparkles size={12} className="mr-1.5" /><span>Analyze {stale.length}</span></>}
                  </LiquidGlassButton>
                )}
                {autoTagPlan && autoTagPlan.tracksAffected > 0 && (
                  <LiquidGlassButton onClick={runAutoTag} disabled={autoTagging}>
                    {autoTagging
                      ? <><Loader2 size={12} className="animate-spin mr-1.5" /><span>Tagging…</span></>
                      : <><Tag size={12} className="mr-1.5" /><span>Auto-tag {autoTagPlan.tracksAffected}</span></>}
                  </LiquidGlassButton>
                )}
                <LiquidGlassButton onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }} active={selectMode} className="ml-auto">
                  {selectMode ? 'Done' : 'Select'}
                </LiquidGlassButton>
              </div>
            </div>
          </div>
        </div>

        {/* ── Quick actions ──────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <LiquidGlassButton onClick={() => { if (uploadOpenRef.current) uploadOpenRef.current(); else window.scrollTo({ top: 9999, behavior: 'smooth' }); }}>
            <Upload size={13} /> Upload beat
          </LiquidGlassButton>

          {/* New Release — split button with dropdown */}
          <div className="relative">
            <div className="flex items-center overflow-hidden rounded-full bg-white/[0.06] border border-white/[0.10] backdrop-blur-md hover:bg-white/[0.12] hover:border-white/[0.18] text-white transition-colors">
              <button
                onClick={() => handleNewRelease('both')}
                disabled={creatingRelease}
                className="flex items-center gap-1.5 pl-3.5 pr-2.5 py-2 text-[11px] font-semibold transition-colors disabled:opacity-60"
              >
                {creatingRelease ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
                New release
              </button>
              <div className="h-4 w-px bg-white/[0.12]" />
              <button
                onClick={() => setReleaseDropdownOpen((v) => !v)}
                className="px-2 py-2 transition-colors hover:bg-white/[0.08]"
                aria-label="Release options"
              >
                <ChevronDown size={12} />
              </button>
            </div>
            {releaseDropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setReleaseDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-1.5 z-40 w-48 bg-white/[0.04] border border-white/10 rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                  {[
                    { mode: 'both' as const, label: 'Project + Playlist', sub: 'Full release flow' },
                    { mode: 'project' as const, label: 'Project only', sub: 'Production session' },
                    { mode: 'playlist' as const, label: 'Playlist only', sub: 'Curated set' },
                  ].map(({ mode, label, sub }) => (
                    <button
                      key={mode}
                      onClick={() => handleNewRelease(mode)}
                      className="w-full flex flex-col items-start px-4 py-3 text-left hover:bg-white/[0.05] transition-colors border-b border-white/10 last:border-0"
                    >
                      <span className="text-[11px] font-medium text-white">{label}</span>
                      <span className="text-[9px] font-mono text-white/50 mt-0.5">{sub}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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
                accent: '#FFFFFF',
                cover: listedTracks.find((t) => t.cover_url)?.cover_url ?? null,
              },
              {
                href: '/projects',
                label: 'Projects',
                sub: 'Sessions',
                icon: <FolderOpen size={15} />,
                accent: '#FFFFFF',
                cover: tracks.filter((t) => t.cover_url)[1]?.cover_url ?? null,
              },
              {
                href: '/sales',
                label: 'Sales',
                sub: analyticsStats ? `$${analyticsStats.gross_usd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : 'Revenue',
                icon: <ShoppingBag size={15} />,
                accent: '#FFFFFF',
                cover: tracks.filter((t) => t.cover_url)[2]?.cover_url ?? null,
              },
              {
                href: '/analytics',
                label: 'Analytics',
                sub: analyticsStats ? `${analyticsStats.plays} plays` : 'Engagement',
                icon: <BarChart2 size={15} />,
                accent: '#FFFFFF',
                cover: tracks.filter((t) => t.cover_url)[3]?.cover_url ?? null,
              },
            ] as const).map(({ href, label, sub, icon, accent, cover }) => (
              <Link key={href} href={href} className="group relative flex items-center gap-0 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-[#1e1a14] overflow-hidden transition-all hover:border-white/20">
                {/* Square cover — left quarter of the card */}
                <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 flex items-center justify-center overflow-hidden" style={{ backgroundColor: `${accent}18` }}>
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cover} alt="" className="w-full h-full object-cover" />
                    : <span style={{ color: accent }}>{icon}</span>}
                </div>
                <div className="flex-1 min-w-0 px-3 py-3.5">
                  <p className="text-[11px] font-bold text-white truncate leading-tight">{label}</p>
                  <p className="text-[9px] font-mono text-white/50 mt-0.5 truncate">{sub}</p>
                </div>
                {/* Hover play dot */}
                <div className="absolute right-2.5 bottom-2.5 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100" style={{ backgroundColor: accent }}>
                  <PlayGlyph size={11} className="text-black ml-0.5" />
                </div>
              </Link>
            ))}
          </div>

          {/* "Beats need attention" now lives in the notifications center
              (TopBar), alongside everything else demanding the producer's
              attention, rather than competing for space on the homepage. */}
        </div>

        {/* ── Library section header + browse toggle ─────────────── */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Music size={13} className="text-white/60" />
            <h2 className="text-[16px] font-bold text-white">Library</h2>
            <span className="text-[9px] font-mono text-white/40 tabular-nums">· {tracks.length}</span>
          </div>
          {/* Browse mode toggle */}
          <div className="hidden sm:flex items-center bg-white/[0.04] border border-white/[0.06] rounded-full p-0.5">
            <button
              onClick={() => setBrowseMode('sections')}
              className={`px-3 py-1 rounded-full text-[10px] font-medium transition-colors ${effectiveBrowseMode === 'sections' ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
            >Browse</button>
            <button
              onClick={() => setBrowseMode('all')}
              className={`px-3 py-1 rounded-full text-[10px] font-medium transition-colors ${effectiveBrowseMode === 'all' ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
            >All tracks</button>
          </div>
        </div>

        {/* ── Sections view (Browse mode) ────────────────────────── */}
        {effectiveBrowseMode === 'sections' && !loading && (
          <div className="mb-6 space-y-1">
            {/* ── Home filter chips ────────────────────────────────── */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap sm:flex-wrap overflow-x-auto scrollbar-hide mb-4 pb-2">
              <span className="hidden sm:inline text-[9px] font-mono uppercase tracking-wider text-white/40 shrink-0">Filter rows:</span>
              {/* Genre chips */}
              {['Drill','Trap','R&B','Afrobeats','Amapiano','Hip-hop','Lo-fi'].map((g) => (
                <button key={g} onClick={() => setHomeGenre(homeGenre === g ? null : g)}
                  className={`shrink-0 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-medium border transition-all ${
                    homeGenre === g ? 'bg-white text-black border-white' : 'border-white/10 text-white/60 hover:text-white hover:border-white/20'
                  }`}>{g}</button>
              ))}
              <div className="w-px h-4 bg-white/20 mx-1 shrink-0" />
              {/* State chips */}
              {[
                { v: 'maq', l: 'MAQ', cls: 'bg-[#1f1a10] text-[#c8a47a] border-[#3d3020]/40' },
                { v: 'needs_work', l: 'WIP', cls: 'bg-[#1f1a0a] text-white border-[#3a2f1f]' },
                { v: 'finished', l: 'Finished', cls: 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]' },
              ].map(({ v, l, cls }) => (
                <button key={v} onClick={() => setHomeStatus(homeStatus === v ? null : v)}
                  className={`shrink-0 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-medium border transition-all ${homeStatus === v ? cls : 'border-white/10 text-white/60 hover:text-white hover:border-white/20'}`}
                >{l}</button>
              ))}
              <div className="w-px h-4 bg-white/20 mx-1 shrink-0" />
              {/* Type chips */}
              {[{ v: 'beat', l: 'Beats' }, { v: 'instrumental', l: 'Instr.' }].map(({ v, l }) => (
                <button key={v} onClick={() => setHomeType(homeType === v ? null : v)}
                  className={`shrink-0 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-medium border transition-all ${
                    homeType === v ? 'bg-white text-black border-white' : 'border-white/10 text-white/60 hover:text-white hover:border-white/20'
                  }`}>{l}</button>
              ))}
              {hasHomeFilters && (
                <button onClick={clearHomeFilters} className="flex items-center gap-1 text-[9px] font-mono text-white/50 hover:text-white transition-colors sm:ml-auto shrink-0">
                  <X size={10} />Clear
                </button>
              )}
            </div>

            {/* ── Config-driven rows ───────────────────────────────── */}
            <div className="space-y-6">
              {homeRows.map((row) => (
                <HomeRow
                  key={row.cfg.id}
                  cfg={row.cfg}
                  tracks={row.tracks}
                  playlists={row.playlists}
                  projects={row.projects}
                  recentHistory={row.isRecent ? history : undefined}
                  currentTrackId={currentTrack?.id ?? null}
                  isPlaying={isPlaying}
                  onPlayTrack={(t) => { setTrack(t); setQueue(row.tracks); }}
                  onOpenTrack={(t) => setSelectedTrack(t)}
                  onSeeAll={() => setBrowseMode('all')}
                />
              ))}
            </div>

            {/* Upload — no permanent drop panel here; the hero "Upload beat"
                button opens the picker, and this hidden zone appears only
                while files are analysing/uploading so progress stays visible. */}
            <div className="pt-4">
              <DropZone onUploadSuccess={fetchTracks} openRef={uploadOpenRef} variant="hidden" />
            </div>
          </div>
        )}

        {/* Filter chips — Beat and Instrumental are mutually exclusive
            single-type filters. "All" resets. Only shown in 'all' list view. */}
        {effectiveBrowseMode === 'all' && (
          <>

        {/* Secondary toolbar — search on the left, sort dropdown on the
            right. Lives below the chips so the hero + chip strip read
            as the identity row, and the toolbar is the actual control. */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6">
          <div className="relative flex-1 min-w-[160px] sm:max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              placeholder="Search tracks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-full pl-8 pr-3 py-2 text-[11px] text-white placeholder-white/40 focus:outline-none focus:border-white/[0.12] transition-colors"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-medium transition-colors ${
                showFilters || hasActiveFilters(filters)
                  ? 'bg-white/15 border border-white/40 text-white'
                  : 'bg-white/[0.04] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <SlidersHorizontal size={11} />
              Filters
              {hasActiveFilters(filters) && (
                <span className="w-4 h-4 rounded-full bg-white text-black text-[9px] font-bold flex items-center justify-center leading-none">
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
            <div className="hidden sm:flex items-center bg-white/[0.04] border border-white/[0.06] rounded-full p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-full transition-colors ${
                  effectiveViewMode === 'list' ? 'bg-white text-black' : 'text-white/60 hover:text-white/80'
                }`}
                title="List view"
              >
                <LayoutList size={13} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-full transition-colors ${
                  effectiveViewMode === 'grid' ? 'bg-white text-black' : 'text-white/60 hover:text-white/80'
                }`}
                title="Grid view"
              >
                <LayoutGrid size={13} />
              </button>
              <button
                onClick={() => setViewMode('portfolio')}
                className="p-1.5 rounded-full transition-colors text-white/60 hover:text-white/80"
                title="Portfolio view"
              >
                <Disc3 size={13} />
              </button>
            </div>
          </div>
        </div>

        {showFilters && !isMobileViewport && (
          <FilterBar filters={filters} onChange={setFilters} />
        )}
        <Drawer
          open={showFilters && isMobileViewport}
          onClose={() => setShowFilters(false)}
          side="bottom"
          title="Library filters"
          description={`${filtered.length} track${filtered.length === 1 ? '' : 's'} shown`}
          contentClassName="pb-8"
        >
          <FilterBar filters={filters} onChange={setFilters} embedded />
        </Drawer>

        {/* ── Smart playlists — saved auto-updating filter views ──── */}
        {(smartPlaylists.length > 0 || hasActiveFilters(filters)) && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/40 shrink-0">Smart playlists:</span>
            {smartPlaylists.map((sp) => (
              <span key={sp.id} className={`group inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-[10px] font-medium border transition-all ${
                activeSmartId === sp.id ? 'bg-white text-black border-white' : 'border-white/10 text-white/60 hover:text-white hover:border-white/20'
              }`}>
                <button onClick={() => applySmartPlaylist(sp)} className="flex items-center gap-1.5">
                  <Sparkles size={9} />{sp.name}
                </button>
                <button onClick={() => deleteSmartPlaylist(sp.id)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity ml-0.5" title="Delete smart playlist">
                  <X size={9} />
                </button>
              </span>
            ))}
            {hasActiveFilters(filters) && (
              <button onClick={saveSmartPlaylist} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border border-dashed border-white/20 text-white/60 hover:text-white hover:border-white/30 transition-all">
                <Sparkles size={9} />Save current filter
              </button>
            )}
          </div>
        )}

        {/* Upload */}
        <div className="mb-8">
          <DropZone onUploadSuccess={fetchTracks} openRef={uploadOpenRef} />
        </div>

        {/* Sits immediately after upload, which is the moment a producer would
            otherwise assume the job is done. Upload previously ended in silence:
            the beat landed untagged, unpriced and unlisted with nothing saying
            so, and the store editor's own "needs attention" panel only inspects
            beats that are ALREADY listed — so these were invisible everywhere. */}
        <SellReadinessPanel tracks={tracks} hasDefaultPrice={hasDefaultPrice} />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={18} className="animate-spin text-white/40" />
          </div>
        ) : fetchError ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-red-950/30 border border-red-900/40 flex items-center justify-center">
              <Music size={22} className="text-red-400" />
            </div>
            <p className="text-sm text-white mb-1">Couldn&apos;t load your library</p>
            <p className="text-[11px] text-red-400 max-w-md mx-auto mb-4">{fetchError}</p>
            <button
              onClick={() => fetchTracks()}
              className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.04] text-white hover:border-white/20"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center">
              <Music size={22} className="text-white/40" />
            </div>
            <p className="text-sm text-white mb-1">
              {tracks.length === 0 ? 'No tracks yet' : 'No matches'}
            </p>
            <p className="text-[11px] text-white/50">
              {tracks.length === 0
                ? 'Upload above to start building your Vault'
                : 'Try a different search or filter'}
            </p>
          </div>
        ) : effectiveViewMode === 'list' ? (
          <div className="mb-32 space-y-1.5">
            {sortMode === 'store_order' && (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#0e0c09] px-4 py-2">
                <Store size={10} className="text-white" />
                <span className="text-[9px] font-mono uppercase tracking-wider text-white/60">
                  Store order — use ↑↓ to rearrange how beats appear on your public store
                </span>
              </div>
            )}
            {/* Header mirrors the Store list product row rather than the
                old table grid: cover/play, title/meta, vibe, time,
                rating/offline, actions. */}
            <div className={`hidden md:grid ${TRACK_ROW_GRID} items-center gap-4 border border-transparent px-3 h-8 text-[9px] font-mono uppercase tracking-wider`}>
              <span className="text-center flex items-center justify-center text-white/30">
                {sortMode === 'store_order' ? (
                  <Store size={10} className="text-white" />
                ) : selectMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      const allSelected = filtered.every((t) => selectedIds.has(t.id));
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (allSelected) {
                          filtered.forEach((t) => next.delete(t.id));
                        } else {
                          filtered.forEach((t) => next.add(t.id));
                        }
                        return next;
                      });
                    }}
                    className={`w-4 h-4 rounded flex items-center justify-center transition-colors cursor-pointer border ${
                      filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id))
                        ? 'bg-white border-white text-black'
                        : 'border-white/20 hover:border-white/30'
                    }`}
                  >
                    {filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id)) && (
                      <span className="text-white text-[9px] leading-none">✓</span>
                    )}
                  </button>
                ) : (
                  ''
                )}
              </span>
              {/* Clickable sort headers */}
              {(
                [
                  { label: 'Title', sort: 'title' as SortMode, always: true },
                  { label: 'Tags · Store', sort: null, always: false, cls: 'hidden md:block' },
                  { label: 'Time', sort: 'recent' as SortMode, always: false, cls: 'hidden md:flex justify-end' },
                  { label: 'Rating', sort: 'rating' as SortMode, always: false, cls: 'hidden md:flex justify-end', activeSort: sortMode === 'rating' },
                ] as Array<{ label: string; sort: SortMode | null; always: boolean; cls?: string; activeSort?: boolean }>
              ).map(({ label, sort, cls, activeSort }) => {
                const isActive = activeSort ?? (sort != null && sortMode === sort);
                if (!sort) return <span key={label} className={`${cls ?? ''} text-white/40`}>{label}</span>;
                return (
                  <button
                    key={label}
                    onClick={() => setSortMode(sort)}
                    className={`flex items-center gap-1 transition-colors hover:text-white ${cls ?? ''} ${
                      isActive ? 'text-white' : 'text-white/40'
                    }`}
                  >
                    {label}
                    <span className="text-[9px]">
                      {isActive ? (sortMode === 'bpm-desc' ? '↓' : '↑') : ''}
                    </span>
                  </button>
                );
              })}
              <span />
            </div>
            {pageTracks.map((t, i) => {
              const absIdx = currentPage * PAGE_SIZE + i;
              return (
                <TrackCard
                  key={t.id}
                  track={t}
                  index={absIdx + 1}
                  onClickDetails={(track) => setSelectedTrack(track)}
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
                onClickDetails={(track) => setSelectedTrack(track)}
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
        {effectiveBrowseMode === 'all' && totalPages > 1 && (
          <div className="flex items-center justify-between py-4 mb-24">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-medium text-white/60 hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
                        : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >{page + 1}</button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-medium text-white/60 hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        )}

        {effectiveBrowseMode === 'all' && hasMoreTracks && (
          <div className="flex justify-center pb-28">
            <button
              type="button"
              onClick={loadMoreTracks}
              disabled={loadingMoreTracks}
              className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 text-[9px] font-mono uppercase tracking-[0.18em] text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {loadingMoreTracks ? 'Loading tracks...' : 'Load more tracks'}
            </button>
          </div>
        )}

        </>
        )}{/* end browseMode === 'all' */}
      </PageContainer>

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

      {/* Batch action bar */}
      <BatchActionBar
        count={selectedIds.size}
        noun={['track', 'tracks']}
        onClear={() => { setSelectedIds(new Set()); setBulkEditOpen(false); }}
        busy={bulkDeleting || bulkEditing || packing}
        actions={[
          {
            label: bulkEditOpen ? 'Close' : 'Edit',
            icon: <SlidersHorizontal size={11} />,
            intent: bulkEditOpen ? 'primary' : 'default',
            onClick: () => setBulkEditOpen((v) => !v),
          },
          { label: 'Add tags', icon: <Tag size={11} />, onClick: () => setBulkTagPanel('addTags') },
          { label: 'Remove tags', icon: <Tag size={11} />, onClick: () => setBulkTagPanel('removeTags') },
          {
            label: 'Create pack',
            icon: <Package size={11} />,
            intent: 'primary',
            onClick: createPackFromSelected,
          },
          {
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
              setBulkEditOpen(false);
              await fetchTracks();
              if (failed === 0) toast.success(`Deleted ${ids.length} track${ids.length === 1 ? '' : 's'}`);
              else toast.warning(`Deleted ${ids.length - failed}, ${failed} failed`);
            },
          },
        ]}
      />
      {/* Bulk edit popover */}
      {bulkEditOpen && selectedIds.size > 0 && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-2 fade-in duration-200">
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 w-72 space-y-3">
            <p className="text-[9px] font-mono uppercase tracking-wider text-white/40">
              Edit {selectedIds.size} track{selectedIds.size === 1 ? '' : 's'}
            </p>
            {/* Batch status */}
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider text-white/30 mb-1.5">Set status</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: 'maq', l: 'MAQ', cls: 'bg-[#1f1a10] text-[#c8a47a] border-[#3d3020]/40' },
                  { v: 'needs_work', l: 'WIP', cls: 'bg-[#1f1a0a] text-white border-[#3a2f1f]' },
                  { v: 'finished', l: 'Finished', cls: 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]' },
                  { v: 'archived', l: 'Archived', cls: 'bg-[#0D0D0A] text-white/60 border-white/10' },
                ].map(({ v, l, cls }) => (
                  <button
                    key={v}
                    disabled={bulkEditing}
                    onClick={async () => {
                      setBulkEditing(true);
                      const ids = Array.from(selectedIds);
                      await Promise.allSettled(ids.map((id) =>
                        fetch(`/api/tracks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: v }) })
                      ));
                      setBulkEditing(false);
                      await fetchTracks();
                      toast.success(`Set ${ids.length} tracks to ${l}`);
                    }}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all disabled:opacity-40 ${cls}`}
                  >{l}</button>
                ))}
              </div>
            </div>
            {/* Batch store list */}
            <div className="flex gap-2">
              {[
                { label: 'List in store', val: true },
                { label: 'Unlist', val: false },
              ].map(({ label, val }) => (
                <button
                  key={String(val)}
                  disabled={bulkEditing}
                  onClick={async () => {
                    setBulkEditing(true);
                    const ids = Array.from(selectedIds);
                    await Promise.allSettled(ids.map((id) =>
                      fetch(`/api/tracks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store_listed: val }) })
                    ));
                    setBulkEditing(false);
                    await fetchTracks();
                    toast.success(`${val ? 'Listed' : 'Unlisted'} ${ids.length} track${ids.length === 1 ? '' : 's'}`);
                  }}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-white/10 bg-[#090907] text-[11px] font-medium text-white/60 hover:text-white hover:border-white/20 transition-all disabled:opacity-40"
                >{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {packModalOpen && (
        <PackBuilderModal
          tracks={tracks.filter((t) => selectedIds.has(t.id))}
          busy={packing}
          onClose={() => { if (!packing) setPackModalOpen(false); }}
          onCreate={submitPack}
        />
      )}

      {smartNameOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => !savingSmart && setSmartNameOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.02] p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white">Smart playlist</p>
            <h3 className="text-[16px] font-bold text-white mt-1 mb-1">Save current filters</h3>
            <p className="text-[11px] text-white/60 mb-4">Auto-updates as new tracks match these filters.</p>
            <input
              autoFocus
              value={smartNameDraft}
              onChange={(e) => setSmartNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && smartNameDraft.trim()) confirmSaveSmartPlaylist(); }}
              placeholder='e.g. "Finished Drill 140+"'
              maxLength={120}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20 mb-4"
            />
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setSmartNameOpen(false)} disabled={savingSmart} className="px-3 py-2 rounded-lg text-[11px] font-mono uppercase tracking-wider text-white/60 hover:text-white transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={confirmSaveSmartPlaylist} disabled={!smartNameDraft.trim() || savingSmart} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-40">
                {savingSmart ? <Loader2 size={12} className="animate-spin" /> : null}Save
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkTagPanel && (
        <BulkEditPanel
          mode={bulkTagPanel}
          ids={Array.from(selectedIds)}
          tagsEndpoint="/api/tracks/tags/bulk"
          onClose={() => setBulkTagPanel(null)}
          onDone={() => { setBulkTagPanel(null); setSelectedIds(new Set()); setSelectMode(false); fetchTracks(); }}
        />
      )}
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
      className="group relative shrink-0 w-[112px] sm:w-[132px] cursor-pointer"
      onClick={onOpen}
    >
      {/* Cover art + overlays */}
      <div className={`relative w-full aspect-square rounded-xl overflow-hidden bg-white/[0.04] border mb-2 transition-all ${isCurrent ? 'border-white/60 ring-1 ring-white/30' : 'border-white/10 group-hover:border-white/20'}`}>
        {track.cover_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#161616] to-[#090907]"><Music size={24} className="text-white/30" /></div>}
        {/* State badge */}
        {track.status && track.status !== 'archived' && (
          <span className={`absolute top-1.5 left-1.5 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
            track.status === 'maq'        ? 'bg-[#1f1a10] text-[#c8a47a] border-[#3d3020]/40' :
            track.status === 'finished'   ? 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]'   :
            track.status === 'needs_work' ? 'bg-[#1f1a0a] text-white border-[#3a2f1f]'   : ''
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
              ? <div className="flex items-end gap-[2px] h-4">{[3,5,7,5,3].map((h,i)=><span key={i} className="w-[3px] rounded-sm bg-white animate-bounce" style={{height:h,animationDelay:`${i*80}ms`}}/>)}</div>
              : <PlayGlyph size={15} className="text-white ml-0.5" />}
          </div>
        </button>
      </div>
      {/* Meta */}
      <p className={`text-[11px] font-medium truncate leading-tight ${isCurrent ? 'text-white' : 'text-white'}`}>{track.title}</p>
      <p className="text-[9px] font-mono text-white/50 mt-0.5 truncate">
        {[track.bpm && `${track.bpm}`, track.key && `${track.key}${track.scale === 'minor' ? 'm' : ''}`].filter(Boolean).join(' · ') || track.type || '—'}
      </p>
    </div>
  );
}

// ── MiniPlaylistCard ─────────────────────────────────────────────
function MiniPlaylistCard({ playlist }: { playlist: HomePlaylist }) {
  return (
    <Link href={`/playlists/${playlist.id}`} className="group relative shrink-0 w-[112px] sm:w-[132px] cursor-pointer block">
      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-white/[0.04] border border-white/10 group-hover:border-white/20 mb-2 transition-all">
        {playlist.cover_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={playlist.cover_url} alt={playlist.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1f1a33] to-[#090907]"><ListMusic size={24} className="text-white/40" /></div>}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-black/30">
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center">
            <PlayGlyph size={15} className="text-white ml-0.5" />
          </div>
        </div>
      </div>
      <p className="text-[11px] font-medium truncate text-white">{playlist.name}</p>
      <p className="text-[9px] font-mono text-white/50 mt-0.5">{playlist.track_count ?? 0} tracks</p>
    </Link>
  );
}

// ── MiniProjectCard ──────────────────────────────────────────────
function MiniProjectCard({ project }: { project: HomeProject }) {
  return (
    <Link href={`/projects/${project.id}`} className="group relative shrink-0 w-[112px] sm:w-[132px] cursor-pointer block">
      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-white/[0.04] border border-white/10 group-hover:border-white/20 mb-2 transition-all">
        {project.cover_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={project.cover_url} alt={project.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1a1830] to-[#090907]"><FolderOpen size={24} className="text-white/30" /></div>}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-black/30">
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center">
            <ArrowRight size={14} className="text-white" />
          </div>
        </div>
      </div>
      <p className="text-[11px] font-medium truncate text-white">{project.name}</p>
      <p className="text-[9px] font-mono text-white/50 mt-0.5 capitalize">{project.status?.replace('_', ' ') ?? 'project'} · {project.track_count ?? 0} tracks</p>
    </Link>
  );
}

// ── HomeRow — one horizontal scrollable section ──────────────────
function HomeRow({
  cfg, tracks, playlists, projects, recentHistory,
  currentTrackId, isPlaying, onPlayTrack, onOpenTrack, onSeeAll,
}: {
  cfg: HomeRowConfig;
  tracks: Track[];
  playlists: HomePlaylist[];
  projects: HomeProject[];
  recentHistory?: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlayTrack: (t: Track) => void;
  onOpenTrack: (t: Track) => void;
  onSeeAll: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'right' ? 320 : -320, behavior: 'smooth' });
  };

  const isEmpty =
    cfg.source === 'tracks' ? tracks.length === 0 :
    cfg.source === 'playlists' ? playlists.length === 0 :
    cfg.source === 'projects' ? projects.length === 0 :
    (recentHistory?.length ?? 0) === 0;

  if (isEmpty) return null;

  return (
    <div className="group/row">
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <h3 className="text-[18px] font-bold text-white">{cfg.title}</h3>
          {cfg.subtitle && <p className="text-[9px] font-mono text-white/40 mt-0.5">{cfg.subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => scroll('left')} className="hidden sm:flex w-6 h-6 rounded-full bg-white/[0.04] border border-white/10 items-center justify-center text-white/60 hover:text-white hover:border-white/20 transition-all opacity-0 group-hover/row:opacity-100">
            <ChevronLeft size={12} />
          </button>
          <button onClick={() => scroll('right')} className="hidden sm:flex w-6 h-6 rounded-full bg-white/[0.04] border border-white/10 items-center justify-center text-white/60 hover:text-white hover:border-white/20 transition-all opacity-0 group-hover/row:opacity-100">
            <ChevronRight size={12} />
          </button>
          {cfg.source === 'tracks' && (
            <button onClick={onSeeAll} className="text-[9px] font-mono text-white/60 hover:text-white transition-colors">
              See all →
            </button>
          )}
          {cfg.source === 'playlists' && <Link href="/playlists" className="text-[9px] font-mono text-white/40 hover:text-white/80 transition-colors">See all →</Link>}
          {cfg.source === 'projects' && <Link href="/projects" className="text-[9px] font-mono text-white/40 hover:text-white/80 transition-colors">See all →</Link>}
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide scroll-smooth">
        {cfg.source === 'recent' && recentHistory?.map((t) => (
          <MiniTrackCard key={t.id} track={t} isCurrent={currentTrackId === t.id}
            isPlaying={isPlaying && currentTrackId === t.id}
            onPlay={() => onPlayTrack(t)} onOpen={() => onOpenTrack(t)} />
        ))}
        {cfg.source === 'tracks' && tracks.map((t) => (
          <MiniTrackCard key={t.id} track={t} isCurrent={currentTrackId === t.id}
            isPlaying={isPlaying && currentTrackId === t.id}
            onPlay={() => onPlayTrack(t)} onOpen={() => onOpenTrack(t)} />
        ))}
        {cfg.source === 'playlists' && playlists.map((pl) => <MiniPlaylistCard key={pl.id} playlist={pl} />)}
        {cfg.source === 'projects' && projects.map((pr) => <MiniProjectCard key={pr.id} project={pr} />)}
      </div>
    </div>
  );
}

/* ─── Pack Builder modal ────────────────────────────────────────
   Replaces the old window.prompt chain: shows the selected beats, the
   summed lease value, a discount slider, and the resulting pack price +
   buyer savings live. */
function PackBuilderModal({
  tracks,
  busy,
  onClose,
  onCreate,
}: {
  tracks: Track[];
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, price: number, coverUrl: string | null) => void;
}) {
  const leaseSum = useMemo(
    () => tracks.reduce((s, t) => s + (t.lease_price_usd ?? 0), 0),
    [tracks],
  );
  const [name, setName] = useState('Beat Pack');
  const [discount, setDiscount] = useState(20); // percent off the lease total
  // Pack cover defaults to the first selected beat that has artwork; the
  // producer can click any beat in the strip to use its cover instead.
  const [coverUrl, setCoverUrl] = useState<string | null>(tracks.find((t) => t.cover_url)?.cover_url ?? null);

  // If no lease prices are set we can't anchor a discount — let the producer
  // type an absolute price instead.
  const hasAnchor = leaseSum > 0;
  const computed = hasAnchor ? Math.max(1, Math.round(leaseSum * (1 - discount / 100))) : 0;
  const [manualPrice, setManualPrice] = useState('');
  const price = hasAnchor ? computed : Number.parseFloat(manualPrice);
  const savings = hasAnchor ? Math.round(leaseSum - computed) : 0;
  const valid = !!name.trim() && Number.isFinite(price) && price > 0;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.02] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white">Beat pack</p>
            <h3 className="text-[16px] font-bold text-white mt-1">Bundle {tracks.length} beats</h3>
          </div>
          <button onClick={onClose} disabled={busy} className="text-white/50 hover:text-white transition-colors disabled:opacity-40"><X size={16} /></button>
        </div>

        {/* Selected beats — click one with art to set it as the pack cover */}
        <p className="text-[9px] font-mono uppercase tracking-wider text-white/50 mb-1.5">Pack cover <span className="text-white/40">— tap a beat</span></p>
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-hide">
          {tracks.map((t) => {
            const selectable = !!t.cover_url;
            const isCover = !!t.cover_url && coverUrl === t.cover_url;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { if (selectable) setCoverUrl(t.cover_url!); }}
                title={selectable ? `Use "${t.title}" as cover` : t.title}
                className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/[0.04] border transition-all ${
                  isCover ? 'border-white ring-2 ring-white/40' : 'border-white/10 hover:border-white/20'
                } ${selectable ? 'cursor-pointer' : 'cursor-default opacity-60'}`}
              >
                {t.cover_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-white/40"><Music size={14} /></div>}
              </button>
            );
          })}
        </div>

        {/* Name */}
        <label className="block text-[9px] font-mono uppercase tracking-wider text-white/50 mb-1.5">Pack name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-white/20 mb-4"
        />

        {hasAnchor ? (
          <>
            {/* Discount slider */}
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[9px] font-mono uppercase tracking-wider text-white/50">Discount</label>
              <span className="text-[11px] font-mono text-white tabular-nums">{discount}% off</span>
            </div>
            <input
              type="range" min={0} max={60} step={5} value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              className="w-full accent-white mb-4"
            />
            {/* Price math */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 mb-5 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-white/60">
                <span>Lease value of {tracks.length} beats</span>
                <span className="tabular-nums line-through">${leaseSum.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-white">Pack price</span>
                <span className="text-[22px] font-bold text-white tabular-nums">${computed.toLocaleString()}</span>
              </div>
              {savings > 0 && (
                <p className="text-[9px] font-mono text-[#6DC6A4]">Buyer saves ${savings.toLocaleString()}</p>
              )}
            </div>
          </>
        ) : (
          <>
            <label className="block text-[9px] font-mono uppercase tracking-wider text-white/50 mb-1.5">Pack price (USD)</label>
            <div className="relative mb-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60">$</span>
              <input
                type="number" min={1} value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="50"
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-7 pr-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-white/20 tabular-nums"
              />
            </div>
            <p className="text-[11px] text-white/50 mb-5">No lease prices on these beats yet — set the pack price directly.</p>
          </>
        )}

        <button
          onClick={() => onCreate(name, price, coverUrl)}
          disabled={!valid || busy}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-bold uppercase tracking-wider bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Package size={13} />}
          Create &amp; list pack
        </button>
      </div>
    </div>
  );
}
