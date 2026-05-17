'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Music, Mail, Instagram, Twitter, Globe, ExternalLink,
  Play, Pause, ChevronRight, Mic2,
} from 'lucide-react';

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
  /** Plays/pauses the given track in whatever audio shell the parent
   *  page owns (the share page already mounts a Wavesurfer instance;
   *  we just hand it the track to switch to). */
  onPlay: (track: Track) => void;
  /** Currently-playing track id, used to flip the play/pause icon. */
  playingId?: string | null;
  isPlaying?: boolean;
}

export function ClientShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying }: Props) {
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
                      </div>
                      <ChevronRight size={14} className="text-[#3a3328] shrink-0 group-hover:text-[#E8DCC8] transition-colors" />
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
                  </div>
                )}
                {creator?.license_exclusive_price_usd != null && (
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-2">Exclusive</p>
                    <p className="text-3xl font-medium text-[#E8D8B8]">
                      ${creator.license_exclusive_price_usd.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-[#a08a6a] mt-1">full transfer of rights</p>
                  </div>
                )}
              </div>
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
                  icon={<Instagram size={12} />}
                  label={`@${creator.instagram_handle.replace(/^@/, '')}`}
                />
              )}
              {creator?.twitter_handle && (
                <SocialPill
                  href={`https://twitter.com/${creator.twitter_handle.replace(/^@/, '')}`}
                  icon={<Twitter size={12} />}
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
