/**
 * cdnAudioSrc — resolve a stored audio_url to a URL the plain <audio> element
 * can stream WITHOUT going through our /api/audio proxy.
 *
 * Why this exists: the bottom PlayerBar now plays via a plain HTML5 <audio>
 * element (SimpleAudioEngine), not WaveSurfer. Media elements play cross-origin
 * sources directly and don't need CORS (only Web-Audio *decoding* does, which
 * we no longer do for the player). So every preview stream can come straight
 * from R2 / a CDN — the server never touches the bytes. Under load that's the
 * difference between "Vercel functions hold N streaming connections" and "the
 * edge/CDN serves them and our origin is idle."
 *
 * Optional CDN: set NEXT_PUBLIC_R2_CDN_URL to a Cloudflare-cached custom domain
 * in front of the R2 bucket (e.g. https://cdn.uche-beatstore.com). When set,
 * R2 public URLs are rewritten to it so repeat plays are served from the edge
 * cache. When unset, the direct R2 public URL is used (already public + Range-
 * capable, just not edge-cached).
 *
 * The /api/audio proxy stays for WaveSurfer surfaces that still decode audio
 * (share-page PlayerCanvas) and for purchased-download signing.
 */
export function cdnAudioSrc(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('r2://')) {
    return `/api/audio?src=${encodeURIComponent(url)}`;
  }
  // Already pointed at our proxy — unwrap to the direct src so we don't double
  // through the origin. Checked BEFORE the generic '/' local-path test, since
  // proxy URLs also start with '/'.
  if (url.startsWith('/api/audio')) {
    try {
      const u = new URL(url, 'http://x');
      const inner = u.searchParams.get('src'); // searchParams.get already decodes
      if (inner) return cdnAudioSrc(inner);
    } catch { /* fall through */ }
    return url;
  }
  // Local same-origin (dev /uploads, or an already-relative path) — leave it.
  if (url.startsWith('/')) return url;

  const cdn = process.env.NEXT_PUBLIC_R2_CDN_URL?.replace(/\/$/, '');
  const r2 = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, '');

  // Rewrite the R2 public host → CDN host when a CDN is configured.
  if (cdn && r2 && url.startsWith(r2)) {
    return cdn + url.slice(r2.length);
  }

  // Otherwise stream straight from wherever it lives (R2 public URL, etc.).
  return url;
}

/**
 * Like cdnAudioSrc, but for plain <audio> PLAYBACK of private r2:// refs it
 * opts into the proxy's redirect mode: /api/audio answers with a 302 to a
 * presigned R2 URL (local HMAC — near-instant) and the element streams +
 * Range-seeks directly from R2 instead of piping bytes through the function.
 * Use ONLY for media-element playback (PlayerBar engine) — WaveSurfer/decode
 * surfaces need same-origin bytes and must stay on cdnAudioSrc.
 */
export function playbackAudioSrc(url: string | null | undefined): string {
  const resolved = cdnAudioSrc(url);
  if (resolved.startsWith('/api/audio?') && !resolved.includes('redirect=')) {
    return `${resolved}&redirect=1`;
  }
  return resolved;
}

/**
 * True when browser fetch() may read audio bytes without triggering CORS noise.
 *
 * Plain <audio> playback can stream public R2 URLs directly, but fetch() cannot
 * read them unless the bucket/CDN sends CORS headers. We use this only for
 * background cache/warmup paths that need readable bytes; normal playback still
 * uses playbackAudioSrc().
 */
export function canFetchReadableAudio(url: string | null | undefined): boolean {
  if (!url) return false;
  const resolved = cdnAudioSrc(url);
  if (!resolved) return false;
  if (resolved.startsWith('/') || resolved.startsWith('blob:')) return true;
  if (!/^https?:\/\//i.test(resolved)) return false;

  const cdn = process.env.NEXT_PUBLIC_R2_CDN_URL?.replace(/\/$/, '');
  if (cdn && resolved.startsWith(cdn)) return true;

  const r2 = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, '');
  if (r2 && resolved.startsWith(r2)) return false;

  try {
    const host = new URL(resolved).hostname;
    if (host.endsWith('.r2.dev')) return false;
  } catch {
    return false;
  }

  return true;
}
