/**
 * The producer's social profiles as label + href, for the storefront `links`
 * section. Same URL shapes `ArtistBioBlock` builds for the hero's icons, so a
 * handle stored as `@name` resolves the same way in both places.
 */
import type { CreatorProfile } from '@/components/store/types';

export type StoreSocialLink = { label: string; href: string };

type SocialFields = Pick<CreatorProfile,
  'instagram_handle' | 'twitter_handle' | 'spotify_url' | 'soundcloud_url' | 'website_url'>;

function handle(value: string): string {
  return value.trim().replace(/^@/, '');
}

/** Stored profile URLs are free text; anything but http(s) is not a link. */
function webUrl(value: string): string | null {
  const v = value.trim();
  if (/^https?:\/\/[^/\s]/i.test(v)) return v;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return `https://${v}`;
  return null;
}

export function storeSocialLinks(creator: Partial<SocialFields> | null | undefined): StoreSocialLink[] {
  if (!creator) return [];
  const links: StoreSocialLink[] = [];
  if (creator.instagram_handle?.trim()) links.push({ label: 'Instagram', href: `https://instagram.com/${handle(creator.instagram_handle)}` });
  if (creator.twitter_handle?.trim()) links.push({ label: 'X', href: `https://x.com/${handle(creator.twitter_handle)}` });
  const urls: Array<[string, string | null | undefined]> = [
    ['Spotify', creator.spotify_url],
    ['SoundCloud', creator.soundcloud_url],
    ['Website', creator.website_url],
  ];
  for (const [label, raw] of urls) {
    const href = raw ? webUrl(raw) : null;
    if (href) links.push({ label, href });
  }
  return links;
}
