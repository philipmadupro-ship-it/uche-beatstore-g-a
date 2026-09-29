/**
 * What a producer-authored storefront section may put in front of a buyer.
 *
 * The Design builder lets a producer add `text`, `image`, `video`, `links` and
 * free-form `canvas` sections, and type any URL into them. The builder shows
 * hints ("Add your text in the inspector") where content is missing; the live
 * storefront must show nothing instead, and must never load a URL it cannot
 * vouch for. Everything that decides that lives here, pure and tested, so the
 * builder's preview and `/store` cannot disagree about it.
 *
 * `/store` is served under an ENFORCED CSP (`lib/security/csp.ts`). Images are
 * fine (`img-src https:`), but a video is an iframe, and `frame-src` names its
 * origins. So video is limited to YouTube and Vimeo, rewritten to their embed
 * players, and `VIDEO_EMBED_ORIGINS` is what the CSP allows. A URL that is not
 * one of those renders nothing on the store, and the builder says so.
 */

import type { CanvasBlock, StoreSection } from './layout';

/** The origins `publicVideoEmbed` can return. `buildCsp()` adds these to frame-src. */
export const VIDEO_EMBED_ORIGINS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'] as const;

function parseUrl(value: string | null | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

/**
 * A YouTube or Vimeo URL, as the embed player URL the store may frame, or null.
 * Accepts watch, short, share and embed forms. YouTube goes through the
 * no-cookie host, so a buyer who never presses play is not tracked by it.
 */
export function publicVideoEmbed(value: string | null | undefined): string | null {
  const url = parseUrl(value);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  let youtubeId: string | null = null;
  if (host === 'youtu.be') youtubeId = parts[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') youtubeId = url.searchParams.get('v');
    else if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') youtubeId = parts[1] ?? null;
  }
  if (youtubeId && YOUTUBE_ID.test(youtubeId)) return `https://www.youtube-nocookie.com/embed/${youtubeId}`;

  let vimeoId: string | null = null;
  if (host === 'vimeo.com') vimeoId = parts[0] ?? null;
  else if (host === 'player.vimeo.com' && parts[0] === 'video') vimeoId = parts[1] ?? null;
  if (vimeoId && VIMEO_ID.test(vimeoId)) return `https://player.vimeo.com/video/${vimeoId}`;

  return null;
}

/** An `https:` URL or a site path (`/store/…`) for an <img>, or null. */
export function publicImageUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  const url = parseUrl(trimmed);
  return url && url.protocol === 'https:' ? url.toString() : null;
}

/**
 * A link target a buyer may be sent to: http(s) or a site path. Anything else
 * (`javascript:`, `data:`, a protocol-relative `//host`) is dropped rather
 * than rendered, since the producer typed it into a free-text field.
 */
export function publicHref(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  const url = parseUrl(trimmed);
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url.toString() : null;
}

export type CreatorLinkFields = {
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website_url?: string | null;
};

export type CreatorLink = { label: string; href: string };

function handle(value: string | null | undefined): string | null {
  const h = value?.trim().replace(/^@+/, '');
  return h && /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
}

/** The producer's social links, in a fixed order, each with a usable href. */
export function creatorLinks(creator: CreatorLinkFields | null | undefined): CreatorLink[] {
  const links: Array<CreatorLink | null> = [
    handle(creator?.instagram_handle) ? { label: 'Instagram', href: `https://instagram.com/${handle(creator?.instagram_handle)}` } : null,
    handle(creator?.twitter_handle) ? { label: 'X', href: `https://x.com/${handle(creator?.twitter_handle)}` } : null,
    publicHref(creator?.spotify_url) ? { label: 'Spotify', href: publicHref(creator?.spotify_url)! } : null,
    publicHref(creator?.soundcloud_url) ? { label: 'SoundCloud', href: publicHref(creator?.soundcloud_url)! } : null,
    publicHref(creator?.website_url) ? { label: 'Website', href: publicHref(creator?.website_url)! } : null,
  ];
  return links.filter((link): link is CreatorLink => link !== null);
}

/** A canvas block that draws something on the live page. */
export function isVisibleBlock(block: CanvasBlock): boolean {
  if (block.kind === 'text') return Boolean(block.text?.trim());
  if (block.kind === 'image') return publicImageUrl(block.imageUrl) !== null;
  return block.kind === 'shape';
}

/**
 * Does this producer-authored section have anything to show a buyer? The
 * built-in kinds are not decided here (their components own their own empty
 * states), so they answer true.
 */
export function hasPublicContent(section: StoreSection, creator: CreatorLinkFields | null | undefined): boolean {
  const c = section.content;
  switch (section.kind) {
    case 'text':
      return Boolean(c?.heading?.trim() || c?.body?.trim() || (c?.ctaLabel?.trim() && publicHref(c.ctaHref)));
    case 'image':
      return publicImageUrl(c?.imageUrl) !== null;
    case 'video':
      return publicVideoEmbed(c?.videoUrl) !== null;
    case 'links':
      return creatorLinks(creator).length > 0;
    case 'canvas':
      return (c?.blocks ?? []).some(isVisibleBlock);
    default:
      return true;
  }
}

/** The producer-authored kinds, which `/store` draws through `SectionRenderer`. */
export const AUTHORED_SECTION_KINDS = ['text', 'image', 'video', 'links', 'canvas'] as const;

export function isAuthoredSection(kind: StoreSection['kind']): boolean {
  return (AUTHORED_SECTION_KINDS as readonly string[]).includes(kind);
}
