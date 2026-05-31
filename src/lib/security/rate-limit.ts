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

/**
 * Durable, cross-instance rate limit backed by Postgres (mig 074), with an
 * in-memory fallback. Returns true if allowed, false if over the limit.
 *
 * Uses the atomic rate_limit_hit() RPC so the limit holds across serverless
 * instances/regions and cold starts. If Supabase is unconfigured or the RPC
 * errors, falls back to the per-instance limiter so a DB hiccup never takes
 * the endpoint down — it just degrades to local throttling.
 */
export async function rateLimitDurable(key: string, limit: number, windowMs = 60_000): Promise<boolean> {
  try {
    // Lazy import to keep this module usable in pure-logic/unit contexts.
    const { isSupabaseConfigured } = await import('@/lib/local-store');
    if (!isSupabaseConfigured()) return rateLimit(key, limit, windowMs);
    const { createServiceClient } = await import('@/lib/auth/ownership');
    const admin = createServiceClient();
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_bucket: key,
      p_limit: limit,
      p_window_seconds: Math.ceil(windowMs / 1000),
    });
    if (error) return rateLimit(key, limit, windowMs); // degrade, don't fail
    return data !== false;
  } catch {
    return rateLimit(key, limit, windowMs);
  }
}
