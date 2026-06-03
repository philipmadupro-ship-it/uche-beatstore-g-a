'use client';

import { useState, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ArrowLeft, Play, Pause, ShoppingCart, Music, Clock, Gauge,
  Music2, Check, X, Loader2, ExternalLink, Globe, Mail,
  AtSign, Download, ChevronRight, Tag, Link2,
} from 'lucide-react';
import { MiniWaveform } from '@/components/player/MiniWaveform';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
import { usePlayer } from '@/hooks/usePlayer';
import { useCart } from '@/hooks/useCart';
import { toast } from '@/hooks/useToast';
import { slugify } from '@/lib/slug';
import { BeatComments } from '@/components/store/BeatComments';
import { ShareMenu } from '@/components/store/ShareMenu';
import type { Track } from '@/lib/types';

/* ─── Types ────────────────────────────────────────────────── */

interface CreatorProfile {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  license_notes?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
  accent_color?: string | null;
}

/** Shape returned by /api/store/[id] after license resolution */
interface ApiLicenseTier {
  id: string;
  name: string;
  price_usd: number;
  description: string | null;
  is_free: boolean;
  file_types: string[];
  stems_included: boolean;
  is_exclusive: boolean;
  streaming_limit: number | null;
  distribution_limit: number | null;
  commercial_rights: boolean;
  sync_rights: boolean;
  broadcast_rights: boolean;
  credit_required: boolean;
}

/** Shape the LicenseCard component expects */
interface LicenseTier {
  id: string;
  name: string;
  price: number;
  tagline: string;
  fileTypes: string[];
  rights: string[];
  isExclusive: boolean;
  accentClass: string;
  buttonClass: string;
  /** 'lease' | 'exclusive' for the checkout API */
  checkoutType: 'lease' | 'exclusive';
}

/* ─── Helpers ───────────────────────────────────────────────── */

