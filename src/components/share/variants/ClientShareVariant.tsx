'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Music, Mail, Globe, ExternalLink,
  Play, Pause, ChevronRight, Mic2, Loader2, ShoppingCart,
  CheckCircle2, XCircle, X as CloseIcon,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { ShareWaveformVinyl } from '@/components/share/ShareWaveformVinyl';

// lucide-react removed brand icons in recent versions.
// Small inline SVGs keep the social-pill row working.
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

/**
 * Client / A&R share variant — "intro to my universe."
 *
 * Shown when the share's recipient_kind === 'client'. The brief on what
 * to surface (in order of priority the user picked):
 *   1. Bio paragraph
 *   2. Credits list
 *   3. Hero photo
 *   4. Curated 3-5 tracks  (currently uses the project's full track set)
 *   5. License pricing card
 *   6. Contact + social links
 *
 * Every section is conditional — if the owner hasn't filled out their
 * creator_profile yet, sections render empty rather than printing
 * "Unknown bio" or placeholder text. Better to skip a section than
 * print a half-filled stub.
 *
 * Producer variant (engineer / mix collaborator) lives in
 * ProducerShareVariant — exposes per-stem download instead of the
 * commercial framing here.
 */

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
  // Per-track listing (migration 021). NULL on either field
  // means "inherit profile default" for the display logic below.
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
  /** Share token — needed by the license card to spin up a Stripe
   *  Checkout session. When omitted, the buy buttons render in a
   *  display-only state. */
  shareToken?: string;
  /** Plays/pauses the given track in whatever audio shell the parent
   *  page owns (the share page already mounts a Wavesurfer instance;
   *  we just hand it the track to switch to). */
  onPlay: (track: Track) => void;
  /** Currently-playing track id, used to flip the play/pause icon. */
  playingId?: string | null;
  isPlaying?: boolean;
}

