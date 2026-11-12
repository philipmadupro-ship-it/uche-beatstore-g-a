'use client';

import { useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Music, Mail, Globe, ExternalLink,
  ChevronRight, Mic2, ShoppingCart,
  CheckCircle2, XCircle, X as CloseIcon, Tag, Zap,
  SkipForward, SkipBack,
} from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { CartDrawer } from '@/components/share/CartDrawer';
import { ShareTrackDetailsDrawer } from '@/components/share/ShareTrackDetailsDrawer';
import { LicenseSelector } from '@/components/store/LicenseSelector';
import type { LicenseTier } from '@/components/store/LicenseSelector';
import type { Track as CartTrack } from '@/lib/types';
import type { ShareRowDownload } from '@/components/share/ShareTrackList';
import { SharePageFrame, type ShareFrameOptions } from '@/components/share/SharePageFrame';
import { resolveCreatorLink } from '@/lib/store/social-links';

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
  user_id?: string | null;
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
  wav_url?: string | null;
  stems_status?: CartTrack['stems_status'] | null;
  created_at?: string | null;
  peaks_url?: string | null;
  track_tags?: { tag: string; category?: string | null }[] | null;
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
  /** Custom license tiers from the producer's /api/licenses. Empty array = use fallback */
  licenses: LicenseTier[];
  shareToken?: string;
  /** Password the share was unlocked with, forwarded to checkout. */
  sharePassword?: string | null;
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
  /** Share options the producer set (downloads, playback, collaboration), for the header. */
  options: ShareFrameOptions;
  /** Download on the row itself, beside the beat it belongs to. */
  rowDownload?: ShareRowDownload;
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

function toCartTrack(track: Track): CartTrack {
  return {
    ...track,
    user_id: track.user_id ?? '',
    type: track.type as CartTrack['type'],
    duration_seconds: track.duration_seconds ?? null,
    bpm: track.bpm ?? null,
    stems_status: track.stems_status ?? 'none',
    created_at: track.created_at ?? '',
  };
}

