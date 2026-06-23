'use client';

import { useState, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ArrowLeft, ShoppingCart, Music, Clock, Gauge,
  Music2, Check, X, Loader2, Globe, Mail,
  AtSign, Download, ChevronRight, Tag, Link2, ArrowRight,
} from 'lucide-react';
import { ProgressBar } from '@/components/player/ProgressBar';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
import { usePlayer } from '@/hooks/usePlayer';
import { useCart } from '@/hooks/useCart';
import { toast } from '@/hooks/useToast';
import { slugify } from '@/lib/slug';
import { BeatComments } from '@/components/store/BeatComments';
import { ShareMenu } from '@/components/store/ShareMenu';
import { seededGradient } from '@/lib/ui/cover-gradient';
import { normalizeThemeColor } from '@/lib/theme/colors';
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
      ? 'border-[#E7D7BE]/30 bg-gradient-to-b from-[#2B2821] to-[#171511]'
      : 'border-[#3B372F] hover:border-[#D0C3AF]/40',
    buttonClass: t.is_exclusive
      ? 'bg-[#E7D7BE] hover:bg-[#F3E6D1] text-black'
      : 'bg-white/[0.06] hover:bg-white/[0.1] text-[#F7EBDD] border border-white/[0.08]',
  };
}

const TYPE_LABELS: Record<string, string> = {
  beat: 'Beat', instrumental: 'Instrumental', song: 'Song', remix: 'Remix',
};

/* ─── Page ──────────────────────────────────────────────────── */

