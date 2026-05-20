'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Music, Mail, Globe, ExternalLink,
  Play, Pause, ChevronRight, Mic2, Loader2, ShoppingCart,
  CheckCircle2, XCircle, X as CloseIcon, Tag, Zap,
  Clock, Hash, SkipForward, SkipBack,
} from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { CartDrawer } from '@/components/share/CartDrawer';
import { ShareTrackDetailsDrawer } from '@/components/share/ShareTrackDetailsDrawer';

function InstagramIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function XTwitterIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function SoundcloudIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M1.175 12.225c-.017 0-.034 0-.05.002a.42.42 0 0 0-.372.301L.5 14.163l.253 1.638a.42.42 0 0 0 .422.349c.017 0 .034 0 .05-.002.232-.015.41-.209.41-.444v-3.08a.42.42 0 0 0-.46-.4zm1.78-.638c-.232 0-.42.188-.42.42v4.002c0 .232.188.42.42.42s.42-.188.42-.42V12.007a.42.42 0 0 0-.42-.42zm1.78-.42c-.232 0-.42.188-.42.42v4.842c0 .232.188.42.42.42s.42-.188.42-.42V11.587a.42.42 0 0 0-.42-.42zm1.78.21c-.232 0-.42.188-.42.42v4.632c0 .232.188.42.42.42s.42-.188.42-.42v-4.632a.42.42 0 0 0-.42-.42zm1.78-.42c-.232 0-.42.188-.42.42v5.052c0 .232.188.42.42.42s.42-.188.42-.42v-5.052a.42.42 0 0 0-.42-.42zm1.778-.63a.42.42 0 0 0-.42.42v5.682c0 .232.188.42.42.42s.42-.188.42-.42v-5.682a.42.42 0 0 0-.42-.42zm1.78.63c-.232 0-.42.188-.42.42v5.052c0 .232.188.42.42.42s.42-.188.42-.42v-5.052a.42.42 0 0 0-.42-.42zm1.78 2.1a3.36 3.36 0 0 0-1.26-2.628 4.62 4.62 0 0 0-3.36-1.452 4.62 4.62 0 0 0-1.68.315v9.135h6.3v-5.37z" />
    </svg>
  );
}

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
}

interface Track {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  description?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
}

interface Project {
  id: string;
  name: string;
  cover_url?: string | null;
  description?: string | null;
}

interface Props {
  project: Project;
  tracks: Track[];
  creator: CreatorProfile | null;
  shareToken?: string;
  shareLeasePrice?: number | null;
  shareExclusivePrice?: number | null;
  shareDiscountPercent?: number | null;
  onPlay: (track: Track) => void;
  playingId?: string | null;
  isPlaying?: boolean;
  currentTime: number;
  duration: number;
  progressPct: number;
  waveRef: React.RefObject<HTMLDivElement | null>;
  onSeek: (seconds: number) => void;
}

