/**
 * Bounded HTTP Range (LABEL-72). The lossy full-length derivative of a master is streamed to the public
 * store through the server, and "the whole file in one response" is exactly what a scraper wants: every
 * response is a PARTIAL of at most `DERIVATIVE_MAX_RANGE_BYTES`, whatever was asked.
 *
 *  - no Range header, an unparseable one, or several ranges → the first chunk (206, never 200);
 *  - `bytes=a-` (open-ended) and `bytes=a-b` wider than the cap → clamped to the cap;
 *  - `bytes=-n` (suffix) → the last `min(n, cap)` bytes;
 *  - a start at or past the end of the file → 416.
 *
 * An audio element (and wavesurfer) asks for what it needs next and carries on with the next range, so a
 * bounded partial plays exactly as a whole body would, just in more requests (which the limiter counts).
 */

/** 1 MiB: about 65 s of the 128 kbps derivative. */
export const DERIVATIVE_MAX_RANGE_BYTES = 1024 * 1024;

export type RangePlan = { ok: true; start: number; end: number } | { ok: false };

export function planCappedRange(header: string | null | undefined, size: number, cap: number = DERIVATIVE_MAX_RANGE_BYTES): RangePlan {
  if (!Number.isFinite(size) || size <= 0 || cap <= 0) return { ok: false };
  const last = size - 1;
  const first = (): RangePlan => ({ ok: true, start: 0, end: Math.min(last, cap - 1) });
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header ?? '');
  // No header, a malformed one, or `bytes=0-1,5-9`: RFC 9110 lets a server ignore a Range it does not honour.
  if (!m || (m[1] === '' && m[2] === '')) return first();
  if (m[1] === '') {
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false };
    const len = Math.min(n, cap, size);
    return { ok: true, start: size - len, end: last };
  }
  const start = Number(m[1]);
  if (!Number.isSafeInteger(start) || start > last) return { ok: false };
  const requested = m[2] === '' ? last : Number(m[2]);
  if (!Number.isSafeInteger(requested) || requested < start) return { ok: false };
  return { ok: true, start, end: Math.min(requested, last, start + cap - 1) };
}
