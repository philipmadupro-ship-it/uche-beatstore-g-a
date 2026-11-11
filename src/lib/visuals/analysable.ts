/**
 * Can this audio source feed Web Audio without silencing playback?
 *
 * `createMediaElementSource` on an element playing a CROSS-ORIGIN resource that
 * was not fetched with CORS makes the element's output SILENT. So an element
 * may only be captured when its source is same-origin / blob / data, or its
 * origin is known to send CORS headers (and then `crossOrigin="anonymous"` is
 * set BEFORE `src`). Anything else plays untouched and the visual falls back to
 * the track's precomputed peaks.
 */

export type CorsKnowledge = ReadonlyMap<string, boolean>;

export function originOf(src: string, base: string): string | null {
  try {
    const u = new URL(src, base);
    if (u.protocol === 'blob:' || u.protocol === 'data:') return 'self';
    return u.origin;
  } catch {
    return null;
  }
}

export type SourceClass = 'same-origin' | 'cors-ok' | 'unknown' | 'cors-bad';

export function classifySource(src: string, pageOrigin: string, known: CorsKnowledge): SourceClass {
  const o = originOf(src, pageOrigin);
  if (o === null) return 'cors-bad';
  if (o === 'self' || o === pageOrigin) return 'same-origin';
  const k = known.get(o);
  return k === true ? 'cors-ok' : k === false ? 'cors-bad' : 'unknown';
}

/** Only these may be captured (and, for cors-ok, need crossOrigin set first). */
export function canCapture(c: SourceClass): boolean {
  return c === 'same-origin' || c === 'cors-ok';
}

/** The `crossOrigin` attribute a source needs before `src` is assigned. */
export function crossOriginFor(c: SourceClass): 'anonymous' | null {
  return c === 'cors-ok' ? 'anonymous' : null;
}
