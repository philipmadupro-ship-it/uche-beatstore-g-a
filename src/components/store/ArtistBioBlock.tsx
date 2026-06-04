'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Globe, Mail, ArrowRight } from 'lucide-react';
import { ParticleText } from '@/components/store/ParticleText';
import { sanitizeUrl } from './helpers';
import { slugify } from '@/lib/slug';
import type { CreatorProfile } from './types';

interface Props {
  creator: CreatorProfile | null;
  trackCount: number;
  accentColor?: string;
}

export function ArtistBioBlock({ creator, trackCount, accentColor }: Props) {
  const [licenseExpanded, setLicenseExpanded] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const bioIsLong = (creator?.bio?.length ?? 0) > 160;
  const hero = sanitizeUrl(creator?.hero_image_url);

  const socialLinks: Array<{ href: string; label: string; icon: React.ReactNode; color: string }> = [];
  if (creator?.instagram_handle) {
    const h = creator.instagram_handle.replace(/^@/, '');
    socialLinks.push({
      href: `https://instagram.com/${h}`, label: 'Instagram', color: 'hover:text-[#E1306C]', icon: (
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    });
  }
  if (creator?.twitter_handle) {
    const h = creator.twitter_handle.replace(/^@/, '');
    socialLinks.push({
      href: `https://x.com/${h}`, label: 'X / Twitter', color: 'hover:text-white', icon: (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.736-8.854L2.5 2.25h6.894l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    });
  }
  if (creator?.spotify_url) {
    socialLinks.push({
      href: creator.spotify_url, label: 'Spotify', color: 'hover:text-[#1DB954]', icon: (
        <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
      )
    });
  }
  if (creator?.soundcloud_url) {
    socialLinks.push({
      href: creator.soundcloud_url, label: 'SoundCloud', color: 'hover:text-[#FF5500]', icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M1.175 12.225c-.014.095 0 .19 0 .285l1.3 5.48H1.175c-.65 0-1.175-.524-1.175-1.175v-3.62c0-.65.524-1.175 1.175-1.175v.205zm2.6-3.92c-.65 0-1.175.524-1.175 1.175v7.63h1.3V8.48c0-.65-.474-1.175-1.125-1.175zm1.3-.3c-.65 0-1.175.524-1.175 1.175v8.43h1.3V9.18c0-.65-.474-1.155-1.125-1.175zm1.3-1.24c-.65 0-1.175.524-1.175 1.175v9.67h1.3V7.94c0-.65-.474-1.175-1.125-1.175zm1.3.175c-.65 0-1.175.524-1.175 1.175v9.495l1.3-.7V7.115c0-.65-.474-1.175-1.125-1.175zm1.3 0c-.65 0-1.175.524-1.175 1.175v9.67c.27.095.555.175.855.175.38 0 .745-.095 1.065-.27V7.115c0-.65-.474-1.175-1.125-1.175z" />
        </svg>
      )
    });
  }
  if (creator?.website_url) {
    socialLinks.push({ href: creator.website_url, label: 'Website', color: 'hover:text-[#E8DCC8]', icon: <Globe size={16} /> });
  }
  if (creator?.contact_email) {
    socialLinks.push({ href: `mailto:${creator.contact_email}`, label: creator.contact_email, color: 'hover:text-[#E8DCC8]', icon: <Mail size={15} /> });
  }

  return (
    <div className="relative w-full overflow-hidden">
      {hero ? (
        <img loading="eager" src={hero} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#2A2418] via-[#14110d] to-[#0a0907]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-[#0a0907]" />

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 md:px-8 pt-12 pb-12 md:pt-32 md:pb-24">
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-3">Beat store</p>
        <h1 className="sr-only">{creator?.display_name || 'Producer'}</h1>
        {/* No max-width on the canvas wrapper — Akira Expanded is very wide
            and max-w-3xl clips long names at the right edge. The canvas
            itself scales the font to fit its actual width, so going
            full-width just means more room before the scale-down kicks in. */}
        <ParticleText
          text={creator?.display_name || 'Producer'}
          color={accentColor || '#D4BFA0'}
          className="relative w-full h-[90px] md:h-[140px]"
        />
        {creator?.bio && (
          <div className="mt-4">
            <p className={`text-[14px] text-[#E8DCC8]/80 max-w-2xl leading-relaxed transition-all ${bioIsLong && !bioExpanded ? 'line-clamp-3' : ''}`}>
              {creator.bio}
            </p>
            {bioIsLong && (
              <button
                onClick={() => setBioExpanded((o) => !o)}
                className="mt-1.5 text-[11px] font-mono text-[#6a5d4a] hover:text-[#a08a6a] transition-colors flex items-center gap-1"
              >
                {bioExpanded ? 'Read less' : 'Read more'}
                <ChevronDown size={10} className={`transition-transform ${bioExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        )}
        {trackCount > 0 && (
          <p className="mt-3 text-[11px] font-mono uppercase tracking-wider text-[#5a5142]">
            {trackCount} beat{trackCount === 1 ? '' : 's'} for sale
          </p>
        )}

        {creator?.license_notes && (
          <div className="mt-5 max-w-2xl">
            <button
              onClick={() => setLicenseExpanded((o) => !o)}
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] hover:text-[#a08a6a] transition-colors"
            >
              License Terms
              <ChevronDown size={11} className={`transition-transform ${licenseExpanded ? 'rotate-180' : ''}`} />
            </button>
            {licenseExpanded && (
              <p className="mt-2 text-[11px] font-mono text-[#5a5142] leading-relaxed whitespace-pre-wrap bg-[#14110d]/60 rounded-lg px-3 py-2 border border-[#1f1a13]">
                {creator.license_notes}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {creator?.display_name && (
            <Link
              href={`/store/producer/${slugify(creator.display_name)}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/20 text-[#E8DCC8] hover:bg-white/10 hover:border-white/30 transition-all text-[11px] font-mono uppercase tracking-wider"
            >
              View full profile
              <ArrowRight size={11} />
            </Link>
          )}
          {socialLinks.map(({ href, label, icon, color }) => (
            <a
              key={href}
              href={href}
              target={href.startsWith('mailto:') ? undefined : '_blank'}
              rel="noopener noreferrer"
              title={label}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/30 border border-white/10 text-[#a08a6a] ${color} hover:bg-black/50 hover:border-white/20 transition-all text-[11px] font-medium`}
            >
              {icon}
              <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-wider">{label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
