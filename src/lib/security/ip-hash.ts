import { createHash } from 'crypto';

/**
 * Salted IP hash for event rows. Never store the address itself: a producer
 * can see that two downloads came from one place without learning where.
 * Same salt as /api/store/play and /api/store/event, so hashes line up.
 */
export function hashClientIp(ip: string): string {
  const salt = process.env.STRIPE_WEBHOOK_SECRET ?? 'antigravity-default-salt';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}
