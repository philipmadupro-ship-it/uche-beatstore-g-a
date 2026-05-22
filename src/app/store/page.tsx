'use client';

import { useEffect, useMemo, useRef, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Music, Search, ShoppingCart, Loader2, Play, Pause,
  Globe, X, CheckCircle2, XCircle, Link2, LayoutGrid,
  List, Mail, ChevronDown, Send, ListMusic, Sliders,
  Heart, ExternalLink, SlidersHorizontal, RotateCcw,
  ShoppingBag, Download, ChevronRight,
} from 'lucide-react';
import { MiniWaveform } from '@/components/player/MiniWaveform';
import { useCart } from '@/hooks/useCart';
import { usePlayer } from '@/hooks/usePlayer';
import { toast } from '@/hooks/useToast';
import type { Track } from '@/lib/types';
import { LicenseSelector } from '@/components/store/LicenseSelector';
import type { LicenseTier as LicenseTierImport } from '@/components/store/LicenseSelector';

/* ─── Types ─────────────────────────────────────────────────── */

interface TrackTag {
  tag: string;
  category: string | null;
}

// Re-export the canonical type from the shared component
type LicenseTier = LicenseTierImport;

interface CreatorProfile {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  credits?: string | null;
  license_lease_price_usd?: number | null;
  license_exclusive_price_usd?: number | null;
  license_notes?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
  accent_color?: string | null;
  font_style?: string | null;
  text_color_primary?: string | null;
  store_enabled?: boolean | null;
}

interface PlaylistTrackItem {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
  free_download_enabled?: boolean | null;
}

interface FeaturedPlaylist {
  id: string;
  name: string;
  cover_url: string | null;
  store_order: number | null;
  tracks: PlaylistTrackItem[];
}

interface StoreTrack extends Track {
  tags?: TrackTag[];
}

/** Beat + Instrumental share the "Beats" filter pill */
const TYPE_FILTERS = ['all', 'beats', 'song', 'remix'] as const;
type TypeFilter = typeof TYPE_FILTERS[number];
type ViewMode = 'grid' | 'list';

const FONT_FAMILY_MAP: Record<string, string> = {
  default: 'Inter, ui-sans-serif, system-ui, sans-serif',
  serif:   'Georgia, ui-serif, Times New Roman, serif',
  mono:    'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/* ─── Helpers ────────────────────────────────────────────────── */

function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^(https?:\/\/)+/, 'https://');
}

function fmtDur(s: number | null | undefined): string {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function getSimilarTracks(track: StoreTrack, pool: StoreTrack[], limit = 4): StoreTrack[] {
  const myTags = new Set(
    (track.tags ?? [])
      .filter((t) => t.category === 'genre' || t.category === 'mood')
      .map((t) => t.tag.toLowerCase()),
  );
  if (myTags.size === 0) return [];
  return pool
    .filter((t) => t.id !== track.id)
    .map((t) => ({
      track: t,
      score: (t.tags ?? []).filter(
        (tag) => (tag.category === 'genre' || tag.category === 'mood') && myTags.has(tag.tag.toLowerCase()),
      ).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ track: t }) => t);
}

/* ─── Suspense wrapper ───────────────────────────────────────── */

export default function StorePageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0907]" />}>
      <StorePage />
    </Suspense>
  );
}

/* ─── Main page ──────────────────────────────────────────────── */

