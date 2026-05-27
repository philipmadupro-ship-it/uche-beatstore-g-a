'use client';

/**
 * The "About the producer" block — name + bio + social icons. Repeated
 * in the Producer tab of /store/projects/[id], /store/projects/access/
 * [token], and /store/playlists/[id]. Centralised here so adding a new
 * social (or restyling the row) is one edit.
 */

import Link from 'next/link';
import { Mail, Globe, AtSign, Link2 } from 'lucide-react';
import { slugify } from '@/lib/slug';

export interface ProducerProfileCreator {
  display_name?: string | null;
  bio?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
}

export function ProducerProfile({ creator }: { creator: ProducerProfileCreator | null }) {
  if (!creator?.display_name) {
    return <p className="text-[13px] text-white/50">Producer details unavailable.</p>;
  }
  return (
    <>
      <Link
        href={`/store/producer/${slugify(creator.display_name)}`}
        className="inline-block max-w-full text-[20px] font-semibold text-white hover:text-[#D4BFA0] transition-colors break-all"
      >
        {creator.display_name}
      </Link>
      {creator.bio && (
        <p className="mt-3 text-[13px] text-white/65 leading-relaxed max-w-2xl whitespace-pre-line">
          {creator.bio}
        </p>
      )}
      <div className="mt-5 flex items-center gap-2 flex-wrap">
        {creator.instagram_handle && (
          <SocialIcon
            href={`https://instagram.com/${creator.instagram_handle.replace(/^@/, '')}`}
            title="Instagram"
          >
            <AtSign size={14} />
          </SocialIcon>
        )}
        {creator.twitter_handle && (
          <SocialIcon
            href={`https://x.com/${creator.twitter_handle.replace(/^@/, '')}`}
            title="X / Twitter"
          >
            <Link2 size={14} />
          </SocialIcon>
        )}
        {creator.website_url && (
          <SocialIcon href={creator.website_url} title="Website">
            <Globe size={14} />
          </SocialIcon>
        )}
        {creator.contact_email && (
          <SocialIcon href={`mailto:${creator.contact_email}`} title="Email">
            <Mail size={14} />
          </SocialIcon>
        )}
      </div>
    </>
  );
}

function SocialIcon({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  const isMail = href.startsWith('mailto:');
  return (
    <a
      href={href}
      title={title}
      target={isMail ? undefined : '_blank'}
      rel={isMail ? undefined : 'noopener noreferrer'}
      className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.05] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.10] transition-colors"
    >
      {children}
    </a>
  );
}
