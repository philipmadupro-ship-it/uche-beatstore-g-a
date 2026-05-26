'use client';

/**
 * /store/playlists/[id]
 *
 * Public, Spotify-style detail page for a store-featured playlist.
 * Unlike /store/projects/[id] (sold as a fixed-price bundle),
 * playlists are à la carte: each track keeps its own lease + exclusive
 * pricing and the buyer picks which ones to add to the cart.
 *
 * Buyer flow:
 *   1. Browse the track list, see per-track prices.
 *   2. Either click a price button on a row to add that specific
 *      license to the cart immediately, OR
 *   3. Check the boxes on multiple tracks, then use the bottom sticky
 *      action bar to "Add selected — Lease" or "Add selected — Exclusive".
 *   4. The shared CartDrawer (mounted by the /store layout) shows the
 *      running total and routes to /store/checkout when ready.
 */

import { useEffect, useState, use, useMemo } from 'react';
import Link from 'next/link';
import {
  Loader2, ListMusic, Play, Pause, Music, ShoppingBag, Check, ArrowLeft,
  Mail, Globe, AtSign, Link2,
} from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { useCart } from '@/hooks/useCart';
import { toast } from '@/hooks/useToast';
import { slugify } from '@/lib/slug';
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
  cover_url: string | null;
  created_at: string;
}