export default function StoreProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue, progress, seekTo } = usePlayer();
  const { addItem, setIsOpen } = useCart();
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
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#9B9282]" />
      </div>
    );
  }
  if (notFound || !track) {
    return (
      <div className="min-h-screen bg-[#090907] flex flex-col items-center justify-center gap-4 text-[#9B9282]">
        <Music size={36} />
        <p className="text-[14px]">Beat not found or no longer for sale.</p>
        <Link href="/store" className="text-[12px] underline hover:text-[#F7EBDD]">← Back to store</Link>
      </div>
    );
  }

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;
  const accent = normalizeThemeColor(creator?.accent_color);

  const handlePlay = () => {
    if (isCurrent) { togglePlay(); return; }
    setQueue([track, ...related]);
    playTrack(track);
  };

  const handleAddToCart = (tier: LicenseTier) => {
    addItem(track, {
      id: tier.id,
      name: tier.name,
      price_usd: tier.price,
      file_types: tier.fileTypes,
      is_exclusive: tier.isExclusive,
    });
    toast.success(`Added "${track.title}" (${tier.name}) to cart`);
    setIsOpen(true);
  };

  const metaChips = [
    track.type && { label: TYPE_LABELS[track.type] ?? track.type, icon: Tag },
    track.bpm && { label: `${track.bpm} BPM`, icon: Gauge },
    (track.key || track.scale) && { label: [track.key, track.scale].filter(Boolean).join(' '), icon: Music2 },
    track.duration_seconds && { label: fmt(track.duration_seconds), icon: Clock },
  ].filter(Boolean) as Array<{ label: string; icon: React.ComponentType<{ size?: number }> }>;

  const licenseGridClass = 'grid grid-cols-1 gap-3';

  return (
    <div className="min-h-screen bg-[#090907] pb-28 text-[#F7EBDD] md:pb-0">

      {/* ── Cinematic hero ──────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        {/* Blurred cover as atmospheric background */}
        {track.cover_url && (
          <img
            src={track.cover_url}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-110 pointer-events-none"
            style={{ filter: 'blur(80px)', opacity: 0.18 }}
          />
        )}
        {/* Gradient: dark top (nav area) → transparent middle → solid page bg at bottom */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#090907]/80 via-transparent to-[#090907]" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-10">
          {/* Back */}
          <div className="pt-6 pb-0">
            <Link
              href="/store"
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#D0C3AF] transition-colors"
            >
              <ArrowLeft size={11} />
              Back to store
            </Link>
          </div>

          {/* Cover + info row */}
          <div className="flex flex-col items-start gap-6 py-8 sm:flex-row sm:items-end md:gap-10 md:py-12">

            {/* Cover — large, playable product signal */}
            <div className="w-[min(78vw,320px)] shrink-0 sm:w-[260px] md:w-[320px]">
              <div
                className="rounded-[18px] p-[2px]"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)' }}
              >
                <button
                  onClick={handlePlay}
                  aria-label={isCurrentPlaying ? 'Pause' : 'Play'}
                  className="relative w-full aspect-square rounded-[16px] overflow-hidden bg-[#171511] group block"
                  style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}
                >
                  {track.cover_url ? (
                    <CoverImage
                      src={track.cover_url}
                      alt={track.title}
                      priority
                      sizes="(max-width: 640px) 78vw, (max-width: 768px) 260px, 320px"
                      className="w-full h-full object-cover group-hover:scale-[1.04] [transition:transform_700ms_cubic-bezier(0.32,0.72,0,1)]"
                    />
                  ) : (
                    <div className="absolute inset-0" style={seededGradient(track.id)}>
                      <div className="w-full h-full flex items-center justify-center"><Music size={40} className="text-[#6E685B]" /></div>
                    </div>
                  )}
                  {/* Play overlay */}
                  <div
                    className={`absolute inset-0 flex items-center justify-center ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    style={{ background: 'rgba(0,0,0,0.4)', transition: 'opacity 250ms cubic-bezier(0.22,1,0.36,1)' }}
                  >
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
                      style={{ backgroundColor: accent }}
                    >
                      {isCurrentPlaying ? <PauseGlyph size={20} /> : <PlayGlyph size={20} className="ml-0.5 text-black" />}
                    </div>
                  </div>
                  {/* Playing badge */}
                  {isCurrent && (
                    <div
                      className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/70 backdrop-blur-sm text-[8px] font-mono uppercase tracking-wider"
                      style={{ color: accent }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] animate-pulse" />
                      {isCurrentPlaying ? 'Now playing' : 'Paused'}
                    </div>
                  )}
                </button>
              </div>
            </div>

            {/* Text + action row */}
            <div className="flex-1 min-w-0 pb-1">
              <p
                className="text-[10px] font-mono uppercase tracking-[0.25em] mb-2"
                style={{ color: `${accent}99` }}
              >
                {TYPE_LABELS[track.type ?? ''] ?? track.type ?? 'Beat'}
              </p>
              <h1 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold text-white leading-[1.05] tracking-tight break-words">
                {track.title}
              </h1>
              {creator?.display_name && (
                <p className="mt-2 text-[13px] text-[#B4AA99]">
                  prod.{' '}
                  <Link
                    href={`/store/producer/${slugify(creator.display_name)}`}
                    className="text-[#D0C3AF] hover:text-[#E7D7BE] transition-colors"
                  >
                    {creator.display_name}
                  </Link>
                </p>
              )}

              {/* Meta chips */}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                {metaChips.map(({ label, icon: Icon }) => (
                  <div
                    key={label}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider text-[#D0C3AF]"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <Icon size={10} />
                    {label}
                  </div>
                ))}
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {tags.map(({ tag, category }) => (
                    <span
                      key={`${category}:${tag}`}
                      className="px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider border border-[#2B2821] bg-white/[0.03] text-[#B4AA99]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Play + share row */}
              <div className="flex items-center gap-3 mt-5">
                <button
                  onClick={handlePlay}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-[12px] font-bold uppercase tracking-wider transition-all active:scale-[0.97]"
                  style={{
                    backgroundColor: accent,
                    color: '#090907',
                    transition: 'all 300ms cubic-bezier(0.32,0.72,0,1)',
                  }}
                >
                  {isCurrentPlaying
                    ? <><PauseGlyph size={14} /> Pause</>
                    : <><PlayGlyph size={14} className="ml-0.5" /> Play</>}
                </button>
                <ShareMenu
                  trackId={track.id}
                  trackTitle={track.title}
                  producerName={creator?.display_name ?? null}
                  accentColor={accent}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Full-width progress line — between hero and content ──── */}
      <div className="max-w-7xl mx-auto px-4 md:px-10 -mt-2 mb-10">
        <div
          className="rounded-2xl px-5 py-5"
          style={{ background: '#171511', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <ProgressBar
            progress={isCurrent ? progress : 0}
            onSeek={(f) => { if (isCurrent) seekTo(f); else handlePlay(); }}
            accent={accent}
          />
          <div className="flex items-center justify-between mt-2.5">
            <span className="text-[9px] font-mono text-[#6E685B] tabular-nums">
              {isCurrent ? fmt(Math.round((track.duration_seconds ?? 0) * progress)) : '0:00'}
            </span>
            <span className="text-[9px] font-mono text-[#6E685B] tabular-nums">
              {fmt(track.duration_seconds)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 md:px-10 pb-16">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10 lg:items-start">

          {/* ── Left: description + comments ── */}
          <div className="order-2 flex min-w-0 flex-col gap-8 lg:order-1">

            {/* Description */}
            {track.description && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-3">About this track</p>
                <div className="rounded-xl border border-[#2B2821] bg-[#171511] px-5 py-4">
                  <p className="text-[13px] text-[#D0C3AF] leading-relaxed whitespace-pre-line">{track.description}</p>
                </div>
              </div>
            )}

            {/* Comments */}
            {track && (
              <BeatComments
                trackId={track.id}
                trackDurationSeconds={track.duration_seconds}
                accentColor={accent}
                onSeek={(seconds) => {
                  if (!isCurrent) handlePlay();
                  seekTo(seconds / Math.max(track.duration_seconds ?? 1, 1));
                }}
              />
            )}
          </div>

          {/* ── Right sidebar: purchase + producer + similar ── */}
          <aside className="order-1 flex flex-col gap-5 lg:sticky lg:top-24 lg:order-2">

            <div
              id="licenses"
              className="scroll-mt-20 rounded-[18px] p-[1.5px]"
              style={{ background: `linear-gradient(145deg, ${accent}40, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.015))` }}
            >
              <div className="rounded-[17px] bg-[#100d09] p-4 sm:p-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-[#6E685B]">License this beat</p>
                    <p className="mt-1 text-[12px] text-[#B4AA99]">Instant delivery after secure checkout.</p>
                  </div>
                  {licenses.length > 0 && !track.exclusive_sold && (
                    <p className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[#D0C3AF]">
                      from {price(Math.min(...licenses.map((l) => l.price)))}
                    </p>
                  )}
                </div>

                {track.free_download_enabled && (
                  <div className="mb-4 rounded-xl border border-[#6DC6A4]/20 bg-[#6DC6A4]/5 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold text-[#6DC6A4]">Free download available</p>
                        <p className="mt-0.5 text-[10px] text-[#9B9282]">No account needed.</p>
                      </div>
                      <a
                        href={`/api/store/free-download?track_id=${track.id}`}
                        download
                        className="flex shrink-0 items-center gap-2 rounded-full bg-[#6DC6A4] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-[#7ED4B0]"
                      >
                        <Download size={12} />
                        Free
                      </a>
                    </div>
                  </div>
                )}

                {track.exclusive_sold ? (
                  <div className="rounded-xl border border-[#E7D7BE]/30 bg-[#171511] px-5 py-6 text-center">
                    <p className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-[#E7D7BE]">Exclusive sold</p>
                    <p className="text-[12px] leading-relaxed text-[#D0C3AF]">
                      The exclusive rights to this beat have been purchased.
                    </p>
                  </div>
                ) : licenses.length > 0 ? (
                  <>
                    <div className={licenseGridClass}>
                      {licenses.map((tier, i) => (
                        <LicenseCard
                          key={tier.id}
                          tier={tier}
                          accent={accent}
                          recommended={licenses.length > 1 && i === Math.min(1, licenses.length - 1) && !tier.isExclusive}
                          onAddToCart={() => handleAddToCart(tier)}
                          onMakeOffer={tier.isExclusive ? () => setOfferOpen(true) : undefined}
                        />
                      ))}
                    </div>
                    {creator?.license_notes && (
                      <p className="mt-4 border-l-2 border-[#2B2821] pl-3 text-[10px] leading-relaxed text-[#9B9282]">{creator.license_notes}</p>
                    )}
                  </>
                ) : (
                  <div className="rounded-xl border border-[#2B2821] bg-[#171511] px-5 py-6 text-center">
                    <Download size={20} className="mx-auto mb-2 text-[#6E685B]" />
                    <p className="text-[12px] text-[#B4AA99]">No licenses available yet.</p>
                  </div>
                )}

                <button
                  onClick={() => setIsOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 text-[11px] text-[#B4AA99] transition-colors hover:text-[#F7EBDD]"
                >
                  <ShoppingCart size={12} />
                  View cart
                </button>
              </div>
            </div>

            {/* Producer card */}
            {creator && (
              <div
                className="rounded-[14px] p-[1.5px]"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))' }}
              >
                <div className="rounded-[13px] bg-[#171511] p-4">
                  <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] mb-3">Producer</p>
                  {creator.display_name ? (
                    <Link
                      href={`/store/producer/${slugify(creator.display_name)}`}
                      className="block text-[16px] font-bold leading-tight break-words hover:opacity-80 transition-opacity"
                      style={{ color: accent }}
                    >
                      {creator.display_name}
                    </Link>
                  ) : (
                    <p className="text-[16px] font-bold text-[#F7EBDD]">Producer</p>
                  )}
                  {creator.bio && (
                    <p className="text-[11px] text-[#B4AA99] mt-2 leading-relaxed line-clamp-3">{creator.bio}</p>
                  )}
                  <div className="flex items-center gap-3 mt-3 flex-wrap">
                    {creator.instagram_handle && (
                      <a href={`https://instagram.com/${creator.instagram_handle.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono text-[#9B9282] hover:text-[#F7EBDD] transition-colors flex items-center gap-1" title="Instagram">
                        <AtSign size={11} />
                        {creator.instagram_handle.replace(/^@/, '')}
                      </a>
                    )}
                    {creator.twitter_handle && (
                      <a href={`https://twitter.com/${creator.twitter_handle.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono text-[#9B9282] hover:text-[#F7EBDD] transition-colors flex items-center gap-1" title="X / Twitter">
                        <Link2 size={11} />
                        {creator.twitter_handle.replace(/^@/, '')}
                      </a>
                    )}
                    {creator.website_url && (
                      <a href={creator.website_url} target="_blank" rel="noopener noreferrer" className="text-[#9B9282] hover:text-[#F7EBDD] transition-colors" title="Website">
                        <Globe size={14} />
                      </a>
                    )}
                    {creator.contact_email && (
                      <a href={`mailto:${creator.contact_email}`} className="text-[#9B9282] hover:text-[#F7EBDD] transition-colors" title={creator.contact_email}>
                        <Mail size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Similar beats mini list */}
            {related.length > 0 && (
              <div className="rounded-[14px] p-[1.5px]" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))' }}>
                <div className="rounded-[13px] bg-[#171511] p-4">
                  <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] mb-3">More beats</p>
                  <div className="space-y-2">
                    {related.slice(0, 4).map((r) => (
                      <Link key={r.id} href={`/store/${r.id}`} className="flex items-center gap-3 rounded-lg hover:bg-[#1A1813] p-1.5 -mx-1.5 transition-colors group">
                        <div className="w-9 h-9 rounded-md overflow-hidden bg-[#090907] shrink-0">
                          {r.cover_url
                            ? <img src={r.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={12} /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-[#F7EBDD] truncate group-hover:text-[#E7D7BE] transition-colors">{r.title}</p>
                          <p className="text-[8px] font-mono text-[#9B9282] uppercase">{r.bpm ? `${r.bpm} BPM` : ''}{r.key ? ` · ${r.key}` : ''}</p>
                        </div>
                        <ChevronRight size={11} className="text-[#6E685B] group-hover:text-[#9B9282] shrink-0 transition-colors" />
                      </Link>
                    ))}
                    {related.length > 4 && (
                      <Link href="/store" className="flex items-center justify-center gap-1 py-2 text-[9px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#D0C3AF] transition-colors">
                        View all <ChevronRight size={9} />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* ── Fans also bought ── */}
        {fansAlsoBought.length > 0 && (
          <section className="mt-16">
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] mb-5" style={{ color: accent }}>
              Fans also bought
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
              {fansAlsoBought.map((r) => <RelatedCard key={r.id} track={r} />)}
            </div>
          </section>
        )}

        {/* ── You might also like ── */}
        {related.length > 0 && (
          <section className="mt-14">
            <div className="flex items-center justify-between mb-5">
              <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#9B9282]">You might also like</p>
              <Link href="/store" className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#D0C3AF] transition-colors">
                View all <ChevronRight size={10} />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
              {related.map((r) => <RelatedCard key={r.id} track={r} />)}
            </div>
          </section>
        )}
      </div>

      {offerOpen && (
        <OfferModal
          trackId={track.id}
          trackTitle={track.title}
          accent={accent}
          onClose={() => setOfferOpen(false)}
        />
      )}

      {/* ── Sticky mobile buy bar — keeps the purchase path visible while
            the license cards scroll away. Hidden on md+ where the cards
            stay in view. Single tier adds straight to cart; multiple
            tiers scroll back to the comparison. ── */}
      {!track.exclusive_sold && licenses.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#2B2821] bg-[#0c0a08]/95 px-4 py-3 backdrop-blur-xl md:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[#F7EBDD]">{track.title}</p>
              <p className="text-[10px] font-mono text-[#9B9282]">
                from <span className="font-bold tabular-nums" style={{ color: accent }}>{price(Math.min(...licenses.map((l) => l.price)))}</span>
              </p>
            </div>
            <button
              onClick={() => {
                if (licenses.length === 1) { handleAddToCart(licenses[0]); return; }
                document.getElementById('licenses')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="flex shrink-0 items-center gap-2 rounded-full px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-black transition-transform active:scale-[0.98]"
              style={{ backgroundColor: accent }}
            >
              <ShoppingCart size={13} />
              {licenses.length === 1 ? 'Add to cart' : 'Choose license'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── License Card ─────────────────────────────────────────── */

function LicenseCard({ tier, accent, recommended = false, onAddToCart, onMakeOffer }: {
  tier: LicenseTier;
  accent: string;
  recommended?: boolean;
  onAddToCart: () => void;
  onMakeOffer?: () => void;
}) {
  const exclusive = tier.isExclusive;

  // Double-bezel: the exclusive + recommended tiers get a richer accent
  // tray so they read as the premium option; standard tiers get a neutral
  // hairline tray. The inner core carries the real surface.
  const bezel = exclusive
    ? `linear-gradient(150deg, ${accent}66, ${accent}18 55%, rgba(255,255,255,0.03))`
    : recommended
      ? `linear-gradient(150deg, ${accent}40, rgba(255,255,255,0.04))`
      : 'linear-gradient(150deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))';

  return (
    <div
      className="group relative rounded-[20px] p-[1.5px] flex transition-transform duration-300 hover:-translate-y-0.5"
      style={{ background: bezel, boxShadow: exclusive ? `0 18px 50px -20px ${accent}55` : undefined }}
    >
      <div className="relative flex flex-col w-full rounded-[19px] bg-[#100d09] overflow-hidden">
        {/* Ribbon — recommended or exclusive */}
        {(exclusive || recommended) && (
          <div
            className="absolute top-0 right-0 px-2.5 py-1 rounded-bl-[10px] text-[8px] font-mono uppercase tracking-[0.18em]"
            style={exclusive
              ? { background: accent, color: '#090907' }
              : { background: `${accent}1f`, color: accent, borderLeft: `1px solid ${accent}33`, borderBottom: `1px solid ${accent}33` }}
          >
            {exclusive ? 'Full ownership' : 'Popular'}
          </div>
        )}

        <div className="p-5 flex flex-col gap-5 h-full">
          {/* Header — name + price */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-[#B4AA99]">{tier.name}</p>
            <div className="flex items-baseline gap-1.5 mt-1.5">
              <span className="text-[32px] font-bold text-white leading-none tracking-tight tabular-nums">
                {price(tier.price)}
              </span>
              <span className="text-[10px] font-mono text-[#9B9282] uppercase tracking-wider">one-time</span>
            </div>
            <p className="text-[11px] text-[#8a7a5f] mt-2 leading-snug">{tier.tagline}</p>
          </div>

          {/* Files included */}
          <div>
            <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#837B6D] mb-1.5">You receive</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {tier.fileTypes.map((f) => (
                <span
                  key={f}
                  className="px-2 py-1 rounded-md text-[9px] font-mono font-semibold uppercase tracking-wider"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#b8a888' }}
                >
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-white/[0.07] to-transparent" />

          {/* Rights — refined rows, thin accent tick */}
          <ul className="space-y-2 flex-1">
            {tier.rights.map((r) => (
              <li key={r} className="flex items-start gap-2.5 text-[11.5px] text-[#D0C3AF] leading-snug">
                <Check size={11} className="shrink-0 mt-0.5" style={{ color: accent }} strokeWidth={2.5} />
                <span>{r}</span>
              </li>
            ))}
          </ul>

          {/* CTA — button-in-button with trailing arrow */}
          <div className="mt-auto space-y-2">
            <button
              onClick={onAddToCart}
              className="group/btn relative w-full flex items-center justify-center gap-2 rounded-full py-3.5 pl-5 pr-3 text-[12px] font-bold uppercase tracking-wider transition-all active:scale-[0.98]"
              style={exclusive || recommended
                ? { backgroundColor: accent, color: '#090907' }
                : { backgroundColor: 'rgba(255,255,255,0.06)', color: '#F7EBDD', border: '1px solid rgba(255,255,255,0.10)' }}
            >
              <ShoppingCart size={13} />
              <span>Add to cart</span>
              <span
                className="ml-1 w-6 h-6 rounded-full flex items-center justify-center transition-transform duration-300 group-hover/btn:translate-x-0.5"
                style={{ background: exclusive || recommended ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)' }}
              >
                <ArrowRight size={12} />
              </span>
            </button>
            {onMakeOffer && (
              <button
                onClick={onMakeOffer}
                className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-[10px] font-mono uppercase tracking-[0.15em] text-[#B4AA99] hover:text-[#F7EBDD] transition-colors"
              >
                <Tag size={11} />
                or make an offer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Related Card ─────────────────────────────────────────── */

function RelatedCard({ track }: { track: Track }) {
  return (
    <Link href={`/store/${track.id}`} className="group flex flex-col rounded-xl border border-[#2B2821] bg-[#171511] overflow-hidden hover:border-[#3B372F] transition-all">
      <div className="relative w-full aspect-square bg-[#090907]">
        {track.cover_url ? (
          <img loading="lazy" src={track.cover_url} alt={track.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#6E685B] bg-gradient-to-br from-[#2B2821] to-[#090907]">
            <Music size={20} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
          <PlayGlyph size={18} className="text-white ml-0.5" />
        </div>
      </div>
      <div className="p-2.5">
        <p className="text-[11px] font-medium text-[#F7EBDD] truncate">{track.title}</p>
        <p className="text-[9px] font-mono text-[#9B9282] uppercase tracking-wider mt-0.5">
          {track.type}{track.bpm ? ` · ${track.bpm}` : ''}
        </p>
      </div>
    </Link>
  );
}

/* ─── Offer Modal ──────────────────────────────────────────── */

function OfferModal({ trackId, trackTitle, accent, onClose }: {
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

  const offerPrice = Number.parseFloat(priceStr);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = emailValid && Number.isFinite(offerPrice) && offerPrice > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/store/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId, buyer_email: email.trim(), offered_price_usd: offerPrice, message: message.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
      setSent(true);
    } catch (err) {
      toast.error('Could not send offer', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-[#2B2821] bg-[#11100D] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-[0.25em]" style={{ color: accent }}>Make an offer</p>
            <h3 className="text-[15px] font-bold text-[#F7EBDD] mt-1 leading-tight">{trackTitle}</h3>
          </div>
          <button onClick={onClose} className="text-[#9B9282] hover:text-[#F7EBDD] transition-colors"><X size={16} /></button>
        </div>
        {sent ? (
          <div className="text-center py-6">
            <Check size={26} className="mx-auto mb-3" style={{ color: accent }} />
            <p className="text-[13px] font-medium text-[#F7EBDD] mb-1">Offer sent</p>
            <p className="text-[11px] text-[#B4AA99] leading-relaxed">The producer will reply to your email if interested.</p>
            <button onClick={onClose} className="mt-5 text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#F7EBDD] transition-colors">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3" noValidate>
            <div>
              <label htmlFor="offer-price" className="block text-[9px] font-mono uppercase tracking-wider text-[#9B9282] mb-1.5">Your offer (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B4AA99] text-[14px]">$</span>
                <input id="offer-price" type="number" min="1" step="1" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} placeholder="500"
                  className="w-full bg-[#171511] border border-[#2B2821] rounded-lg pl-7 pr-3 py-2.5 text-[14px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F] tabular-nums" />
              </div>
            </div>
            <div>
              <label htmlFor="offer-email" className="block text-[9px] font-mono uppercase tracking-wider text-[#9B9282] mb-1.5">Your email</label>
              <input id="offer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email"
                className="w-full bg-[#171511] border border-[#2B2821] rounded-lg px-3 py-2.5 text-[13px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]" />
            </div>
            <div>
              <label htmlFor="offer-message" className="block text-[9px] font-mono uppercase tracking-wider text-[#9B9282] mb-1.5">Message <span className="text-[#6E685B]">(optional)</span></label>
              <textarea id="offer-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={2000} placeholder="What you'd use it for, timeline, etc."
                className="w-full bg-[#171511] border border-[#2B2821] rounded-lg px-3 py-2 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F] resize-none" />
            </div>
            <button type="submit" disabled={!valid || submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[12px] font-bold uppercase tracking-wider text-black transition-all disabled:opacity-40"
              style={{ backgroundColor: accent }}>
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Tag size={13} />}
              Send offer
            </button>
            <p className="text-[9px] text-[#6E685B] text-center leading-relaxed">No payment is taken now.</p>
          </form>
        )}
      </div>
    </div>
  );
}
