/**
 * Stateless buyer-account tokens.
 *
 * A buyer enters their email on /store/account; we email them a link to
 * /store/account/<token>. The token is an HMAC-signed payload of
 *
 *   <base64url(email)>.<expiry-unix-seconds>.<base64url(hmac-sha256)>
 *
 * No DB row — verification just re-derives the HMAC and checks expiry.
 * Signing key reuses STRIPE_WEBHOOK_SECRET so we don't add another env
 * var (it's already required for prod webhooks).
 *
 * Expiry is intentionally short (24h). If the buyer needs another link
 * they can request one — the cost is negligible.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_SECONDS = 24 * 60 * 60; // 24h

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}
function fromB64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

function signingKey(): string {
  const key = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key) throw new Error('STRIPE_WEBHOOK_SECRET is required to sign buyer tokens');
  return key;
}

function hmac(input: string, key: string): Buffer {
  return createHmac('sha256', key).update(input).digest();
}

/** Mint a token for an email address. Returns the encoded string. */
export function signBuyerToken(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error('email required');
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${b64url(normalized)}.${exp}`;
  const sig = b64url(hmac(payload, signingKey()));
  return `${payload}.${sig}`;
}

export interface BuyerTokenClaims {
  email: string;
  exp: number;
}

/**
 * Verify a token. Returns the claims when valid, null when malformed,
 * expired, or signature mismatch.
 */
export function verifyBuyerToken(token: string): BuyerTokenClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [emailB64, expStr, sigB64] = parts;

  // Constant-time signature check
  let key: string;
  try { key = signingKey(); } catch { return null; }
  const expected = hmac(`${emailB64}.${expStr}`, key);
  let provided: Buffer;
  try { provided = Buffer.from(sigB64, 'base64url'); } catch { return null; }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return null;
  if (Math.floor(Date.now() / 1000) >= exp) return null;

  let email: string;
  try { email = fromB64url(emailB64); } catch { return null; }
  if (!email) return null;

  return { email, exp };
}
