/**
 * Which image hosts `next/image` is allowed to optimize.
 *
 * This matters more than an allowlist usually does, because `next/image` does
 * not degrade when a host is missing from it — it THROWS at render time
 * ("hostname is not configured under images"), before any `onError` handler
 * can run. A single cover pointing at an unlisted host takes down every page
 * that renders it, with a full-screen error overlay rather than a broken
 * thumbnail.
 *
 * That is reachable from the UI: the store editor's cover field invites a
 * pasted URL ("Paste URL or click thumbnail to upload…") and persists whatever
 * is typed. Paste a link to an image anywhere else on the internet and the
 * library, the links page and the storefront all crash on that track.
 *
 * So the list lives here, next.config.ts builds `remotePatterns` from it, and
 * `CoverImage` checks against the same values before handing a URL to the
 * optimizer — anything else falls back to a plain <img>, which renders any
 * host fine and merely skips the resizing.
 */

/** Static hosts. Wildcards follow Next's own rule: `*` is one label, `**` is many. */
export const REMOTE_IMAGE_HOSTNAMES = [
  // Cloudflare R2 public dev buckets — where covers and previews live today.
  '*.r2.dev',
  '*.r2.cloudflarestorage.com',
] as const;

/**
 * The custom CDN domain, when the producer has wired one up.
 *
 * `NEXT_PUBLIC_R2_CDN_URL` puts a cached Cloudflare domain in front of the
 * bucket. It was never added to the allowlist, so switching it on would have
 * made every optimized cover throw — the exact failure this module exists to
 * prevent, on the happy path of a documented feature.
 */
export function cdnImageHostname(
  cdnUrl: string | undefined = process.env.NEXT_PUBLIC_R2_CDN_URL,
): string | null {
  if (!cdnUrl) return null;
  try {
    return new URL(cdnUrl).hostname || null;
  } catch {
    // A malformed env var must not take the build down; the CDN simply is not
    // allowlisted and its images fall back to unoptimized.
    return null;
  }
}

/** Every hostname pattern that may be optimized, CDN included. */
export function allowedImageHostnames(cdnUrl?: string): string[] {
  const cdn = cdnImageHostname(cdnUrl);
  return cdn ? [...REMOTE_IMAGE_HOSTNAMES, cdn] : [...REMOTE_IMAGE_HOSTNAMES];
}

/**
 * Match a hostname against one pattern, using Next's wildcard semantics:
 * `*` stands for exactly one label, `**` for one or more.
 */
export function matchesHostPattern(hostname: string, pattern: string): boolean {
  if (!hostname || !pattern) return false;
  if (pattern === hostname) return true;
  if (!pattern.includes('*')) return false;

  const escaped = pattern
    .split('.')
    .map((part) => {
      if (part === '**') return '[^.]+(?:\\.[^.]+)*';
      if (part === '*') return '[^.]+';
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('\\.');
  return new RegExp(`^${escaped}$`, 'i').test(hostname);
}

/**
 * Can this src go through the image optimizer?
 *
 * Relative paths are always fine — they are served by this app. Remote URLs
 * are only fine on an allowlisted host. Anything else (blob:, data:, a foreign
 * https host, a malformed string) is not, and the caller must render it with a
 * plain <img> instead of throwing.
 */
export function isOptimizableImageSrc(src: string, cdnUrl?: string): boolean {
  if (!src) return false;
  if (src.startsWith('/')) return true;
  if (!/^https?:\/\//i.test(src)) return false;

  let hostname: string;
  try {
    hostname = new URL(src).hostname;
  } catch {
    return false;
  }
  return allowedImageHostnames(cdnUrl).some((pattern) => matchesHostPattern(hostname, pattern));
}
