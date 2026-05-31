/**
 * Lightweight in-memory rate limiter for public, unauthenticated endpoints
 * (offers, follows, contact, free-download). Defense-in-depth against burst
 * abuse + email-bombing the producer's inbox.
 *
 * Honest scope: this is per-serverless-instance memory. It throttles a single
 * client hammering a warm instance and resets on cold start / across regions.
 * For a hard global guarantee you'd back it with Upstash/Redis or a Postgres
 * counter — wire that here later without changing call sites. For now it
 * meaningfully raises the cost of abuse with zero new infrastructure.
 */

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map can't grow unbounded.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}

/**
 * Returns true if the action is allowed, false if the caller is over the limit.
 * @param key   stable identifier (e.g. `offer:<ip>`)
 * @param limit max actions per window
 * @param windowMs window length in ms (default 60s)
 */
export function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
