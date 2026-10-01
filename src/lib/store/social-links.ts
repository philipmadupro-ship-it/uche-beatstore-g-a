/**
 * The producer's social profiles as label + href. `resolveCreatorLink` is the
 * one rule every storefront and share surface uses to turn a stored handle / URL
 * / email into a destination; `storeSocialLinks` is the `links` section's list.
 */
import type { CreatorProfile } from '@/components/store/types';

export type StoreSocialLink = { label: string; href: string };

type SocialFields = Pick<CreatorProfile,
  'instagram_handle' | 'twitter_handle' | 'spotify_url' | 'soundcloud_url' | 'website_url'>;

export type CreatorLinkKind = 'instagram' | 'x' | 'spotify' | 'soundcloud' | 'website' | 'email';
export type ResolvedCreatorLink = { href: string; label: string };

/**
 * Stored profile values are free text (the profile route only caps length), and
 * every public surface used to interpolate them straight into `href`: a pasted
 * `https://instagram.com/me` became `instagram.com/https://instagram.com/me`, a
 * bare `open.spotify.com/...` became a relative link into our own site, and
 * `javascript:` was emitted verbatim. This is the single place a stored value
 * becomes a destination; anything it cannot vouch for resolves to null and the
 * caller renders nothing rather than a dead or hostile link.
 */
const HANDLE_RULES = {
  instagram: { host: /^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\//i, valid: /^[A-Za-z0-9._]{1,30}$/, origin: 'https://instagram.com/' },
  x: { host: /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\//i, valid: /^[A-Za-z0-9_]{1,15}$/, origin: 'https://x.com/' },
} as const;

/** `@me`, `me`, or a pasted profile URL → the bare handle, else null. */
function handleOf(kind: keyof typeof HANDLE_RULES, raw: string): string | null {
  const rule = HANDLE_RULES[kind];
  let v = raw.trim().replace(rule.host, '');
  v = v.split(/[/?#]/)[0].replace(/^@/, '');
  return rule.valid.test(v) ? v : null;
}

/** http(s) only, with a real host and no `user:pass@` (a phishing shape). */
function webUrl(value: string): string | null {
  const v = value.trim();
  let candidate: string | null = null;
  if (/^https?:\/\/[^/\s]\S*$/i.test(v)) candidate = v;
  else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i.test(v)) candidate = `https://${v}`;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || !url.hostname.includes('.')) return null;
  } catch {
    return null;
  }
  return candidate;
}

/** Conservative on purpose: nothing that could smuggle a `mailto:` header (`?cc=`, `,`, `%0d`). */
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

const URL_LABELS = { spotify: 'Spotify', soundcloud: 'SoundCloud', website: 'Website' } as const;

export function resolveCreatorLink(kind: CreatorLinkKind, raw: string | null | undefined): ResolvedCreatorLink | null {
  if (!raw || !raw.trim()) return null;
  if (kind === 'instagram' || kind === 'x') {
    const h = handleOf(kind, raw);
    return h ? { href: `${HANDLE_RULES[kind].origin}${h}`, label: `@${h}` } : null;
  }
  if (kind === 'email') {
    const v = raw.trim();
    return EMAIL.test(v) ? { href: `mailto:${v}`, label: v } : null;
  }
  const href = webUrl(raw);
  return href ? { href, label: URL_LABELS[kind] } : null;
}

export function storeSocialLinks(creator: Partial<SocialFields> | null | undefined): StoreSocialLink[] {
  if (!creator) return [];
  const rows: Array<[string, CreatorLinkKind, string | null | undefined]> = [
    ['Instagram', 'instagram', creator.instagram_handle],
    ['X', 'x', creator.twitter_handle],
    ['Spotify', 'spotify', creator.spotify_url],
    ['SoundCloud', 'soundcloud', creator.soundcloud_url],
    ['Website', 'website', creator.website_url],
  ];
  const links: StoreSocialLink[] = [];
  for (const [label, kind, raw] of rows) {
    const link = resolveCreatorLink(kind, raw);
    if (link) links.push({ label, href: link.href });
  }
  return links;
}

type LinkFields = Partial<Record<
  'instagram_handle' | 'twitter_handle' | 'spotify_url' | 'soundcloud_url' | 'website_url' | 'contact_email',
  string | null
>>;

const FIELD_LABELS: Array<[keyof LinkFields, CreatorLinkKind, string]> = [
  ['instagram_handle', 'instagram', 'Instagram'],
  ['twitter_handle', 'x', 'X'],
  ['spotify_url', 'spotify', 'Spotify'],
  ['soundcloud_url', 'soundcloud', 'SoundCloud'],
  ['website_url', 'website', 'Website'],
  ['contact_email', 'email', 'Email'],
];

/**
 * Labels of the profile link fields that hold something the storefront will
 * refuse to link (`resolveCreatorLink` → null). Empty fields are fine; this is
 * for the save-time warning, so a producer learns the link is dead when they
 * press Save rather than when a visitor can't click it.
 */
export function unusableCreatorLinks(fields: LinkFields | null | undefined): string[] {
  if (!fields) return [];
  return FIELD_LABELS
    .filter(([key, kind]) => !!fields[key]?.trim() && !resolveCreatorLink(kind, fields[key]))
    .map(([, , label]) => label);
}

/** Toast copy for `unusableCreatorLinks`, or null when every filled field is usable. */
export function unusableLinksWarning(fields: LinkFields | null | undefined): { title: string; description: string } | null {
  const bad = unusableCreatorLinks(fields);
  if (bad.length === 0) return null;
  return {
    title: bad.length === 1 ? `${bad[0]} link won't show` : `${bad.length} links won't show`,
    description: `${bad.join(', ')} ${bad.length === 1 ? "isn't" : "aren't"} a valid link or handle, so it is hidden on your storefront. Saved as typed — fix it to show it.`,
  };
}