function StorePage() {
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [tracks, setTracks] = useState<StoreTrack[]>([]);
  const [licenses, setLicenses] = useState<LicenseTier[]>([]);
  const [featuredPlaylists, setFeaturedPlaylists] = useState<FeaturedPlaylist[]>([]);
  const [featuredProjects, setFeaturedProjects] = useState<FeaturedPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Sidebar filters
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile toggle
  const [genreFilter, setGenreFilter] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [bpmMin, setBpmMin] = useState(0);   // 0 = sentinel (not yet set)
  const [bpmMax, setBpmMax] = useState(999); // 999 = sentinel (not yet set)
  const [freeOnly, setFreeOnly] = useState(false);

  // Debounced search
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(v), 200);
  }, []);

  // Preview drawer
  const [previewTrack, setPreviewTrack] = useState<StoreTrack | null>(null);

  // Free download modal
  const [freeDownloadTrack, setFreeDownloadTrack] = useState<StoreTrack | null>(null);

  const { items, addItem, clearCart, setIsOpen } = useCart();
  const { currentTrack, isPlaying, setTrack, togglePlay, setQueue, progress } = usePlayer();

  const searchParams = useSearchParams();
  const router = useRouter();

  const handleBuyProject = (proj: any) => {
    if (!proj?.id) return;
    const price = proj.price_usd != null ? Number(proj.price_usd) : 0;
    if (price <= 0) {
      toast.error('This project is not available for purchase');
      return;
    }
    const storedEmail = localStorage.getItem('antigravity-buyer-email') || '';
    const qs = storedEmail ? `?project_id=${proj.id}&email=${encodeURIComponent(storedEmail)}` : `?project_id=${proj.id}`;
    router.push(`/store/checkout${qs}`);
    toast.success(`Starting purchase: ${proj.name || 'Project'}`);
  };

  const purchaseStatus = searchParams?.get('purchase');
  const [bannerOpen, setBannerOpen] = useState(false);
  useEffect(() => {
    setBannerOpen(purchaseStatus === 'success' || purchaseStatus === 'cancelled');
    if (purchaseStatus === 'success') clearCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseStatus]);
  const dismissBanner = () => {
    setBannerOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('purchase');
    url.searchParams.delete('session_id');
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/store');
        const data = await res.json();
        const rawTracks = (data.tracks as StoreTrack[]) ?? [];
        const cleanTracks = rawTracks.map((t) => ({
          ...t,
          cover_url: sanitizeUrl(t.cover_url) ?? undefined,
        }));
        setCreator(data.creator ?? null);
        setTracks(cleanTracks);
        setLicenses((data.licenses as LicenseTier[]) ?? []);
        setFeaturedPlaylists((data.featuredPlaylists as FeaturedPlaylist[]) ?? []);
        setFeaturedProjects((data.featuredProjects as FeaturedPlaylist[]) ?? []);
      } catch (err) {
        console.error('store fetch failed', err);
        toast.error("Couldn't load store");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Distinct genres from track tags
  const availableGenres = useMemo(() => {
    const genres = new Set<string>();
    tracks.forEach((t) => {
      (t.tags ?? []).filter((tag) => tag.category === 'genre').forEach((tag) => genres.add(tag.tag));
    });
    return Array.from(genres).sort();
  }, [tracks]);

  const availableKeys = useMemo(() => {
    const keys = new Set(tracks.map((t) => t.key).filter(Boolean) as string[]);
    return Array.from(keys).sort();
  }, [tracks]);

  const bpmRange = useMemo(() => {
    const bpms = tracks.map((t) => t.bpm).filter(Boolean) as number[];
    if (!bpms.length) return { min: 60, max: 200 };
    return { min: Math.min(...bpms), max: Math.max(...bpms) };
  }, [tracks]);

  // Initialize BPM sliders when tracks first load
  useEffect(() => {
    if (tracks.length > 0 && bpmMin === 0 && bpmMax === 999) {
      setBpmMin(bpmRange.min);
      setBpmMax(bpmRange.max);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length]);

  const effectiveBpmMin = bpmMin === 0 ? bpmRange.min : bpmMin;
  const effectiveBpmMax = bpmMax === 999 ? bpmRange.max : bpmMax;

  const hasActiveFilters =
    genreFilter !== '' || keyFilter !== '' || freeOnly ||
    effectiveBpmMin > bpmRange.min || effectiveBpmMax < bpmRange.max;

  const resetFilters = () => {
    setGenreFilter('');
    setKeyFilter('');
    setBpmMin(bpmRange.min);
    setBpmMax(bpmRange.max);
    setFreeOnly(false);
    setSearch('');
    setDebouncedSearch('');
    setTypeFilter('all');
  };

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return tracks.filter((t) => {
      if (typeFilter === 'beats' && t.type !== 'beat' && t.type !== 'instrumental') return false;
      if (typeFilter !== 'all' && typeFilter !== 'beats' && t.type !== typeFilter) return false;
      if (freeOnly && !t.free_download_enabled) return false;
      if (t.bpm != null && (t.bpm < effectiveBpmMin || t.bpm > effectiveBpmMax)) return false;
      if (keyFilter && (t.key ?? '').toLowerCase() !== keyFilter.toLowerCase()) return false;
      if (genreFilter) {
        const hasGenre = (t.tags ?? []).some(
          (tag) => tag.category === 'genre' && tag.tag.toLowerCase() === genreFilter.toLowerCase(),
        );
        if (!hasGenre) return false;
      }
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.key ?? '').toLowerCase().includes(q) ||
        String(t.bpm ?? '').includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        (t.tags ?? []).some((tag) => tag.tag.toLowerCase().includes(q))
      );
    });
  }, [tracks, debouncedSearch, typeFilter, freeOnly, effectiveBpmMin, effectiveBpmMax, keyFilter, genreFilter]);

  const handlePlay = (t: StoreTrack) => {
    if (currentTrack?.id === t.id) { togglePlay(); return; }
    setQueue(filtered as Track[]);
    setTrack(t as Track);
  };

  const priceFor = (t: StoreTrack, type: 'lease' | 'exclusive'): number | null => {
    const override = type === 'lease' ? t.lease_price_usd : t.exclusive_price_usd;
    if (override != null && Number(override) > 0) return Number(override);
    const def = type === 'lease' ? creator?.license_lease_price_usd : creator?.license_exclusive_price_usd;
    return def != null && Number(def) > 0 ? Number(def) : null;
  };

  const addToCart = (t: StoreTrack, type: 'lease' | 'exclusive') => {
    const price = priceFor(t, type);
    if (price == null) { toast.error(`No ${type} price set for ${t.title}`); return; }
    addItem(t as Track, {
      id: `${type}-${t.id}`,
      name: type === 'lease' ? 'Lease' : 'Exclusive',
      price_usd: price,
      file_types: type === 'lease' ? ['MP3'] : ['WAV', 'MP3', 'STEMS'],
      is_exclusive: type === 'exclusive',
    });
    toast.success(`Added: ${t.title} (${type})`);
  };

  const handleCopyLink = () => {
    const url = window.location.origin + '/store';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => toast.success('Store link copied!'))
        .catch(() => copyFallback(url));
    } else {
      copyFallback(url);
    }
  };

  function copyFallback(text: string) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast.success('Store link copied!');
    } catch {
      toast.error('Copy failed — copy the URL from the address bar');
    }
  }

  const accentColor = creator?.accent_color || '#D4BFA0';
  const textColor   = creator?.text_color_primary || '#E8DCC8';
  const fontFamily  = FONT_FAMILY_MAP[creator?.font_style ?? 'default'] ?? FONT_FAMILY_MAP.default;

  if (!loading && creator?.store_enabled === false) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
        <div className="text-center px-6 max-w-sm">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#3a3328] mb-4">Beat Store</p>
          <h1 className="text-2xl font-bold text-[#E8DCC8] mb-3">
            {creator?.display_name || 'Coming soon'}
          </h1>
          <p className="text-[12px] text-[#5a5142]">The store is under construction. Check back soon.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#0a0907]"
      style={{
        '--store-accent': accentColor,
        '--store-text':   textColor,
        fontFamily,
        color: textColor,
      } as React.CSSProperties}
    >
      {/* ── Purchase return banner ─────────────────────────────── */}
      {bannerOpen && (
        <div className={`sticky top-0 z-50 px-4 md:px-12 py-3 border-b ${
          purchaseStatus === 'success'
            ? 'bg-[#0e1f17] border-[#6DC6A4]/30 text-[#6DC6A4]'
            : 'bg-[#1f1010] border-red-500/30 text-red-300'
        }`}>
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            {purchaseStatus === 'success'
              ? <CheckCircle2 size={16} className="shrink-0" />
              : <XCircle size={16} className="shrink-0" />}
            <p className="text-[12px] font-medium flex-1">
              {purchaseStatus === 'success'
                ? 'Purchase complete — check your inbox for the download link.'
                : 'Checkout cancelled. No payment was taken.'}
            </p>
            <button onClick={dismissBanner} aria-label="Dismiss" className="text-current/60 hover:text-current">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Artist bio block ──────────────────────────────────── */}
      <ArtistBioBlock creator={creator} trackCount={tracks.length} />

      {/* ── Featured playlists + projects ────────────────────── */}
      {(featuredPlaylists.length > 0 || featuredProjects.length > 0) && (
        <div>
          {featuredPlaylists.length > 0 && (
            <FeaturedPlaylistsStrip
              label="Featured Playlists"
              playlists={featuredPlaylists}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onPlay={(t, playlist) => {
                setQueue((playlist?.tracks ?? []) as unknown as Track[]);
                setTrack(t as unknown as Track);
              }}
              priceFor={(t, type) => {
                const override = type === 'lease' ? t.lease_price_usd : t.exclusive_price_usd;
                if (override != null && Number(override) > 0) return Number(override);
                const def = type === 'lease' ? creator?.license_lease_price_usd : creator?.license_exclusive_price_usd;
                return def != null && Number(def) > 0 ? Number(def) : null;
              }}
              onAddToCart={(t, type) => {
                const price = (type === 'lease' ? t.lease_price_usd : t.exclusive_price_usd)
                  ?? (type === 'lease' ? creator?.license_lease_price_usd : creator?.license_exclusive_price_usd);
                if (!price) { toast.error(`No ${type} price set`); return; }
                addItem({ ...t, user_id: '', stems_status: 'none', created_at: '' } as Track, {
                  id: `${type}-${t.id}`,
                  name: type === 'lease' ? 'Lease' : 'Exclusive',
                  price_usd: Number(price),
                  file_types: type === 'lease' ? ['MP3'] : ['WAV', 'MP3', 'STEMS'],
                  is_exclusive: type === 'exclusive',
                });
                toast.success(`Added: ${t.title} (${type})`);
              }}
            />
          )}
          {featuredProjects.length > 0 && (
             <FeaturedPlaylistsStrip
               label="Projects"
               playlists={featuredProjects}
               detailHrefBase="/store/projects"
               currentTrack={currentTrack}
               isPlaying={isPlaying}
               onPlay={(t, playlist) => {
                 setQueue((playlist?.tracks ?? []) as unknown as Track[]);
                 setTrack(t as unknown as Track);
               }}
               priceFor={(t, type) => {
                 const override = type === 'lease' ? t.lease_price_usd : t.exclusive_price_usd;
                 if (override != null && Number(override) > 0) return Number(override);
                 const def = type === 'lease' ? creator?.license_lease_price_usd : creator?.license_exclusive_price_usd;
                 return def != null && Number(def) > 0 ? Number(def) : null;
               }}
               onAddToCart={(t, type) => {
                 const price = (type === 'lease' ? t.lease_price_usd : t.exclusive_price_usd)
                   ?? (type === 'lease' ? creator?.license_lease_price_usd : creator?.license_exclusive_price_usd);
                 if (!price) { toast.error(`No ${type} price set`); return; }
                 addItem({ ...t, user_id: '', stems_status: 'none', created_at: '' } as Track, {
                   id: `${type}-${t.id}`,
                   name: type === 'lease' ? 'Lease' : 'Exclusive',
                   price_usd: Number(price),
                   file_types: type === 'lease' ? ['MP3'] : ['WAV', 'MP3', 'STEMS'],
                   is_exclusive: type === 'exclusive',
                 });
                 toast.success(`Added: ${t.title} (${type})`);
               }}
               onBuyProject={handleBuyProject}
             />

          )}
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-[#0a0907]/95 backdrop-blur-md border-b border-[#1f1a13]">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-3 flex items-center gap-3">
          {/* Mobile filters toggle */}
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className={`lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-full border text-[10px] font-mono uppercase tracking-wider transition-colors ${
              sidebarOpen || hasActiveFilters
                ? 'border-[#D4BFA0]/40 text-[#D4BFA0] bg-[#D4BFA0]/5'
                : 'border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8]'
            }`}
          >
            <SlidersHorizontal size={11} />
            Filters
            {hasActiveFilters && (
              <span className="w-4 h-4 rounded-full text-black text-[8px] flex items-center justify-center font-bold"
                style={{ backgroundColor: accentColor }}>
                ·
              </span>
            )}
          </button>

          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-sm">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328]" />
            <input
              type="text"
              placeholder="Search title, key, BPM, tag…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-[#14110d] border border-[#1f1a13] rounded-full py-2 pl-8 pr-3 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]"
            />
          </div>

          {/* Track count */}
          {!loading && (
            <span className="hidden md:block text-[10px] font-mono text-[#4a4338] whitespace-nowrap tabular-nums shrink-0">
              {filtered.length} {filtered.length === 1 ? 'beat' : 'beats'}
            </span>
          )}

          {/* Type filters */}
          <div className="hidden sm:flex items-center gap-1">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-full transition-colors whitespace-nowrap ${
                  typeFilter === f ? 'text-black' : 'bg-transparent text-[#6a5d4a] hover:text-[#E8DCC8]'
                }`}
                style={typeFilter === f ? { backgroundColor: accentColor } : {}}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Grid / List toggle */}
          <div className="flex items-center gap-0.5 bg-[#14110d] border border-[#1f1a13] rounded-md p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              title="Grid view"
              className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-[#2d2620] text-[#E8DCC8]' : 'text-[#5a5142] hover:text-[#a08a6a]'}`}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              title="List view"
              className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-[#2d2620] text-[#E8DCC8]' : 'text-[#5a5142] hover:text-[#a08a6a]'}`}
            >
              <List size={13} />
            </button>
          </div>

          {/* Copy store link */}
          <button
            onClick={handleCopyLink}
            title="Copy store link"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620] text-[10px] font-mono uppercase tracking-wider transition-colors"
          >
            <Link2 size={11} />
            Share
          </button>

          {/* Cart */}
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-full text-black hover:opacity-90 text-[11px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-40"
            style={{ backgroundColor: accentColor }}
            disabled={items.length === 0}
          >
            <ShoppingCart size={13} />
            <span className="hidden sm:inline">Cart</span>
            {items.length > 0 && (
              <span className="bg-black text-white text-[9px] font-mono rounded-full w-4 h-4 flex items-center justify-center">
                {items.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Main layout: sidebar + beat listing ─────────────────── */}
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 flex gap-6 items-start">

        {/* Left sidebar — sticky, visible on lg+ */}
        <StoreSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          genreFilter={genreFilter}
          setGenreFilter={setGenreFilter}
          keyFilter={keyFilter}
          setKeyFilter={setKeyFilter}
          bpmMin={bpmMin}
          setBpmMin={setBpmMin}
          bpmMax={bpmMax}
          setBpmMax={setBpmMax}
          bpmRange={bpmRange}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          freeOnly={freeOnly}
          setFreeOnly={setFreeOnly}
          hasActiveFilters={hasActiveFilters}
          onReset={resetFilters}
          availableGenres={availableGenres}
          availableKeys={availableKeys}
          accentColor={accentColor}
        />

        {/* Beat listing */}
        <div className="flex-1 min-w-0">
          {loading ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => <BeatCardSkeleton key={i} />)}
              </div>
            ) : (
              <div className="space-y-1">
                {Array.from({ length: 8 }).map((_, i) => <BeatListRowSkeleton key={i} />)}
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="text-center py-32 border border-dashed border-[#1f1a13] rounded-lg">
              <Music size={28} className="text-[#3a3328] mx-auto mb-3" />
              <p className="text-sm text-[#E8DCC8] mb-1">
                {tracks.length === 0 ? 'No beats in the store yet' : 'No beats match your filters'}
              </p>
              <p className="text-[11px] text-[#5a5142]">
                {tracks.length === 0 ? 'Check back soon.' : 'Try adjusting or resetting filters.'}
              </p>
              {hasActiveFilters && (
                <button onClick={resetFilters} className="mt-4 text-[10px] font-mono uppercase tracking-wider text-[#D4BFA0] hover:text-white transition-colors">
                  Reset filters
                </button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((t) => (
                <BeatCard
                  key={t.id}
                  track={t}
                  allTracks={filtered}
                  priceLease={priceFor(t, 'lease')}
                  priceExclusive={priceFor(t, 'exclusive')}
                  isCurrent={currentTrack?.id === t.id}
                  isPlaying={isPlaying && currentTrack?.id === t.id}
                  isPreview={previewTrack?.id === t.id}
                  onPlay={() => handlePlay(t)}
                  onPreview={() => setPreviewTrack(previewTrack?.id === t.id ? null : t)}
                  onAddLease={() => addToCart(t, 'lease')}
                  onAddExclusive={() => addToCart(t, 'exclusive')}
                  onFreeDownload={() => setFreeDownloadTrack(t)}
                  accentColor={accentColor}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((t, i) => (
                <BeatListRow
                  key={t.id}
                  track={t}
                  index={i + 1}
                  priceLease={priceFor(t, 'lease')}
                  priceExclusive={priceFor(t, 'exclusive')}
                  isCurrent={currentTrack?.id === t.id}
                  isPlaying={isPlaying && currentTrack?.id === t.id}
                  isPreview={previewTrack?.id === t.id}
                  onPlay={() => handlePlay(t)}
                  onPreview={() => setPreviewTrack(previewTrack?.id === t.id ? null : t)}
                  onAddLease={() => addToCart(t, 'lease')}
                  onAddExclusive={() => addToCart(t, 'exclusive')}
                  onFreeDownload={() => setFreeDownloadTrack(t)}
                  accentColor={accentColor}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Contact form ─────────────────────────────────────────── */}
      <StoreContactForm creator={creator} accentColor={accentColor} />

      {/* ── Beat preview drawer ──────────────────────────────────── */}
      {previewTrack && (
        <BeatPreviewDrawer
          track={previewTrack}
          allTracks={filtered}
          licenses={licenses}
          priceLease={priceFor(previewTrack, 'lease')}
          priceExclusive={priceFor(previewTrack, 'exclusive')}
          isCurrent={currentTrack?.id === previewTrack.id}
          isPlaying={isPlaying && currentTrack?.id === previewTrack.id}
          progress={progress}
          onPlay={() => handlePlay(previewTrack)}
          onAddLease={() => addToCart(previewTrack, 'lease')}
          onAddExclusive={() => addToCart(previewTrack, 'exclusive')}
          onFreeDownload={() => setFreeDownloadTrack(previewTrack)}
          onClose={() => setPreviewTrack(null)}
          onSelectTrack={(t) => setPreviewTrack(t)}
          accentColor={accentColor}
        />
      )}

      {/* ── Free download modal ──────────────────────────────────── */}
      {freeDownloadTrack && (
        <FreeDownloadModal
          track={freeDownloadTrack}
          onClose={() => setFreeDownloadTrack(null)}
          accentColor={accentColor}
        />
      )}

      <style>{`
        .no-scrollbar::-webkit-scrollbar{display:none}
        .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}
        @keyframes beat-pulse{0%,100%{box-shadow:0 0 0 1px var(--pulse-clr,rgba(212,191,160,0.2))}50%{box-shadow:0 0 0 3px var(--pulse-clr,rgba(212,191,160,0.15))}}
      `}</style>
    </div>
  );
}

/* ─── Skeleton loaders ───────────────────────────────────────── */

function BeatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] overflow-hidden flex flex-col">
      <div className="w-full aspect-square bg-[#1a160f] animate-pulse" />
      <div className="p-4 flex flex-col gap-3">
        <div className="h-3.5 bg-[#1f1a13] rounded animate-pulse w-3/4" />
        <div className="flex gap-1">
          <div className="h-4 w-12 bg-[#1a160f] rounded animate-pulse" />
          <div className="h-4 w-10 bg-[#1a160f] rounded animate-pulse" />
        </div>
        <div className="h-9 bg-[#1a160f] rounded animate-pulse mt-1" />
        <div className="mt-auto pt-2 flex gap-2">
          <div className="flex-1 h-10 bg-[#1a160f] rounded animate-pulse" />
          <div className="flex-1 h-10 bg-[#1f1a13] rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function BeatListRowSkeleton() {
  return (
    <div className="rounded-xl border border-[#1a160f] bg-[#14110d]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-7 h-7 rounded-full bg-[#1a160f] animate-pulse shrink-0" />
        <div className="w-10 h-10 rounded-lg bg-[#1a160f] animate-pulse shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="h-3 bg-[#1f1a13] rounded animate-pulse w-2/3" />
          <div className="h-2.5 bg-[#1a160f] rounded animate-pulse w-1/3" />
        </div>
        <div className="hidden md:flex gap-2 shrink-0">
          <div className="h-8 w-14 bg-[#1a160f] rounded animate-pulse" />
          <div className="h-8 w-14 bg-[#1f1a13] rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/* ─── Sidebar ────────────────────────────────────────────────── */

function StoreSidebar({
  open, onClose,
  genreFilter, setGenreFilter,
  keyFilter, setKeyFilter,
  bpmMin, setBpmMin,
  bpmMax, setBpmMax, bpmRange,
  typeFilter, setTypeFilter,
  freeOnly, setFreeOnly,
  hasActiveFilters, onReset,
  availableGenres, availableKeys,
  accentColor,
}: {
  open: boolean;
  onClose: () => void;
  genreFilter: string;
  setGenreFilter: (v: string) => void;
  keyFilter: string;
  setKeyFilter: (v: string) => void;
  bpmMin: number;
  setBpmMin: (v: number) => void;
  bpmMax: number;
  setBpmMax: (v: number) => void;
  bpmRange: { min: number; max: number };
  typeFilter: TypeFilter;
  setTypeFilter: (v: TypeFilter) => void;
  freeOnly: boolean;
  setFreeOnly: (v: boolean) => void;
  hasActiveFilters: boolean;
  onReset: () => void;
  availableGenres: string[];
  availableKeys: string[];
  accentColor: string;
}) {
  const effectiveMin = bpmMin === 0 ? bpmRange.min : bpmMin;
  const effectiveMax = bpmMax === 999 ? bpmRange.max : bpmMax;
  const PillButton = ({
    active, onClick, children,
  }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded-full border transition-all whitespace-nowrap ${
        active
          ? 'text-black border-[#D4BFA0]'
          : 'bg-transparent text-[#6a5d4a] border-[#1f1a13] hover:border-[#D4BFA0]/30 hover:text-[#a08a6a]'
      }`}
      style={active ? { backgroundColor: accentColor, borderColor: accentColor } : {}}
    >
      {children}
    </button>
  );

  const content = (
    <div className="flex flex-col gap-6 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a]">
          <Sliders size={11} />
          Filters
        </div>
        <button onClick={onClose} className="lg:hidden text-[#4a4338] hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Type */}
      <div>
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] mb-2">Type</p>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <PillButton key={f} active={typeFilter === f} onClick={() => setTypeFilter(f)}>
              {f}
            </PillButton>
          ))}
        </div>
      </div>

      {/* Genre */}
      {availableGenres.length > 0 && (
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] mb-2">Genre</p>
          <div className="flex flex-wrap gap-1.5">
            <PillButton active={genreFilter === ''} onClick={() => setGenreFilter('')}>All</PillButton>
            {availableGenres.map((g) => (
              <PillButton key={g} active={genreFilter === g} onClick={() => setGenreFilter(genreFilter === g ? '' : g)}>
                {g}
              </PillButton>
            ))}
          </div>
        </div>
      )}

      {/* Key */}
      {availableKeys.length > 0 && (
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] mb-2">Key</p>
          <div className="flex flex-wrap gap-1.5">
            <PillButton active={keyFilter === ''} onClick={() => setKeyFilter('')}>Any</PillButton>
            {availableKeys.map((k) => (
              <PillButton key={k} active={keyFilter === k} onClick={() => setKeyFilter(keyFilter === k ? '' : k)}>
                {k}
              </PillButton>
            ))}
          </div>
        </div>
      )}

      {/* BPM dual sliders */}
      {bpmRange.min < bpmRange.max && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328]">BPM range</p>
            <span
              className="text-[11px] font-mono font-bold tabular-nums"
              style={{ color: hasActiveFilters ? accentColor : '#4a4338' }}
            >
              {effectiveMin}–{effectiveMax}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-[#3a3328] w-5 text-right shrink-0">min</span>
              <input
                type="range"
                min={bpmRange.min}
                max={bpmRange.max}
                step={1}
                value={effectiveMin}
                onChange={(e) => setBpmMin(Math.min(Number(e.target.value), effectiveMax - 1))}
                className="flex-1 h-1 rounded"
                style={{ accentColor }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-[#3a3328] w-5 text-right shrink-0">max</span>
              <input
                type="range"
                min={bpmRange.min}
                max={bpmRange.max}
                step={1}
                value={effectiveMax}
                onChange={(e) => setBpmMax(Math.max(Number(e.target.value), effectiveMin + 1))}
                className="flex-1 h-1 rounded"
                style={{ accentColor }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Free only toggle */}
      <button
        onClick={() => setFreeOnly(!freeOnly)}
        className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all ${
          freeOnly
            ? 'bg-[#0e1f17]/60 border-[#6DC6A4]/30 text-[#6DC6A4]'
            : 'bg-transparent border-[#1f1a13] text-[#6a5d4a] hover:border-[#2d2620]'
        }`}
      >
        <div className="flex items-center gap-2">
          <Download size={11} />
          <span className="text-[10px] font-mono uppercase tracking-wider">Free only</span>
        </div>
        <span className={`text-[8px] font-mono uppercase ${freeOnly ? 'text-[#6DC6A4]' : 'text-[#3a3328]'}`}>
          {freeOnly ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* Reset */}
      <button
        onClick={onReset}
        disabled={!hasActiveFilters}
        className="flex items-center gap-1.5 justify-center px-3 py-2 rounded-lg border border-[#1f1a13] text-[10px] font-mono uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:border-[#D4BFA0]/40 hover:text-[#D4BFA0] text-[#6a5d4a]"
      >
        <RotateCcw size={10} />
        Reset filters
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Mobile bottom sheet */}
      <div className={`lg:hidden fixed left-0 right-0 bottom-0 z-50 bg-[#0c0a08] border-t border-[#1f1a13] rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.6)] overflow-y-auto max-h-[75vh] transition-transform duration-300 ${
        open ? 'translate-y-0' : 'translate-y-full'
      }`}>
        {/* Bottom sheet drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#2d2620]" />
        </div>
        {content}
      </div>

      {/* Desktop sticky sidebar */}
      <div className="hidden lg:block w-56 shrink-0 sticky top-[57px] max-h-[calc(100vh-57px)] overflow-y-auto">
        <div className="bg-[#0c0a08] border border-[#1f1a13] rounded-2xl overflow-hidden">
          {content}
        </div>
      </div>
    </>
  );
}

/* ─── Tag chips helper ───────────────────────────────────────── */

function TagChips({ tags, max = 3, accentGenre = false }: { tags: TrackTag[]; max?: number; accentGenre?: boolean }) {
  const display = tags
    .filter((t) => t.category === 'genre' || t.category === 'mood')
    .slice(0, max + 1);
  if (display.length === 0) return null;
  const visible = display.slice(0, max);
  const overflow = display.length - max;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {visible.map((t) => {
        const isGenre = t.category === 'genre';
        return (
          <span key={t.tag} className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border ${
            isGenre && accentGenre
              ? 'bg-[#D4BFA0]/10 text-[#D4BFA0] border-[#D4BFA0]/20'
              : 'bg-[#1f1a13] text-[#a08a6a] border-[#1f1a13]'
          }`}>
            {t.tag}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-[#5a5142] bg-[#1a160f]">
          +{overflow}
        </span>
      )}
    </div>
  );
}

/* ─── BeatCard (grid view) ───────────────────────────────────── */

function BeatCard({
  track, allTracks, priceLease, priceExclusive, isCurrent, isPlaying, isPreview,
  onPlay, onPreview, onAddLease, onAddExclusive, onFreeDownload, accentColor,
}: {
  track: StoreTrack;
  allTracks: StoreTrack[];
  priceLease: number | null;
  priceExclusive: number | null;
  isCurrent: boolean;
  isPlaying: boolean;
  isPreview: boolean;
  onPlay: () => void;
  onPreview: () => void;
  onAddLease: () => void;
  onAddExclusive: () => void;
  onFreeDownload: () => void;
  accentColor: string;
}) {
  const similar = useMemo(() => getSimilarTracks(track, allTracks), [track, allTracks]);

  return (
    <div
      id={`beat-${track.id}`}
      className={`group rounded-2xl border bg-[#14110d] overflow-hidden transition-all flex flex-col ${
        isPreview
          ? 'border-[#D4BFA0]/50 shadow-lg shadow-[#D4BFA0]/5'
          : isPlaying
          ? 'shadow-md animate-[beat-pulse_2s_ease-in-out_infinite]'
          : isCurrent
          ? 'border-[#D4BFA0]/30 shadow-md shadow-[#D4BFA0]/5'
          : 'border-[#1f1a13] hover:border-[#2d2620]'
      }`}
      style={
        isPreview ? { borderColor: `${accentColor}80` }
        : isPlaying ? { borderColor: `${accentColor}66`, boxShadow: `0 0 0 1px ${accentColor}33` }
        : isCurrent ? { borderColor: `${accentColor}4D` }
        : {}
      }
    >
      {/* Cover art — clicking opens preview drawer */}
      <div
        className="relative w-full aspect-square bg-[#0a0907] overflow-hidden block shrink-0 cursor-pointer"
        onClick={onPreview}
      >
        {track.cover_url ? (
          <img loading="lazy" src={track.cover_url} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#2A2418] to-[#0a0907] flex items-center justify-center text-[#a08a6a]">
            <Music size={36} />
          </div>
        )}

        {/* BPM badge — top left */}
        {track.bpm && (
          <div className="absolute top-2 left-2 text-[8px] font-mono bg-black/70 text-white px-2 py-0.5 rounded border border-[#1f1a13] backdrop-blur-sm">
            {track.bpm} BPM
          </div>
        )}

        {/* Key badge — top right */}
        {track.key && (
          <div
            className="absolute top-2 right-2 text-[8px] font-mono font-semibold px-2 py-0.5 rounded backdrop-blur-sm"
            style={{ backgroundColor: `${accentColor}CC`, color: '#0a0907' }}
          >
            {track.key}{track.scale === 'minor' ? 'm' : ''}
          </div>
        )}

        {/* Free badge overlay */}
        {track.free_download_enabled && (
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider bg-[#6DC6A4] text-black">
            Free
          </div>
        )}

        {/* Playing indicator */}
        {isCurrent && (
          <div className="absolute top-8 left-2 w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shadow-[0_0_6px_#6DC6A4] animate-pulse" />
        )}

        {/* Play overlay */}
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          aria-label={isCurrent && isPlaying ? 'Pause' : 'Play'}
          className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-150 ${
            isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-xl transform group-hover:scale-105 transition-transform pointer-events-none">
            {isCurrent && isPlaying
              ? <Pause size={22} fill="currentColor" />
              : <Play size={22} className="ml-0.5" fill="currentColor" />}
          </div>
        </button>
      </div>

      <div className="p-4 flex flex-col flex-1">
        {/* Title — clicking opens preview drawer */}
        <button onClick={onPreview} className="text-left">
          <p className="text-[14px] font-semibold text-white truncate hover:text-[#D4BFA0] transition-colors"
            style={isPreview || isCurrent ? { color: accentColor } : {}}>
            {track.title}
          </p>
        </button>

        {/* Tags with genre accent */}
        <TagChips tags={track.tags ?? []} max={3} accentGenre />

        {/* Waveform */}
        <div className="mt-3 px-0.5">
          <MiniWaveform
            trackId={track.id}
            peaksUrl={track.peaks_url}
            height={36}
            isActive={isCurrent}
            onPlay={!isCurrent ? onPlay : undefined}
          />
        </div>

        {track.description && (
          <p className="text-[11px] text-[#a08a6a] mt-2 line-clamp-2 leading-relaxed">{track.description}</p>
        )}

        {/* Buy / free download buttons */}
        <div className="mt-auto pt-3">
          {track.free_download_enabled ? (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFreeDownload(); }}
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-md bg-[#6DC6A4]/10 border border-[#6DC6A4]/25 hover:bg-[#6DC6A4]/20 text-[#6DC6A4] text-[11px] font-bold uppercase tracking-wider transition-colors"
            >
              <Download size={12} />
              Free Download
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onAddLease(); }}
                disabled={priceLease == null}
                className="flex-1 flex flex-col items-start px-3 py-2 rounded-md bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.15] text-left transition-colors disabled:opacity-30"
              >
                <span className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a]">Lease</span>
                <span className="text-[13px] font-bold text-[#E8DCC8] tabular-nums">
                  {priceLease != null ? `$${priceLease.toLocaleString()}` : '—'}
                </span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onAddExclusive(); }}
                disabled={priceExclusive == null}
                className="flex-1 flex flex-col items-start px-3 py-2 rounded-md text-left transition-colors disabled:opacity-30 hover:opacity-90"
                style={{ backgroundColor: accentColor }}
              >
                <span className="text-[9px] font-mono uppercase tracking-wider text-black/70">Excl</span>
                <span className="text-[13px] font-bold text-black tabular-nums">
                  {priceExclusive != null ? `$${priceExclusive.toLocaleString()}` : '—'}
                </span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onPreview(); }}
                className="w-9 h-9 rounded-md bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] flex items-center justify-center text-[#5a5142] hover:text-[#E8DCC8] transition-all shrink-0"
                title="Preview & license details"
              >
                <Heart size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Similar beats */}
        {similar.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[#1a160f]">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] mb-2">Similar</p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {similar.map((s) => (
                <button
                  key={s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    document.getElementById(`beat-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#1a160f] border border-[#1f1a13] hover:border-[#2d2620] transition-colors group/sim"
                >
                  <Play size={8} className="text-[#5a5142] group-hover/sim:text-[#a08a6a] transition-colors shrink-0" />
                  <p className="text-[10px] text-[#a08a6a] font-medium whitespace-nowrap max-w-[90px] truncate">{s.title}</p>
                  {s.bpm && <span className="text-[9px] font-mono text-[#5a5142] shrink-0">{s.bpm}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── BeatListRow (list view) ────────────────────────────────── */

function BeatListRow({
  track, index, priceLease, priceExclusive, isCurrent, isPlaying, isPreview,
  onPlay, onPreview, onAddLease, onAddExclusive, onFreeDownload, accentColor,
}: {
  track: StoreTrack;
  index: number;
  priceLease: number | null;
  priceExclusive: number | null;
  isCurrent: boolean;
  isPlaying: boolean;
  isPreview: boolean;
  onPlay: () => void;
  onPreview: () => void;
  onAddLease: () => void;
  onAddExclusive: () => void;
  onFreeDownload: () => void;
  accentColor: string;
}) {
  void index;

  return (
    <div
      id={`beat-${track.id}`}
      className={`rounded-xl border transition-all ${
        isPreview
          ? 'border-[#D4BFA0]/40 bg-[#16130e]'
          : isCurrent
          ? 'border-[#D4BFA0]/20 bg-[#16130e]'
          : 'border-[#1a160f] bg-[#14110d] hover:border-[#1f1a13]'
      }`}
      style={isPreview ? { borderColor: `${accentColor}66` } : isCurrent ? { borderColor: `${accentColor}33` } : {}}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Play button */}
        <button
          onClick={onPlay}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors shrink-0 ${
            isCurrent ? 'text-black' : 'bg-white/[0.06] text-[#a08a6a] hover:bg-white/[0.12] hover:text-white'
          }`}
          style={isCurrent ? { backgroundColor: accentColor } : {}}
        >
          {isCurrent && isPlaying
            ? <Pause size={11} fill="currentColor" />
            : <Play size={11} fill="currentColor" className="ml-0.5" />}
        </button>

        {/* Cover art thumbnail — clicking opens preview */}
        <button
          onClick={onPreview}
          className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-[#0a0907] cursor-pointer relative group"
        >
          {track.cover_url
            ? <img src={track.cover_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={14} /></div>}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <ExternalLink size={10} className="text-white" />
          </div>
        </button>

        {/* Title + meta + tags */}
        <div className="flex-1 min-w-0">
          <button onClick={onPreview} className="text-left w-full" title={track.title}>
            <p className={`text-[13px] font-medium truncate transition-colors ${
              isPreview || isCurrent ? '' : 'text-[#E8DCC8] hover:text-[#D4BFA0]'
            }`}
              style={isPreview || isCurrent ? { color: accentColor } : {}}
            >
              {track.title}
            </p>
          </button>
          <p className="text-[10px] font-mono text-[#5a5142] uppercase tracking-wider truncate">
            {track.type}
            {track.duration_seconds ? ` · ${fmtDur(track.duration_seconds)}` : ''}
          </p>
          {(track.tags ?? []).length > 0 && (
            <div className="hidden sm:flex items-center gap-1 mt-1 h-[18px] overflow-hidden">
              {(track.tags ?? [])
                .filter((t) => t.category === 'genre' || t.category === 'mood')
                .slice(0, 3)
                .map((t) => (
                  <span key={t.tag} className={`px-1.5 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider border shrink-0 ${
                    t.category === 'genre'
                      ? 'bg-[#D4BFA0]/10 text-[#D4BFA0] border-[#D4BFA0]/20'
                      : 'bg-[#1f1a13] text-[#6a5d4a] border-[#1f1a13]'
                  }`}>
                    {t.tag}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* BPM column */}
        {track.bpm && (
          <div className="hidden md:block text-right shrink-0">
            <p className="text-[8px] font-mono uppercase text-[#5a5142]">BPM</p>
            <p className="text-[11px] font-mono text-white tabular-nums">{track.bpm}</p>
          </div>
        )}

        {/* Key column */}
        {track.key && (
          <div className="hidden md:block text-right shrink-0">
            <p className="text-[8px] font-mono uppercase text-[#5a5142]">Key</p>
            <p className="text-[11px] font-mono font-semibold tabular-nums" style={{ color: accentColor }}>
              {track.key}{track.scale === 'minor' ? 'm' : ''}
            </p>
          </div>
        )}

        {/* Prices */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {track.free_download_enabled ? (
            <button
              onClick={onFreeDownload}
              className="px-2.5 py-1.5 rounded-md bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 text-[#6DC6A4] text-[10px] font-bold uppercase tracking-wider hover:bg-[#6DC6A4]/20 transition-colors"
            >
              Free
            </button>
          ) : (
            <>
              <button
                onClick={onAddLease}
                disabled={priceLease == null}
                className="px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[#E8DCC8] text-[11px] font-bold hover:bg-white/[0.08] transition-colors disabled:opacity-30"
              >
                {priceLease != null ? `$${priceLease}` : '—'}
                <span className="hidden sm:inline text-[9px] font-mono text-[#6a5d4a] ml-1">L</span>
              </button>
              <button
                onClick={onAddExclusive}
                disabled={priceExclusive == null}
                className="px-2.5 py-1.5 rounded-md text-black text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-30"
                style={{ backgroundColor: accentColor }}
              >
                {priceExclusive != null ? `$${priceExclusive}` : '—'}
              </button>
            </>
          )}
          <button
            onClick={onPreview}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[#4a4338] hover:text-[#E8DCC8] bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.04] transition-all"
            title="Preview"
          >
            <ExternalLink size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Beat Preview Drawer ────────────────────────────────────── */

function BeatPreviewDrawer({
  track, allTracks, licenses, priceLease, priceExclusive, isCurrent, isPlaying, progress,
  onPlay, onAddLease, onAddExclusive, onFreeDownload, onClose, onSelectTrack, accentColor,
}: {
  track: StoreTrack;
  allTracks: StoreTrack[];
  licenses: LicenseTier[];
  priceLease: number | null;
  priceExclusive: number | null;
  isCurrent: boolean;
  isPlaying: boolean;
  progress: number;
  onPlay: () => void;
  onAddLease: () => void;
  onAddExclusive: () => void;
  onFreeDownload: () => void;
  onClose: () => void;
  onSelectTrack: (t: StoreTrack) => void;
  accentColor: string;
}) {
  // Default to lease if available, else exclusive, else first tier
  const defaultLicenseId = priceLease != null ? 'lease' : priceExclusive != null ? 'exclusive' : licenses[0]?.id ?? 'lease';
  const [selectedLicense, setSelectedLicense] = useState<string>(defaultLicenseId);

  // Reset selected license when track changes
  useEffect(() => {
    setSelectedLicense(priceLease != null ? 'lease' : priceExclusive != null ? 'exclusive' : licenses[0]?.id ?? 'lease');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  // Escape key closes drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const similar = useMemo(() => getSimilarTracks(track, allTracks, 5), [track, allTracks]);

  // Bar visualization heights seeded from track ID (deterministic per track)
  const bars = useMemo(() => {
    const seed = track.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return Array.from({ length: 36 }, (_, i) => {
      const s = (seed * (i + 1) * 2654435761) >>> 0;
      return Math.max(12, Math.min(88, (s % 70) + 15 + Math.sin(i * 0.5 + seed) * 10));
    });
  }, [track.id]);

  const dur = track.duration_seconds ?? 0;
  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  const currentSec = isCurrent ? progress * dur : 0;

  const activeLicenses: LicenseTier[] = licenses.length > 0
    ? [...licenses].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : [
        priceLease != null
          ? { id: 'lease', name: 'Lease', price_usd: priceLease, file_types: ['MP3', 'WAV'], is_exclusive: false }
          : null,
        priceExclusive != null
          ? { id: 'exclusive', name: 'Exclusive', price_usd: priceExclusive, file_types: ['MP3', 'WAV', 'STEMS'], is_exclusive: true }
          : null,
      ].filter(Boolean) as LicenseTier[];

  const selectedTier = activeLicenses.find((l) => l.id === selectedLicense) ?? activeLicenses[0];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[420px] z-50 flex flex-col bg-[#0c0a08] border-l border-[#1f1a13] shadow-[0_0_60px_rgba(0,0,0,0.8)] animate-in slide-in-from-right duration-300">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1a13] shrink-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">Preview</p>
          <div className="flex items-center gap-2">
            <Link
              href={`/store/${track.id}`}
              className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#a08a6a] transition-colors flex items-center gap-1"
            >
              Full page
              <ExternalLink size={9} />
            </Link>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#4a4338] hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.04] transition-all">
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* Art + identity */}
          <div className="p-5 border-b border-[#1f1a13]">
            <div className="flex gap-4">
              <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-[#0a0907] border border-[#1f1a13] shrink-0">
                {track.cover_url ? (
                  <img src={track.cover_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                    <Music size={28} />
                  </div>
                )}
                <button
                  onClick={onPlay}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 hover:bg-black/60 transition-colors"
                >
                  {isCurrent && isPlaying
                    ? <Pause size={20} fill="currentColor" className="text-white" />
                    : <Play size={20} fill="currentColor" className="text-white ml-0.5" />}
                </button>
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <p
                  className="text-[15px] font-medium text-[#E8DCC8] leading-tight truncate"
                  style={isCurrent ? { color: accentColor } : {}}
                >
                  {track.title}
                </p>
                <p className="text-[10px] uppercase tracking-widest mt-1 font-bold" style={{ color: accentColor }}>
                  {track.type}
                </p>
                <TagChips tags={track.tags ?? []} max={4} accentGenre />
              </div>
            </div>
          </div>

          {/* Bar visualization scrubber */}
          <div className="px-5 py-4 border-b border-[#1f1a13]">
            <div className="relative h-14 flex items-center gap-[2px]">
              {bars.map((h, i) => {
                const frac = i / bars.length;
                const active = isCurrent && frac < progress;
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-full transition-all duration-75"
                    style={{
                      height: `${h}%`,
                      backgroundColor: active ? accentColor : '#1c1a16',
                      opacity: active ? 1 : 0.6,
                    }}
                  />
                );
              })}
              {/* Invisible range input for scrubbing — cosmetic only, playback controlled via player */}
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[9px] font-mono text-[#5a5142] tabular-nums">{fmt(currentSec)}</span>
              <span className="text-[9px] font-mono text-[#5a5142] tabular-nums">{fmt(dur)}</span>
            </div>
          </div>

          {/* Studio specs */}
          <div className="px-5 py-4 border-b border-[#1f1a13]">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] mb-3">Studio specs</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Tempo', value: track.bpm ? `${track.bpm} BPM` : '—' },
                { label: 'Key', value: track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : '—' },
                { label: 'Duration', value: fmtDur(track.duration_seconds) },
                { label: 'Type', value: track.type?.toUpperCase() ?? '—' },
                { label: 'Stems', value: track.stems_status === 'done' ? 'Available' : 'Not included' },
                { label: 'WAV', value: track.wav_url ? 'Uploaded' : 'On request' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5 bg-[#0a0907] rounded-lg px-3 py-2.5 border border-[#1a160f]">
                  <span className="text-[8px] font-mono uppercase tracking-wider text-[#4a4338]">{label}</span>
                  <span className={`text-[11px] font-mono font-medium ${
                    label === 'Stems' && track.stems_status === 'done' ? 'text-[#6DC6A4]' : 'text-[#E8DCC8]'
                  }`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Similar beats */}
          {similar.length > 0 && (
            <div className="px-5 py-4 border-b border-[#1f1a13]">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] mb-3">Similar beats</p>
              <div className="space-y-1.5">
                {similar.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectTrack(s)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#16130e] border border-transparent hover:border-[#1f1a13] transition-all text-left group"
                  >
                    <div className="w-8 h-8 rounded-md overflow-hidden bg-[#0a0907] shrink-0">
                      {s.cover_url
                        ? <img src={s.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={12} /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#E8DCC8] truncate group-hover:text-[#D4BFA0] transition-colors">{s.title}</p>
                      <p className="text-[9px] font-mono text-[#5a5142] uppercase">
                        {s.bpm ? `${s.bpm} BPM` : ''}{s.key ? ` · ${s.key}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={12} className="text-[#3a3328] group-hover:text-[#6a5d4a] shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* License tiers */}
          <div className="px-5 py-4 pb-24">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#3a3328] mb-3">License</p>
            <LicenseSelector
              tiers={activeLicenses}
              selectedId={selectedLicense}
              onSelect={setSelectedLicense}
              accentColor={accentColor}
              isFreeDownload={track.free_download_enabled ?? false}
              onFreeDownload={onFreeDownload}
            />
          </div>
        </div>

        {/* Sticky add-to-cart bar */}
        {!track.free_download_enabled && (
          <div className="shrink-0 border-t border-[#1f1a13] bg-[#0c0a08] px-5 py-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142]">Selected</p>
                <p className="text-[12px] font-semibold text-[#E8DCC8] truncate">{selectedTier?.name ?? '—'}</p>
              </div>
              <p className="text-[20px] font-bold tabular-nums shrink-0" style={{ color: accentColor }}>
                {selectedTier ? (selectedTier.is_free ? 'Free' : `$${Number(selectedTier.price_usd).toLocaleString()}`) : '—'}
              </p>
            </div>
            <button
              onClick={() => {
                if (selectedTier?.is_exclusive) onAddExclusive();
                else onAddLease();
              }}
              className="w-full py-3.5 rounded-xl text-black text-[12px] font-bold uppercase tracking-widest transition-all hover:opacity-90 active:scale-[0.99] flex items-center justify-center gap-2"
              style={{ background: `linear-gradient(to right, ${accentColor}, #c5a880)` }}
            >
              <ShoppingBag size={14} />
              Add to cart
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Artist Bio Block ───────────────────────────────────────── */

function ArtistBioBlock({ creator, trackCount }: { creator: CreatorProfile | null; trackCount: number }) {
  const [licenseExpanded, setLicenseExpanded] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const bioIsLong = (creator?.bio?.length ?? 0) > 160;
  const hero = sanitizeUrl(creator?.hero_image_url);

  const socialLinks: Array<{ href: string; label: string; icon: React.ReactNode; color: string }> = [];
  if (creator?.instagram_handle) {
    const h = creator.instagram_handle.replace(/^@/, '');
    socialLinks.push({ href: `https://instagram.com/${h}`, label: 'Instagram', color: 'hover:text-[#E1306C]', icon: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    )});
  }
  if (creator?.twitter_handle) {
    const h = creator.twitter_handle.replace(/^@/, '');
    socialLinks.push({ href: `https://x.com/${h}`, label: 'X / Twitter', color: 'hover:text-white', icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.736-8.854L2.5 2.25h6.894l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    )});
  }
  if (creator?.spotify_url) {
    socialLinks.push({ href: creator.spotify_url, label: 'Spotify', color: 'hover:text-[#1DB954]', icon: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    )});
  }
  if (creator?.soundcloud_url) {
    socialLinks.push({ href: creator.soundcloud_url, label: 'SoundCloud', color: 'hover:text-[#FF5500]', icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M1.175 12.225c-.014.095 0 .19 0 .285l1.3 5.48H1.175c-.65 0-1.175-.524-1.175-1.175v-3.62c0-.65.524-1.175 1.175-1.175v.205zm2.6-3.92c-.65 0-1.175.524-1.175 1.175v7.63h1.3V8.48c0-.65-.474-1.175-1.125-1.175zm1.3-.3c-.65 0-1.175.524-1.175 1.175v8.43h1.3V9.18c0-.65-.474-1.155-1.125-1.175zm1.3-1.24c-.65 0-1.175.524-1.175 1.175v9.67h1.3V7.94c0-.65-.474-1.175-1.125-1.175zm1.3.175c-.65 0-1.175.524-1.175 1.175v9.495l1.3-.7V7.115c0-.65-.474-1.175-1.125-1.175zm1.3 0c-.65 0-1.175.524-1.175 1.175v9.67c.27.095.555.175.855.175.38 0 .745-.095 1.065-.27V7.115c0-.65-.474-1.175-1.125-1.175z" />
      </svg>
    )});
  }
  if (creator?.website_url) {
    socialLinks.push({ href: creator.website_url, label: 'Website', color: 'hover:text-[#E8DCC8]', icon: <Globe size={16} /> });
  }
  if (creator?.contact_email) {
    socialLinks.push({ href: `mailto:${creator.contact_email}`, label: creator.contact_email, color: 'hover:text-[#E8DCC8]', icon: <Mail size={15} /> });
  }

  return (
    <div className="relative w-full overflow-hidden">
      {hero ? (
        <img loading="eager" src={hero} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#2A2418] via-[#14110d] to-[#0a0907]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-[#0a0907]" />

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 md:px-8 pt-10 pb-10 md:pt-24 md:pb-16">
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-3">Beat store</p>
        <h1 className="text-3xl md:text-5xl font-medium tracking-tight text-white leading-[1.05] max-w-3xl">
          {creator?.display_name || 'Producer'}
        </h1>
        {creator?.bio && (
          <div className="mt-4">
            <p className={`text-[14px] text-[#E8DCC8]/80 max-w-2xl leading-relaxed transition-all ${
              bioIsLong && !bioExpanded ? 'line-clamp-3' : ''
            }`}>
              {creator.bio}
            </p>
            {bioIsLong && (
              <button
                onClick={() => setBioExpanded((o) => !o)}
                className="mt-1.5 text-[11px] font-mono text-[#6a5d4a] hover:text-[#a08a6a] transition-colors flex items-center gap-1"
              >
                {bioExpanded ? 'Read less' : 'Read more'}
                <ChevronDown size={10} className={`transition-transform ${bioExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        )}
        {trackCount > 0 && (
          <p className="mt-3 text-[11px] font-mono uppercase tracking-wider text-[#5a5142]">
            {trackCount} beat{trackCount === 1 ? '' : 's'} for sale
          </p>
        )}

        {creator?.license_notes && (
          <div className="mt-5 max-w-2xl">
            <button
              onClick={() => setLicenseExpanded((o) => !o)}
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] hover:text-[#a08a6a] transition-colors"
            >
              License Terms
              <ChevronDown size={11} className={`transition-transform ${licenseExpanded ? 'rotate-180' : ''}`} />
            </button>
            {licenseExpanded && (
              <p className="mt-2 text-[11px] font-mono text-[#5a5142] leading-relaxed whitespace-pre-wrap bg-[#14110d]/60 rounded-lg px-3 py-2 border border-[#1f1a13]">
                {creator.license_notes}
              </p>
            )}
          </div>
        )}

        {socialLinks.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {socialLinks.map(({ href, label, icon, color }) => (
              <a
                key={href}
                href={href}
                target={href.startsWith('mailto:') ? undefined : '_blank'}
                rel="noopener noreferrer"
                title={label}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/30 border border-white/10 text-[#a08a6a] ${color} hover:bg-black/50 hover:border-white/20 transition-all text-[11px] font-medium`}
              >
                {icon}
                <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-wider">{label}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Featured playlists strip ───────────────────────────────── */

function FeaturedPlaylistsStrip({
  label = 'Featured Playlists',
  playlists, currentTrack, isPlaying, onPlay, priceFor, onAddToCart,
  detailHrefBase,
  onBuyProject,
}: {
  label?: string;
  playlists: FeaturedPlaylist[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlay: (t: PlaylistTrackItem, playlist: FeaturedPlaylist) => void;
  priceFor: (t: PlaylistTrackItem, type: 'lease' | 'exclusive') => number | null;
  onAddToCart: (t: PlaylistTrackItem, type: 'lease' | 'exclusive') => void;
  /** When set, expanded view shows "Open" link at `${detailHrefBase}/${pl.id}`. */
  detailHrefBase?: string;
  /** Optional handler for buying an entire project (only passed for the Projects strip) */
  onBuyProject?: (proj: FeaturedPlaylist & { price_usd?: number | null }) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-8 pb-2">
      <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#3a3328] mb-4">{label}</p>
      <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
        {playlists.map((pl) => (
          <button
            key={pl.id}
            onClick={() => setExpandedId((id) => (id === pl.id ? null : pl.id))}
            className={`shrink-0 w-[120px] sm:w-[140px] text-left group transition-all ${expandedId === pl.id ? 'opacity-100' : ''}`}
          >
            <div className={`w-full aspect-square rounded-xl bg-[#14110d] border overflow-hidden mb-2 flex items-center justify-center transition-all ${
              expandedId === pl.id ? 'border-[#D4BFA0]/40 shadow-lg shadow-[#D4BFA0]/5' : 'border-[#1f1a13] group-hover:border-[#2d2620]'
            }`}>
              {pl.cover_url
                ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                : <ListMusic size={24} className="text-[#2d2620]" />}
            </div>
            <p className="text-[11px] font-medium text-[#E8DCC8] truncate">{pl.name}</p>
            <p className="text-[9px] font-mono text-[#5a5142] mt-0.5">{pl.tracks?.length ?? 0} tracks</p>
          </button>
        ))}
      </div>

      {expandedId && (() => {
        const pl = playlists.find((p) => p.id === expandedId);
        if (!pl) return null;
        if (!pl.tracks?.length) return (
          <div className="mt-4 rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-8 text-center">
            <ListMusic size={20} className="text-[#2d2620] mx-auto mb-2" />
            <p className="text-[11px] text-[#5a5142]">No tracks in this playlist yet.</p>
          </div>
        );
        return (
          <div className="mt-4 rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a160f]">
              <p className="text-[11px] font-semibold text-[#E8DCC8]">{pl.name}</p>
               <div className="flex items-center gap-2">
                 {detailHrefBase && (
                   <Link
                     href={`${detailHrefBase}/${pl.id}`}
                     className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.08] text-[#a08a6a] text-[9px] font-mono uppercase tracking-widest hover:text-[#E8DCC8] hover:border-white/[0.16] transition-colors"
                   >
                     Open
                     <ChevronRight size={11} />
                   </Link>
                 )}
                 {/* Buy entire project (only for the Projects strip) */}
                 {onBuyProject && (pl as any).price_usd != null && Number((pl as any).price_usd) > 0 && (
                   <button
                     onClick={() => onBuyProject(pl as any)}
                     className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#D4BFA0] text-black text-[9px] font-mono uppercase tracking-widest hover:bg-[#E8D8B8] transition-colors"
                   >
                     <ShoppingBag size={11} />
                     Buy project — ${(pl as any).price_usd}
                   </button>
                 )}
                 {/* Add All — Lease */}
                 {pl.tracks.some((t) => priceFor(t, 'lease') != null) && (
                   <button
                     onClick={() => {
                       let added = 0;
                       pl.tracks.forEach((t) => {
                         const lp = priceFor(t, 'lease');
                         if (lp == null) return;
                         onAddToCart(t, 'lease');
                         added++;
                       });
                       if (added > 0) toast.success(`${added} beat${added !== 1 ? 's' : ''} added to cart`);
                     }}
                     className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#D4BFA0]/30 text-[#D4BFA0] text-[9px] font-mono uppercase tracking-widest hover:bg-[#D4BFA0]/10 transition-colors"
                   >
                     <ShoppingBag size={11} />
                     Add All — Lease
                   </button>
                 )}
                 <button onClick={() => setExpandedId(null)} className="text-[#3a3328] hover:text-[#a08a6a] transition-colors">
                   <X size={13} />
                 </button>
               </div>

            </div>
            <div className="divide-y divide-[#1a160f]">
              {pl.tracks.map((t) => {
                const isCur = currentTrack?.id === t.id;
                const lp = priceFor(t, 'lease');
                const ep = priceFor(t, 'exclusive');
                return (
                  <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-[#16130e] transition-colors ${isCur ? 'bg-[#16130e]' : ''}`}>
                    <button
                      onClick={() => { if (pl) onPlay(t, pl); }}
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        isCur ? 'bg-[#D4BFA0] text-black' : 'bg-white/[0.06] text-[#a08a6a] hover:bg-white/[0.12] hover:text-white'
                      }`}
                    >
                      {isCur && isPlaying
                        ? <Pause size={10} fill="currentColor" />
                        : <Play size={10} fill="currentColor" className="ml-0.5" />}
                    </button>
                    <div className="w-8 h-8 rounded shrink-0 bg-[#0a0907] overflow-hidden">
                      {t.cover_url
                        ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={12} /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] font-medium truncate ${isCur ? 'text-[#D4BFA0]' : 'text-[#E8DCC8]'}`}>{t.title}</p>
                      <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider">
                        {t.type}{t.bpm ? ` · ${t.bpm}` : ''}{t.key ? ` · ${t.key}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {t.free_download_enabled ? (
                        <span className="text-[10px] font-mono text-[#6DC6A4] uppercase tracking-wider">Free</span>
                      ) : (
                        <>
                          {lp != null && (
                            <button onClick={() => onAddToCart(t, 'lease')}
                              className="px-2 py-1 rounded bg-white/[0.06] border border-white/[0.08] text-[#E8DCC8] text-[10px] font-bold hover:bg-white/[0.12] transition-colors">
                              ${lp}
                            </button>
                          )}
                          {ep != null && (
                            <button onClick={() => onAddToCart(t, 'exclusive')}
                              className="px-2 py-1 rounded bg-[#D4BFA0] text-black text-[10px] font-bold hover:bg-[#E8D8B8] transition-colors">
                              ${ep}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ─── Free Download Modal ────────────────────────────────────── */

function FreeDownloadModal({
  track, onClose, accentColor,
}: {
  track: StoreTrack;
  onClose: () => void;
  accentColor: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required.'); return; }
    if (!emailValid) { setError('Enter a valid email address.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/store/free-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, track_id: track.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Trigger download
      const a = document.createElement('a');
      a.href = data.download_url;
      a.download = track.title || 'beat';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Show success state briefly, then close
      setSuccess(true);
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      setError(err.message || 'Download failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative bg-[#14110d] border border-[#1f1a13] rounded-2xl w-full max-w-sm p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-[#3a3328] hover:text-[#a08a6a] transition-colors">
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          {track.cover_url && (
            <img src={track.cover_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
          )}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-1">Free download</p>
            <p className="text-[14px] font-semibold text-[#E8DCC8] truncate max-w-[200px]">{track.title}</p>
          </div>
        </div>

        {success ? (
          <div className="py-8 text-center">
            <CheckCircle2 size={32} className="text-[#6DC6A4] mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-[#E8DCC8] mb-1">Download started!</p>
            <p className="text-[11px] text-[#5a5142]">Check your downloads folder.</p>
          </div>
        ) : (
        <>
        <p className="text-[11px] text-[#6a5d4a] mb-4 leading-relaxed">
          Enter your email to get the download. We'll occasionally send new releases — no spam.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full bg-[#0c0a08] border border-[#1f1a13] rounded-lg px-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] transition-colors"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com *"
            required
            className="w-full bg-[#0c0a08] border border-[#1f1a13] rounded-lg px-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] transition-colors"
          />
          {error && (
            <p className="text-[11px] text-red-400 bg-red-400/5 border border-red-400/20 rounded px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-black font-bold text-[12px] uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ backgroundColor: accentColor }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? 'Preparing…' : 'Download Free'}
          </button>
        </form>
        </>
        )}
      </div>
    </div>
  );
}

/* ─── Contact form ───────────────────────────────────────────── */

function StoreContactForm({ creator, accentColor }: { creator: CreatorProfile | null; accentColor: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));
  const nameErr   = touched.name    && !name.trim()    ? 'Name is required'    : null;
  const emailErr  = touched.email   && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Valid email required' : null;
  const msgErr    = touched.message && !message.trim() ? 'Message is required' : null;
  const canSubmit = !sending && name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && message.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, email: true, message: true });
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !message.trim()) {
      setError('Please fill in all required fields correctly.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/store/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setSent(true);
      setName(''); setEmail(''); setSubject(''); setMessage('');
    } catch (err: any) {
      setError(err.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-[#1a160f]">
      <div className="max-w-xl mx-auto px-4 md:px-10 py-16">
        <div className="text-center mb-8">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#3a3328] mb-2">Get in touch</p>
          <h2 className="text-xl font-medium text-[#E8DCC8]">
            Work with {creator?.display_name || 'the producer'}
          </h2>
          <p className="mt-2 text-[12px] text-[#5a5142]">
            Licensing inquiries, custom beats, features — drop a message.
          </p>
        </div>

        {sent ? (
          <div className="text-center py-10 px-6 rounded-2xl bg-[#14110d] border border-[#1f1a13]">
            <CheckCircle2 size={28} className="text-[#6DC6A4] mx-auto mb-3" />
            <p className="text-[14px] font-medium text-[#E8DCC8] mb-1">Message sent!</p>
            <p className="text-[12px] text-[#5a5142]">You'll hear back soon.</p>
            <button onClick={() => setSent(false)} className="mt-4 text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">
              Send another
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5">
                  Your name <span className="text-[#3a3328]">*</span>
                </label>
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => touch('name')}
                  placeholder="Artist or real name"
                  className={`w-full bg-[#14110d] border rounded-lg px-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none transition-colors ${nameErr ? 'border-red-500/50 focus:border-red-500/70' : 'border-[#1f1a13] focus:border-[#2d2620]'}`}
                />
                {nameErr && <p className="mt-1 text-[10px] text-red-400">{nameErr}</p>}
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5">
                  Email <span className="text-[#3a3328]">*</span>
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => touch('email')}
                  placeholder="your@email.com"
                  className={`w-full bg-[#14110d] border rounded-lg px-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none transition-colors ${emailErr ? 'border-red-500/50 focus:border-red-500/70' : 'border-[#1f1a13] focus:border-[#2d2620]'}`}
                />
                {emailErr && <p className="mt-1 text-[10px] text-red-400">{emailErr}</p>}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5">Subject</label>
              <input
                type="text"
                autoComplete="off"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Beat licensing, custom request, feature…"
                className="w-full bg-[#14110d] border border-[#1f1a13] rounded-lg px-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5">
                Message <span className="text-[#3a3328]">*</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onBlur={() => touch('message')}
                rows={5}
                maxLength={2000}
                placeholder="Tell me about your project or what you're looking for…"
                className={`w-full bg-[#14110d] border rounded-lg px-3 py-2.5 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none transition-colors resize-none leading-relaxed ${msgErr ? 'border-red-500/50 focus:border-red-500/70' : 'border-[#1f1a13] focus:border-[#2d2620]'}`}
              />
              <div className="flex items-center justify-between mt-1">
                {msgErr
                  ? <p className="text-[10px] text-red-400">{msgErr}</p>
                  : <span />}
                <p className="text-right text-[9px] font-mono text-[#3a3328]">{message.length}/2000</p>
              </div>
            </div>
            {error && (
              <p className="text-[11px] text-red-400 bg-red-400/5 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-black font-bold text-[12px] uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-40"
              style={{ backgroundColor: accentColor }}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
