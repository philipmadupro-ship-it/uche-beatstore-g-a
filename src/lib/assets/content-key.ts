/**
 * A short, one-way fingerprint of a stored reference (AUDIO-01).
 *
 * It answers one question — "is this the same file I cached?" — without ever
 * putting the reference itself anywhere a browser can see it: an `r2://` key
 * names a private bucket object and must not reach the client, so what is
 * stored beside an offline copy is this hash. Two different references give
 * two different keys (a re-upload or a version revert changes `audio_url`),
 * which is exactly what makes a cached copy detectably stale.
 *
 * Sync and dependency-free on purpose: it runs in the browser (offline meta)
 * and on the server alike. It is a change detector, NOT a security hash.
 */
export function assetContentKey(ref: string | null | undefined): string | null {
  if (!ref) return null;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).slice(0, 12);
}
