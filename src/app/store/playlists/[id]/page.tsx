'use client';

/**
 * /store/playlists/[id]
 *
 * Public, VisionOS-glass detail page for a store-featured playlist.
 * Unlike /store/projects/[id] (fixed-price bundle), playlists are
 * à la carte — each track keeps its own lease + exclusive pricing
 * and buyers pick which ones to add to the cart.
 *
 * Glass shell + top tab nav are shared with /store/projects/[id]
 * and /store/projects/access/[token] for visual continuity.
 */

import { useState, use, useMemo } from 'react';
import {
  Loader2, ListMusic, Play, Pause, Music, ShoppingBag, Check,
  Headphones, Clock, Heart, MoreHorizontal,
  Copy, Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { usePlayer } from '@/hooks/usePlayer';
import { useCart } from '@/hooks/useCart';
import { useWishlist } from '@/hooks/useWishlist';
import { toast } from '@/hooks/useToast';
import { GlassPage } from '@/components/store/GlassPage';
import { ProducerProfile } from '@/components/store/ProducerProfile';
import type { Track } from '@/lib/types';

interface PlaylistTrack {
  id: string;
  title: string;
  type: string;
  audio_url: string | null;
  peaks_url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  lease_price_usd: number | null;
  exclusive_price_usd: number | null;
  free_download_enabled: boolean | null;
}

interface PlaylistShape {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  created_at: string;
}

interface Creator {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  accent_color?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
}

function fmt(secs: number | null): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function fmtTotal(secs: number): string {
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    return `${m} min`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [tab, setTab] = useState<'tracks' | 'producer'>('tracks');
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue } = usePlayer();
  const { addItem, addItems, items: cartItems } = useCart();
  const { has: isWishlisted, toggle: toggleWishlist } = useWishlist();

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['playlist', id],
    queryFn: async () => {
      const res = await fetch(`/api/store/playlists/${id}`);
      if (res.status === 404) throw new Error('Playlist not found.');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json as {
        playlist: PlaylistShape;
        tracks: PlaylistTrack[];
        creator: Creator | null;
        pricing_fallback?: { lease: number | null; exclusive: number | null };
      };
    },
  });
  const playlist = data?.playlist ?? null;
  const tracks = data?.tracks ?? [];
  const creator = data?.creator ?? null;
  const fallback = data?.pricing_fallback ?? { lease: null, exclusive: null };
  const error = queryError ? (queryError as Error).message : null;

  const accent = creator?.accent_color || '#D4BFA0';
  const totalDuration = useMemo(
    () => tracks.reduce((acc, t) => acc + (t.duration_seconds ?? 0), 0),
    [tracks],
  );

  const priceFor = (t: PlaylistTrack, kind: 'lease' | 'exclusive'): number | null => {
    const trackPrice = kind === 'lease' ? t.lease_price_usd : t.exclusive_price_usd;
    if (trackPrice != null && Number(trackPrice) > 0) return Number(trackPrice);
    const fb = kind === 'lease' ? fallback.lease : fallback.exclusive;
    if (fb != null && Number(fb) > 0) return Number(fb);
    return null;
  };

  const addOne = (t: PlaylistTrack, kind: 'lease' | 'exclusive') => {
    const price = priceFor(t, kind);
    if (price == null) {
      toast.warning('Not available', `No ${kind} price set for ${t.title}`);
      return;
    }
    addItem(t as unknown as Track, {
      id: kind,
      name: kind === 'lease' ? 'Lease' : 'Exclusive',
      price_usd: price,
      file_types: kind === 'lease' ? ['MP3'] : ['WAV', 'MP3', 'STEMS'],
      is_exclusive: kind === 'exclusive',
    });
    toast.success('Added to cart', `${kind === 'lease' ? 'Lease' : 'Exclusive'} — ${t.title}`);
  };

  const addBulk = (kind: 'lease' | 'exclusive', source: 'selected' | 'all') => {
    const candidates = source === 'selected'
      ? tracks.filter((t) => selected.has(t.id))
      : tracks;
    const pairs = candidates
      .map((t) => {
        const price = priceFor(t, kind);
        if (price == null) return null;
        return {
          track: t as unknown as Track,
          license: {
            id: kind,
            name: kind === 'lease' ? 'Lease' : 'Exclusive',
            price_usd: price,
            file_types: kind === 'lease' ? ['MP3'] : ['WAV', 'MP3', 'STEMS'],
            is_exclusive: kind === 'exclusive',
          },
        };
      })
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (pairs.length === 0) {
      toast.warning('Nothing to add', `No tracks have a ${kind} price set.`);
      return;
    }
    addItems(pairs);
    toast.success(
      `Added ${pairs.length} ${pairs.length === 1 ? 'track' : 'tracks'}`,
      `${kind === 'lease' ? 'Lease' : 'Exclusive'} licenses added to cart`,
    );
    if (source === 'selected') setSelected(new Set());
  };

  const toggleSelected = (trackId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(tracks.map((t) => t.id)));
  const clearAll = () => setSelected(new Set());
  const playAll = () => {
    if (tracks.length === 0) return;
    if (currentTrack && tracks.some((t) => t.id === currentTrack.id)) {
      togglePlay();
      return;
    }
    setQueue(tracks as unknown as Track[]);
    playTrack(tracks[0] as unknown as Track);
  };
  const anyOurTrackPlaying =
    isPlaying && currentTrack && tracks.some((t) => t.id === currentTrack.id);

  const selectedTracks = tracks.filter((t) => selected.has(t.id));
  const selectedTotals = useMemo(() => {
    let lease = 0, leaseCount = 0, exclusive = 0, exclusiveCount = 0;
    for (const t of selectedTracks) {
      const lp = priceFor(t, 'lease');
      if (lp != null) { lease += lp; leaseCount++; }
      const ep = priceFor(t, 'exclusive');
      if (ep != null) { exclusive += ep; exclusiveCount++; }
    }
    return { lease, leaseCount, exclusive, exclusiveCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTracks, fallback]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#5a5142]" />
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex flex-col items-center justify-center gap-4 text-[#5a5142] px-6">
        <ListMusic size={36} />
        <p className="text-[14px] text-center">{error || 'Playlist not found.'}</p>
        <Link href="/store" className="text-[11px] underline hover:text-[#E8DCC8]">
          Back to store
        </Link>
      </div>
    );
  }

  const stickyVisible = selected.size > 0;

  const heroMeta = (
    <>
      <Headphones size={13} className="text-white/40" />
      <span>{tracks.length} {tracks.length === 1 ? 'song' : 'songs'} Total</span>
      {totalDuration > 0 && (
        <>
          <span className="text-white/30">·</span>
          <span>{fmtTotal(totalDuration)}</span>
        </>
      )}
    </>
  );

  const heroActions = (
    <>
      <button
        onClick={playAll}
        disabled={tracks.length === 0}
        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/[0.08] border border-white/[0.10] text-white text-[12px] hover:bg-white/[0.14] transition-colors disabled:opacity-40"
      >
        {anyOurTrackPlaying ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-0.5" />}
        {anyOurTrackPlaying ? 'Pause' : 'Play all'}
      </button>
      <button
        onClick={() => addBulk('lease', 'all')}
        disabled={tracks.length === 0}
        className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/[0.10] bg-white/[0.04] text-white text-[12px] hover:bg-white/[0.08] transition-colors disabled:opacity-40"
      >
        <ShoppingBag size={11} />
        Add all — Lease
      </button>
      <button
        onClick={() => addBulk('exclusive', 'all')}
        disabled={tracks.length === 0}
        className="flex items-center gap-1.5 px-4 py-2 rounded-full text-black text-[12px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ backgroundColor: accent }}
      >
        <ShoppingBag size={11} />
        Add all — Exclusive
      </button>
    </>
  );

  return (
    <div className={stickyVisible ? 'pb-20' : ''}>
      <GlassPage coverUrl={playlist.cover_url} accentColor={accent}>
        <GlassPage.TabNav
          tabs={[
            ['tracks', 'Tracks'],
            ['producer', 'Producer'],
          ] as const}
          activeTab={tab}
          onTabChange={setTab}
          accentColor={accent}
        />
        <GlassPage.Hero
          eyebrow="Playlist"
          title={playlist.name}
          producer={creator}
          meta={heroMeta}
          actions={heroActions}
          coverImage={playlist.cover_url || creator?.hero_image_url}
          coverFallback={<ListMusic size={56} />}
        />

        {/* Curator's description (migration 061). Whitespace-pre-line
            so paragraphs survive; same warm-sand styling as the
            project pages for visual consistency. */}
        {playlist.description && (
          <GlassPage.Section eyebrow="About this playlist">
            <p className="text-[13px] text-[#a08a6a] leading-relaxed whitespace-pre-line max-w-3xl">
              {playlist.description}
            </p>
          </GlassPage.Section>
        )}

          {tab === 'tracks' && (
            <div className="px-2 md:px-4 pt-3 pb-2">
              {/* Track list header — select-all + columns */}
              <div className="hidden md:grid grid-cols-[28px_minmax(0,1.5fr)_120px_70px_220px_28px_28px] gap-3 items-center px-4 md:px-6 py-2 border-b border-white/[0.05] text-[10px] font-mono uppercase tracking-[0.15em] text-white/40">
                <button
                  onClick={selected.size === tracks.length ? clearAll : selectAll}
                  title={selected.size === tracks.length ? 'Clear selection' : 'Select all'}
                  className="flex items-center justify-center h-5 w-5 rounded border border-white/20 hover:border-white/40 transition-colors"
                >
                  {selected.size === tracks.length && tracks.length > 0 && (
                    <Check size={11} className="text-white" />
                  )}
                </button>
                <span>Title</span>
                <span>Tag</span>
                <span className="text-right">Time</span>
                <span className="text-right pr-1">Add to cart</span>
                <span />
                <span />
              </div>

              {tracks.length === 0 ? (
                <div className="px-6 md:px-10 py-10 text-center">
                  <Music size={20} className="text-[#3a3328] mx-auto mb-2" />
                  <p className="text-[12px] text-[#6a5d4a]">No tracks listed for sale in this playlist yet.</p>
                </div>
              ) : (
                <ul>
                  {tracks.map((t) => {
                    const isCur = currentTrack?.id === t.id;
                    const isCurPlaying = isCur && isPlaying;
                    const isSel = selected.has(t.id);
                    const isHov = hovered === t.id;
                    const lp = priceFor(t, 'lease');
                    const ep = priceFor(t, 'exclusive');
                    const wishlisted = isWishlisted(t.id);
                    const cartHasTrack = cartItems.some((it: any) => it.track?.id === t.id);

                    return (
                      <li
                        key={t.id}
                        onMouseEnter={() => setHovered(t.id)}
                        onMouseLeave={() => setHovered((v) => (v === t.id ? null : v))}
                        className={`relative grid grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[28px_minmax(0,1.5fr)_120px_70px_220px_28px_28px] gap-3 items-center px-4 md:px-6 py-2.5 rounded-2xl transition-colors ${isSel ? 'bg-white/[0.06]' : isCur ? 'bg-white/[0.04]' : 'hover:bg-white/[0.04]'}`}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={() => toggleSelected(t.id)}
                          aria-pressed={isSel}
                          title={isSel ? 'Deselect' : 'Select'}
                          className={`flex items-center justify-center h-5 w-5 rounded border transition-colors ${
                            isSel
                              ? 'border-white/40 text-white'
                              : 'border-white/15 hover:border-white/30 text-transparent'
                          }`}
                          style={isSel ? { backgroundColor: accent, borderColor: accent, color: '#000' } : {}}
                        >
                          {isSel && <Check size={11} strokeWidth={3} />}
                        </button>

                        {/* Cover + title */}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-[#0a0907] border border-white/[0.06] shrink-0">
                            {t.cover_url
                              ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={14} /></div>}
                            {(isHov || isCur) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isCur) { togglePlay(); return; }
                                  setQueue(tracks as unknown as Track[]);
                                  playTrack(t as unknown as Track);
                                }}
                                aria-label={isCurPlaying ? 'Pause' : 'Play'}
                                className="absolute inset-0 flex items-center justify-center bg-black/55 text-white"
                              >
                                {isCurPlaying
                                  ? <Pause size={13} fill="currentColor" />
                                  : <Play size={13} fill="currentColor" className="ml-0.5" />}
                              </button>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p
                              className="text-[14px] truncate flex items-center gap-2"
                              style={isCur ? { color: accent, fontWeight: 600 } : { color: '#E8DCC8' }}
                            >
                              <span className="truncate">{t.title}</span>
                              {cartHasTrack && (
                                <span className="shrink-0 text-[8px] font-mono uppercase tracking-[0.15em] text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/30 rounded-full px-1.5 py-0.5">
                                  In cart
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-white/45 truncate">
                              {t.type}{t.bpm ? ` · ${t.bpm} BPM` : ''}{t.key ? ` · ${t.key}${t.scale === 'minor' ? 'm' : ''}` : ''}
                            </p>
                          </div>
                        </div>

                        {/* Tag column — show type for now */}
                        <div className="hidden md:block text-[11px] text-white/55">
                          <span className="font-medium" style={{ color: accent }}>
                            #{t.type}
                          </span>
                        </div>

                        {/* Duration */}
                        <div className="hidden md:flex items-center gap-1 justify-end text-[11px] font-mono text-white/45 tabular-nums">
                          <Clock size={11} />
                          {fmt(t.duration_seconds)}
                        </div>

                        {/* Per-track price buttons */}
                        <div className="flex items-center gap-1.5 justify-end shrink-0">
                          {t.free_download_enabled ? (
                            <span className="text-[11px] font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/25 rounded-md px-2.5 py-1.5 font-bold">
                              Free
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => addOne(t, 'lease')}
                                disabled={lp == null}
                                className="flex flex-col items-center px-2.5 py-1.5 rounded-md bg-white/[0.06] border border-white/[0.10] text-white text-[12px] font-bold hover:bg-white/[0.12] transition-colors disabled:opacity-30 leading-none"
                              >
                                <span className="tabular-nums">{lp != null ? `$${lp}` : '—'}</span>
                                <span className="text-[7px] font-mono text-white/45 mt-0.5 uppercase tracking-wider">Lease</span>
                              </button>
                              <button
                                onClick={() => addOne(t, 'exclusive')}
                                disabled={ep == null}
                                className="flex flex-col items-center px-2.5 py-1.5 rounded-md text-black text-[12px] font-bold hover:opacity-90 transition-opacity disabled:opacity-30 leading-none"
                                style={{ backgroundColor: accent }}
                              >
                                <span className="tabular-nums">{ep != null ? `$${ep}` : '—'}</span>
                                <span className="text-[7px] font-mono text-black/60 mt-0.5 uppercase tracking-wider">Excl.</span>
                              </button>
                            </>
                          )}
                        </div>

                        {/* Heart */}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleWishlist(t.id); }}
                          aria-pressed={wishlisted}
                          title={wishlisted ? 'Remove from favorites' : 'Add to favorites'}
                          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                          style={wishlisted ? { color: '#c8a84b' } : { color: 'rgba(255,255,255,0.45)' }}
                        >
                          <Heart size={13} fill={wishlisted ? 'currentColor' : 'none'} />
                        </button>

                        {/* Menu */}
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.id ? null : t.id); }}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.06] transition-colors"
                            title="More"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {menuFor === t.id && (
                            <div className="absolute right-0 top-9 z-30 w-44 rounded-xl bg-[#14110d]/95 backdrop-blur-xl border border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-1.5">
                              <button
                                onClick={() => { addOne(t, 'lease'); setMenuFor(null); }}
                                disabled={lp == null}
                                className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] w-full text-left disabled:opacity-40"
                              >
                                <Plus size={12} className="text-white/60" />
                                Add lease {lp != null ? `($${lp})` : ''}
                              </button>
                              <button
                                onClick={() => { addOne(t, 'exclusive'); setMenuFor(null); }}
                                disabled={ep == null}
                                className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] w-full text-left disabled:opacity-40"
                              >
                                <Plus size={12} style={{ color: accent }} />
                                Add exclusive {ep != null ? `($${ep})` : ''}
                              </button>
                              <div className="my-1 mx-2 border-t border-white/[0.06]" />
                              <button
                                onClick={() => {
                                  try { navigator.clipboard.writeText(t.title); toast.success('Copied'); } catch {/* noop */}
                                  setMenuFor(null);
                                }}
                                className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] w-full text-left"
                              >
                                <Copy size={12} className="text-white/60" />
                                Copy title
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

        {tab === 'producer' && (
          <GlassPage.Section eyebrow="About the producer" noBorder className="px-6 md:px-10 py-8">
            <ProducerProfile creator={creator} />
          </GlassPage.Section>
        )}
      </GlassPage>

      {/* Sticky bulk-action bar (only when selection > 0) */}
      {stickyVisible && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 sm:bottom-28 z-40 bg-[#0c0a08]/90 border border-white/[0.10] rounded-2xl shadow-[0_16px_60px_rgba(0,0,0,0.7)] backdrop-blur-2xl px-4 py-3 w-[min(620px,calc(100vw-32px))]">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[12px] text-white flex items-center gap-2">
              <span className="font-bold tabular-nums">{selected.size}</span>
              <span className="text-white/60">selected</span>
            </div>
            <button
              onClick={clearAll}
              className="text-[10px] font-mono uppercase tracking-wider text-white/50 hover:text-white transition-colors"
            >
              Clear
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => addBulk('lease', 'selected')}
                disabled={selectedTotals.leaseCount === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.10] text-white text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-30"
              >
                <ShoppingBag size={11} />
                Add Lease ${selectedTotals.lease.toLocaleString()}
              </button>
              <button
                onClick={() => addBulk('exclusive', 'selected')}
                disabled={selectedTotals.exclusiveCount === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-black text-[11px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-30"
                style={{ backgroundColor: accent }}
              >
                <ShoppingBag size={11} />
                Add Excl ${selectedTotals.exclusive.toLocaleString()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
