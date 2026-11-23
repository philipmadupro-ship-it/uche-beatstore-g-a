import { createHash } from 'node:crypto';

/**
 * A log-safe reference to a share token: the first 8 hex chars of its sha256.
 * Enough to correlate lines of one request, useless as a credential.
 */
export function tokenRef(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}
