'use client';

import { useEffect, useMemo, useRef, useState, useCallback, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Music, Search, ShoppingCart,
  X, CheckCircle2, XCircle, Link2, LayoutGrid,
  List, SlidersHorizontal, Disc3, ShieldCheck,
  CreditCard, Download, BadgeCheck, Sparkles, ArrowRight,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { buildHarmonicOrder } from '@/lib/audio/harmonic';
import { useCart } from '@/hooks/useCart';
import { usePlayer } from '@/hooks/usePlayer';
import { toast } from '@/hooks/useToast';
import type { Track } from '@/lib/types';
import { StoreListView } from '@/components/store/StoreListView';
import BandcampRemixCard from '@/components/store/BandcampRemixCard';
import { RecommendationsStrip } from '@/components/store/RecommendationsStrip';
import { useWishlist } from '@/hooks/useWishlist';
import { filterAndSortTracks, type StoreTrack as StoreTrackFilter } from '@/lib/store/filters';
import {
  type StoreTrack, type CreatorProfile, type FeaturedPlaylist, type PlaylistTrackItem,
  type TypeFilter, type ViewMode, type LicenseTier,
  TYPE_FILTERS, FONT_FAMILY_MAP,
} from '@/components/store/types';
import { sanitizeUrl } from '@/components/store/helpers';
import { normalizeThemeColor } from '@/lib/theme/colors';
import { FreeDownloadModal } from '@/components/store/FreeDownloadModal';
import { StoreContactForm } from '@/components/store/StoreContactForm';
import { ArtistBioBlock } from '@/components/store/ArtistBioBlock';
import { FeaturedPlaylistsStrip } from '@/components/store/FeaturedPlaylistsStrip';
import {
  StoreSidebar, BeatCardSkeleton, BeatListRowSkeleton,
} from '@/components/store/StoreSidebar';
import { DropCountdown } from '@/components/store/DropCountdown';
import { logPlay } from '@/lib/buyer-session';
import { BeatCard } from '@/components/store/BeatCard';
import { BeatPreviewDrawer } from '@/components/store/BeatPreviewDrawer';

/* ─── Suspense wrapper ───────────────────────────────────────── */

export default function StorePageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#090907]" />}>
      <StorePage />
    </Suspense>
  );
}

function stableDailyScore(id: string, salt: number) {
  let hash = salt || 5381;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `$${Number(value).toLocaleString()}`;
}

const STORE_PAGE_SIZE = 80;

type StorePageInfo = {
  hasMore: boolean;
  nextCursor: string | null;
};

type StoreFacets = {
  total: number;
  genres: string[];
  moods: string[];
  keys: string[];
  bpmRange: { min: number; max: number };
  priceRange: { min: number; max: number };
};

function normalizeStoreTracks(rawTracks: StoreTrack[]) {
  return rawTracks.map((t) => ({
    ...t,
    cover_url: sanitizeUrl(t.cover_url) ?? undefined,
  }));
}

