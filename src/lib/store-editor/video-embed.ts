/**
 * Which video URLs a storefront `video` section may embed, and as what.
 *
 * CSP is ENFORCED on /store in production (`lib/security/csp.ts`), so an
 * iframe whose origin is not in `frame-src` is blocked there while the builder
 * — which runs under the dashboard's Report-Only policy — shows it perfectly.
 * That is exactly the "the preview obeys and the storefront does not" failure
 * the layout document exists to prevent. So the section accepts the two
 * providers a producer actually posts beat videos to, rewrites any of their
 * URL shapes into the one embed origin each, and refuses everything else on
 * BOTH surfaces. `buildCsp()` reads `VIDEO_EMBED_ORIGINS` from here, so the
 * policy and the rewrite cannot drift apart.
 *
 * Dependency-free on purpose: the CSP module imports it, and that runs in the
 * proxy on every request.
 */

/** The only origins `videoEmbedUrl` ever produces. */
export const VIDEO_EMBED_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
] as const;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

function youtubeId(url: URL): string | null {
  if (url.hostname === 'youtu.be') return url.pathname.split('/')[1] || null;
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const [, kind, id] = url.pathname.split('/');
  return kind === 'embed' || kind === 'shorts' || kind === 'live' ? id ?? null : null;
}

function vimeoEmbed(url: URL): string | null {
  if (!VIMEO_HOSTS.has(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const idIndex = parts.findIndex((part) => /^\d+$/.test(part));
  if (idIndex < 0) return null;
  const id = parts[idIndex];
  // Unlisted videos carry a privacy hash, either as the next path segment
  // (vimeo.com/123/abc) or already as ?h= on a player URL.
  const hash = url.searchParams.get('h') ?? parts[idIndex + 1];
  const h = hash && /^[A-Za-z0-9]+$/.test(hash) ? `?h=${hash}` : '';
  return `https://player.vimeo.com/video/${id}${h}`;
}

/**
 * An embeddable URL for a producer-supplied video link, or null when the link
 * is not a YouTube or Vimeo video the storefront can frame.
 */
export function videoEmbedUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.hostname = url.hostname.toLowerCase();

  const yt = youtubeId(url);
  if (yt) return YOUTUBE_ID.test(yt) ? `https://www.youtube-nocookie.com/embed/${yt}` : null;
  return vimeoEmbed(url);
}
