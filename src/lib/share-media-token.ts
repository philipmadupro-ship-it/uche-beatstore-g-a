import { createHmac, timingSafeEqual } from 'crypto';

const GRANT_TTL_SECONDS = 15 * 60;

function signingSecret(): string {
  const secret = process.env.SHARE_MEDIA_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return 'antigravity-local-share-media';
  throw new Error('SHARE_MEDIA_TOKEN_SECRET is not configured');
}

function signature(token: string, trackId: string, expires: number): string {
  return createHmac('sha256', signingSecret())
    .update(`${token}\0${trackId}\0${expires}`)
    .digest('base64url');
}

export function signedSharePreviewUrl(token: string, trackId: string): string {
  const expires = Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS;
  const sig = signature(token, trackId, expires);
  return `/api/share/${encodeURIComponent(token)}/preview/${encodeURIComponent(trackId)}?expires=${expires}&sig=${encodeURIComponent(sig)}`;
}

export function verifyShareMediaGrant(
  token: string,
  trackId: string,
  expiresRaw: string | null,
  provided: string | null,
): boolean {
  const expires = Number(expiresRaw);
  if (!provided || !Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = signature(token, trackId, expires);
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