function StoreTrustRail({ accentColor }: { accentColor: string }) {
  const items = [
    { icon: ShieldCheck, label: 'Protected checkout', detail: 'Stripe payment' },
    { icon: Download, label: 'Instant delivery', detail: 'Private links' },
    { icon: BadgeCheck, label: 'License included', detail: 'Usage rights' },
    { icon: CreditCard, label: 'No account needed', detail: 'Email receipt' },
  ];

  return (
    <section className="mx-auto mt-8 max-w-[1400px] px-4 md:px-8">
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/[0.06] bg-[#14110D]/70 p-2 sm:grid-cols-4">
        {items.map(({ icon: Icon, label, detail }) => (
          <div key={label} className="flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2.5">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full border"
              style={{ borderColor: `${accentColor}33`, color: accentColor, backgroundColor: `${accentColor}10` }}
            >
              <Icon size={13} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-[#F7EBDD]">{label}</span>
              <span className="block truncate text-[9px] font-mono uppercase tracking-[0.16em] text-[#837B6D]">{detail}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function StoreSalesSpotlight({
  track,
  project,
  accentColor,
  currentTrackId,
  isPlaying,
  licenseCount,
  lowestLicensePrice,
  priceFor,
  onPlay,
  onPreview,
  onBuyProject,
}: {
  track: StoreTrack | null;
  project: FeaturedPlaylist | null;
  accentColor: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  licenseCount: number;
  lowestLicensePrice: number | null;
  priceFor: (t: StoreTrack, kind: 'lease' | 'exclusive') => number | null;
  onPlay: (t: StoreTrack) => void;
  onPreview: (t: StoreTrack) => void;
  onBuyProject: (p: FeaturedPlaylist) => void;
}) {
  if (!track && !project) return null;

  const isCurrent = !!track && currentTrackId === track.id;
  const trackPrice = track
    ? licenseCount > 0
      ? lowestLicensePrice
      : priceFor(track, 'lease') ?? priceFor(track, 'exclusive')
    : null;
  const projectCover = project?.cover_url ?? project?.tracks?.find((item) => item.cover_url)?.cover_url ?? null;
  const projectPrice = project?.price_usd != null ? Number(project.price_usd) : null;

  return (
    <section className="mx-auto mt-6 max-w-[1400px] px-4 md:px-8">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.48fr)]">
        {track && (
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#14110D]/80 p-3">
            {track.cover_url && (
              <img
                src={track.cover_url}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover opacity-15 blur-2xl scale-110"
              />
            )}
            <div className="relative grid gap-3 sm:grid-cols-[104px_minmax(0,1fr)] sm:items-center">
              <button
                type="button"
                onClick={() => onPreview(track)}
                className="group relative aspect-square overflow-hidden rounded-xl bg-[#090907] text-left"
              >
                {track.cover_url ? (
                  <img src={track.cover_url} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-[#171511] text-[#6E685B]">
                    <Music size={28} />
                  </div>
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              </button>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.18em] text-[#9B9282]">
                    <Sparkles size={10} style={{ color: accentColor }} />
                    Daily pick
                  </span>
                  {trackPrice != null && (
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.18em] text-[#D0C3AF]">
                      from {money(trackPrice)}
                    </span>
                  )}
                </div>
                <h2 className="truncate text-[18px] font-bold leading-tight text-[#F7EBDD] sm:text-[24px]">
                  {track.title}
                </h2>
                <p className="mt-1.5 max-w-xl truncate text-[10px] font-mono uppercase tracking-[0.16em] text-[#837B6D]">
                  {[track.type, track.bpm ? `${track.bpm} BPM` : null, track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPlay(track)}
                    className="tap inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 text-[10px] font-bold uppercase tracking-wider text-black transition-opacity hover:opacity-90"
                    style={{ backgroundColor: accentColor }}
                  >
                    <Disc3 size={13} className={isCurrent && isPlaying ? 'animate-[spin_3s_linear_infinite]' : ''} />
                    {isCurrent && isPlaying ? 'Playing' : 'Play'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreview(track)}
                    className="tap inline-flex min-h-10 items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-3.5 text-[10px] font-mono uppercase tracking-wider text-[#D0C3AF] transition-colors hover:border-white/[0.18] hover:text-[#F7EBDD]"
                  >
                    {licenseCount > 0 ? 'Choose license' : 'Open beat'}
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {project && (
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#14110D]/80 p-3">
            <div className="flex h-full gap-3">
              <Link href={`/store/projects/${project.id}`} className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[#090907] sm:size-24">
                {projectCover ? (
                  <img src={projectCover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-[#6E685B]">
                    <Music size={22} />
                  </div>
                )}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#837B6D]">Bundle</p>
                <Link href={`/store/projects/${project.id}`} className="mt-1 line-clamp-2 text-[18px] font-bold leading-tight text-[#F7EBDD] hover:text-[#D0C3AF]">
                  {project.name}
                </Link>
                <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.16em] text-[#837B6D]">
                  {project.tracks?.length ?? 0} tracks{projectPrice != null && projectPrice > 0 ? ` · ${money(projectPrice)}` : ''}
                </p>
                <button
                  type="button"
                  onClick={() => onBuyProject(project)}
                  disabled={projectPrice == null || projectPrice <= 0}
                  className="tap mt-auto inline-flex min-h-9 items-center justify-center gap-2 rounded-full px-3 text-[9px] font-bold uppercase tracking-wider text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: accentColor }}
                >
                  <ShoppingCart size={12} />
                  Buy bundle
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── Main page ──────────────────────────────────────────────── */

function StorePage() {
  const [loadedMoreTracks, setLoadedMoreTracks] = useState<StoreTrack[]>([]);
  const [pageInfo, setPageInfo] = useState<StorePageInfo>({ hasMore: false, nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // List (track rows) is the marketplace default; an explicit grid choice
  // sticks via localStorage. Hydrated in an effect so SSR HTML stays stable.
  const [viewMode, setViewMode] = useState<ViewMode>('list');

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

  const serverStoreQuery = useMemo(() => {
    const params = new URLSearchParams({ limit: String(STORE_PAGE_SIZE) });
    const q = debouncedSearch.trim();
    if (q) params.set('q', q);
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (genreFilter) params.set('genre', genreFilter);
    if (moodFilter) params.set('mood', moodFilter);
    if (keyFilter) params.set('key', keyFilter);
    if (scaleFilter) params.set('scale', scaleFilter);
    if (durationBucket) params.set('duration', durationBucket);
    if (freeOnly) params.set('free', '1');
    if (newThisWeek) params.set('new', '1');
    if (sortBy !== 'newest') params.set('sort', sortBy);
    return params.toString();
  }, [
    debouncedSearch,
    durationBucket,
    freeOnly,
    genreFilter,
    keyFilter,
    moodFilter,
    newThisWeek,
    scaleFilter,
    sortBy,
    typeFilter,
  ]);

  const storeQuery = useQuery({
    queryKey: ['store', 'paged', serverStoreQuery],
    queryFn: async () => {
      const res = await fetch(`/api/store?${serverStoreQuery}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawTracks = (data.tracks as StoreTrack[]) ?? [];
      return {
        creator: (data.creator ?? null) as CreatorProfile | null,
        tracks: normalizeStoreTracks(rawTracks),
        licenses: (data.licenses as LicenseTier[]) ?? [],
        featuredPlaylists: (data.featuredPlaylists as FeaturedPlaylist[]) ?? [],
        featuredProjects: (data.featuredProjects as FeaturedPlaylist[]) ?? [],
        pageInfo: (data.pageInfo ?? { hasMore: false, nextCursor: null }) as StorePageInfo,
      };
    },
  });
  const facetsQuery = useQuery({
    queryKey: ['store-facets'],
    queryFn: async () => {
      const res = await fetch('/api/store/facets');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as StoreFacets;
    },
  });
  const creator = storeQuery.data?.creator ?? null;
  useEffect(() => {
    setLoadedMoreTracks([]);
    setPageInfo(storeQuery.data?.pageInfo ?? { hasMore: false, nextCursor: null });
  }, [storeQuery.data?.pageInfo]);
  const initialTracks = useMemo(() => storeQuery.data?.tracks ?? [], [storeQuery.data?.tracks]);
  const tracks = useMemo(() => {
    const seen = new Set<string>();
    const merged: StoreTrack[] = [];
    for (const track of [...initialTracks, ...loadedMoreTracks]) {
      if (!track?.id || seen.has(track.id)) continue;
      seen.add(track.id);
      merged.push(track);
    }
    return merged;
  }, [initialTracks, loadedMoreTracks]);
  const licenses = useMemo(() => storeQuery.data?.licenses ?? [], [storeQuery.data?.licenses]);
  const featuredPlaylists = useMemo(() => storeQuery.data?.featuredPlaylists ?? [], [storeQuery.data?.featuredPlaylists]);
  const featuredProjects = useMemo(() => storeQuery.data?.featuredProjects ?? [], [storeQuery.data?.featuredProjects]);
  const loading = storeQuery.isLoading;
  const rotationSeed = useMemo(() => Math.floor(Date.now() / 86_400_000), []);
  useEffect(() => {
    if (storeQuery.isError) toast.error("Couldn't load store");
  }, [storeQuery.isError]);
  useEffect(() => {
    if (facetsQuery.isError) toast.error("Couldn't load store filters");
  }, [facetsQuery.isError]);

  const loadMoreTracks = useCallback(async () => {
    if (!pageInfo.hasMore || !pageInfo.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(serverStoreQuery);
      params.set('cursor', pageInfo.nextCursor);
      const res = await fetch(`/api/store?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLoadedMoreTracks((current) => [
        ...current,
        ...normalizeStoreTracks((data.tracks as StoreTrack[]) ?? []),
      ]);
      setPageInfo((data.pageInfo ?? { hasMore: false, nextCursor: null }) as StorePageInfo);
    } catch {
      toast.error("Couldn't load more beats");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, pageInfo.hasMore, pageInfo.nextCursor, serverStoreQuery]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('store-view-mode');
      if (stored === 'grid' || stored === 'list') setViewMode(stored);
    } catch { /* private mode */ }
  }, []);
  const changeViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try { localStorage.setItem('store-view-mode', mode); } catch { /* private mode */ }
  }, []);
  const [isSignedIn, setIsSignedIn] = useState(false);
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setIsSignedIn(!!data.user));
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
    const threshold = Number(creator?.bundle_discount_threshold ?? 0);
    const percent = Number(creator?.bundle_discount_percent ?? 0);
    setBundleRule(threshold > 0 && percent > 0 ? { threshold, percent } : null);
  }, [creator, setBundleRule]);

  const searchParams = useSearchParams();
  const router = useRouter();

  const handleBuyProject = (proj: FeaturedPlaylist) => {
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
    if (facetsQuery.data?.genres?.length) return facetsQuery.data.genres;
    const genres = new Set<string>();
    tracks.forEach((t) => {
      (t.tags ?? []).filter((tag) => tag.category === 'genre').forEach((tag) => genres.add(tag.tag));
    });
    return Array.from(genres).sort();
  }, [facetsQuery.data?.genres, tracks]);

  const availableMoods = useMemo(() => {
    if (facetsQuery.data?.moods?.length) return facetsQuery.data.moods;
    const moods = new Set<string>();
    tracks.forEach((t) => {
      (t.tags ?? []).filter((tag) => tag.category === 'mood').forEach((tag) => moods.add(tag.tag));
    });
    return Array.from(moods).sort();
  }, [facetsQuery.data?.moods, tracks]);

  const availableKeys = useMemo(() => {
    if (facetsQuery.data?.keys?.length) return facetsQuery.data.keys;
    const keys = new Set(tracks.map((t) => t.key).filter(Boolean) as string[]);
    return Array.from(keys).sort();
  }, [facetsQuery.data?.keys, tracks]);

  const bpmRange = useMemo(() => {
    if (facetsQuery.data?.bpmRange) return facetsQuery.data.bpmRange;
    const bpms = tracks.map((t) => t.bpm).filter(Boolean) as number[];
    if (!bpms.length) return { min: 60, max: 200 };
    return { min: Math.min(...bpms), max: Math.max(...bpms) };
  }, [facetsQuery.data?.bpmRange, tracks]);

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
    if (facetsQuery.data?.priceRange) return facetsQuery.data.priceRange;
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
  }, [facetsQuery.data?.priceRange, tracks, creator?.license_lease_price_usd]);

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
    debouncedSearch.trim() !== '' ||
    typeFilter !== 'all' ||
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
    return pool
      .map((track, index) => ({ track, score: stableDailyScore(track.id, rotationSeed + index) }))
      .sort((a, b) => a.score - b.score)
      .map(({ track }) => track)
      .slice(0, 12);
  }, [tracks, filtered, rotationSeed]);

  // Producer-curated picks — uses tracks.store_featured (migration 054).
  // Falls back to nothing when the producer hasn't picked anything yet.
  const producerPicks = useMemo(() => {
    return tracks.filter((t) => t.store_featured === true).slice(0, 12);
  }, [tracks]);

  const lowestLicensePrice = useMemo(() => {
    const activePrices = licenses
      .map((license) => Number(license.price_usd ?? 0))
      .filter((price) => Number.isFinite(price) && price > 0);
    return activePrices.length ? Math.min(...activePrices) : null;
  }, [licenses]);

  const spotlightTrack = useMemo(() => {
    const pool = producerPicks.length > 0 ? producerPicks : tracks;
    if (pool.length === 0) return null;
    return pool[rotationSeed % pool.length] ?? null;
  }, [producerPicks, tracks, rotationSeed]);

  const spotlightProject = useMemo(() => {
    if (featuredProjects.length === 0) return null;
    return featuredProjects[(rotationSeed + 1) % featuredProjects.length] ?? null;
  }, [featuredProjects, rotationSeed]);

  // DJ Mode — order the visible catalogue into a continuous harmonic mix and play it.
  const [djActive, setDjActive] = useState(false);
  const handleDjMode = () => {
    const playable = filtered.filter((t) => t.audio_url);
    if (playable.length === 0) return;
    const mix = buildHarmonicOrder(playable);
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
    setQueue(filtered);
    setTrack(t);
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

  const addLicenseToCart = (t: StoreTrack, license: LicenseTier) => {
    addItem(t as Track, {
      id: license.id,
      name: license.name,
      price_usd: Number(license.price_usd ?? 0),
      file_types: license.file_types?.length ? license.file_types : ['MP3'],
      is_exclusive: !!license.is_exclusive,
    });
    toast.success(`Added: ${t.title} (${license.name})`);
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

  const accentColor = normalizeThemeColor(creator?.accent_color);
  const textColor = creator?.text_color_primary || '#F7EBDD';
  const fontFamily = FONT_FAMILY_MAP[creator?.font_style ?? 'default'] ?? FONT_FAMILY_MAP.default;

  return (
    <div
      className="store-ui min-h-screen bg-[#090907] pb-28"
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
      <ArtistBioBlock creator={creator} accentColor={accentColor} />

      {/* ── Next-drop countdown (only renders when there's an
          upcoming scheduled_publish_at on a draft track) ──────── */}
      <DropCountdown accentColor={accentColor} />

      {/* ── Featured projects (first) + playlists ──────────────── */}
      {(featuredProjects.length > 0 || featuredPlaylists.length > 0) && (
        <div>
          {/* Projects — album-style larger cards, direct navigation */}
          {featuredProjects.length > 0 && (
            <FeaturedPlaylistsStrip
              label="Projects"
              playlists={featuredProjects}
              detailHrefBase="/store/projects"
              projectMode
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
          {/* Playlists — compact thumbnail strip below projects */}
          {featuredPlaylists.length > 0 && (
            <FeaturedPlaylistsStrip
              label="Playlists"
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
        </div>
      )}

      <StoreSalesSpotlight
        track={spotlightTrack}
        project={spotlightProject}
        accentColor={accentColor}
        currentTrackId={currentTrack?.id ?? null}
        isPlaying={isPlaying}
        licenseCount={licenses.length}
        lowestLicensePrice={lowestLicensePrice}
        priceFor={priceFor}
        onPlay={handlePlay}
        onPreview={(t) => setPreviewTrack(t)}
        onBuyProject={handleBuyProject}
      />

      {producerPicks.length > 0 && (
        <RecommendationsStrip
          label="Producer's Picks"
          tracks={producerPicks}
          accentColor={accentColor}
          currentTrackId={currentTrack?.id ?? null}
          isPlaying={isPlaying}
          compact
          priceFor={(t, k) => priceFor(t, k)}
          onPlay={(t) => handlePlay(t)}
          onPreview={(t) => setPreviewTrack(previewTrack?.id === t.id ? null : t)}
        />
      )}

      {/* ── Toolbar — sticky glass header ──────────────────────── */}
      <div className="sticky top-0 z-30" style={{ backdropFilter: 'blur(24px)', background: 'rgba(10,9,7,0.88)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-2.5 flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
          {/* Mobile filters toggle */}
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className={`tap lg:hidden flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors ${sidebarOpen || hasActiveFilters
                ? 'border-[#E7D7BE]/40 text-[#E7D7BE] bg-[#E7D7BE]/5'
                : 'border-[#2B2821] text-[#B4AA99] hover:text-[#F7EBDD]'
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
          <div className="relative order-2 min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1 sm:min-w-[160px] sm:max-w-sm">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B4AA99]" />
            <input
              type="text"
              aria-label="Search beats"
              placeholder="Search title, key, BPM, tag…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full min-h-11 bg-[#171511] border border-[#2B2821] rounded-full py-2 pl-8 pr-3 text-[12px] text-[#F7EBDD] placeholder:text-[#B4AA99] focus:outline-none focus:border-[#3B372F]"
            />
          </div>

          {/* Sub-type filters */}
          <div className="hidden md:flex items-center gap-1">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setTypeFilter(f)}
                  className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider rounded-full transition-colors whitespace-nowrap ${typeFilter === f ? 'text-[#F7EBDD] border border-[#E7D7BE]/40 bg-[#E7D7BE]/10' : 'bg-transparent text-[#837B6D] hover:text-[#D0C3AF]'
                    }`}
                >
                  {f}
                </button>
              ))}
            </div>

          <div className="hidden flex-1 sm:block" />

          {/* Grid / List toggle */}
          <div className="flex items-center gap-0.5 bg-[#171511] border border-[#2B2821] rounded-md p-0.5">
            <button
              onClick={() => changeViewMode('grid')}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
              className={`tap grid size-11 place-items-center rounded transition-colors ${viewMode === 'grid' ? 'bg-[#3B372F] text-[#F7EBDD]' : 'text-[#9B9282] hover:text-[#D0C3AF]'}`}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              onClick={() => changeViewMode('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              className={`tap grid size-11 place-items-center rounded transition-colors ${viewMode === 'list' ? 'bg-[#3B372F] text-[#F7EBDD]' : 'text-[#9B9282] hover:text-[#D0C3AF]'}`}
            >
              <List size={13} />
            </button>
          </div>

          {/* Secondary actions — quiet ghost icons so only Cart carries
              accent weight (Untitled-calm: one primary action, the rest
              recede). DJ Mode shows the accent only while active. */}
          {/* DJ Mode — continuous harmonic-compatible mix of the catalogue */}
          <button
            onClick={handleDjMode}
            title="DJ Mode — play a continuous, key-matched mix"
            aria-label="DJ Mode"
            aria-pressed={djActive}
            className="tap hidden sm:flex w-9 h-9 items-center justify-center rounded-full transition-colors"
            style={djActive
              ? { backgroundColor: accentColor, color: '#090907' }
              : { color: '#B4AA99' }}
          >
            <Disc3 size={15} className={djActive ? 'animate-[spin_3s_linear_infinite]' : ''} />
          </button>

          {/* Copy store link */}
          <button
            onClick={handleCopyLink}
            title="Copy store link"
            aria-label="Copy store link"
            className="tap hidden sm:flex w-9 h-9 items-center justify-center rounded-full text-[#B4AA99] hover:text-[#F7EBDD] transition-colors"
          >
            <Link2 size={15} />
          </button>

          {/* Cart — the one prominent action */}
          <button
            onClick={() => setIsOpen(true)}
            aria-label={`Cart${items.length > 0 ? ` (${items.length})` : ''}`}
            className="tap hidden min-h-11 items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-black transition-opacity hover:opacity-90 disabled:opacity-40 sm:flex"
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
      <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-10 md:py-14 flex gap-6 md:gap-8 items-start">

        {/* Left sidebar — sticky, visible on lg+ */}
        <StoreSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          totalResults={filtered.length}
          searchQuery={debouncedSearch}
          clearSearch={() => {
            setSearch('');
            setDebouncedSearch('');
          }}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-4">
                {Array.from({ length: 6 }).map((_, i) => <BeatCardSkeleton key={i} />)}
              </div>
            ) : (
              <div className="space-y-1">
                {Array.from({ length: 8 }).map((_, i) => <BeatListRowSkeleton key={i} />)}
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="text-center py-32 border border-dashed border-[#2B2821] rounded-lg">
              <Music size={28} className="text-[#6E685B] mx-auto mb-3" />
              <p className="text-sm text-[#F7EBDD] mb-1">
                {tracks.length === 0 ? 'No beats in the store yet' : 'No beats match your filters'}
              </p>
              <p className="text-[11px] text-[#9B9282]">
                {tracks.length === 0 ? 'Check back soon.' : 'Try adjusting or resetting filters.'}
              </p>
              {hasActiveFilters && (
                <button onClick={resetFilters} className="mt-4 text-[10px] font-mono uppercase tracking-wider text-[#E7D7BE] hover:text-white transition-colors">
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
                  {filtered.map((t) =>
                    // Remix tracks get the Bandcamp release-card layout to
                    // stand out in the mixed grid; regular beats keep BeatCard.
                    t.type === 'remix' ? (
                      <div key={t.id} className="store-card-enter">
                      <BandcampRemixCard
                        track={t as unknown as Track}
                        creatorName={creator?.display_name ?? null}
                        priceLease={priceFor(t, 'lease')}
                        priceExclusive={priceFor(t, 'exclusive')}
                        licenseCount={licenses.length}
                        lowestLicensePrice={lowestLicensePrice}
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
                      </div>
                    ) : (
                      <div key={t.id} className="store-card-enter">
                      <BeatCard
                        track={t}
                        allTracks={filtered}
                        priceLease={priceFor(t, 'lease')}
                        priceExclusive={priceFor(t, 'exclusive')}
                        licenseCount={licenses.length}
                        lowestLicensePrice={lowestLicensePrice}
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
                      </div>
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
                  licenseCount={licenses.length}
                  lowestLicensePrice={lowestLicensePrice}
                  onFreeDownload={(t) => setFreeDownloadTrack(t)}
                  isWishlisted={(id) => wishlist.has(id)}
                  onToggleWishlist={(id) => wishlist.toggle(id)}
                />
              )}

              {pageInfo.hasMore && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMoreTracks}
                    disabled={loadingMore}
                    className="tap inline-flex min-h-11 items-center justify-center rounded-full border border-[#2B2821] bg-[#14110D] px-6 text-[10px] font-mono uppercase tracking-[0.2em] text-[#E7D7BE] transition-colors hover:border-[#D4BFA0]/40 hover:text-white disabled:cursor-wait disabled:opacity-60"
                  >
                    {loadingMore ? 'Loading beats...' : 'Load more beats'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Retention strips ─────────────────────────────────────── */}
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

      <StoreTrustRail accentColor={accentColor} />

      {/* ── Store footer ─────────────────────────────────────────── */}
      <div className="border-t border-[#2B2821] mt-4 py-6 px-4 md:px-12">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6E685B]">
            © {new Date().getFullYear()} {creator?.display_name || 'Beat Store'}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href={isSignedIn ? '/store/account/me' : '/store/account'}
              className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#837B6D] hover:text-[#D0C3AF] transition-colors"
            >
              Buyer account
            </Link>
            <Link
              href="/store/orders"
              className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#837B6D] hover:text-[#D0C3AF] transition-colors"
            >
              Order history / Re-download
            </Link>
          </div>
        </div>
      </div>

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
          onAddLicense={(license) => addLicenseToCart(previewTrack, license)}
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
        @keyframes beat-pulse{0%,100%{box-shadow:0 0 0 1px var(--pulse-clr,rgba(231,215,190,0.2))}50%{box-shadow:0 0 0 3px var(--pulse-clr,rgba(231,215,190,0.15))}}
      `}</style>
    </div>
  );
}