function fmt(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Resolved pricing helper — share override → track override → creator default → discount
function resolvePrice(
  sharePrice: number | null | undefined,
  trackPrice: number | null | undefined,
  creatorPrice: number | null | undefined,
  discount: number | null | undefined,
): number | null {
  const base = sharePrice ?? (trackPrice != null ? Number(trackPrice) : null) ?? (creatorPrice != null ? Number(creatorPrice) : null);
  if (base == null) return null;
  const d = discount != null && discount > 0 && discount <= 100 ? discount : null;
  return d ? base * (1 - d / 100) : base;
}

function KeyBadge({ keyName, scale }: { keyName?: string | null; scale?: string | null }) {
  if (!keyName) return null;
  const isMinor = scale === 'minor';
  return (
    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
      isMinor
        ? 'text-[#9d95e8] bg-[#1a1833]/60 border border-[#534AB7]/30'
        : 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/40'
    }`}>
      {keyName}{isMinor ? 'm' : ''}
    </span>
  );
}

export function ClientShareVariant({
  project,
  tracks,
  creator,
  shareToken,
  shareLeasePrice,
  shareExclusivePrice,
  shareDiscountPercent,
  onPlay,
  playingId,
  isPlaying,
  currentTime,
  duration,
  progressPct,
  waveRef,
  onSeek,
}: Props) {
  const { addItem, items: cartItems, setIsOpen: setCartOpen, isOpen: cartOpen } = useCart();
  const searchParams = useSearchParams();
  const router = useRouter();
  const purchaseStatus = searchParams?.get('purchase');
  const [bannerOpen, setBannerOpen] = useState(false);
  const [selectedTrackForDetails, setSelectedTrackForDetails] = useState<Track | null>(null);
  const [headerVisible, setHeaderVisible] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBannerOpen(purchaseStatus === 'success' || purchaseStatus === 'cancelled');
  }, [purchaseStatus]);

  const dismissBanner = () => {
    setBannerOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('purchase');
    url.searchParams.delete('session_id');
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  };

  // Sticky header appears once hero scrolls away
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderVisible(!entry.isIntersecting),
      { threshold: 0 },
    );
    if (heroRef.current) observer.observe(heroRef.current);
    return () => observer.disconnect();
  }, []);

  const displayName = creator?.display_name?.trim() || project.name;
  const heroImage = creator?.hero_image_url || project.cover_url || tracks[0]?.cover_url || null;
  const discount = shareDiscountPercent != null && shareDiscountPercent > 0 && shareDiscountPercent <= 100 ? shareDiscountPercent : null;

  const hasBio = !!creator?.bio?.trim();
  const hasCredits = !!creator?.credits?.trim();
  const hasContact = !!creator?.contact_email || !!creator?.instagram_handle || !!creator?.twitter_handle
                  || !!creator?.spotify_url || !!creator?.soundcloud_url || !!creator?.website_url;

  const creatorLeasePrice = creator?.license_lease_price_usd ?? null;
  const creatorExclusivePrice = creator?.license_exclusive_price_usd ?? null;

  // Effective bundle prices (used for the section-level license card)
  const bundleLeasePrice = resolvePrice(shareLeasePrice, null, creatorLeasePrice, discount);
  const bundleExclusivePrice = resolvePrice(shareExclusivePrice, null, creatorExclusivePrice, discount);
  const hasLicenseSection = bundleLeasePrice != null || bundleExclusivePrice != null || !!creator?.license_notes?.trim();

  const cartCount = cartItems.length;
  const cartTotal = cartItems.reduce((sum, i) => sum + i.license.price_usd, 0);

  const handleAddToCart = (track: Track, type: 'lease' | 'exclusive') => {
    const price = type === 'lease'
      ? resolvePrice(shareLeasePrice, track.lease_price_usd, creatorLeasePrice, discount)
      : resolvePrice(shareExclusivePrice, track.exclusive_price_usd, creatorExclusivePrice, discount);
    if (price == null) return;
    addItem(track as any, {
      id: type === 'lease' ? 'basic-lease' : 'exclusive-rights',
      name: type === 'lease' ? 'Basic Lease' : 'Exclusive Rights',
      price_usd: price,
      file_types: type === 'lease' ? ['MP3', 'WAV'] : ['MP3', 'WAV', 'STEMS'],
      is_exclusive: type === 'exclusive',
    });
    setCartOpen(true);
  };

  const playingTrack = tracks.find((t) => t.id === playingId) ?? null;
  const playingIdx = tracks.findIndex((t) => t.id === playingId);

  const handlePrev = () => {
    if (playingIdx > 0) onPlay(tracks[playingIdx - 1]);
  };
  const handleNext = () => {
    if (playingIdx >= 0 && playingIdx < tracks.length - 1) onPlay(tracks[playingIdx + 1]);
  };

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * (duration || 0));
  };

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">

      {/* ── Sticky post-hero header ── */}
      <div className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
        headerVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
      }`}>
        <div className="bg-[#0a0907]/95 backdrop-blur-xl border-b border-[#1f1a13] px-4 md:px-8 h-13 flex items-center gap-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#E8DCC8] flex-1 truncate">{displayName}</span>
          {discount && (
            <span className="hidden sm:flex items-center gap-1 text-[9px] font-mono font-bold text-[#6DC6A4] bg-[#0e1f17] border border-[#6DC6A4]/25 px-2.5 py-1 rounded-full uppercase tracking-wider">
              <Tag size={9} />
              {discount}% off
            </span>
          )}
          {shareToken && (
            <button
              onClick={() => setCartOpen(true)}
              className="relative flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#14110d] border border-[#2d2620] hover:border-[#D4BFA0]/40 transition-colors"
            >
              <ShoppingCart size={13} className="text-[#D4BFA0]" />
              {cartCount > 0 ? (
                <>
                  <span className="text-[11px] font-mono font-bold text-[#E8D8B8] tabular-nums">
                    ${cartTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#D4BFA0] text-black text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
                    {cartCount}
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-[#6a5d4a] font-mono">Cart</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Purchase banner ── */}
      {bannerOpen && (
        <div className={`sticky top-0 z-50 px-4 md:px-12 py-3 border-b ${
          purchaseStatus === 'success'
            ? 'bg-[#0e1f17] border-[#6DC6A4]/30 text-[#6DC6A4]'
            : 'bg-[#1f1010] border-red-500/30 text-red-300'
        }`}>
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            {purchaseStatus === 'success' ? <CheckCircle2 size={16} className="shrink-0" /> : <XCircle size={16} className="shrink-0" />}
            <p className="text-[12px] font-medium flex-1">
              {purchaseStatus === 'success'
                ? 'Purchase complete — check your inbox for the receipt and download link.'
                : 'Checkout cancelled. No payment was taken.'}
            </p>
            <button onClick={dismissBanner} className="text-current/60 hover:text-current shrink-0">
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      <div ref={heroRef} className="relative w-full h-[50vh] md:h-[60vh] overflow-hidden">
        {heroImage ? (
          <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#2A2418] via-[#14110d] to-[#0a0907]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-[#0a0907]" />

        {/* Discount ribbon */}
        {discount && (
          <div className="absolute top-6 right-6 flex items-center gap-1.5 bg-[#0e1f17]/90 backdrop-blur-sm border border-[#6DC6A4]/30 text-[#6DC6A4] px-3 py-1.5 rounded-full text-[11px] font-bold font-mono uppercase tracking-wider">
            <Zap size={11} fill="currentColor" />
            {discount}% off everything
          </div>
        )}

        {/* Cart button in hero */}
        {shareToken && (
          <button
            onClick={() => setCartOpen(true)}
            className="absolute top-6 left-6 relative flex items-center gap-2 px-3.5 py-2 rounded-full bg-black/40 backdrop-blur-sm border border-white/[0.12] hover:border-white/25 transition-colors"
          >
            <ShoppingCart size={13} className="text-[#D4BFA0]" />
            {cartCount > 0 ? (
              <>
                <span className="text-[11px] font-mono font-bold text-[#E8D8B8]">${cartTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#D4BFA0] text-black text-[8px] font-bold rounded-full flex items-center justify-center">
                  {cartCount}
                </span>
              </>
            ) : (
              <span className="text-[10px] text-white/60 font-mono">Cart</span>
            )}
          </button>
        )}

        <div className="absolute inset-x-0 bottom-0 px-6 md:px-12 pb-10 md:pb-14">
          <p className="text-[9px] font-mono uppercase tracking-[0.35em] text-[#a08a6a] mb-2">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} · Curated selection
          </p>
          <h1 className="text-4xl md:text-6xl font-medium tracking-tight text-white leading-[1.05] max-w-3xl">
            {displayName}
          </h1>
          {project.description && (
            <p className="mt-3 text-[13px] md:text-[14px] text-[#E8DCC8]/70 max-w-xl leading-relaxed">
              {project.description}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 md:px-10 pt-10 pb-36">

        {/* ── Bio ── */}
        {hasBio && (
          <section className="mb-14 max-w-2xl">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-3">About</p>
            <p className="text-[15px] text-[#E8DCC8]/85 leading-[1.75] whitespace-pre-wrap">
              {creator!.bio}
            </p>
          </section>
        )}

        {/* ── Track list ── */}
        <section className="mb-14">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#a08a6a]">
              Tracks · {tracks.length}
            </p>
            {discount && (
              <span className="text-[9px] font-mono text-[#6DC6A4] bg-[#0e1f17] border border-[#6DC6A4]/20 px-2 py-0.5 rounded-full">
                {discount}% off all prices
              </span>
            )}
          </div>

          <div className="rounded-2xl border border-[#1f1a13] overflow-hidden divide-y divide-[#1f1a13]">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[2fr_80px_80px_1fr] gap-4 px-5 py-2.5 bg-[#0e0c09]">
              <span className="text-[9px] font-mono uppercase tracking-widest text-[#3a3328]">Track</span>
              <span className="text-[9px] font-mono uppercase tracking-widest text-[#3a3328] text-center">BPM</span>
              <span className="text-[9px] font-mono uppercase tracking-widest text-[#3a3328] text-center">Time</span>
              <span className="text-[9px] font-mono uppercase tracking-widest text-[#3a3328] text-right">License</span>
            </div>

            {tracks.length === 0 ? (
              <div className="px-5 py-12 text-center text-[12px] text-[#6a5d4a]">
                No tracks in this selection yet.
              </div>
            ) : (
              tracks.map((t, i) => {
                const isCurrent = playingId === t.id;
                const leasePrice = resolvePrice(shareLeasePrice, t.lease_price_usd, creatorLeasePrice, discount);
                const exclPrice = resolvePrice(shareExclusivePrice, t.exclusive_price_usd, creatorExclusivePrice, discount);
                // Original (pre-discount) prices for strikethrough
                const leaseOrig = discount && leasePrice != null ? leasePrice / (1 - discount / 100) : null;
                const exclOrig = discount && exclPrice != null ? exclPrice / (1 - discount / 100) : null;
                const hasPricing = leasePrice != null || exclPrice != null;
                const inCart = cartItems.some((ci) => ci.track.id === t.id);

                return (
                  <div
                    key={t.id}
                    className={`group flex md:grid md:grid-cols-[2fr_80px_80px_1fr] items-center gap-3 md:gap-4 px-4 md:px-5 py-3.5 transition-colors ${
                      isCurrent ? 'bg-[#14110d]' : 'hover:bg-[#0e0c09]'
                    }`}
                  >
                    {/* Cover + play */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        onClick={() => onPlay(t)}
                        className="relative w-11 h-11 rounded-lg overflow-hidden bg-[#14110d] border border-[#1f1a13] shrink-0 focus:outline-none"
                      >
                        {t.cover_url ? (
                          <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                            <Music size={16} />
                          </div>
                        )}
                        <div className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${
                          isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}>
                          {isCurrent && isPlaying ? (
                            <Pause size={16} className="text-white" fill="currentColor" />
                          ) : (
                            <Play size={16} className="text-white ml-0.5" fill="currentColor" />
                          )}
                        </div>
                        {isCurrent && isPlaying && (
                          <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-0.5 items-end h-2">
                            <span className="w-0.5 bg-[#D4BFA0] animate-[pulse_0.6s_ease-in-out_infinite]" style={{ height: '40%' }} />
                            <span className="w-0.5 bg-[#D4BFA0] animate-[pulse_0.8s_ease-in-out_infinite]" style={{ height: '100%' }} />
                            <span className="w-0.5 bg-[#D4BFA0] animate-[pulse_0.7s_ease-in-out_infinite]" style={{ height: '60%' }} />
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setSelectedTrackForDetails(t)}
                        className="min-w-0 text-left flex-1"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-mono text-[#3a3328] tabular-nums ${isCurrent ? 'text-[#D4BFA0]' : ''}`}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <p className={`text-[14px] font-medium truncate transition-colors ${
                            isCurrent ? 'text-[#D4BFA0]' : 'text-white group-hover:text-[#E8D8B8]'
                          }`}>
                            {t.title}
                          </p>
                          {inCart && (
                            <span className="text-[8px] font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#0e1f17] border border-[#6DC6A4]/20 px-1.5 py-0.5 rounded-full shrink-0">
                              In cart
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] font-mono text-[#5a5142] uppercase tracking-wider">{t.type}</span>
                          {t.key && <KeyBadge keyName={t.key} scale={t.scale} />}
                        </div>
                      </button>
                    </div>

                    {/* BPM */}
                    <div className="hidden md:flex flex-col items-center">
                      {t.bpm ? (
                        <>
                          <span className="text-[13px] font-mono font-bold text-[#E8DCC8] tabular-nums">{t.bpm}</span>
                          <span className="text-[8px] font-mono text-[#3a3328] uppercase tracking-wider">bpm</span>
                        </>
                      ) : (
                        <span className="text-[#3a3328] font-mono">—</span>
                      )}
                    </div>

                    {/* Duration */}
                    <div className="hidden md:flex items-center justify-center">
                      <span className="text-[11px] font-mono text-[#5a5142] tabular-nums">
                        {t.duration_seconds ? fmt(t.duration_seconds) : '—'}
                      </span>
                    </div>

                    {/* License pills / chevron */}
                    <div className="flex items-center justify-end gap-2 shrink-0 ml-auto md:ml-0">
                      {shareToken && hasPricing ? (
                        <div className="flex items-center gap-1.5">
                          {leasePrice != null && (
                            <button
                              onClick={() => handleAddToCart(t, 'lease')}
                              className="flex flex-col items-center px-2.5 py-1.5 rounded-lg bg-[#14110d] border border-[#2d2620] hover:border-[#D4BFA0]/40 hover:bg-[#1a160f] transition-colors group/btn"
                            >
                              {leaseOrig && (
                                <span className="text-[8px] font-mono text-[#3a3328] line-through tabular-nums">
                                  ${Math.round(leaseOrig)}
                                </span>
                              )}
                              <span className="text-[11px] font-mono font-bold text-[#E8D8B8] tabular-nums leading-none">
                                ${Math.round(leasePrice)}
                              </span>
                              <span className="text-[7px] font-mono text-[#6a5d4a] uppercase tracking-wider mt-0.5">Lease</span>
                            </button>
                          )}
                          {exclPrice != null && (
                            <button
                              onClick={() => handleAddToCart(t, 'exclusive')}
                              className="flex flex-col items-center px-2.5 py-1.5 rounded-lg bg-[#D4BFA0]/[0.07] border border-[#D4BFA0]/20 hover:border-[#D4BFA0]/50 hover:bg-[#D4BFA0]/10 transition-colors"
                            >
                              {exclOrig && (
                                <span className="text-[8px] font-mono text-[#3a3328] line-through tabular-nums">
                                  ${Math.round(exclOrig)}
                                </span>
                              )}
                              <span className="text-[11px] font-mono font-bold text-[#D4BFA0] tabular-nums leading-none">
                                ${Math.round(exclPrice)}
                              </span>
                              <span className="text-[7px] font-mono text-[#a08a6a] uppercase tracking-wider mt-0.5">Excl.</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => setSelectedTrackForDetails(t)}
                          className="text-[#3a3328] group-hover:text-[#E8DCC8] transition-colors p-1"
                        >
                          <ChevronRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ── License feature comparison ── */}
        {hasLicenseSection && (
          <section className="mb-14">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-4">
              License tiers
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {bundleLeasePrice != null && (
                <LicenseTierCard
                  label="Basic Lease"
                  badge="Most Popular"
                  price={bundleLeasePrice}
                  originalPrice={discount ? bundleLeasePrice / (1 - discount / 100) : null}
                  discount={discount}
                  features={[
                    { label: 'MP3 + WAV download', included: true },
                    { label: 'Unlimited streaming', included: true },
                    { label: 'Up to 100k streams', included: true },
                    { label: 'Trackout stems', included: false },
                    { label: 'Exclusive rights', included: false },
                    { label: 'Radio & sync clearance', included: false },
                  ]}
                  accent="default"
                />
              )}
              {bundleExclusivePrice != null && (
                <LicenseTierCard
                  label="Exclusive Rights"
                  price={bundleExclusivePrice}
                  originalPrice={discount ? bundleExclusivePrice / (1 - discount / 100) : null}
                  discount={discount}
                  features={[
                    { label: 'MP3 + WAV download', included: true },
                    { label: 'Unlimited streaming', included: true },
                    { label: 'Unlimited streams', included: true },
                    { label: 'Trackout stems', included: true },
                    { label: 'Exclusive rights', included: true },
                    { label: 'Radio & sync clearance', included: true },
                  ]}
                  accent="gold"
                />
              )}
            </div>
            {creator?.license_notes && (
              <p className="text-[12px] text-[#a08a6a] mt-4 leading-relaxed">
                {creator.license_notes}
              </p>
            )}
          </section>
        )}

        {/* ── Credits ── */}
        {hasCredits && (
          <section className="mb-14 max-w-2xl">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-3 flex items-center gap-2">
              <Mic2 size={11} />
              Selected credits
            </p>
            <p className="text-[13px] text-[#E8DCC8]/80 leading-[1.9] whitespace-pre-wrap font-mono">
              {creator!.credits}
            </p>
          </section>
        )}

        {/* ── Contact + socials ── */}
        {hasContact && (
          <section className="mb-8">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-3">Get in touch</p>
            <div className="flex flex-wrap gap-2">
              {creator?.contact_email && (
                <SocialPill href={`mailto:${creator.contact_email}`} icon={<Mail size={12} />} label={creator.contact_email} />
              )}
              {creator?.instagram_handle && (
                <SocialPill
                  href={`https://instagram.com/${creator.instagram_handle.replace(/^@/, '')}`}
                  icon={<InstagramIcon size={12} />}
                  label={`@${creator.instagram_handle.replace(/^@/, '')}`}
                />
              )}
              {creator?.twitter_handle && (
                <SocialPill
                  href={`https://twitter.com/${creator.twitter_handle.replace(/^@/, '')}`}
                  icon={<XTwitterIcon size={12} />}
                  label={`@${creator.twitter_handle.replace(/^@/, '')}`}
                />
              )}
              {creator?.spotify_url && (
                <SocialPill href={creator.spotify_url} icon={<Music size={12} />} label="Spotify" />
              )}
              {creator?.soundcloud_url && (
                <SocialPill href={creator.soundcloud_url} icon={<SoundcloudIcon size={12} />} label="SoundCloud" />
              )}
              {creator?.website_url && (
                <SocialPill href={creator.website_url} icon={<Globe size={12} />} label="Website" />
              )}
            </div>
          </section>
        )}
      </div>

      {/* ── Sticky Now-Playing bar ── */}
      {playingTrack && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0c0a08]/95 backdrop-blur-xl border-t border-[#1f1a13] shadow-[0_-8px_40px_rgba(0,0,0,0.6)]">
          {/* Seek bar — full-width clickable strip at the very top of the bar */}
          <div
            onClick={handleSeekClick}
            className="h-1 bg-[#1f1a13] cursor-pointer hover:h-1.5 transition-all relative"
          >
            <div
              className="h-full bg-[#D4BFA0] transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="max-w-5xl mx-auto px-4 md:px-8 py-3 flex items-center gap-4">
            {/* Cover */}
            <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#14110d] border border-[#1f1a13] shrink-0">
              {playingTrack.cover_url ? (
                <img src={playingTrack.cover_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                  <Music size={12} />
                </div>
              )}
            </div>

            {/* Track info */}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-white truncate">{playingTrack.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-mono text-[#5a5142] tabular-nums">
                  {fmt(currentTime)}
                </span>
                <span className="text-[10px] font-mono text-[#3a3328]">/</span>
                <span className="text-[10px] font-mono text-[#5a5142] tabular-nums">
                  {duration > 0 ? fmt(duration) : fmt(playingTrack.duration_seconds || 0)}
                </span>
              </div>
            </div>

            {/* Transport */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handlePrev}
                disabled={playingIdx <= 0}
                className="w-8 h-8 flex items-center justify-center text-[#6a5d4a] hover:text-white disabled:opacity-30 transition-colors"
              >
                <SkipBack size={14} fill="currentColor" />
              </button>
              <button
                onClick={() => onPlay(playingTrack)}
                className="w-9 h-9 bg-white rounded-full flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-transform shadow"
              >
                {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
              </button>
              <button
                onClick={handleNext}
                disabled={playingIdx >= tracks.length - 1}
                className="w-8 h-8 flex items-center justify-center text-[#6a5d4a] hover:text-white disabled:opacity-30 transition-colors"
              >
                <SkipForward size={14} fill="currentColor" />
              </button>
            </div>

            {/* Cart shortcut */}
            {shareToken && (
              <button
                onClick={() => setCartOpen(true)}
                className="relative w-9 h-9 flex items-center justify-center text-[#6a5d4a] hover:text-[#D4BFA0] transition-colors shrink-0"
              >
                <ShoppingCart size={15} />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#D4BFA0] text-black text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
                    {cartCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Drawers ── */}
      {selectedTrackForDetails && (
        <ShareTrackDetailsDrawer
          track={selectedTrackForDetails}
          projectCover={project.cover_url}
          creator={creator}
          shareToken={shareToken}
          shareLeasePrice={shareLeasePrice}
          shareExclusivePrice={shareExclusivePrice}
          shareDiscountPercent={shareDiscountPercent}
          onClose={() => setSelectedTrackForDetails(null)}
          onPlay={onPlay}
          isPlaying={isPlaying ?? false}
          playingId={playingId ?? null}
          currentTime={currentTime}
          duration={duration}
          progressPct={progressPct}
          onSeek={onSeek}
        />
      )}

      {shareToken && cartOpen && <CartDrawer shareToken={shareToken} />}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function LicenseTierCard({
  label, badge, price, originalPrice, discount, features, accent,
}: {
  label: string;
  badge?: string;
  price: number;
  originalPrice: number | null;
  discount: number | null;
  features: { label: string; included: boolean }[];
  accent: 'default' | 'gold';
}) {
  const isGold = accent === 'gold';
  return (
    <div className={`relative rounded-2xl border p-6 flex flex-col gap-4 overflow-hidden ${
      isGold
        ? 'border-[#D4BFA0]/25 bg-gradient-to-br from-[#1a160d] to-[#0c0a08]'
        : 'border-[#1f1a13] bg-[#14110d]'
    }`}>
      {badge && (
        <span className="absolute top-4 right-4 text-[8px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] bg-[#1f1a13] border border-[#2d2620] px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}

      <div>
        <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#6a5d4a] mb-1.5">{label}</p>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-mono font-bold ${isGold ? 'text-[#D4BFA0]' : 'text-white'}`}>
            ${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
          {originalPrice && discount && (
            <span className="text-[13px] font-mono text-[#3a3328] line-through tabular-nums">
              ${Math.round(originalPrice).toLocaleString()}
            </span>
          )}
        </div>
        {discount && (
          <span className="text-[9px] font-mono text-[#6DC6A4] mt-0.5 block">
            You save ${Math.round((originalPrice ?? price) - price).toLocaleString()} ({discount}% off)
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {features.map((f) => (
          <li key={f.label} className="flex items-center gap-2.5 text-[11px]">
            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${
              f.included
                ? isGold ? 'bg-[#D4BFA0]/20 text-[#D4BFA0]' : 'bg-white/10 text-[#E8DCC8]'
                : 'bg-[#1a160f] text-[#3a3328]'
            }`}>
              {f.included ? '✓' : '✗'}
            </span>
            <span className={f.included ? 'text-[#E8DCC8]/80' : 'text-[#3a3328]'}>
              {f.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialPill({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[12px] text-[#E8DCC8] hover:bg-white/[0.08] hover:border-white/[0.12] transition-colors"
    >
      {icon}
      <span className="truncate max-w-[200px]">{label}</span>
      <ExternalLink size={10} className="text-[#6a5d4a]" />
    </a>
  );
}