function fmt(secs: number | null): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function price(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtLimit(n: number | null): string {
  if (n == null) return 'Unlimited';
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}K`;
  return String(n);
}

/** Map server-resolved ApiLicenseTier → client LicenseTier for the card */
function mapToUiTier(t: ApiLicenseTier): LicenseTier {
  const rights: string[] = [];
  if (t.is_exclusive) rights.push('Exclusive worldwide license');
  else rights.push('Non-exclusive license');
  rights.push(`Up to ${fmtLimit(t.streaming_limit)} streams`);
  if (t.commercial_rights) rights.push('Commercial & paid use');
  if (t.sync_rights) rights.push('Sync / film use');
  if (t.broadcast_rights) rights.push('Broadcast / TV rights');
  if (t.stems_included) rights.push('Stems included');
  if (t.credit_required) rights.push('Producer credit required');

  return {
    id: t.id,
    name: t.name,
    price: t.price_usd,
    tagline: t.description ?? (t.is_exclusive ? 'Full ownership transfer' : 'Non-exclusive · Commercial use'),
    fileTypes: t.file_types,
    rights: rights.slice(0, 5),
    isExclusive: t.is_exclusive,
    checkoutType: t.is_exclusive ? 'exclusive' : 'lease',
    accentClass: t.is_exclusive
      ? 'border-[#D4BFA0]/30 bg-gradient-to-b from-[#1f1a13] to-[#14110d]'
      : 'border-[#2d2620] hover:border-[#a08a6a]/40',
    buttonClass: t.is_exclusive
      ? 'bg-[#D4BFA0] hover:bg-[#E8D8B8] text-black'
      : 'bg-white/[0.06] hover:bg-white/[0.1] text-[#E8DCC8] border border-white/[0.08]',
  };
}

const TYPE_LABELS: Record<string, string> = {
  beat: 'Beat',
  instrumental: 'Instrumental',
  song: 'Song',
  remix: 'Remix',
};

/* ─── Page ──────────────────────────────────────────────────── */

export default function StoreProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue } = usePlayer();
  const { addItem, isOpen, setIsOpen } = useCart();
  // Must be declared before any early returns (Rules of Hooks).
  const [offerOpen, setOfferOpen] = useState(false);

  const { data, isLoading: loading, isError } = useQuery({
    queryKey: ['storeTrack', id],
    queryFn: async () => {
      const res = await fetch(`/api/store/${id}`);
      if (res.status === 404) throw new Error('Not found');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return {
        track: json.track as Track,
        creator: (json.creator ?? null) as CreatorProfile | null,
        licenses: ((json.licenses ?? []) as ApiLicenseTier[]).map(mapToUiTier),
        tags: (json.tags ?? []) as Array<{ tag: string; category: string }>,
        related: (json.related ?? []) as Track[],
        fansAlsoBought: (json.fans_also_bought ?? []) as Track[],
      };
    },
    retry: false,
  });
  const track = data?.track ?? null;
  const creator = data?.creator ?? null;
  const licenses = data?.licenses ?? [];
  const tags = data?.tags ?? [];
  const related = data?.related ?? [];
  const fansAlsoBought = data?.fansAlsoBought ?? [];
  const notFound = isError || (!loading && !track);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#5a5142]" />
      </div>
    );
  }

  if (notFound || !track) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex flex-col items-center justify-center gap-4 text-[#5a5142]">
        <Music size={36} />
        <p className="text-[14px]">Beat not found or no longer for sale.</p>
        <Link href="/store" className="text-[12px] underline hover:text-[#E8DCC8]">← Back to store</Link>
      </div>
    );
  }

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;

  const handlePlay = () => {
    if (isCurrent) { togglePlay(); return; }
    const allTracks = [track, ...related];
    setQueue(allTracks);
    playTrack(track);
  };

  const handleAddToCart = (tier: LicenseTier) => {
    addItem(track, {
      id: `${tier.checkoutType}-${track.id}`,
      name: tier.name,
      price_usd: tier.price,
      file_types: tier.fileTypes,
      is_exclusive: tier.isExclusive,
    });
    toast.success(`Added "${track.title}" (${tier.name}) to cart`);
    setIsOpen(true);
  };

  // offerOpen declared above the early returns (Rules of Hooks).

  const metaChips = [
    track.type && { label: TYPE_LABELS[track.type] ?? track.type, icon: Tag },
    track.bpm && { label: `${track.bpm} BPM`, icon: Gauge },
    (track.key || track.scale) && {
      label: [track.key, track.scale].filter(Boolean).join(' '),
      icon: Music2,
    },
    track.duration_seconds && { label: fmt(track.duration_seconds), icon: Clock },
  ].filter(Boolean) as Array<{ label: string; icon: any }>;

  // Adaptive grid: 1 tier → full-width; 2 → 2-col; 3 → 3-col; 4 → 2×2
  const licenseGridClass =
    licenses.length === 1
      ? 'grid grid-cols-1'
      : licenses.length === 2
        ? 'grid grid-cols-1 sm:grid-cols-2 gap-3'
        : licenses.length === 3
          ? 'grid grid-cols-1 sm:grid-cols-3 gap-3'
          : 'grid grid-cols-1 sm:grid-cols-2 gap-3';

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">
      {/* ── Back breadcrumb ── */}
      <div className="max-w-6xl mx-auto px-4 md:px-10 pt-6">
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#5a5142] hover:text-[#a08a6a] transition-colors"
        >
          <ArrowLeft size={11} />
          Back to store
        </Link>
      </div>

      {/* ── Main product layout ── */}
      <div className="max-w-6xl mx-auto px-4 md:px-10 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(260px,360px)_1fr] gap-6 md:gap-14 items-start">

          {/* ── LEFT: Cover + play ── */}
          <div className="flex flex-col gap-4 md:sticky md:top-24">
            {/* Cover art */}
            <button
              onClick={handlePlay}
              className="relative w-full aspect-square rounded-2xl overflow-hidden bg-[#14110d] border border-[#1f1a13] group shadow-[0_16px_60px_rgba(0,0,0,0.6)]"
            >
              {track.cover_url ? (
                <CoverImage
                  src={track.cover_url}
                  alt={track.title}
                  priority
                  sizes="(max-width: 1024px) 100vw, 480px"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2A2418] to-[#0a0907] text-[#5a5142]">
                  <Music size={56} />
                </div>
              )}
              {/* Play overlay */}
              <div className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-200 ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                <div className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center shadow-2xl transform transition-transform duration-200 group-hover:scale-105">
                  {isCurrentPlaying
                    ? <PauseGlyph size={30} />
                    : <PlayGlyph size={30} className="ml-1" />}
                </div>
              </div>
              {/* Currently playing indicator */}
              {isCurrent && (
                <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/70 backdrop-blur text-[9px] font-mono uppercase tracking-wider text-[#D4BFA0] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] animate-pulse" />
                  {isCurrentPlaying ? 'Now playing' : 'Paused'}
                </div>
              )}
            </button>

            {/* Waveform seek strip — shows below the cover art */}
            <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-3 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[9px] font-mono uppercase tracking-wider text-[#3a3328]">
                  Waveform Preview
                </span>
                {isCurrent && (
                  <span className="text-[9px] font-mono text-[#6DC6A4] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] animate-pulse inline-block" />
                    {isCurrentPlaying ? 'Playing' : 'Paused'}
                  </span>
                )}
              </div>
              <MiniWaveform
                trackId={track.id}
                peaksUrl={track.peaks_url}
                height={48}
                isActive={isCurrent}
                onPlay={!isCurrent ? handlePlay : undefined}
              />
              {isCurrent && (
                <p className="text-[9px] font-mono text-[#3a3328] mt-1.5 text-center">
                  Click to seek
                </p>
              )}
            </div>

            {/* Producer strip */}
            {creator && (
              <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#5a5142] mb-2">Producer</p>
                {creator.display_name ? (
                  <Link
                    href={`/store/producer/${slugify(creator.display_name)}`}
                    className="inline-block max-w-full text-[14px] font-semibold text-[#E8DCC8] hover:text-[#D4BFA0] transition-colors break-words"
                  >
                    {creator.display_name}
                  </Link>
                ) : (
                  <p className="text-[14px] font-semibold text-[#E8DCC8]">Producer</p>
                )}
                {creator.bio && (
                  <p className="text-[11px] text-[#6a5d4a] mt-1.5 leading-relaxed line-clamp-3">
                    {creator.bio}
                  </p>
                )}
                {/* Social row */}
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  {creator.instagram_handle && (
                    <a
                      href={`https://instagram.com/${creator.instagram_handle.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] font-mono text-[#5a5142] hover:text-[#E8DCC8] transition-colors flex items-center gap-1"
                      title="Instagram"
                    >
                      <AtSign size={11} />
                      {creator.instagram_handle.replace(/^@/, '')}
                    </a>
                  )}
                  {creator.twitter_handle && (
                    <a
                      href={`https://twitter.com/${creator.twitter_handle.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] font-mono text-[#5a5142] hover:text-[#E8DCC8] transition-colors flex items-center gap-1"
                      title="X / Twitter"
                    >
                      <Link2 size={11} />
                      {creator.twitter_handle.replace(/^@/, '')}
                    </a>
                  )}
                  {creator.website_url && (
                    <a
                      href={creator.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#5a5142] hover:text-[#E8DCC8] transition-colors"
                      title="Website"
                    >
                      <Globe size={14} />
                    </a>
                  )}
                  {creator.contact_email && (
                    <a
                      href={`mailto:${creator.contact_email}`}
                      className="text-[#5a5142] hover:text-[#E8DCC8] transition-colors"
                      title={creator.contact_email}
                    >
                      <Mail size={14} />
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Details + licenses ── */}
          <div className="flex flex-col gap-6">
            {/* Title + meta */}
            <div>
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-2xl md:text-4xl font-bold text-white leading-tight tracking-tight">
                  {track.title}
                </h1>
                {/* Single share affordance — popover with URL share /
                    IG card / 9:16 vertical preview. Replaces the three
                    overlapping buttons that used to live here. */}
                <ShareMenu
                  trackId={track.id}
                  trackTitle={track.title}
                  producerName={creator?.display_name ?? null}
                  accentColor={creator?.accent_color || '#D4BFA0'}
                />
              </div>
              {creator?.display_name && (
                <p className="mt-1 text-[13px] text-[#6a5d4a] break-words">
                  prod.{' '}
                  <Link
                    href={`/store/producer/${slugify(creator.display_name)}`}
                    className="text-[#a08a6a] hover:text-[#D4BFA0] transition-colors break-words"
                  >
                    {creator.display_name}
                  </Link>
                </p>
              )}

              {/* Metadata chips */}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                {metaChips.map(({ label, icon: Icon }) => (
                  <div
                    key={label}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#14110d] border border-[#1f1a13] text-[10px] font-mono uppercase tracking-wider text-[#a08a6a]"
                  >
                    <Icon size={9} />
                    {label}
                  </div>
                ))}
              </div>

              {/* Tag chips */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {tags.map(({ tag, category }) => (
                    <span
                      key={`${category}:${tag}`}
                      className="px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider border border-[#1f1a13] bg-white/[0.03] text-[#6a5d4a] hover:text-[#a08a6a] transition-colors cursor-default"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Free download CTA */}
            {(track as any).free_download_enabled && (
              <div className="rounded-xl border border-[#6DC6A4]/20 bg-[#6DC6A4]/5 px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[12px] font-semibold text-[#6DC6A4]">Free Download Available</p>
                  <p className="text-[10px] text-[#5a5142] mt-0.5">Download this track free — no account needed.</p>
                </div>
                <a
                  href={`/api/store/free-download?track_id=${track.id}`}
                  download
                  className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-full bg-[#6DC6A4] hover:bg-[#7ED4B0] text-black text-[11px] font-bold uppercase tracking-wider transition-colors"
                >
                  <Download size={12} />
                  Free
                </a>
              </div>
            )}

            {/* License cards — hidden once the exclusive has sold (mig 075) */}
            {track.exclusive_sold ? (
              <div className="rounded-xl border border-[#D4BFA0]/30 bg-[#14110d] px-5 py-6 text-center">
                <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#D4BFA0] mb-1.5">
                  Exclusive Sold
                </p>
                <p className="text-[12px] text-[#a08a6a] leading-relaxed">
                  The exclusive rights to this beat have been purchased. It&apos;s no longer available for license.
                </p>
              </div>
            ) : licenses.length > 0 ? (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-3">
                  License Options
                </p>
                <div className={licenseGridClass}>
                  {licenses.map((tier) => (
                    <LicenseCard
                      key={tier.id}
                      tier={tier}
                      onAddToCart={() => handleAddToCart(tier)}
                      onMakeOffer={tier.isExclusive ? () => setOfferOpen(true) : undefined}
                    />
                  ))}
                </div>
                {creator?.license_notes && (
                  <p className="mt-3 text-[10px] text-[#5a5142] leading-relaxed">
                    {creator.license_notes}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-6 text-center">
                <Download size={20} className="text-[#3a3328] mx-auto mb-2" />
                <p className="text-[12px] text-[#6a5d4a]">No licenses available yet.</p>
              </div>
            )}

            {/* View cart — layout mounts the CartDrawer; just open it */}
            <button
              onClick={() => setIsOpen(true)}
              className="inline-flex items-center gap-2 text-[11px] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors self-start"
            >
              <ShoppingCart size={12} />
              View cart
            </button>

            {/* Description */}
            {track.description && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-3">
                  About this track
                </p>
                <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-4">
                  <p className="text-[13px] text-[#a08a6a] leading-relaxed whitespace-pre-line">
                    {track.description}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Comments ── */}
        {track && (
          <BeatComments
            trackId={track.id}
            trackDurationSeconds={track.duration_seconds}
            accentColor={creator?.accent_color || '#D4BFA0'}
          />
        )}

        {/* ── Fans also bought (collaborative filtering) ── */}
        {fansAlsoBought.length > 0 && (
          <section className="mt-16">
            <div className="flex items-center gap-2 mb-5">
              <p className="text-[10px] font-mono uppercase tracking-[0.25em]" style={{ color: creator?.accent_color || '#D4BFA0' }}>
                Fans also bought
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
              {fansAlsoBought.map((r) => (
                <RelatedCard key={r.id} track={r} />
              ))}
            </div>
          </section>
        )}

        {/* ── Related tracks ── */}
        {related.length > 0 && (
          <section className="mt-16">
            <div className="flex items-center justify-between mb-5">
              <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#5a5142]">
                You might also like
              </p>
              <Link
                href="/store"
                className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#5a5142] hover:text-[#a08a6a] transition-colors"
              >
                View all <ChevronRight size={10} />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
              {related.map((r) => (
                <RelatedCard key={r.id} track={r} />
              ))}
            </div>
          </section>
        )}
      </div>

      {offerOpen && (
        <OfferModal
          trackId={track.id}
          trackTitle={track.title}
          accent={creator?.accent_color || '#D4BFA0'}
          onClose={() => setOfferOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── Offer Modal ──────────────────────────────────────────── */

function OfferModal({
  trackId,
  trackTitle,
  accent,
  onClose,
}: {
  trackId: string;
  trackTitle: string;
  accent: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const price = Number.parseFloat(priceStr);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = emailValid && Number.isFinite(price) && price > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/store/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId, buyer_email: email.trim(), offered_price_usd: price, message: message.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
      setSent(true);
    } catch (err: any) {
      toast.error('Could not send offer', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-[#1f1a13] bg-[#0e0c08] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-[0.25em]" style={{ color: accent }}>Make an offer</p>
            <h3 className="text-[15px] font-bold text-[#E8DCC8] mt-1 leading-tight">{trackTitle}</h3>
          </div>
          <button onClick={onClose} className="text-[#5a5142] hover:text-[#E8DCC8] transition-colors"><X size={16} /></button>
        </div>

        {sent ? (
          <div className="text-center py-6">
            <Check size={26} className="mx-auto mb-3" style={{ color: accent }} />
            <p className="text-[13px] font-medium text-[#E8DCC8] mb-1">Offer sent</p>
            <p className="text-[11px] text-[#6a5d4a] leading-relaxed">The producer will reply to your email if they want to negotiate.</p>
            <button onClick={onClose} className="mt-5 text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3" noValidate>
            <div>
              <label className="block text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5">Your offer (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6a5d4a] text-[14px]">$</span>
                <input type="number" min="1" step="1" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} placeholder="500"
                  className="w-full bg-[#14110d] border border-[#1f1a13] rounded-lg pl-7 pr-3 py-2.5 text-[14px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] tabular-nums" />
              </div>
            </div>
            <div>
              <label className="block text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5">Your email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email"
                className="w-full bg-[#14110d] border border-[#1f1a13] rounded-lg px-3 py-2.5 text-[13px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]" />
            </div>
            <div>
              <label className="block text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5">Message <span className="text-[#3a3328]">(optional)</span></label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={2000} placeholder="What you'd use it for, timeline, etc."
                className="w-full bg-[#14110d] border border-[#1f1a13] rounded-lg px-3 py-2 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] resize-none" />
            </div>
            <button type="submit" disabled={!valid || submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[12px] font-bold uppercase tracking-wider text-black transition-all disabled:opacity-40"
              style={{ backgroundColor: accent }}>
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Tag size={13} />}
              Send offer
            </button>
            <p className="text-[9px] text-[#3a3328] text-center leading-relaxed">The producer is notified instantly and can reply to negotiate. No payment is taken now.</p>
          </form>
        )}
      </div>
    </div>
  );
}

/* ─── License Card ─────────────────────────────────────────── */

function LicenseCard({
  tier,
  onAddToCart,
  onMakeOffer,
}: {
  tier: LicenseTier;
  onAddToCart: () => void;
  onMakeOffer?: () => void;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-5 flex flex-col gap-4 transition-all ${tier.accentClass} ${
        tier.isExclusive ? '' : 'bg-[#14110d]'
      }`}
    >
      {tier.isExclusive && (
        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-[#D4BFA0]/10 border border-[#D4BFA0]/20 text-[8px] font-mono uppercase tracking-wider text-[#D4BFA0]">
          Exclusive
        </div>
      )}

      {/* Price */}
      <div>
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">
          {tier.name}
        </p>
        <p className="text-[28px] font-bold text-white leading-none mt-1 tabular-nums">
          {price(tier.price)}
        </p>
        <p className="text-[10px] text-[#6a5d4a] mt-1">{tier.tagline}</p>
      </div>

      {/* Files included */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {tier.fileTypes.map((f) => (
          <span
            key={f}
            className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-[9px] font-mono uppercase tracking-wider text-[#a08a6a]"
          >
            {f}
          </span>
        ))}
      </div>

      {/* Rights */}
      <ul className="space-y-1.5">
        {tier.rights.map((r) => (
          <li key={r} className="flex items-start gap-2 text-[11px] text-[#a08a6a]">
            <Check size={10} className="text-[#6DC6A4] shrink-0 mt-0.5" />
            {r}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-auto space-y-2">
        <button
          onClick={onAddToCart}
          className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[12px] font-bold uppercase tracking-wider transition-all ${tier.buttonClass}`}
        >
          <ShoppingCart size={13} />
          Add to Cart
        </button>
        {onMakeOffer && (
          <button
            onClick={onMakeOffer}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[11px] font-medium uppercase tracking-wider border border-[#2d2620] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#3a3328] transition-all"
          >
            <Tag size={12} />
            Make an offer
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Related Card ─────────────────────────────────────────── */

function RelatedCard({ track }: { track: Track }) {
  return (
    <Link
      href={`/store/${track.id}`}
      className="group flex flex-col rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden hover:border-[#2d2620] transition-all"
    >
      <div className="relative w-full aspect-square bg-[#0a0907]">
        {track.cover_url ? (
          <img
            loading="lazy"
            src={track.cover_url}
            alt={track.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#3a3328] bg-gradient-to-br from-[#1f1a13] to-[#0a0907]">
            <Music size={20} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
          <PlayGlyph size={18} className="text-white ml-0.5" />
        </div>
      </div>
      <div className="p-2.5">
        <p className="text-[11px] font-medium text-[#E8DCC8] truncate">{track.title}</p>
        <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider mt-0.5">
          {track.type}{track.bpm ? ` · ${track.bpm}` : ''}
        </p>
      </div>
    </Link>
  );
}