export function ClientShareVariant({
  project,
  tracks,
  creator,
  licenses,
  shareToken,
  sharePassword,
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
  options,
  rowDownload,
}: Props) {
  const { addItem, items: cartItems, setIsOpen: setCartOpen, isOpen: cartOpen } = useCart();
  const searchParams = useSearchParams();
  const router = useRouter();
  const purchaseStatus = searchParams?.get('purchase');
  const bannerOpen = purchaseStatus === 'success' || purchaseStatus === 'cancelled';
  const [selectedTrackForDetails, setSelectedTrackForDetails] = useState<Track | null>(null);
  const [headerVisible, setHeaderVisible] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const dismissBanner = () => {
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
  // Resolved, not interpolated: a stored value that is not a usable link
  // renders no pill (and no empty "Get in touch" heading).
  const contactLinks = ([
    ['email', resolveCreatorLink('email', creator?.contact_email), <Mail key="m" size={12} />],
    ['instagram', resolveCreatorLink('instagram', creator?.instagram_handle), <InstagramIcon key="i" size={12} />],
    ['x', resolveCreatorLink('x', creator?.twitter_handle), <XTwitterIcon key="x" size={12} />],
    ['spotify', resolveCreatorLink('spotify', creator?.spotify_url), <Music key="s" size={12} />],
    ['soundcloud', resolveCreatorLink('soundcloud', creator?.soundcloud_url), <SoundcloudIcon key="c" size={12} />],
    ['website', resolveCreatorLink('website', creator?.website_url), <Globe key="w" size={12} />],
  ] as const).flatMap(([key, link, icon]) => (link ? [{ key, link, icon }] : []));
  const hasContact = contactLinks.length > 0;

  const creatorLeasePrice = creator?.license_lease_price_usd ?? null;
  const creatorExclusivePrice = creator?.license_exclusive_price_usd ?? null;

  // Effective bundle prices (used for the section-level license card fallback)
  const bundleLeasePrice = resolvePrice(shareLeasePrice, null, creatorLeasePrice, discount);
  const bundleExclusivePrice = resolvePrice(shareExclusivePrice, null, creatorExclusivePrice, discount);
  const hasLicenseSection = bundleLeasePrice != null || bundleExclusivePrice != null || !!creator?.license_notes?.trim() || licenses.length > 0;

  // ── Resolved tier list for LicenseSelector ─────────────────────────
  // Custom tiers take precedence; their prices are run through resolvePrice
  // so share-level and discount overrides apply correctly.
  // When no custom tiers exist, synthesise the classic two-tier shape.
  const resolvedTiers: LicenseTier[] = licenses.length > 0
    ? licenses.map((l) => ({
        ...l,
        price_usd: l.is_free
          ? 0
          : l.is_exclusive
            ? resolvePrice(shareExclusivePrice, l.price_usd, creatorExclusivePrice, discount) ?? l.price_usd
            : resolvePrice(shareLeasePrice, l.price_usd, creatorLeasePrice, discount) ?? l.price_usd,
      }))
    : (
        [
          bundleLeasePrice != null
            ? { id: 'basic-lease', name: 'Basic Lease', price_usd: bundleLeasePrice, file_types: ['MP3', 'WAV'], is_exclusive: false }
            : null,
          bundleExclusivePrice != null
            ? { id: 'exclusive-rights', name: 'Exclusive Rights', price_usd: bundleExclusivePrice, file_types: ['MP3', 'WAV', 'STEMS'], is_exclusive: true }
            : null,
        ].filter(Boolean) as LicenseTier[]
      );

  const [selectedLicenseId, setSelectedLicenseId] = useState<string>(resolvedTiers[0]?.id ?? '');

  const cartCount = cartItems.length;
  const cartTotal = cartItems.reduce((sum, i) => sum + i.license.price_usd, 0);

  const handleAddToCart = (track: Track) => {
    const tier = resolvedTiers.find((t) => t.id === selectedLicenseId) ?? resolvedTiers[0];
    if (!tier || tier.price_usd == null) return;
    // For per-track price overrides: exclusive tiers use exclusive_price_usd, lease tiers use lease_price_usd
    const price = tier.is_exclusive
      ? resolvePrice(shareExclusivePrice, track.exclusive_price_usd, creatorExclusivePrice, discount) ?? tier.price_usd
      : resolvePrice(shareLeasePrice, track.lease_price_usd, creatorLeasePrice, discount) ?? tier.price_usd;
    addItem(toCartTrack(track), {
      id: tier.id,
      name: tier.name,
      price_usd: price,
      file_types: tier.file_types ?? [],
      is_exclusive: tier.is_exclusive ?? false,
    });
    setCartOpen(true);
  };

  const cartButton = shareToken ? (
    <button
      onClick={() => setCartOpen(true)}
      className="relative inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-medium text-white transition-all hover:border-white/[0.12] hover:bg-white/[0.08] sm:px-4"
    >
      <ShoppingCart size={12} aria-hidden="true" />
      {cartCount > 0 ? (
        <>
          <span className="font-mono tabular-nums">${cartTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-white/20 bg-[#090907] text-[8px] font-bold leading-none text-white/70">
            {cartCount}
          </span>
        </>
      ) : (
        'Cart'
      )}
    </button>
  ) : null;

  return (
    <>
      {/* ── Purchase banner ── */}
      {bannerOpen && (
        <div className={`sticky top-0 z-50 px-4 md:px-12 py-3 border-b ${
          purchaseStatus === 'success'
            ? 'bg-[#0e1f17] border-[#6DC6A4]/30 text-[#6DC6A4]'
            : 'bg-[#1f1010] border-red-500/30 text-red-300'
        }`}>
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            {purchaseStatus === 'success' ? <CheckCircle2 size={16} className="shrink-0" /> : <XCircle size={16} className="shrink-0" />}
            <p className="text-[11px] font-medium flex-1">
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

      <SharePageFrame
        project={project}
        producerName={creator?.display_name?.trim() || null}
        tracks={tracks}
        options={options}
        playingId={playingId}
        isPlaying={isPlaying}
        onPlay={onPlay}
        waveRef={waveRef}
        rowDownload={rowDownload}
        buy={shareToken && resolvedTiers.length > 0 ? (t) => {
              const leasePrice = resolvePrice(shareLeasePrice, t.lease_price_usd, creatorLeasePrice, discount);
              const exclPrice = resolvePrice(shareExclusivePrice, t.exclusive_price_usd, creatorExclusivePrice, discount);
              // Original (pre-discount) prices for strikethrough
              const leaseOrig = discount && leasePrice != null ? leasePrice / (1 - discount / 100) : null;
              const exclOrig = discount && exclPrice != null ? exclPrice / (1 - discount / 100) : null;
              const inCart = cartItems.some((ci) => ci.track.id === t.id);
              return (

                        <>
                        {shareToken && resolvedTiers.length > 0 ? (
                          (() => {
                            const selTier = resolvedTiers.find((r) => r.id === selectedLicenseId) ?? resolvedTiers[0];
                            const price = selTier?.is_exclusive ? exclPrice : leasePrice;
                            const origPrice = selTier?.is_exclusive ? exclOrig : leaseOrig;
                            if (price == null) return (
                              <button
                                onClick={() => setSelectedTrackForDetails(t)}
                                className="text-white/30 group-hover:text-white transition-colors p-1"
                              >
                                <ChevronRight size={14} />
                              </button>
                            );
                            const isExcl = selTier?.is_exclusive ?? false;
                            return (
                              <button
                                onClick={() => handleAddToCart(t)}
                                className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg border transition-colors ${
                                  isExcl
                                    ? 'bg-white/[0.07] border-white/20 hover:border-white/20 hover:bg-white/10'
                                    : 'bg-white/[0.04] border-white/20 hover:border-white/20 hover:bg-white/[0.05]'
                                }`}
                              >
                                <span className={`text-[8px] font-mono uppercase tracking-wider ${isExcl ? 'text-white/80' : 'text-white/60'}`}>
                                  {selTier?.name ?? 'Add'}
                                </span>
                                <span className="flex items-center gap-1 leading-none">
                                  {origPrice && (
                                    <span className="text-[8px] font-mono text-white/30 line-through tabular-nums">
                                      ${Math.round(origPrice)}
                                    </span>
                                  )}
                                  <span className={`text-[11px] font-mono font-bold tabular-nums ${isExcl ? 'text-white' : 'text-white'}`}>
                                    ${Math.round(price)}
                                  </span>
                                </span>
                              </button>
                            );
                          })()
                        ) : (
                          <button
                            onClick={() => setSelectedTrackForDetails(t)}
                            className="text-white/30 group-hover:text-white transition-colors p-1"
                          >
                            <ChevronRight size={14} />
                          </button>
                        )}

                        </>
              );
            } : undefined}
        headerExtras={(
          <>
            {discount && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#6DC6A4]/25 bg-[#0e1f17] px-2.5 py-1.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[#6DC6A4]">
                <Tag size={9} aria-hidden="true" />
                {discount}% off
              </span>
            )}
            {cartButton}
          </>
        )}
      >
        {/* ── Bio ── */}
        {hasBio && (
          <section className="mb-14 max-w-2xl">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/80 mb-3">About</p>
            <p className="text-[14px] text-white/85 leading-[1.75] whitespace-pre-wrap">
              {creator!.bio}
            </p>
          </section>
        )}

        {/* ── License tiers ── */}
        {hasLicenseSection && (
          <section className="mb-14">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/80 mb-4">
              License tiers
            </p>
            <LicenseSelector
              tiers={resolvedTiers}
              selectedId={selectedLicenseId}
              onSelect={setSelectedLicenseId}
            />
            {creator?.license_notes && (
              <p className="text-[11px] text-white/80 mt-4 leading-relaxed">
                {creator.license_notes}
              </p>
            )}
          </section>
        )}

        {/* ── Credits ── */}
        {hasCredits && (
          <section className="mb-14 max-w-2xl">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/80 mb-3 flex items-center gap-2">
              <Mic2 size={11} />
              Selected credits
            </p>
            <p className="text-[13px] text-white/80 leading-[1.9] whitespace-pre-wrap font-mono">
              {creator!.credits}
            </p>
          </section>
        )}

        {/* ── Contact + socials ── */}
        {hasContact && (
          <section className="mb-8">
            <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/80 mb-3">Get in touch</p>
            <div className="flex flex-wrap gap-2">
              {contactLinks.map(({ key, link, icon }) => (
                <SocialPill key={key} href={link.href} icon={icon} label={link.label} />
              ))}
            </div>
          </section>
        )}
      </SharePageFrame>

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

      {shareToken && cartOpen && <CartDrawer shareToken={shareToken} sharePassword={sharePassword} />}
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SocialPill({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-white hover:bg-white/[0.08] hover:border-white/[0.12] transition-colors"
    >
      {icon}
      <span className="truncate max-w-[200px]">{label}</span>
      <ExternalLink size={10} className="text-white/60" />
    </a>
  );
}