export function ClientShareVariant({ project, tracks, creator, shareToken, onPlay, playingId, isPlaying }: Props) {
  // Purchase-return banner. Stripe's success_url + cancel_url both
  // land back on this page with a ?purchase= param. We surface a
  // dismissible toast-row at the top so the buyer knows their
  // payment landed; without this the redirect looks like a no-op.
  const searchParams = useSearchParams();
  const router = useRouter();
  const purchaseStatus = searchParams?.get('purchase');
  const [bannerOpen, setBannerOpen] = useState(false);
  useEffect(() => {
    setBannerOpen(purchaseStatus === 'success' || purchaseStatus === 'cancelled');
  }, [purchaseStatus]);
  const dismissBanner = () => {
    setBannerOpen(false);
    // Strip the query so a refresh doesn't re-show the banner.
    const url = new URL(window.location.href);
    url.searchParams.delete('purchase');
    url.searchParams.delete('session_id');
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  };

  // Buy-button state for the license card. We collect the buyer's
  // email inline (lighter-touch than a modal) and POST to
  // /api/share/[token]/checkout to create a Stripe Checkout Session.
  // The success_url on the session brings the buyer back to the
  // share page with ?purchase=success.
  const [buyerEmail, setBuyerEmail] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState<null | 'lease' | 'exclusive'>(null);
  const handleBuy = async (licenseType: 'lease' | 'exclusive') => {
    if (!shareToken) return;
    if (!buyerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail)) {
      toast.error('Email required', 'Add your email so we can send the license.');
      return;
    }
    setCheckoutLoading(licenseType);
    try {
      const res = await fetch(`/api/share/${shareToken}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_type: licenseType,
          track_ids: tracks.map((t) => t.id),
          buyer_email: buyerEmail.trim(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (err) {
      toast.error('Checkout failed', err instanceof Error ? err.message : 'Unknown error');
      setCheckoutLoading(null);
    }
  };

  // Defensive: every section guards on the presence of its specific
  // data so a half-filled creator_profile doesn't show empty boxes.
  const hasBio = !!creator?.bio?.trim();
  const hasCredits = !!creator?.credits?.trim();
  const hasHero = !!creator?.hero_image_url;
  const hasLicense = creator?.license_lease_price_usd != null
                  || creator?.license_exclusive_price_usd != null
                  || !!creator?.license_notes?.trim();
  const hasContact = !!creator?.contact_email
                  || !!creator?.instagram_handle
                  || !!creator?.twitter_handle
                  || !!creator?.spotify_url
                  || !!creator?.soundcloud_url
                  || !!creator?.website_url;
  const displayName = creator?.display_name?.trim() || project.name;

  // Hero image fall-through: prefer the creator's portrait, then the
  // project cover, then the first track's cover. Always *something*
  // visible at the top.
  const heroImage = creator?.hero_image_url
    || project.cover_url
    || tracks[0]?.cover_url
    || null;

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">
      {/* Purchase return banner — fixed at the top so it survives
          the hero image. Dismissed by the X or by route-replace
          when the user navigates away. */}
      {bannerOpen && (
        <div className={`sticky top-0 z-50 px-4 md:px-12 py-3 border-b ${
          purchaseStatus === 'success'
            ? 'bg-[#0e1f17] border-[#6DC6A4]/30 text-[#6DC6A4]'
            : 'bg-[#1f1010] border-red-500/30 text-red-300'
        }`}>
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            {purchaseStatus === 'success'
              ? <CheckCircle2 size={16} className="shrink-0" />
              : <XCircle size={16} className="shrink-0" />}
            <p className="text-[12px] font-medium flex-1">
              {purchaseStatus === 'success'
                ? 'Purchase complete — check your inbox for the receipt and download link.'
                : 'Checkout cancelled. No payment was taken.'}
            </p>
            <button
              onClick={dismissBanner}
              className="text-current/60 hover:text-current shrink-0"
              aria-label="Dismiss"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Hero — full-bleed image with a dark overlay so the title
          stays readable regardless of the source photo. Tall but not
          full-viewport so the track list peeks above the fold. */}
      <div className="relative w-full h-[55vh] md:h-[65vh] overflow-hidden">
        {heroImage ? (
          <Image
            src={heroImage}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        ) : (
          // Fallback gradient when no photo at all — uses the same
          // warm-amber → warm-black gradient as the rest of the app's
          // empty states so it doesn't look like a missing-image error.
          <div className="w-full h-full bg-gradient-to-br from-[#2A2418] via-[#14110d] to-[#0a0907]" />
        )}
        {/* Dark wash so the typography reads. Heavier at the bottom
            where the title sits. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/85" />

        <div className="absolute inset-x-0 bottom-0 px-6 md:px-12 pb-10 md:pb-16">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-3">
            Curated for you
          </p>
          <h1 className="text-4xl md:text-6xl font-medium tracking-tight text-white leading-[1.05] max-w-3xl">
            {displayName}
          </h1>
          {project.description && (
            <p className="mt-4 text-[14px] md:text-[15px] text-[#E8DCC8]/80 max-w-2xl leading-relaxed">
              {project.description}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 md:px-12 pt-12 pb-32">
        {/* Now-playing vinyl + waveform. Sits between hero and bio
            so the visitor lands on the music as the centerpiece;
            bio and license card frame the listening experience. */}
        {tracks.length > 0 && (
          <section className="mb-16 flex justify-center">
            <ShareWaveformVinyl
              track={(tracks.find((t) => t.id === playingId) ?? tracks[0]) as any}
              projectCover={project.cover_url}
              caption={displayName}
              isPlaying={isPlaying}
              playingId={playingId ?? null}
              onTogglePlay={onPlay}
              size="large"
            />
          </section>
        )}

        {/* Bio — single paragraph, generous line-height so it reads as
            "an introduction to me," not a bio data row. */}
        {hasBio && (
          <section className="mb-16 max-w-2xl">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mb-3">
              About
            </p>
            <p className="text-[15px] text-[#E8DCC8]/90 leading-[1.7] whitespace-pre-wrap">
              {creator!.bio}
            </p>
          </section>
        )}

        {/* Tracks — focal section. Each row is a play button + title +
            meta + chevron. No technical metadata bloat; clients care
            about feel, not BPM. */}
        <section className="mb-16">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mb-4">
            Selected works · {tracks.length}
          </p>
          <ul className="rounded-2xl border border-[#1f1a13] overflow-hidden divide-y divide-[#1f1a13]">
            {tracks.length === 0 ? (
              <li className="px-5 py-10 text-center text-[12px] text-[#6a5d4a]">
                No tracks in this selection yet.
              </li>
            ) : (
              tracks.map((t, i) => {
                const isCurrent = playingId === t.id;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => onPlay(t)}
                      className="group w-full flex items-center gap-4 px-4 md:px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
                    >
                      <div className="relative w-12 h-12 md:w-14 md:h-14 rounded-lg overflow-hidden bg-[#14110d] border border-[#1f1a13] shrink-0">
                        {t.cover_url ? (
                          <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                            <Music size={18} />
                          </div>
                        )}
                        {/* Play/pause icon overlay — visible on hover or
                            when this track is the active one. */}
                        <div className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
                          isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}>
                          {isCurrent && isPlaying ? <Pause size={18} className="text-white" fill="currentColor" /> : <Play size={18} className="text-white ml-0.5" fill="currentColor" />}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] md:text-[15px] font-medium text-white truncate">
                          {String(i + 1).padStart(2, '0')} · {t.title}
                        </p>
                        <p className="text-[11px] font-mono text-[#6a5d4a] uppercase tracking-wider mt-0.5">
                          {t.type}
                          {t.bpm ? ` · ${t.bpm} bpm` : ''}
                          {t.key ? ` · ${t.key}` : ''}
                        </p>
                        {/* Per-track blurb. Producer fills this in the
                            library detail page; preserves line breaks
                            so multi-line descriptions read clean. */}
                        {t.description && (
                          <p className="text-[12px] text-[#a08a6a] mt-1.5 leading-relaxed whitespace-pre-wrap line-clamp-3">
                            {t.description}
                          </p>
                        )}
                      </div>
                      {/* Right rail: per-track price chip if either
                          override is set, otherwise the chevron. The
                          chip shows the lower (lease) price as the
                          headline number; clients shopping for
                          exclusives will read the full pricing on
                          the license card below. */}
                      {(t.lease_price_usd != null || t.exclusive_price_usd != null) ? (
                        <div className="shrink-0 flex flex-col items-end gap-0.5">
                          {t.lease_price_usd != null && (
                            <span className="text-[11px] font-mono font-bold text-[#E8D8B8] tabular-nums">
                              ${Number(t.lease_price_usd).toLocaleString()}
                            </span>
                          )}
                          {t.exclusive_price_usd != null && (
                            <span className="text-[9px] font-mono text-[#6a5d4a] uppercase tracking-wider tabular-nums">
                              ${Number(t.exclusive_price_usd).toLocaleString()} excl.
                            </span>
                          )}
                        </div>
                      ) : (
                        <ChevronRight size={14} className="text-[#3a3328] shrink-0 group-hover:text-[#E8DCC8] transition-colors" />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        {/* Credits — multi-line list. Owner formats however they want
            (line per placement, prose paragraph, etc); we just preserve
            whitespace and render as a column. */}
        {hasCredits && (
          <section className="mb-16 max-w-2xl">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mb-3 flex items-center gap-2">
              <Mic2 size={11} />
              Selected credits
            </p>
            <p className="text-[13px] text-[#E8DCC8]/85 leading-[1.9] whitespace-pre-wrap font-mono">
              {creator!.credits}
            </p>
          </section>
        )}

        {/* License card — the commercial framing. Two prices side-by-
            side when both set; a single column when only one. Notes
            wrap underneath. */}
        {hasLicense && (
          <section className="mb-16">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mb-3">
              Licensing
            </p>
            <div className="rounded-2xl border border-[#1f1a13] bg-gradient-to-br from-[#14110d] to-[#0a0907] p-6 md:p-8 relative overflow-hidden">
              <div
                className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none opacity-20"
                style={{ background: 'radial-gradient(circle, #D4BFA0 0%, transparent 70%)' }}
              />
              <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-6">
                {creator?.license_lease_price_usd != null && (
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-2">Lease</p>
                    <p className="text-3xl font-medium text-white">
                      ${creator.license_lease_price_usd.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#a08a6a] mt-1">non-exclusive</p>
                    {shareToken && (
                      <button
                        onClick={() => handleBuy('lease')}
                        disabled={checkoutLoading !== null}
                        className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] text-[11px] font-bold uppercase tracking-widest text-[#E8DCC8] transition-colors disabled:opacity-40"
                      >
                        {checkoutLoading === 'lease' ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
                        Buy lease
                      </button>
                    )}
                  </div>
                )}
                {creator?.license_exclusive_price_usd != null && (
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-2">Exclusive</p>
                    <p className="text-3xl font-medium text-[#E8D8B8]">
                      ${creator.license_exclusive_price_usd.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#a08a6a] mt-1">full transfer of rights</p>
                    {shareToken && (
                      <button
                        onClick={() => handleBuy('exclusive')}
                        disabled={checkoutLoading !== null}
                        className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#D4BFA0] text-black hover:bg-[#E8D8B8] text-[11px] font-bold uppercase tracking-widest transition-colors disabled:opacity-40"
                      >
                        {checkoutLoading === 'exclusive' ? <Loader2 size={12} className="animate-spin text-black" /> : <ShoppingCart size={12} />}
                        Buy exclusive
                      </button>
                    )}
                  </div>
                )}
              </div>
              {shareToken && (creator?.license_lease_price_usd != null || creator?.license_exclusive_price_usd != null) && (
                <div className="relative z-10 mt-6 pt-6 border-t border-[#1f1a13]">
                  <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-2 block">
                    Your email for the license
                  </label>
                  <input
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-black/30 border border-white/[0.08] rounded-md py-2.5 px-3 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-white/[0.2] transition-colors"
                  />
                </div>
              )}
              {creator?.license_notes && (
                <p className="relative z-10 text-[12px] text-[#a08a6a] mt-6 pt-6 border-t border-[#1f1a13] leading-relaxed">
                  {creator.license_notes}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Contact + socials — quiet row of pills along the bottom.
            Each link opens in a new tab so the share page itself
            doesn't get navigated away from. */}
        {hasContact && (
          <section className="mb-8">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mb-3">
              Get in touch
            </p>
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
                <SocialPill href={creator.soundcloud_url} icon={<Music size={12} />} label="SoundCloud" />
              )}
              {creator?.website_url && (
                <SocialPill href={creator.website_url} icon={<Globe size={12} />} label="Website" />
              )}
            </div>
          </section>
        )}
      </div>
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
