'use client';

import { useEffect, useMemo, useRef, useState, useCallback, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Music, Search, ShoppingCart, Loader2, Play, Pause,
  Globe, X, CheckCircle2, XCircle, Link2, LayoutGrid,
  List, Mail, ChevronDown, Send, ListMusic, Sliders,
  Heart, ExternalLink, SlidersHorizontal, RotateCcw,
  ShoppingBag, Download, ChevronRight, User, Disc3,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { buildHarmonicOrder } from '@/lib/audio/harmonic';
import { MiniWaveform } from '@/components/player/MiniWaveform';
import { useCart } from '@/hooks/useCart';
import { usePlayer } from '@/hooks/usePlayer';
import { toast } from '@/hooks/useToast';
import type { Track } from '@/lib/types';
import { LicenseSelector } from '@/components/store/LicenseSelector';
import type { LicenseTier as LicenseTierImport } from '@/components/store/LicenseSelector';
import { MusicArtwork } from '@/components/store/MusicArtwork';
import { ParticleText } from '@/components/store/ParticleText';
import { StoreListView } from '@/components/store/StoreListView';
import BandcampRemixCard from '@/components/store/BandcampRemixCard';
import { RecommendationsStrip } from '@/components/store/RecommendationsStrip';
import { useWishlist } from '@/hooks/useWishlist';
import { filterAndSortTracks, type StoreTrack as StoreTrackFilter } from '@/lib/store/filters';
import { Sparkles } from 'lucide-react';
import {
  type StoreTrack, type CreatorProfile, type FeaturedPlaylist, type PlaylistTrackItem,
  type TrackTag, type TypeFilter, type ViewMode, type LicenseTier,
  TYPE_FILTERS, FONT_FAMILY_MAP,
} from '@/components/store/types';
import { sanitizeUrl, fmtDur, getSimilarTracks } from '@/components/store/helpers';
import { FreeDownloadModal } from '@/components/store/FreeDownloadModal';
import { StoreContactForm } from '@/components/store/StoreContactForm';
import { ArtistBioBlock } from '@/components/store/ArtistBioBlock';
import { FeaturedPlaylistsStrip } from '@/components/store/FeaturedPlaylistsStrip';
import {
  StoreSidebar, BeatCardSkeleton, BeatListRowSkeleton,
} from '@/components/store/StoreSidebar';
import { DropCountdown } from '@/components/store/DropCountdown';
import { BeatMatchModal } from '@/components/store/BeatMatchModal';
import { logPlay } from '@/lib/buyer-session';
import { TagChips } from '@/components/store/TagChips';
import { BeatCard } from '@/components/store/BeatCard';
import { BeatListRow } from '@/components/store/BeatListRow';
import { BeatPreviewDrawer } from '@/components/store/BeatPreviewDrawer';

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
  const storeQuery = useQuery({
    queryKey: ['store'],
    queryFn: async () => {
      const res = await fetch('/api/store');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawTracks = (data.tracks as StoreTrack[]) ?? [];
      return {
        creator: (data.creator ?? null) as CreatorProfile | null,
        tracks: rawTracks.map((t) => ({
          ...t,
          cover_url: sanitizeUrl(t.cover_url) ?? undefined,
        })),
        licenses: (data.licenses as LicenseTier[]) ?? [],
        featuredPlaylists: (data.featuredPlaylists as FeaturedPlaylist[]) ?? [],
        featuredProjects: (data.featuredProjects as FeaturedPlaylist[]) ?? [],
      };
    },
  });
  const creator = storeQuery.data?.creator ?? null;
  const tracks = useMemo(() => storeQuery.data?.tracks ?? [], [storeQuery.data]);
  const licenses = storeQuery.data?.licenses ?? [];
  const featuredPlaylists = storeQuery.data?.featuredPlaylists ?? [];
  const featuredProjects = storeQuery.data?.featuredProjects ?? [];
  const loading = storeQuery.isLoading;
  useEffect(() => {
    if (storeQuery.isError) toast.error("Couldn't load store");
  }, [storeQuery.isError]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [isSignedIn, setIsSignedIn] = useState(false);
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setIsSignedIn(!!data.user));
  }, []);

  // Sidebar filters
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile toggle
  const [genreFilter, setGenreFilter] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [bpmMin, setBpmMin] = useState(0);   // 0 = sentinel (not yet set)
  const [bpmMax, setBpmMax] = useState(999); // 999 = sentinel (not yet set)
  const [freeOnly, setFreeOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [newThisWeek, setNewThisWeek] = useState(false);
  // Deeper facets — sentinel pattern (0/99999) so we can detect "not yet
  // initialised" vs "user set a real range". Same approach as bpmMin/Max.
  const [moodFilter, setMoodFilter] = useState('');
  const [scaleFilter, setScaleFilter] = useState<'' | 'major' | 'minor'>('');
  const [durationBucket, setDurationBucket] = useState<'' | 'short' | 'medium' | 'long'>('');
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(99999);
  const [sortBy, setSortBy] = useState<'newest' | 'popular' | 'bpm-asc' | 'bpm-desc' | 'price-asc' | 'price-desc' | 'title'>('newest');
  const wishlist = useWishlist();

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

  const { items, addItem, addItems, clearCart, setIsOpen, setBundleRule } = useCart();
  const { currentTrack, isPlaying, setTrack, togglePlay, setQueue, progress } = usePlayer();

  // Feed the producer's automatic bundle discount into the cart store so the
  // drawer can show the "Bundle deal applied" banner (mig 077, Task 7).
  useEffect(() => {
    const threshold = Number((creator as any)?.bundle_discount_threshold ?? 0);
    const percent = Number((creator as any)?.bundle_discount_percent ?? 0);
    setBundleRule(threshold > 0 && percent > 0 ? { threshold, percent } : null);
  }, [creator, setBundleRule]);

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


  // Distinct genres from track tags
  const availableGenres = useMemo(() => {
    const genres = new Set<string>();
    tracks.forEach((t) => {
      (t.tags ?? []).filter((tag) => tag.category === 'genre').forEach((tag) => genres.add(tag.tag));
    });
    return Array.from(genres).sort();
  }, [tracks]);

  const availableMoods = useMemo(() => {
    const moods = new Set<string>();
    tracks.forEach((t) => {
      (t.tags ?? []).filter((tag) => tag.category === 'mood').forEach((tag) => moods.add(tag.tag));
    });
    return Array.from(moods).sort();
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

  // Price range — derived from resolved lease prices (track override → profile default).
  const priceRange = useMemo(() => {
    const prices = tracks
      .map((t) => {
        const override = t.lease_price_usd;
        const dflt = creator?.license_lease_price_usd;
        const p = override != null && Number(override) > 0
          ? Number(override)
          : dflt != null && Number(dflt) > 0 ? Number(dflt) : null;
        return p;
      })
      .filter((p): p is number => p != null);
    if (!prices.length) return { min: 0, max: 200 };
    return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) };
  }, [tracks, creator?.license_lease_price_usd]);

  useEffect(() => {
    if (tracks.length > 0 && priceMin === 0 && priceMax === 99999) {
      setPriceMin(priceRange.min);
      setPriceMax(priceRange.max);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length]);

  const effectivePriceMin = priceMin === 0 ? priceRange.min : priceMin;
  const effectivePriceMax = priceMax === 99999 ? priceRange.max : priceMax;
  const priceRangeActive = effectivePriceMin > priceRange.min || effectivePriceMax < priceRange.max;

  const hasActiveFilters =
    genreFilter !== '' || moodFilter !== '' || keyFilter !== '' || scaleFilter !== '' ||
    freeOnly || favoritesOnly || newThisWeek || durationBucket !== '' ||
    priceRangeActive ||
    effectiveBpmMin > bpmRange.min || effectiveBpmMax < bpmRange.max;

  const resetFilters = () => {
    setGenreFilter('');
    setMoodFilter('');
    setKeyFilter('');
    setScaleFilter('');
    setBpmMin(bpmRange.min);
    setBpmMax(bpmRange.max);
    setPriceMin(priceRange.min);
    setPriceMax(priceRange.max);
    setFreeOnly(false);
    setFavoritesOnly(false);
    setNewThisWeek(false);
    setDurationBucket('');
    setSearch('');
    setDebouncedSearch('');
    setTypeFilter('all');
  };

  // Filter + sort delegated to the pure helper in @/lib/store/filters so
  // the logic is covered by Vitest (lib/store/filters.test.ts) and future
  // refactors can't silently wipe sidebar features the way two parallel
  // AIs did in earlier rounds.
  const filtered = useMemo(() => filterAndSortTracks(tracks as StoreTrackFilter[], {
    searchQuery: debouncedSearch,
    typeFilter,
    freeOnly,
    favoritesOnly,
    newThisWeek,
    priceRangeActive,
    priceMin: effectivePriceMin,
    priceMax: effectivePriceMax,
    bpmMin: effectiveBpmMin,
    bpmMax: effectiveBpmMax,
    keyFilter,
    scaleFilter,
    durationBucket,
    genreFilter,
    moodFilter,
    sortBy,
    favoriteIds: wishlist.ids,
    defaultLeasePrice: creator?.license_lease_price_usd,
  }) as StoreTrack[], [
    tracks, debouncedSearch, typeFilter, freeOnly, favoritesOnly, newThisWeek,
    priceRangeActive, effectivePriceMin, effectivePriceMax,
    effectiveBpmMin, effectiveBpmMax, keyFilter, scaleFilter, durationBucket,
    genreFilter, moodFilter, sortBy, creator?.license_lease_price_usd, wishlist.ids,
  ]);

  // Retention strips at the bottom of the page. "More from this producer"
  // excludes anything visible in the current filtered set so the picks
  // genuinely add to what the visitor is already seeing. "You might also
  // like" pivots off the genre tags of whichever track the visitor most
  // recently played or previewed (falls back to recent if no engagement).
  const moreFromProducer = useMemo(() => {
    const visible = new Set(filtered.map((t) => t.id));
    const pool = tracks.filter((t) => !visible.has(t.id));
    return pool.sort(() => Math.random() - 0.5).slice(0, 12);
  }, [tracks, filtered]);

  // Producer-curated picks — uses tracks.store_featured (migration 054).
  // Falls back to nothing when the producer hasn't picked anything yet.
  const producerPicks = useMemo(() => {
    return tracks.filter((t) => (t as any).store_featured === true).slice(0, 12);
  }, [tracks]);

  // DJ Mode — order the visible catalogue into a continuous harmonic mix and play it.
  const [djActive, setDjActive] = useState(false);
  const handleDjMode = () => {
    const playable = (filtered as Track[]).filter((t) => t.audio_url);
    if (playable.length === 0) return;
    const mix = buildHarmonicOrder(playable as any) as unknown as Track[];
    setQueue(mix);
    setTrack(mix[0]);
    setDjActive(true);
    toast.success('DJ Mode', `Continuous key-matched mix · ${mix.length} beats`);
    void fetch('/api/store/play', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_id: mix[0].id, source: 'dj-mode' }),
    }).catch(() => undefined);
  };

  const handlePlay = (t: StoreTrack) => {
    setDjActive(false);
    if (currentTrack?.id === t.id) { togglePlay(); return; }
    setQueue(filtered as Track[]);
    setTrack(t as Track);
    // Fire-and-forget store-play telemetry. /api/store/play is rate-limited
    // server-side (60s window per ipHash+track), 200s on failure so a bad
    // network never breaks the listening UX.
    void fetch('/api/store/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: t.id,
        source: viewMode === 'grid' ? 'store-grid' : 'store-list',
      }),
    }).catch(() => undefined);
    // If the buyer has a magic-link token on this device, also log to
    // their personal listening history (mig 060). No-op when anonymous.
    void logPlay(t.id);
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

  const addAllToCart = (trackList: PlaylistTrackItem[], type: 'lease' | 'exclusive') => {
    const pairs: Array<{ track: Track; license: import('@/hooks/useCart').CartLicense }> = [];
    for (const t of trackList) {
      const price = priceFor(t as unknown as StoreTrack, type);
      if (price == null) continue;
      pairs.push({
        track: { ...t, user_id: '', stems_status: 'none', created_at: '' } as Track,
        license: {
          id: `${type}-${t.id}`,
          name: type === 'lease' ? 'Lease' : 'Exclusive',
          price_usd: price,
          file_types: type === 'lease' ? ['MP3'] : ['WAV', 'MP3', 'STEMS'],
          is_exclusive: type === 'exclusive',
        },
      });
    }
    if (pairs.length === 0) { toast.error(`No ${type} price set for any track`); return; }
    addItems(pairs);
    toast.success(`${pairs.length} beat${pairs.length !== 1 ? 's' : ''} added to cart`);
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
  const textColor = creator?.text_color_primary || '#E8DCC8';
  const fontFamily = FONT_FAMILY_MAP[creator?.font_style ?? 'default'] ?? FONT_FAMILY_MAP.default;

  return (
    <div
      className="min-h-screen bg-[#0a0907]"
      style={{
        '--store-accent': accentColor,
        '--store-text': textColor,
        fontFamily,
        color: textColor,
      } as React.CSSProperties}
    >
      {/* ── Purchase return banner ─────────────────────────────── */}
      {bannerOpen && (
        <div className={`sticky top-0 z-50 px-4 md:px-12 py-3 border-b ${purchaseStatus === 'success'
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
      <ArtistBioBlock creator={creator} trackCount={tracks.length} accentColor={accentColor} />

      {/* ── Next-drop countdown (only renders when there's an
          upcoming scheduled_publish_at on a draft track) ──────── */}
      <DropCountdown accentColor={accentColor} />

      {/* ── Featured playlists + projects ────────────────────── */}
      {(featuredPlaylists.length > 0 || featuredProjects.length > 0) && (
        <div>
          {featuredPlaylists.length > 0 && (
            <FeaturedPlaylistsStrip
              label="Featured Playlists"
              playlists={featuredPlaylists}
              detailHrefBase="/store/playlists"
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
              onAddAllToCart={addAllToCart}
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
              onAddAllToCart={addAllToCart}
              onBuyProject={handleBuyProject}
            />

          )}
        </div>
      )}

      {/* ── Toolbar — sticky glass header, matches /store body width.
          The accent gradient over a #14110d tint gives the bar the
          same depth as the page cards underneath. */}
      <div className="sticky top-0 z-30 bg-[#0a0907]/85 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-3 flex items-center gap-3">
          {/* Mobile filters toggle */}
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className={`lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-full border text-[10px] font-mono uppercase tracking-wider transition-colors ${sidebarOpen || hasActiveFilters
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

          {/* Sub-type filters */}
          <div className="hidden md:flex items-center gap-1">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setTypeFilter(f)}
                  className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider rounded-full transition-colors whitespace-nowrap ${typeFilter === f ? 'text-[#E8DCC8] border border-[#D4BFA0]/40 bg-[#D4BFA0]/10' : 'bg-transparent text-[#4a4338] hover:text-[#a08a6a]'
                    }`}
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

          {/* DJ Mode — continuous harmonic-compatible mix of the catalogue */}
          <button
            onClick={handleDjMode}
            title="Play a continuous, key-matched mix"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-mono uppercase tracking-wider transition-colors"
            style={djActive
              ? { backgroundColor: accentColor, color: '#0a0907', borderColor: accentColor }
              : { borderColor: '#1f1a13', color: '#6a5d4a' }}
          >
            <Disc3 size={11} className={djActive ? 'animate-[spin_3s_linear_infinite]' : ''} />
            DJ Mode
          </button>

          {/* AI Beat Match — drop a vocal, get matching beats */}
          <div className="hidden md:block">
            <BeatMatchModal accentColor={accentColor} />
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

          {/* My Account */}
          <Link
            href="/store/account/me"
            title={isSignedIn ? 'My Account' : 'Sign in'}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-full border border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620] transition-colors"
          >
            <User size={13} fill={isSignedIn ? 'currentColor' : 'none'} />
            <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-wider">
              {isSignedIn ? 'Account' : 'Sign in'}
            </span>
          </Link>

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

      {/* ── Main layout: sidebar + beat listing ──────────────────
          1600px max — wider than the previous 1400 so list-view rows
          breathe and the grid can comfortably fit 4 columns on
          standard laptops. Sidebar stays sticky on the left. */}
      <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-8 flex gap-6 items-start">

        {/* Left sidebar — sticky, visible on lg+ */}
        <StoreSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          totalResults={filtered.length}
          genreFilter={genreFilter}
          setGenreFilter={setGenreFilter}
          moodFilter={moodFilter}
          setMoodFilter={setMoodFilter}
          keyFilter={keyFilter}
          setKeyFilter={setKeyFilter}
          scaleFilter={scaleFilter}
          setScaleFilter={setScaleFilter}
          bpmMin={bpmMin}
          setBpmMin={setBpmMin}
          bpmMax={bpmMax}
          setBpmMax={setBpmMax}
          bpmRange={bpmRange}
          priceMin={priceMin}
          setPriceMin={setPriceMin}
          priceMax={priceMax}
          setPriceMax={setPriceMax}
          priceRange={priceRange}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          freeOnly={freeOnly}
          setFreeOnly={setFreeOnly}
          favoritesOnly={favoritesOnly}
          setFavoritesOnly={setFavoritesOnly}
          favoritesCount={wishlist.count}
          newThisWeek={newThisWeek}
          setNewThisWeek={setNewThisWeek}
          durationBucket={durationBucket}
          setDurationBucket={setDurationBucket}
          sortBy={sortBy}
          setSortBy={setSortBy}
          hasActiveFilters={hasActiveFilters}
          onReset={resetFilters}
          availableGenres={availableGenres}
          availableMoods={availableMoods}
          availableKeys={availableKeys}
          accentColor={accentColor}
        />

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {loading ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((t) =>
                // Remix tracks get the Bandcamp release-card layout to
                // stand out in the mixed grid; regular beats keep BeatCard.
                t.type === 'remix' ? (
                  <BandcampRemixCard
                    key={t.id}
                    track={t as unknown as Track}
                    creatorName={creator?.display_name ?? null}
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
                    isWishlisted={wishlist.has(t.id)}
                    onToggleWishlist={() => wishlist.toggle(t.id)}
                  />
                ) : (
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
                    isWishlisted={wishlist.has(t.id)}
                    onToggleWishlist={() => wishlist.toggle(t.id)}
                  />
                ),
              )}
            </div>
          ) : (
            // List view — Apple-UI rows on a glass shell with the
            // hovered row's cover fading in as a blurred backdrop
            // (carryover from the deprecated MusicPortfolio embedded
            // mode the user asked us to replace).
            <StoreListView
              tracks={filtered}
              accentColor={accentColor}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={isPlaying}
              isPreviewId={previewTrack?.id ?? null}
              priceFor={priceFor}
              onPlay={(t) => handlePlay(t)}
              onPreview={(t) => setPreviewTrack(previewTrack?.id === t.id ? null : t)}
              onAddLease={(t) => addToCart(t, 'lease')}
              onAddExclusive={(t) => addToCart(t, 'exclusive')}
              onFreeDownload={(t) => setFreeDownloadTrack(t)}
              isWishlisted={(id) => wishlist.has(id)}
              onToggleWishlist={(id) => wishlist.toggle(id)}
            />
          )}
        </div>
      </div>

      {/* ── Retention strips ─────────────────────────────────────── */}
      {producerPicks.length > 0 && (
        <RecommendationsStrip
          label="Producer's Picks"
          tracks={producerPicks}
          accentColor={accentColor}
          currentTrackId={currentTrack?.id ?? null}
          isPlaying={isPlaying}
          priceFor={(t, k) => priceFor(t, k)}
          onPlay={(t) => handlePlay(t)}
          onPreview={(t) => setPreviewTrack(previewTrack?.id === t.id ? null : t)}
        />
      )}
      <RecommendationsStrip
        label="More from this producer"
        tracks={moreFromProducer}
        accentColor={accentColor}
        currentTrackId={currentTrack?.id ?? null}
        isPlaying={isPlaying}
        priceFor={(t, k) => priceFor(t, k)}
        onPlay={(t) => handlePlay(t)}
        onPreview={(t) => setPreviewTrack(previewTrack?.id === t.id ? null : t)}
      />

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