interface Creator {
  display_name?: string | null;
  bio?: string | null;
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
    const s = Math.floor(secs % 60);
    return `${m} min ${s} sec`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h} hr ${m} min`;
}

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [playlist, setPlaylist] = useState<PlaylistShape | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [fallback, setFallback] = useState<{ lease: number | null; exclusive: number | null }>({ lease: null, exclusive: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);

  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue } = usePlayer();
  const { addItem, addItems, items: cartItems } = useCart();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/store/playlists/${id}`);
        if (res.status === 404) { setError('Playlist not found.'); return; }
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
        setPlaylist(data.playlist);
        setTracks(data.tracks ?? []);
        setCreator(data.creator ?? null);
        setFallback(data.pricing_fallback ?? { lease: null, exclusive: null });
      } catch (err: any) {
        setError(err?.message || 'Could not load playlist');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

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

  // Compute totals for the bulk action bar
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

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="relative">
        {playlist.cover_url && (
          <div
            className="absolute inset-0 -z-10 bg-cover bg-center blur-3xl opacity-30 scale-110"
            style={{ backgroundImage: `url(${playlist.cover_url})` }}
            aria-hidden
          />
        )}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background: `linear-gradient(180deg, ${accent}26 0%, rgba(10,9,7,0.6) 40%, #0a0907 100%)`,
          }}
          aria-hidden
        />

        <div className="max-w-6xl mx-auto px-4 md:px-10 pt-8 md:pt-12 pb-8">
          <Link
            href="/store"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 hover:text-white transition-colors mb-6"
          >
            <ArrowLeft size={12} />
            Back to store
          </Link>

          <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start md:items-end">
            <div className="w-[180px] md:w-[230px] aspect-square rounded-md overflow-hidden bg-[#14110d] border border-white/[0.08] shadow-[0_30px_80px_rgba(0,0,0,0.7)] shrink-0">
              {playlist.cover_url ? (
                <img src={playlist.cover_url} alt={playlist.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2A2418] to-[#0a0907] text-[#5a5142]">
                  <ListMusic size={56} />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-mono uppercase tracking-[0.3em] text-white/70">
                Playlist
              </p>
              <h1 className="mt-2 text-3xl md:text-6xl font-bold text-white leading-[1.05] tracking-tight font-heading break-words">
                {playlist.name}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/70">
                {creator?.display_name && (
                  <Link
                    href={`/store/producer/${slugify(creator.display_name)}`}
                    className="text-white/95 font-semibold hover:text-[#D4BFA0] transition-colors"
                  >
                    {creator.display_name}
                  </Link>
                )}
                <span className="text-white/40">·</span>
                <span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
                {totalDuration > 0 && (
                  <>
                    <span className="text-white/40">·</span>
                    <span className="text-white/60">{fmtTotal(totalDuration)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="mt-8 flex items-center gap-3 flex-wrap">
            <button
              onClick={playAll}
              disabled={tracks.length === 0}
              className="w-14 h-14 rounded-full flex items-center justify-center text-black shadow-[0_8px_24px_rgba(0,0,0,0.5)] hover:scale-[1.04] active:scale-[0.97] transition-transform disabled:opacity-40"
              style={{ backgroundColor: accent }}
              aria-label={anyOurTrackPlaying ? 'Pause' : 'Play all'}
            >
              {anyOurTrackPlaying
                ? <Pause size={22} fill="currentColor" />
                : <Play size={22} fill="currentColor" className="ml-1" />}
            </button>

            <button
              onClick={() => addBulk('lease', 'all')}
              disabled={tracks.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-white text-[11px] font-mono uppercase tracking-[0.18em] transition-colors disabled:opacity-40"
            >
              <ShoppingBag size={12} />
              Add All — Lease
            </button>
            <button
              onClick={() => addBulk('exclusive', 'all')}
              disabled={tracks.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-black text-[11px] font-mono uppercase tracking-[0.18em] transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: accent }}
            >
              <ShoppingBag size={12} />
              Add All — Exclusive
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className={`max-w-6xl mx-auto px-4 md:px-10 ${stickyVisible ? 'pb-44' : 'pb-32'}`}>
        {tracks.length === 0 ? (
          <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-10 text-center">
            <Music size={20} className="text-[#3a3328] mx-auto mb-2" />
            <p className="text-[12px] text-[#6a5d4a]">No tracks in this playlist yet.</p>
          </div>
        ) : (
          <div>
            {/* Header row */}
            <div className="hidden md:grid grid-cols-[28px_24px_minmax(0,1fr)_100px_60px_220px] gap-4 px-4 pb-2 mb-1 border-b border-white/[0.06] text-[10px] font-mono uppercase tracking-[0.15em] text-white/40">
              <button
                onClick={selected.size === tracks.length ? clearAll : selectAll}
                title={selected.size === tracks.length ? 'Clear selection' : 'Select all'}
                className="flex items-center justify-center h-5 w-5 rounded border border-white/20 hover:border-white/40 transition-colors"
              >
                {selected.size === tracks.length && tracks.length > 0 && (
                  <Check size={11} className="text-white" />
                )}
              </button>
              <span className="text-right">#</span>
              <span>Title</span>
              <span>Meta</span>
              <span className="text-right">Time</span>
              <span className="text-right pr-1">Add to cart</span>
            </div>

            <ul>
              {tracks.map((t, i) => {
                const isCur = currentTrack?.id === t.id;
                const isCurPlaying = isCur && isPlaying;
                const isSel = selected.has(t.id);
                const isHovered = hovered === t.id;
                const lp = priceFor(t, 'lease');
                const ep = priceFor(t, 'exclusive');
                const cartHasTrack = cartItems.some((it: any) => it.track?.id === t.id);

                return (
                  <li
                    key={t.id}
                    onMouseEnter={() => setHovered(t.id)}
                    onMouseLeave={() => setHovered((v) => (v === t.id ? null : v))}
                    className={`group grid grid-cols-[28px_24px_minmax(0,1fr)_auto] md:grid-cols-[28px_24px_minmax(0,1fr)_100px_60px_220px] gap-4 items-center px-4 py-2 rounded-md transition-colors ${
                      isSel ? 'bg-white/[0.06]' : isCur ? 'bg-white/[0.04]' : 'hover:bg-white/[0.04]'
                    }`}
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

                    {/* Index / play */}
                    <div className="text-right">
                      <button
                        onClick={() => {
                          if (isCur) { togglePlay(); return; }
                          setQueue(tracks as unknown as Track[]);
                          playTrack(t as unknown as Track);
                        }}
                        aria-label={isCurPlaying ? 'Pause' : 'Play'}
                        className="w-6 h-6 flex items-center justify-center text-white/90 ml-auto"
                      >
                        {isCur ? (
                          isCurPlaying
                            ? <Pause size={12} fill="currentColor" style={{ color: accent }} />
                            : <Play size={12} fill="currentColor" style={{ color: accent }} className="ml-0.5" />
                        ) : isHovered ? (
                          <Play size={12} fill="currentColor" className="ml-0.5" />
                        ) : (
                          <span className="text-[11px] font-mono text-white/40 tabular-nums">{i + 1}</span>
                        )}
                      </button>
                    </div>

                    {/* Cover + title */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded shrink-0 bg-[#0a0907] overflow-hidden border border-white/[0.06]">
                        {t.cover_url
                          ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={12} /></div>}
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
                        <p className="text-[11px] text-white/50 truncate">
                          {creator?.display_name || ''}{creator?.display_name ? ' · ' : ''}{t.type}
                        </p>
                      </div>
                    </div>

                    {/* Meta */}
                    <div className="hidden md:flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/45">
                      {t.bpm && <span>{t.bpm} BPM</span>}
                      {t.key && <span>· {t.key}{t.scale === 'minor' ? 'm' : ''}</span>}
                    </div>

                    {/* Duration */}
                    <div className="hidden md:block text-right text-[11px] font-mono text-white/45 tabular-nums">
                      {fmt(t.duration_seconds)}
                    </div>

                    {/* Per-track price buttons (always visible on this view) */}
                    <div className="flex items-center gap-1.5 justify-end shrink-0">
                      {t.free_download_enabled ? (
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/25 rounded-md px-2 py-1">
                          Free
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => addOne(t, 'lease')}
                            disabled={lp == null}
                            className="flex flex-col items-center px-2.5 py-1.5 rounded-md bg-white/[0.06] border border-white/[0.10] text-white text-[11px] font-bold hover:bg-white/[0.12] transition-colors disabled:opacity-30 leading-none"
                          >
                            <span>{lp != null ? `$${lp}` : '—'}</span>
                            <span className="text-[7px] font-mono text-white/45 mt-0.5 uppercase tracking-wider">Lease</span>
                          </button>
                          <button
                            onClick={() => addOne(t, 'exclusive')}
                            disabled={ep == null}
                            className="flex flex-col items-center px-2.5 py-1.5 rounded-md text-black text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-30 leading-none"
                            style={{ backgroundColor: accent }}
                          >
                            <span>{ep != null ? `$${ep}` : '—'}</span>
                            <span className="text-[7px] font-mono text-black/60 mt-0.5 uppercase tracking-wider">Excl.</span>
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* About producer footer */}
        {creator?.display_name && (
          <div className="mt-16 pt-8 border-t border-white/[0.06]">
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/40 mb-3">
              About the producer
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/store/producer/${slugify(creator.display_name)}`}
                className="text-[16px] font-semibold text-white hover:text-[#D4BFA0] transition-colors"
              >
                {creator.display_name}
              </Link>
              <div className="flex items-center gap-1.5 ml-2 flex-wrap">
                {creator.instagram_handle && (
                  <a
                    href={`https://instagram.com/${creator.instagram_handle.replace(/^@/, '')}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.10] transition-colors"
                    title="Instagram"
                  >
                    <AtSign size={13} />
                  </a>
                )}
                {creator.twitter_handle && (
                  <a
                    href={`https://x.com/${creator.twitter_handle.replace(/^@/, '')}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.10] transition-colors"
                    title="X / Twitter"
                  >
                    <Link2 size={13} />
                  </a>
                )}
                {creator.website_url && (
                  <a
                    href={creator.website_url}
                    target="_blank" rel="noopener noreferrer"
                    className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.10] transition-colors"
                    title="Website"
                  >
                    <Globe size={13} />
                  </a>
                )}
                {creator.contact_email && (
                  <a
                    href={`mailto:${creator.contact_email}`}
                    className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.10] transition-colors"
                    title="Email"
                  >
                    <Mail size={13} />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky bulk-action bar (only when selection > 0) ─────── */}
      {stickyVisible && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 sm:bottom-28 z-40 bg-[#0c0a08] border border-white/[0.10] rounded-2xl shadow-[0_16px_60px_rgba(0,0,0,0.7)] backdrop-blur px-4 py-3 w-[min(620px,calc(100vw-32px))]">
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
